#!/usr/bin/env python3
"""lane-governor: admission control for agent lanes in the Claude desktop app, so new work queues instead of crashing it.

    lane-governor acquire --name NAME [--kind subagent|session|run] [--priority N] [--max-wait S] [--no-wait]
                                       wait in the queue for room, take a lane ticket, print its id (exit 75 = wait)
    lane-governor release TICKET       the lane finished (a subagent or run lane; session tickets expire by themselves)
    lane-governor renew TICKET         keep a long subagent lane's ticket alive past its lease
    lane-governor run --name NAME -- command...   acquire, run the command while holding the lane, release
    lane-governor status [--json]      sensors, lanes in use and the verdict now (exit 75 when a new lane would wait)
    lane-governor limits [--threads N --ram-gb N]  the limits sized for this machine
    lane-governor sample               append one sensor sample to samples.jsonl (the timer runs this every minute)
    lane-governor calibrate [--logs DIR] [--json]  replay the app's logs: crash windows against healthy time
    lane-governor hook                 Claude Code hook (PreToolUse on Agent/start_session, SubagentStop); opt in

Written 2026-10-26 after the Claude app's main process died silently (no OOM, GPU fault or reboot) on 10-23 12:52,
10-25 15:47 and 10-26 19:03 (Craig: "we crashed, running too hard"). Replaying the app's own logs finds 13 in-boot
unclean exits since 09-22, among them 10-24 19:41, 10-26 00:57 and 10-26 04:51. heavy-run, gpu-queue.py, memguard and
diskguard each govern one resource; nothing governed how many agent lanes run inside the app. Craig: "this allows us
to min/max speed and utilization without slamming into stability issues which is slow".

What the logs measured (~/.config/Claude/logs/main*.log: the app's per-minute `[process-memory]` lines and its session
cycle lines, 09-22 to 10-26, ~43,000 healthy minutes): no single number separates crashes from busy healthy time. On
healthy days the app tree held 49 GB, 292 processes and 7 working sessions, and some crashes came at 2-4 GB. A policy of
several gates does separate them: the 10 minutes before 12 of the 13 exits had held minutes, 44 % of those minutes were
held against 3.7 % of healthy minutes, and a random healthy 10 minutes holds at least once 10 % of the time.
`lane-governor calibrate` reruns this and prints each gate's share. A new lane waits (exit 75) while any gate holds:

  lanes      working sessions (from the app log) + starting sessions + subagent and run tickets >= lanes, where
             lanes = min(threads / 10, RAM / 40 GB), 1..6: 3 on the 32-thread, 124 GB rig (the rule since 10-23)
  cli        live Claude Code CLIs in the app tree >= 8 (19:03 had 14)
  burst      >= 6 session cycles started in 10 min (10-23 had 10), or a lane admitted < 60 s ago
  growth     the app tree's RSS grew >= 7 % of RAM in 2.5 min (19:03: 12.8 -> 22 GB in a minute; 5 % and 9 % were
             tried, 7 % kept the most crash minutes per healthy minute held)
  tree       the app tree's RSS >= 20 % of RAM; the app scope's anonymous memory >= 30 % (the scope peaked at 31-94 GB
             at the crashes; not separation-tested yet, `sample` now records it)
  memory     MemAvailable < 12 % of RAM (min 8 GB), MemFree < 1.5 % (00:58 died at 576 MB free with page allocation
             failures), memory PSI some avg10 >= 20
  load       1-minute load >= 0.875 x threads (no load history exists; `sample` now records it)
cli and tree skip the first lane (nothing in use), so an idle but bloated app cannot deadlock the queue. The rest always
apply: background subagents keep running after their session's turn ends, so the lane count can read 0 while the app
grows (10-25 15:47). The fleet capacity dial (fleet-disconnect ramp, FLEET-DISCONNECT.md) scales lanes and load like
heavy-run, and at 0 % (drain) refuses at once. LANE_MAX, LANE_MAX_CLI, LANE_BURST, LANE_STAGGER_SEC, LANE_GROWTH_GB,
LANE_TREE_GB, LANE_SCOPE_GB, LANE_RESERVE_GB, LANE_MIN_FREE_GB, LANE_MAX_LOAD, LANE_MAX_PSI override; LANE_THREADS and
LANE_RAM_GB stand in for the hardware.

This only admits or queues new work. It never stops, kills or slows a session, subagent or job.
State lives in ~/.local/state/lane-governor (LANE_GOVERNOR_DIR); the app logs in ~/.config/Claude/logs
(LANE_GOVERNOR_LOGS).
"""
import argparse, bisect, contextlib, fcntl, glob, json, os, random, re, subprocess, sys, threading, time, uuid

GB = 2 ** 30
STATE = os.environ.get("LANE_GOVERNOR_DIR") or os.path.join(
    os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "lane-governor")
LOGS = os.environ.get("LANE_GOVERNOR_LOGS") or os.path.expanduser("~/.config/Claude/logs")
PROC = os.environ.get("LANE_GOVERNOR_PROC", "/proc")
CGROUP = os.environ.get("LANE_GOVERNOR_CGROUP", "/sys/fs/cgroup")
SESSION_GRACE = 120          # a newly admitted session counts as starting until the app log shows it working
SUBAGENT_LEASE = 45 * 60     # a subagent ticket nobody releases or renews stops counting after this
RUN_LEASE = 10 * 60          # a run ticket is renewed by its holder every minute
WORKING_HORIZON = 4 * 3600   # a session cycle open longer than this without a log line is treated as gone
GROWTH_WINDOW = 150
BURST_WINDOW = 600

# The app log's session cycle lines (2026-10 builds of the Claude desktop app).
CYCLE_START = re.compile(r"(?:LocalSessions\.sendMessage: sessionId=|Sending message to session "
                         r"|sendSteeredNow: sessionId=|drained [1-9]\d* deferred send\(s\) for |side session \(\w+\) )"
                         r"(local_[0-9a-f-]+)")
CYCLE_END = re.compile(r"(?:CycleHealth\] \w+ cycle for |Starting idle timeout for )(local_[0-9a-f-]+)")
MEMLINE = re.compile(r"\[process-memory\] trigger=interval tree_rss_sum=(\d+)MB.*?children\((\d+)\)")


def fleet_capacity():
    """Percent from the fleet capacity dial (fleet-disconnect ramp); 0 while draining. Same files as gpu-queue.py."""
    state = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    fleet = os.environ.get("FLEET_STATE_DIR") or os.path.join(state, "fleet")
    if os.path.exists(os.path.join(fleet, "DRAIN")):
        return 0
    try:
        with open(os.path.join(fleet, "CAPACITY")) as fh:
            return max(0, min(100, int(fh.read(300).split()[0])))
    except (OSError, IndexError, ValueError):
        return 100


def hardware(env=os.environ):
    threads = int(env.get("LANE_THREADS") or os.cpu_count() or 1)
    if env.get("LANE_RAM_GB"):
        return threads, float(env["LANE_RAM_GB"]) * GB
    with open(os.path.join(PROC, "meminfo")) as fh:
        return threads, next(int(l.split()[1]) * 1024 for l in fh if l.startswith("MemTotal:"))


def limits(threads, ram, env=os.environ, capacity=None):
    """Every limit, scaled to this machine and the fleet dial. Bytes for memory, counts otherwise."""
    pct = fleet_capacity() if capacity is None else capacity
    ram_gb = ram / GB
    g = lambda key, default: float(env[key]) if env.get(key) else default
    lanes = int(g("LANE_MAX", max(1, min(6, threads // 10, int(ram_gb // 40)))))
    return {
        "threads": threads, "ram": ram, "capacity": pct,
        "lanes": 0 if pct == 0 else max(1, lanes * pct // 100),
        "max_cli": int(g("LANE_MAX_CLI", 8)),
        "burst": int(g("LANE_BURST", 6)),
        "stagger": g("LANE_STAGGER_SEC", 60),
        "growth": g("LANE_GROWTH_GB", 0.07 * ram_gb) * GB,
        "tree": g("LANE_TREE_GB", 0.20 * ram_gb) * GB,
        "scope": g("LANE_SCOPE_GB", 0.30 * ram_gb) * GB,
        "reserve": g("LANE_RESERVE_GB", max(8, int(ram_gb * 0.12))) * GB,
        "min_free": g("LANE_MIN_FREE_GB", 0.015 * ram_gb) * GB,
        "max_load": g("LANE_MAX_LOAD", round(threads * 0.875, 1)) * pct / 100,
        "max_psi": g("LANE_MAX_PSI", 20),
    }


def describe(lim):
    return (f"threads={lim['threads']} ram={lim['ram'] / GB:.0f}G capacity={lim['capacity']}% lanes={lim['lanes']} "
            f"max_cli={lim['max_cli']} burst={lim['burst']}/10min stagger={lim['stagger']:.0f}s "
            f"growth={lim['growth'] / GB:.1f}G/2.5min tree={lim['tree'] / GB:.0f}G scope={lim['scope'] / GB:.0f}G "
            f"reserve={lim['reserve'] / GB:.0f}G min_free={lim['min_free'] / GB:.1f}G max_load={lim['max_load']:.1f} "
            f"max_psi={lim['max_psi']:.0f}")


def gates(s, lim):
    """Every gate that holds a new lane now, as (gate, reason) pairs. `s` holds the sensor readings; a missing (None)
    reading is skipped, so the same policy replays over the app's logs, which have no load or PSI."""
    if lim["capacity"] == 0:
        return [("drain", "the fleet is draining (fleet-disconnect); requeue after fleet-disconnect resume")]
    why = []
    hold = lambda gate, text: why.append((gate, text))
    in_use = s.get("in_use") or 0
    if in_use >= lim["lanes"]:
        hold("lanes", f"lanes {in_use}/{lim['lanes']} in use ({s.get('in_use_detail') or 'working sessions'})")
    # Background subagents keep running after their session's turn ends, so the lane count can read 0 while the app
    # is busy (10-25 15:47). Only the gates that can stay up while nothing runs skip the first lane: a bloated but idle
    # app must not deadlock the queue. Growth, bursts and memory clear by themselves and always apply.
    if in_use > 0:
        if (s.get("cli") or 0) >= lim["max_cli"]:
            hold("cli", f"{s['cli']} Claude Code CLIs alive in the app (start under {lim['max_cli']})")
        if (s.get("tree_rss") or 0) >= lim["tree"]:
            hold("tree", f"app tree at {s['tree_rss'] / GB:.1f} GB (start under {lim['tree'] / GB:.0f} GB)")
        if (s.get("scope_anon") or 0) >= lim["scope"]:
            hold("tree", f"app scope anon memory {s['scope_anon'] / GB:.1f} GB (start under {lim['scope'] / GB:.0f} GB)")
    if (s.get("starts") or 0) >= lim["burst"]:
        hold("burst", f"{s['starts']} session cycles started in the last 10 min (burst limit {lim['burst']})")
    if s.get("since_admit") is not None and s["since_admit"] < lim["stagger"]:
        hold("burst", f"last lane admitted {s['since_admit']:.0f} s ago (one at a time, {lim['stagger']:.0f} s apart)")
    if (s.get("growth") or 0) >= lim["growth"]:
        hold("growth", f"app tree grew {s['growth'] / GB:.1f} GB in 2.5 min (hold under {lim['growth'] / GB:.1f} GB)")
    if s.get("avail") is not None and s["avail"] < lim["reserve"]:
        hold("memory", f"system memory {s['avail'] / GB:.0f} GB available (start over {lim['reserve'] / GB:.0f} GB)")
    if s.get("free") is not None and s["free"] < lim["min_free"]:
        hold("memory", f"free pool {s['free'] / GB:.1f} GB (start over {lim['min_free'] / GB:.1f} GB)")
    if s.get("psi") is not None and s["psi"] >= lim["max_psi"]:
        hold("memory", f"memory pressure {s['psi']:.0f} % (start under {lim['max_psi']:.0f} %)")
    if s.get("load") is not None and s["load"] >= lim["max_load"]:
        hold("load", f"load {s['load']:.1f} (start under {lim['max_load']:.1f})")
    return why


def decide(s, lim):
    """Why a new lane must wait now; empty means admit."""
    return [text for _, text in gates(s, lim)]


# ---------------------------------------------------------------------------------------------------------- sensors

def log_time(line):
    try:
        return time.mktime(time.strptime(line[:19], "%Y-%m-%d %H:%M:%S"))
    except ValueError:
        return None


def cycle(line, t, last, starts):
    """Track one log line's session cycle start or end in `last`; a start counts in `starts` only when that session
    was not already working (a message logs two start lines, and steers arrive mid-cycle). True if the line matched."""
    m = CYCLE_START.search(line)
    if m:
        if last.get(m[1], ("end",))[0] != "start":
            starts.append(t)
        last[m[1]] = ("start", t)
        return True
    m = CYCLE_END.search(line)
    if m:
        last[m[1]] = ("end", t)
        return True
    return False


def read_app_log(text, now):
    """Working sessions, cycle starts in the last 10 min and the tree RSS samples, from the current app run's log."""
    cut = text.rfind("Starting app {")
    if cut >= 0:
        text = text[text.rfind("\n", 0, cut) + 1:]
    last, starts, rss = {}, [], []
    for line in text.splitlines():
        t = log_time(line)
        if t is None:
            continue
        if cycle(line, t, last, starts):
            continue
        m = MEMLINE.search(line)
        if m:
            rss.append((t, int(m[1]) * 2 ** 20))
    working = sorted(sid for sid, (k, t) in last.items() if k == "start" and now - t < WORKING_HORIZON)
    return {"working": working, "starts": sum(1 for t in starts if 0 <= now - t <= BURST_WINDOW), "rss": rss}


def tail(path, size=4 << 20):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, 2)
            fh.seek(max(0, fh.tell() - size))
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


def processes(proc=PROC):
    out = {}
    page = os.sysconf("SC_PAGE_SIZE")
    for p in os.listdir(proc):
        if not p.isdigit():
            continue
        try:
            with open(f"{proc}/{p}/stat") as fh:
                s = fh.read()
            r = s.rfind(")")
            f = s[r + 2:].split()
            out[int(p)] = {"ppid": int(f[1]), "comm": s[s.find("(") + 1:r], "rss": int(f[21]) * page}
        except (OSError, IndexError, ValueError):
            continue
    return out


def app_tree(procs, proc=PROC):
    """The Claude app's main process and its whole descendant tree: RSS, process count, live Claude Code CLIs."""
    kids = {}
    for pid, p in procs.items():
        kids.setdefault(p["ppid"], []).append(pid)
    best = None
    for pid, p in procs.items():
        if p["comm"] != "claude-desktop" or procs.get(p["ppid"], {}).get("comm") == "claude-desktop":
            continue
        tree, stack = [], [pid]
        while stack:
            x = stack.pop()
            tree.append(x)
            stack += kids.get(x, [])
        if best is None or len(tree) > len(best[1]):
            best = (pid, tree)
    if best is None:
        return None
    pid, tree = best
    cli = 0
    for x in tree:
        if procs[x]["comm"] == "claude":
            try:
                with open(f"{proc}/{x}/cmdline", "rb") as fh:
                    cli += b"stream-json" in fh.read()
            except OSError:
                pass
    return {"pid": pid, "tree_rss": sum(procs[x]["rss"] for x in tree), "procs": len(tree) - 1, "cli": cli}


def scope_anon(pid, proc=PROC, cgroup=CGROUP):
    try:
        with open(f"{proc}/{pid}/cgroup") as fh:
            rel = next(l.split("::", 1)[1].strip() for l in fh if l.startswith("0::"))
        with open(f"{cgroup}{rel}/memory.stat") as fh:
            return next(int(l.split()[1]) for l in fh if l.startswith("anon "))
    except (OSError, StopIteration, IndexError, ValueError):
        return None


def system(proc=PROC):
    out = {"avail": None, "free": None, "psi": None, "load": None}
    try:
        with open(f"{proc}/meminfo") as fh:
            info = {l.split(":")[0]: int(l.split()[1]) * 1024 for l in fh if l.split()[1:]}
        out["avail"], out["free"] = info.get("MemAvailable"), info.get("MemFree")
    except (OSError, ValueError):
        pass
    try:
        with open(f"{proc}/pressure/memory") as fh:
            out["psi"] = float(fh.readline().split()[1].split("=")[1])
    except (OSError, IndexError, ValueError):
        pass
    try:
        with open(f"{proc}/loadavg") as fh:
            out["load"] = float(fh.read().split()[0])
    except (OSError, ValueError, IndexError):
        pass
    return out


# ---------------------------------------------------------------------------------------------------------- tickets

def path(*parts):
    return os.path.join(STATE, *parts)


@contextlib.contextmanager
def locked():
    os.makedirs(path("lanes"), mode=0o700, exist_ok=True)
    os.makedirs(path("queue"), mode=0o700, exist_ok=True)
    with open(path("lock"), "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def read_json(p):
    try:
        with open(p) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_json(p, data):
    tmp = f"{p}.{os.getpid()}.tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, p)


def counting(t, now):
    """Whether a lane ticket still counts toward the lanes in use."""
    if t["kind"] == "session":
        return now - t["admitted"] < SESSION_GRACE
    if t["kind"] == "run" and t.get("pid") and not alive(t["pid"]):
        return False
    return now < t["lease_until"]


def lane_tickets(now):
    out = []
    for p in glob.glob(path("lanes", "*.json")):
        t = read_json(p)
        if t and counting(t, now):
            out.append(t)
        else:
            with contextlib.suppress(OSError):
                os.remove(p)
    return out


def waiters():
    out = []
    for p in glob.glob(path("queue", "*.json")):
        w = read_json(p)
        if w and alive(w["pid"]):
            out.append((w["priority"], w["since"], p, w))
        else:
            with contextlib.suppress(OSError):
                os.remove(p)
    return sorted(out, key=lambda x: (x[0], x[1]))


def recent_rss(now, rss=None):
    """This tool's own tree RSS samples from the last 10 min (with the new one appended), for the growth gate."""
    p = path("recent.json")
    samples = [s for s in (read_json(p) or []) if now - s[0] < 600]
    if rss is not None:
        samples.append([now, rss])
        with contextlib.suppress(OSError):
            write_json(p, samples)
    return samples


def sense(now=None):
    """All sensor readings for `decide`, plus the lanes in use. Call it holding the lock."""
    now = time.time() if now is None else now
    log = read_app_log(tail(os.path.join(LOGS, "main.log")), now)
    tree = app_tree(processes())
    s = dict(system())
    s.update(app_pid=None, tree_rss=None, procs=None, cli=None, scope_anon=None, growth=None)
    if tree:
        s.update(app_pid=tree["pid"], tree_rss=tree["tree_rss"], procs=tree["procs"], cli=tree["cli"],
                 scope_anon=scope_anon(tree["pid"]))
        # each source against itself: the app's own sums and this tool's differ by a few hundred MB
        def rise(samples):
            w = [r for t, r in samples if 0 <= now - t <= GROWTH_WINDOW]
            return w[-1] - min(w) if w else 0
        s["growth"] = max(rise(log["rss"]), rise([tuple(x) for x in recent_rss(now, tree["tree_rss"])]))
    tickets = lane_tickets(now)
    working = log["working"] if tree else []
    starting = [t for t in tickets if t["kind"] == "session"]
    others = [t for t in tickets if t["kind"] != "session"]
    s["working"], s["tickets"] = working, tickets
    s["in_use"] = len(working) + len(starting) + len(others)
    s["in_use_detail"] = (f"{len(working)} working sessions, {len(starting)} starting, "
                          f"{len(others)} subagent/run lanes")
    admitted = [t["admitted"] for t in read_json(path("admissions.json")) or [] if now - t["admitted"] < BURST_WINDOW]
    s["starts"] = max(log["starts"], len(admitted))
    s["since_admit"] = now - max(admitted) if admitted else None
    return s


def admit(name, kind, session, pid, now):
    tid = f"{time.strftime('%H%M%S')}-{name[:24].replace('/', '_')}-{uuid.uuid4().hex[:6]}"
    lease = {"session": SESSION_GRACE, "subagent": SUBAGENT_LEASE, "run": RUN_LEASE}[kind]
    write_json(path("lanes", f"{tid}.json"), {"id": tid, "name": name, "kind": kind, "session": session,
                                              "pid": pid, "admitted": now, "lease_until": now + lease})
    hist = [a for a in read_json(path("admissions.json")) or [] if now - a["admitted"] < BURST_WINDOW]
    write_json(path("admissions.json"), hist + [{"id": tid, "admitted": now}])
    return tid


def record(event, **kw):
    with contextlib.suppress(OSError):
        os.makedirs(STATE, mode=0o700, exist_ok=True)
        with open(path("decisions.jsonl"), "a") as fh:
            fh.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **kw}) + "\n")


def try_admit(name, kind, session, pid, me=None, lim=None):
    """(ticket, reasons). Only the head of the queue (or anyone, while nobody waits) may be admitted."""
    now = time.time()
    lim = lim or limits(*hardware())
    with locked():
        q = [x[2] for x in waiters()]
        if q and q[0] != me:
            return None, [f"{q.index(me) if me in q else len(q)} lane request(s) queued ahead"]
        s = sense(now)
        why = decide(s, lim)
        if why:
            return None, why
        tid = admit(name, kind, session, pid, now)
        if me:
            with contextlib.suppress(OSError):
                os.remove(me)
    record("admit", id=tid, name=name, kind=kind, in_use=s["in_use"], tree_gb=round((s["tree_rss"] or 0) / GB, 1))
    return tid, []


def acquire(name, kind="subagent", priority=5, max_wait=540, poll=10, session=None, pid=None, wait=True):
    """Exit-code style: (0, ticket) once admitted; (75, reasons) when the caller should wait and come back."""
    if fleet_capacity() == 0:
        return 75, ["the fleet is draining (fleet-disconnect); requeue after fleet-disconnect resume"]
    if not wait:
        tid, why = try_admit(name, kind, session, pid)
        if not tid:
            record("hold", name=name, kind=kind, why=why)
        return (0, tid) if tid else (75, why)
    with locked():
        me = path("queue", f"{priority}-{time.time_ns()}-{os.getpid()}.json")
        write_json(me, {"name": name, "kind": kind, "priority": priority, "since": time.time(), "pid": os.getpid()})
    started, last = time.time(), None
    try:
        while True:
            if fleet_capacity() == 0:
                return 75, ["the fleet is draining (fleet-disconnect); requeue after fleet-disconnect resume"]
            tid, why = try_admit(name, kind, session, pid, me=me)
            if tid:
                return 0, tid
            if why != last:
                print(f"lane-governor: {name} waiting: {'; '.join(why)}", file=sys.stderr, flush=True)
                last = why
            if time.time() - started >= max_wait:
                record("hold", name=name, kind=kind, why=why, waited=round(time.time() - started))
                return 75, why
            time.sleep(poll)
    finally:
        with contextlib.suppress(OSError):
            os.remove(me)


def release(tid):
    with locked():
        p = path("lanes", f"{os.path.basename(tid)}.json")
        if not os.path.exists(p):
            return False
        os.remove(p)
    record("release", id=tid)
    return True


def renew(tid, seconds=SUBAGENT_LEASE):
    with locked():
        p = path("lanes", f"{os.path.basename(tid)}.json")
        t = read_json(p)
        if not t:
            return False
        t["lease_until"] = time.time() + seconds
        write_json(p, t)
    return True


# ---------------------------------------------------------------------------------------------------------- calibrate

def parse_logs(lines):
    """One app-log replay: per-minute feature rows and the app's unclean exits.

    A row is a dict of decide() sensor readings at a `[process-memory] trigger=interval` line. An exit is the app's
    main process changing between two of those lines (a second instance that quits before 'ready' changes nothing).
    Lines after "Starting app {" belong to the new instance until its first memory line.
    It is unclean when no "beforeQuit: handler fired" was logged in between, and counts only after the old process had
    run 5 min (quick relaunches are not crashes). Its time is the old process's last log line."""
    rows, exits = [], []
    last, starts, rss_hist = {}, [], []
    main = born = seen = None
    quit_seen = frozen = False       # frozen: a new instance is starting; its lines are not the old process's
    for line in lines:
        t = log_time(line) if line[:2] == "20" else None
        if t is None:
            continue
        if "beforeQuit: handler fired" in line:
            quit_seen = True
        if "Starting app {" in line:
            frozen = True
            continue
        m = MEMLINE.search(line)
        if not m:
            cycle(line, t, last, starts)
            seen = t if main and not frozen else seen
            continue
        pid = re.search(r"electron_main:(\d+)", line)
        pid = pid[1] if pid else main
        if pid != main:
            if main is not None and not quit_seen and seen - born >= 300:
                exits.append({"t": seen, "restart": t, "pid": main})
            main, born = pid, t
            last.clear()
            rss_hist.clear()
        quit_seen, frozen, seen = False, False, t
        rss = int(m[1]) * 2 ** 20
        rss_hist[:] = [x for x in rss_hist if t - x[0] <= GROWTH_WINDOW] + [(t, rss)]
        cli = re.search(r"kinds=\[cli\((\d+)\)", line)
        free = re.search(r"sys_free=(\d+)MB/(\d+)MB sys_free_raw=(\d+)MB", line)
        working = sum(1 for k, ts in last.values() if k == "start" and t - ts < WORKING_HORIZON)
        rows.append({"t": t, "in_use": working, "tree_rss": rss, "procs": int(m[2]), "cli": int(cli[1]) if cli else 0,
                     "growth": rss - min(r for _, r in rss_hist),
                     "starts": len(starts) - bisect.bisect_left(starts, t - BURST_WINDOW),
                     "avail": int(free[1]) * 2 ** 20 if free else None, "free": int(free[3]) * 2 ** 20 if free else None,
                     "ram": int(free[2]) * 2 ** 20 if free else None})
    return rows, exits


def boots():
    """Boot start times from the journal, to tell reboots from app crashes; [] when there is no journal."""
    try:
        out = subprocess.run(["journalctl", "--list-boots", "--no-pager", "-q", "-o", "json"],
                             capture_output=True, text=True, timeout=30).stdout
        return sorted(b["first_entry"] / 1e6 for b in json.loads(out or "[]"))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return []


def crashes(exits, boot_starts):
    """Unclean exits with no reboot between the last log line and the restart."""
    return [e for e in exits if not any(e["t"] <= b <= e["restart"] for b in boot_starts)]


GATES = ("lanes", "cli", "burst", "growth", "tree", "memory")


def calibrate(rows, crash_list, lim, window=600, margin=1800, seed=1):
    """How the policy and each gate behave in the `window` before each crash versus healthy time (rows further than
    `margin` before, or 5 min after, any crash)."""
    def held(r):
        return bool(decide(r, lim))
    near = lambda r: any(c["t"] - margin <= r["t"] <= c["t"] + 300 for c in crash_list)
    healthy = [r for r in rows if not near(r)]
    windows = [[r for r in rows if c["t"] - window <= r["t"] <= c["t"]] for c in crash_list]
    rep = {"rows": len(rows), "healthy_minutes": len(healthy), "crashes": [], "gates": {}}
    for c, w in zip(crash_list, windows):
        first = next((r for r in w if held(r)), None)
        rep["crashes"].append({"t": time.strftime("%Y-%m-%d %H:%M", time.localtime(c["t"])), "minutes": len(w),
                               "held": sum(map(held, w)), "lead_min": round((c["t"] - first["t"]) / 60, 1) if first else None,
                               "peak": {k: max((r[k] or 0) for r in w) if w else None for k in ("in_use", "cli", "starts")},
                               "peak_tree_gb": round(max((r["tree_rss"] for r in w), default=0) / GB, 1),
                               "peak_growth_gb": round(max((r["growth"] for r in w), default=0) / GB, 1)})
    allw = [r for w in windows for r in w]
    share = lambda f, rs: round(100 * sum(1 for r in rs if f(r)) / len(rs), 1) if rs else None
    rep["policy"] = {"crash_windows_held": sum(1 for w in windows if any(map(held, w))), "crash_windows": len(windows),
                     "crash_minutes_held_pct": share(held, allw), "healthy_minutes_held_pct": share(held, healthy)}
    for name in GATES:
        gate = lambda r, name=name: any(g == name for g, _ in gates(r, lim))
        rep["gates"][name] = {"crash_windows_held": sum(1 for w in windows if any(map(gate, w))),
                              "crash_minutes_held_pct": share(gate, allw), "healthy_minutes_held_pct": share(gate, healthy)}
    # chance baseline: how often a random healthy window of the same length holds at least once
    n = max(1, round(window / 60))
    starts = [i for i in range(len(rows) - n) if not any(near(rows[j]) for j in (i, i + n - 1))
              and rows[i + n - 1]["t"] - rows[i]["t"] <= window + 120]
    if starts:
        rnd = random.Random(seed)
        pick = rnd.sample(starts, min(2000, len(starts)))
        rep["policy"]["random_healthy_window_hit_pct"] = round(100 * sum(any(held(rows[j]) for j in range(i, i + n))
                                                                           for i in pick) / len(pick), 1)
    return rep


def log_files(logs):
    """The app's main logs, oldest first (main4.log .. main1.log, then main.log)."""
    rotated = sorted(glob.glob(os.path.join(logs, "main[0-9]*.log")),
                     key=lambda p: -int(re.search(r"main(\d+)\.log$", p)[1]))
    return rotated + [p for p in [os.path.join(logs, "main.log")] if os.path.exists(p)]


def print_calibration(rep, lim):
    print(f"lane-governor calibrate: {rep['rows']} logged minutes, {rep['healthy_minutes']} healthy, "
          f"{len(rep['crashes'])} in-boot unclean app exits")
    print(f"  limits: {describe(lim)}")
    for c in rep["crashes"]:
        print(f"  crash {c['t']}: held {c['held']}/{c['minutes']} min before it, first hold {c['lead_min']} min ahead; "
              f"peak lanes {c['peak']['in_use']} cli {c['peak']['cli']} starts {c['peak']['starts']} "
              f"tree {c['peak_tree_gb']} GB growth {c['peak_growth_gb']} GB")
    p = rep["policy"]
    print(f"  policy: {p['crash_windows_held']}/{p['crash_windows']} crash windows held; held {p['crash_minutes_held_pct']} %"
          f" of crash-window minutes vs {p['healthy_minutes_held_pct']} % of healthy minutes; a random healthy window "
          f"holds at least once {p.get('random_healthy_window_hit_pct')} % of the time")
    for name, g in rep["gates"].items():
        print(f"    {name:7s} {g['crash_windows_held']}/{len(rep['crashes'])} windows, {g['crash_minutes_held_pct']} % of "
              f"crash minutes, {g['healthy_minutes_held_pct']} % of healthy minutes")


# ---------------------------------------------------------------------------------------------------------- hook

def hook(event):
    """Claude Code hook. PreToolUse on Agent or start_session: take a lane ticket without waiting, or block the tool
    call (exit 2) with the reason, so the model queues the lane and retries later. SubagentStop: release the oldest
    subagent ticket this session took."""
    name = event.get("hook_event_name")
    sid = event.get("session_id")
    if name == "SubagentStop":
        with locked():
            mine = sorted((t for t in lane_tickets(time.time()) if t["kind"] == "subagent" and t.get("session") == sid),
                          key=lambda t: t["admitted"])
        if mine:
            release(mine[0]["id"])
        return 0
    if name != "PreToolUse":
        return 0
    tool = event.get("tool_name") or ""
    kind = "subagent" if tool in ("Agent", "Task") else "session" if tool.endswith("start_session") else None
    if kind is None:
        return 0
    tool_input = event.get("tool_input") or {}
    if kind == "session" and not tool_input.get("proposal_id") and tool_input.get("initiation") == "own_initiative":
        return 0                        # a proposal card starts nothing until the user starts it
    label = (tool_input.get("description") or tool_input.get("title") or tool)[:40]
    code, out = acquire(label, kind=kind, session=sid, wait=False)
    if code == 0:
        return 0
    print(f"lane-governor: hold this {kind} and queue it; start it when another lane finishes or the app calms "
          f"down ({'; '.join(out)}). Check with `lane-governor status`.", file=sys.stderr)
    return 2


# ---------------------------------------------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(prog="lane-governor", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("acquire")
    a.add_argument("--name", required=True)
    a.add_argument("--kind", choices=("subagent", "session", "run"), default="subagent")
    a.add_argument("--priority", type=int, default=5)
    a.add_argument("--max-wait", type=float, default=540, help="seconds to wait in the queue (default fits one tool call)")
    a.add_argument("--poll", type=float, default=10)
    a.add_argument("--session")
    a.add_argument("--no-wait", action="store_true")
    for name in ("release", "renew"):
        sub.add_parser(name).add_argument("ticket")
    r = sub.add_parser("run")
    r.add_argument("--name", required=True)
    r.add_argument("--priority", type=int, default=5)
    r.add_argument("--max-wait", type=float, default=6 * 3600)
    r.add_argument("command", nargs=argparse.REMAINDER)
    st = sub.add_parser("status")
    st.add_argument("--json", action="store_true")
    li = sub.add_parser("limits")
    li.add_argument("--threads", type=int)
    li.add_argument("--ram-gb", type=float)
    sub.add_parser("sample")
    ca = sub.add_parser("calibrate")
    ca.add_argument("--logs", default=LOGS)
    ca.add_argument("--json", action="store_true")
    sub.add_parser("hook")
    a = ap.parse_args(argv)

    if a.cmd == "limits":
        threads, ram = hardware()
        print(describe(limits(a.threads or threads, a.ram_gb * GB if a.ram_gb else ram)))
        return 0
    if a.cmd == "acquire":
        code, out = acquire(a.name, a.kind, a.priority, a.max_wait, a.poll, a.session, wait=not a.no_wait)
        if code == 0:
            print(out)
        else:
            print(f"lane-governor: {a.name} must wait (75): {'; '.join(out)}", file=sys.stderr)
        return code
    if a.cmd in ("release", "renew"):
        ok = (release if a.cmd == "release" else renew)(a.ticket)
        if not ok:
            print(f"lane-governor: no lane ticket {a.ticket}", file=sys.stderr)
        return 0 if ok else 1
    if a.cmd == "run":
        cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
        if not cmd:
            ap.error("run needs a command after --")
        code, out = acquire(a.name, "run", a.priority, a.max_wait, session=None, pid=os.getpid())
        if code:
            print(f"lane-governor: {a.name} not run (75): {'; '.join(out)}", file=sys.stderr)
            return code
        stop = threading.Event()

        def heartbeat():
            while not stop.wait(60):
                renew(out, RUN_LEASE)
        threading.Thread(target=heartbeat, daemon=True).start()
        try:
            return subprocess.call(cmd)
        finally:
            stop.set()
            release(out)
    if a.cmd in ("status", "sample"):
        lim = limits(*hardware())
        with locked():
            s = sense()
            q = waiters()
        why = decide(s, lim)
        out = {k: v for k, v in s.items() if k != "tickets"}
        out.update(t=time.strftime("%Y-%m-%dT%H:%M:%S"), verdict="wait" if why else "admit", why=why, queued=len(q),
                   lanes=[{"id": t["id"], "name": t["name"], "kind": t["kind"]} for t in s["tickets"]],
                   limit_lanes=lim["lanes"], capacity=lim["capacity"])
        if a.cmd == "sample":          # calibration data the app logs lack: load, PSI, scope memory, verdicts
            samples = path("samples.jsonl")
            with contextlib.suppress(OSError):
                if os.path.getsize(samples) > 20 << 20:
                    os.replace(samples, samples + ".1")
            with open(samples, "a") as fh:
                fh.write(json.dumps(out) + "\n")
            return 0
        if a.json:
            print(json.dumps(out, indent=1))
        else:
            gb = lambda v: f"{v / GB:.1f}G" if v is not None else "?"
            print(f"lane-governor: {'WAIT' if why else 'admit'}; lanes {s['in_use']}/{lim['lanes']} "
                  f"({s['in_use_detail']}), queued {len(q)}")
            print(f"  app tree {gb(s['tree_rss'])} in {s['procs']} processes, {s['cli']} CLIs, grew {gb(s['growth'])}"
                  f" in 2.5 min; scope anon {gb(s['scope_anon'])}; {s['starts']} cycle starts in 10 min")
            print(f"  system available {gb(s['avail'])}, free {gb(s['free'])}, PSI {s['psi']}, load {s['load']}")
            for w in why:
                print(f"  hold: {w}")
        return 75 if why else 0
    if a.cmd == "calibrate":
        lines = []
        for p in log_files(a.logs):
            with open(p, errors="replace") as fh:
                lines.extend(fh)
        rows, exits = parse_logs(lines)
        found = crashes(exits, boots())
        ram = next((r["ram"] for r in reversed(rows) if r.get("ram")), None) or hardware()[1]
        lim = limits(hardware()[0], ram, capacity=100)
        rep = calibrate(rows, found, lim)
        print(json.dumps(rep, indent=1)) if a.json else print_calibration(rep, lim)
        return 0
    if a.cmd == "hook":
        try:
            event = json.load(sys.stdin)
        except ValueError:
            return 0
        return hook(event)
    return 2


if __name__ == "__main__":
    sys.exit(main())
