#!/usr/bin/env python3
"""Fair, priority-ordered queue for GPU/browser jobs shared by all agents.

The guarded launcher (~/.local/bin/chromium-automation) admits one browser at a
time but has no queue, so waiters race on retries. This takes a ticket, waits
its turn (lower priority number first, then arrival order), checks
system-safety-status, runs the job, and always releases the ticket.

    gpu-queue.py --name abi-plates --priority 1 -- npm run capture -- ...

Priorities: 1 = ABI course (current focus), 5 = Refrigeration.AI lessons.
Heartbeat leases protect live tickets; nested PID namespaces or missing NVIDIA devices cause refusal before queue mutation.
This does not replace or bypass the guard.

Stability first (Craig, 2026-10-26: "gpu gets a queue too", "performance isnt high performace if we lose system
stability"). At the head of the queue a job starts only with headroom, every limit scaled to this machine:
GPU memory and BAR1 under 60 % and 50 % of the card's own totals (the guard stops jobs at 85 % and 75 %), system
memory available >= 12 % of RAM (min 8 GB), and the 1-minute load under 0.875 x threads. A temporary problem (guard
busy, monitor stale or journal slow, pressure, no headroom) means waiting, up to --max-wait; a GPU fault latch still
stops at once (exit 78). GPU_QUEUE_VRAM_FRAC, GPU_QUEUE_BAR1_FRAC, GPU_QUEUE_RESERVE_GB, GPU_QUEUE_MAX_LOAD override.
Tickets default to ~/.local/state/gpu-queue; GPU_QUEUE_DIR overrides that path. If that path is a symlink whose target
is gone (a link into /tmp wiped by a reboot), the target is recreated.

Short jobs do not wait behind long ones (2026-10-27: a 2-second check clip waited behind a 40-minute film capture, and
twice timed out). `--est SECONDS` declares how long a job runs; one of GPU_QUEUE_SHORT_SEC (300) or less takes queue
priority 0, so it starts at the next gap between long jobs. A long ticket that has waited GPU_QUEUE_AGE_SEC (600) is
renamed to priority 0 with its arrival kept, so short jobs can never starve it. The lane lives in the ticket's name
(<priority>-<arrival ns>-<pid>.ticket) because that is all the browser guard reads to find the head: the guard, older
queue processes and this one agree on who is next.

Every job appends one line to history.jsonl in the queue directory (name, priority, lane, est, queued, started and
ended times, waited and ran seconds, exit code); `gpu-queue.py --stats [--hours 12]` summarises waits and runs per lane
and lists the tickets waiting now.

The fleet capacity dial (fleet-disconnect ramp, see FLEET-DISCONNECT.md) scales the start limits: at N % a job starts
only under N % of the VRAM, BAR1 and load limits. At 0 % (the drain before a reboot) no new ticket is taken and a
waiting ticket is released: both exit 75, so the caller requeues after `fleet-disconnect resume`. A job already running
is left to finish.

Task cap (2026-10-27): the job runs in a transient systemd scope with TasksMax (GPU_QUEUE_TASKS_MAX, else 128 per CPU
thread, min 1024), bound to the caller's unit; THROTTLE_TASKS=log only reports, =off skips it. The helpers live in the
sibling `workers` file. Without systemd user scopes (or without that file) the job runs uncapped after one warning.
Exit codes pass through (systemd-run --scope execs the job), and a job killed by signal N kills gpu-queue by N too;
TERM, INT or HUP to gpu-queue reaches a running job; gpu-queue waits for it before it releases the ticket, and records its
end. If systemd-run itself fails the job runs uncapped.

A slot is for the GPU (2026-10-26: an EEVEE render with no GPU access held the only slot for 28 min while the 4080
sat at 0 % and two lookdev jobs waited). If the job's process tree has opened no NVIDIA device after
GPU_QUEUE_IDLE_GRACE seconds (default 600; 0 turns this off), its ticket is released so the next job starts; the job
keeps running, and is told to use heavy-run for CPU work. Jobs under the automation guard (browser_guard.py: guarded
browsers and gpu-workload-run, software or GPU) keep their slot, because the guard admits one at a time anyway.
"""
import argparse, importlib.machinery, importlib.util, json, os, signal, subprocess, sys, tempfile, threading, time


def queue_dir():
    return os.environ.get("GPU_QUEUE_DIR", os.path.expanduser("~/.local/state/gpu-queue"))


QDIR = queue_dir()


def fleet_capacity():
    """(percent, note) from the fleet capacity dial (fleet-disconnect ramp); (0, note) while draining for a disconnect."""
    state = os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state")
    fleet = os.environ.get("FLEET_STATE_DIR") or os.path.join(state, "fleet")
    for name in ("DRAIN", "CAPACITY"):
        try:
            with open(os.path.join(fleet, name)) as fh:
                text = fh.read(300).strip()
        except FileNotFoundError:
            continue
        if name == "DRAIN":
            return 0, text or "draining"
        try:
            return max(0, min(100, int(text.split()[0]))), text
        except (IndexError, ValueError):
            return 100, text
    return 100, None


def drain_reason():
    """The drain notice while the dial is at 0 %, else None."""
    pct, note = fleet_capacity()
    return (note or "capacity 0 %") if pct == 0 else None
STATUS = os.path.expanduser("~/.local/bin/system-safety-status")
HEALTH = os.path.expanduser("~/.local/state/automation-safety/health.json")
STATUS_PATH = "/proc/self/status"
DEV_DIR = "/dev"


def nested_pid_namespace(status_path):
    with open(status_path) as fh:
        return any(line.startswith("NSpid:") and len(line.split()[1:]) > 1 for line in fh)


def nvidia_devices(dev_dir):
    return any(name == "nvidiactl" or
               (name.startswith("nvidia") and name[6:7].isdigit())
               for name in os.listdir(dev_dir))


def require_host(status_path=None, dev_dir=None):
    reason = None
    try:
        if nested_pid_namespace(status_path or STATUS_PATH):
            reason = "nested PID namespace"
        elif not nvidia_devices(dev_dir or DEV_DIR):
            reason = "no /dev/nvidia* device nodes"
    except OSError as exc:
        reason = f"cannot verify host: {exc}"
    if reason:
        print(f"gpu-queue: refusing to touch the queue from a sandbox ({reason}); run this on the host",
              file=sys.stderr)
        raise SystemExit(77)


def pid_namespace():
    try:
        return os.readlink('/proc/self/ns/pid')
    except OSError:
        return None


def lease_seconds(poll):
    try:
        lease = float(os.environ.get("GPU_QUEUE_LEASE_SEC", "600"))
    except ValueError:
        lease = 600
    return max(lease, 3 * poll)


def ensure_queue_dir():
    """Create the queue directory. A symlink whose target is gone (a link into /tmp after a reboot) gets its target
    created, instead of makedirs failing with FileExistsError on the link and every GPU job with it."""
    require_host()
    if os.path.islink(QDIR) and not os.path.exists(QDIR):
        target = os.path.realpath(QDIR)
        print(f"gpu-queue: {QDIR} pointed at missing {target}; creating it", file=sys.stderr)
        os.makedirs(target, mode=0o700, exist_ok=True)
    os.makedirs(QDIR, mode=0o700, exist_ok=True)


def write_ticket(path, data):
    ensure_queue_dir()
    with tempfile.NamedTemporaryFile(mode="w", dir=QDIR, suffix=".tmp", delete=False) as fh:
        temporary = fh.name
        try:
            json.dump(data, fh)
            fh.close()
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)


def restore_ticket(path, data):
    if not os.path.exists(path):
        write_ticket(path, data)
        print(f"gpu-queue: {data['name']} ticket was missing, restored", file=sys.stderr, flush=True)


def heartbeat(path, data):
    require_host()
    restore_ticket(path, data)
    os.utime(path, None)


def process_tree(root, proc="/proc"):
    """root and every descendant, from the parent links in /proc/<pid>/stat."""
    children = {}
    for d in os.listdir(proc):
        if not d.isdigit():
            continue
        try:
            with open(f"{proc}/{d}/stat") as fh:
                ppid = int(fh.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        children.setdefault(ppid, []).append(int(d))
    out, todo = [], [root]
    while todo:
        pid = todo.pop()
        out.append(pid)
        todo += children.get(pid, [])
    return out


GPU_DEVICE = "/dev/nvidia"


def gpu_use(pids, proc="/proc", device=None):
    """'gpu' if a process holds an NVIDIA device open, 'guarded' if one runs under the automation guard, else None."""
    for pid in pids:
        try:
            if b"browser_guard.py" in open(f"{proc}/{pid}/cmdline", "rb").read():
                return "guarded"
        except OSError:
            continue
        try:
            fds = os.listdir(f"{proc}/{pid}/fd")
        except OSError:
            continue
        for fd in fds:
            try:
                if os.readlink(f"{proc}/{pid}/fd/{fd}").startswith(device or GPU_DEVICE):
                    return "gpu"
            except OSError:
                continue
    return None


def idle_grace():
    try:
        return float(os.environ.get("GPU_QUEUE_IDLE_GRACE", "600"))
    except ValueError:
        return 600.0


def keep_alive(path, data, poll, stopped, grace=None):
    """Heartbeat the running job's ticket. If the job (this process's children) has opened no NVIDIA device after
    `grace` seconds and is not under the automation guard, release the ticket so the next job can start."""
    grace = idle_grace() if grace is None else grace
    start, watching = time.time(), grace > 0
    while not stopped.wait(min(poll, grace) if watching else poll):
        if watching:
            if gpu_use(process_tree(os.getpid())):
                watching = False                    # it uses the GPU (or the guard owns it): keep the slot
            elif time.time() - start >= grace:
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass
                print(f"gpu-queue: {data['name']} has not opened the GPU in {grace:.0f} s; its slot is released so "
                      "the next job can start. It keeps running. Run CPU-only jobs through heavy-run, not the GPU "
                      "queue.", file=sys.stderr, flush=True)
                return
        heartbeat(path, data)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def tickets(poll=30):
    out = []
    try:
        files = os.listdir(QDIR)
    except FileNotFoundError:
        ensure_queue_dir()
        return []
    for f in files:
        if not f.endswith(".ticket"):
            continue
        try:
            prio, ts, pid = f[:-7].split("-")[:3]
            pid = int(pid)
        except ValueError:
            continue
        path = os.path.join(QDIR, f)
        try:
            expired = time.time() - os.stat(path).st_mtime > lease_seconds(max(poll, 5))
            try:
                with open(path) as fh:
                    data = json.load(fh)
            except (ValueError, OSError):
                data = {}
            namespace = data.get("pidns")
            same_namespace = namespace is not None and namespace == pid_namespace()
            provably_alive = (namespace is None or same_namespace) and alive(data.get("pid", pid))
            if not provably_alive and (same_namespace or expired):
                require_host()
                os.remove(path)
                continue
        except FileNotFoundError:
            continue
        out.append((int(prio), int(ts), pid, f))
    return sorted(out)


def status():
    try:
        r = subprocess.run([STATUS], capture_output=True, text=True, timeout=30)
        return r.returncode, json.loads(r.stdout or "{}")
    except Exception as e:  # treat an unreadable status as not ready
        return 78, {"error": str(e)}


def headroom(health_path=None, meminfo="/proc/meminfo", load1=None):
    """None when a job may start; otherwise why it should wait."""
    env = os.environ
    scale = fleet_capacity()[0] / 100
    try:
        with open(health_path or HEALTH) as fh:
            gpus = json.load(fh).get("gpus") or []
    except (OSError, ValueError):
        return "no GPU health sample"
    if not gpus:
        return "no GPU pressure metrics"
    for gpu in gpus:
        for key, frac in (("framebuffer_mib", scale * float(env.get("GPU_QUEUE_VRAM_FRAC", 0.60))),
                          ("bar1_mib", scale * float(env.get("GPU_QUEUE_BAR1_FRAC", 0.50)))):
            m = gpu.get(key) or {}
            if not m.get("total") or m.get("used") is None:
                return f"no {key} metric"
            if m["used"] / m["total"] >= frac:
                return f"{key} at {100 * m['used'] / m['total']:.0f}% (start under {100 * frac:.0f}%)"
    try:
        with open(meminfo) as fh:
            info = {line.split(":")[0]: int(line.split()[1]) for line in fh if line.split()[1:]}
        total, avail = info["MemTotal"] / 2 ** 20, info["MemAvailable"] / 2 ** 20
    except (OSError, KeyError, ValueError, IndexError):
        return "no memory metrics"
    reserve = float(env.get("GPU_QUEUE_RESERVE_GB", max(8, int(total * 0.12))))
    if avail < reserve:
        return f"system memory {avail:.0f} GB free (start over {reserve:.0f} GB)"
    load1 = os.getloadavg()[0] if load1 is None else load1
    max_load = scale * float(env.get("GPU_QUEUE_MAX_LOAD", round((os.cpu_count() or 1) * 0.875, 1)))
    if load1 >= max_load:
        return f"load {load1:.1f} (start under {max_load:.1f})"
    return None


def short_seconds():
    try:
        return float(os.environ.get("GPU_QUEUE_SHORT_SEC", "300"))
    except ValueError:
        return 300.0


def age_seconds():
    try:
        return float(os.environ.get("GPU_QUEUE_AGE_SEC", "600"))
    except ValueError:
        return 600.0


def ticket_priority(priority, est):
    """The queue priority a ticket is filed under: 0 for a declared short job, else the caller's."""
    return 0 if est is not None and est <= short_seconds() else priority


def history_path():
    return os.path.join(QDIR, "history.jsonl")


def record(entry):
    """Append one finished job to history.jsonl (best effort: history never fails a job)."""
    try:
        ensure_queue_dir()
        with open(history_path(), "a") as fh:
            fh.write(json.dumps(entry) + "\n")
    except OSError as exc:
        print(f"gpu-queue: history not written ({exc})", file=sys.stderr)


def stats(hours=12.0, now=None, out=sys.stdout):
    """Waits and runs per lane over the last `hours`, and the tickets waiting now."""
    now = time.time() if now is None else now
    rows = []
    try:
        with open(history_path()) as fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("ended", 0) >= now - hours * 3600:
                    rows.append(e)
    except FileNotFoundError:
        pass
    def pct(xs, q):
        xs = sorted(xs)
        return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0
    print(f"gpu-queue: {len(rows)} jobs in the last {hours:g} h", file=out)
    for lane in ("short", "long"):
        sel = [e for e in rows if e.get("lane") == lane]
        if not sel:
            continue
        w = [e.get("waited", 0) for e in sel]; r = [e.get("ran", 0) for e in sel]
        print(f"  {lane:5} {len(sel):4} jobs  wait median {pct(w, .5):6.0f} s  p90 {pct(w, .9):6.0f} s  max {max(w):6.0f} s"
              f"   run median {pct(r, .5):6.0f} s  max {max(r):6.0f} s  failed {sum(1 for e in sel if e.get('rc'))}", file=out)
    late = [e for e in rows if e.get("est") and e.get("ran", 0) > 2 * e["est"]]
    for e in late[-5:]:
        print(f"  over estimate: {e.get('name')} ran {e.get('ran'):.0f} s, declared {e.get('est'):.0f} s", file=out)
    q = tickets()
    if q:
        print(f"  waiting now ({len(q)}):", file=out)
        for prio, ts, pid, f in q:
            try:
                with open(os.path.join(QDIR, f)) as fh:
                    name = json.load(fh).get("name", "?")
            except (OSError, ValueError):
                name = "?"
            print(f"    {prio} {name:32} queued {now - ts / 1e9:6.0f} s ago", file=out)
    return rows


def taskcap():
    """The task-cap helpers from the sibling `workers` file, or None (then jobs run uncapped)."""
    path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "workers")
    try:
        loader = importlib.machinery.SourceFileLoader("throttle_workers", path)
        mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("throttle_workers", loader))
        loader.exec_module(mod)
        return mod
    except (OSError, SyntaxError, ImportError):
        return None


TASKCAP = taskcap()


JOB = {}          # the running job's Popen, so SIGTERM reaches it and its rc gets recorded


def run_job(cmd, name):
    """(rc, cap info, peak tasks): the job under its task cap."""
    cap = TASKCAP
    JOB["starting"] = True                             # a signal now is held until the job exists
    if cap is None:
        print(f"gpu-queue: {name}: task-cap helpers missing; running uncapped", file=sys.stderr)
        JOB["proc"], info = subprocess.Popen(cmd), {"mode": "uncapped", "why": "no workers helpers"}
    else:
        JOB["proc"], info = cap.launch(cmd, "GPU_QUEUE", name)
    JOB.pop("starting")
    if JOB.get("pending"):
        JOB["proc"].send_signal(JOB.pop("pending"))
    if cap is None:
        return JOB["proc"].wait(), info, None
    watch = cap.PeakWatch(info)
    watch.start()
    rc = JOB["proc"].wait()
    peak = watch.stop()
    if info.get("mode") == "log" and peak and peak >= info["tasks_max"]:
        print(f"gpu-queue: {name} peaked at {peak} tasks, over the {info['tasks_max']} cap it would get", file=sys.stderr)
    return rc, info, peak


def on_signal(release):
    """TERM, INT, HUP or QUIT: a running job gets the same signal and main() waits for it to end (a second signal kills
    it) before the ticket is released and its end recorded, so the next ticket never overlaps a job still running.
    A waiting ticket is released at once (exit 128 + N)."""
    def handler(sig, _frame):
        if JOB.get("starting"):
            JOB["pending"] = sig
            return
        proc = JOB.get("proc")
        if proc is not None and proc.poll() is None:
            JOB["signals"] = JOB.get("signals", 0) + 1
            proc.send_signal(sig if JOB["signals"] == 1 else signal.SIGKILL)
            return
        release()
        sys.exit(128 + sig)
    return handler


def main():
    signal.signal(signal.SIGQUIT, lambda *_: sys.exit(128 + signal.SIGQUIT))   # never a Python core dump
    ap = argparse.ArgumentParser()
    if "--stats" in sys.argv[1:]:
        hours = float(sys.argv[sys.argv.index("--hours") + 1]) if "--hours" in sys.argv else 12.0
        stats(hours)
        return 0
    ap.add_argument("--name", required=True)
    ap.add_argument("--priority", type=int, default=5)
    ap.add_argument("--est", type=float, default=None,
                    help="expected run seconds; GPU_QUEUE_SHORT_SEC (300) or less takes the short lane (priority 0)")
    ap.add_argument("--poll", type=int, default=30, help="seconds between checks")
    ap.add_argument("--max-wait", type=float, default=6 * 3600, help="seconds to wait for health and headroom")
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    if not cmd:
        ap.error("no command given after --")
    drain = drain_reason()
    if drain:
        print(f"gpu-queue: {a.name} not queued, the fleet is draining for a disconnect ({drain}); "
              "requeue after fleet-disconnect resume", file=sys.stderr)
        return 75
    arrival = time.time_ns()
    lane = "short" if ticket_priority(a.priority, a.est) == 0 and a.est is not None else "long"
    me = f"{ticket_priority(a.priority, a.est)}-{arrival}-{os.getpid()}.ticket"
    path = os.path.join(QDIR, me)
    poll = max(a.poll, 5)
    data = {"name": a.name, "cmd": cmd, "cwd": os.getcwd(),
            "pid": os.getpid(), "pidns": pid_namespace(), "priority": a.priority, "est": a.est}
    write_ticket(path, data)
    stopped = threading.Event()
    worker = None

    def release(*_):
        stopped.set()
        if worker is not None:
            worker.join()
        require_host()
        try:
            os.remove(path)
        except FileNotFoundError:
            pass

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
        signal.signal(sig, on_signal(release))
    started, last_why = time.time(), None
    run_at, rc, cap, peak = None, None, None, None
    try:
        while True:
            drain = drain_reason()
            if drain:
                print(f"gpu-queue: {a.name} ticket released, the fleet is draining for a disconnect ({drain}); "
                      "requeue after fleet-disconnect resume", file=sys.stderr)
                return 75
            heartbeat(path, data)
            if not me.startswith("0-") and time.time() - started >= age_seconds():
                # aged: file it under priority 0, arrival kept, so short jobs cannot starve it
                aged = f"0-{arrival}-{os.getpid()}.ticket"
                os.replace(path, os.path.join(QDIR, aged))
                me, path = aged, os.path.join(QDIR, aged)
                print(f"gpu-queue: {a.name} waited {age_seconds():.0f} s, now in the short lane", file=sys.stderr, flush=True)
            q = tickets(poll)
            if q and q[0][3] == me:
                code, st = status()
                if st.get("fault") or st.get("monitor_status") == "mapping_fault":
                    print(f"gpu-queue: GPU fault latched, not running ({st})", file=sys.stderr)
                    return 78
                monitor = st.get("monitor_status")
                why = headroom() if code == 0 else (
                    monitor if monitor not in (None, "ok") else f"guard {st.get('guard_status') or code}")
                if why is None:
                    break
                if time.time() - started > a.max_wait:
                    print(f"gpu-queue: {a.name} gave up after {a.max_wait:.0f} s waiting ({why})", file=sys.stderr)
                    return 78
                if why != last_why:                    # temporary: guard busy, monitor stale, pressure, no headroom
                    print(f"gpu-queue: {a.name} at the head, waiting: {why}", file=sys.stderr, flush=True)
                    last_why = why
            else:
                ahead = [t for t in q if t[3] != me and (t[0], t[1]) < (int(me.split('-')[0]), arrival)]
                print(f"gpu-queue: {a.name} waiting, {len(ahead)} ahead", file=sys.stderr, flush=True)
            time.sleep(poll)
        heartbeat(path, data)
        worker = threading.Thread(target=keep_alive, args=(path, data, poll, stopped), daemon=True)
        worker.start()
        print(f"gpu-queue: {a.name} running", file=sys.stderr, flush=True)
        run_at = time.time()
        rc, cap, peak = run_job(cmd, a.name)
        if rc == 75:
            print("gpu-queue: launcher still busy (75); job not run, requeue later", file=sys.stderr)
        return rc
    finally:
        release()
        ended = time.time()
        record({"name": a.name, "priority": a.priority, "lane": lane, "est": a.est, "queued": arrival / 1e9,
                "started": run_at, "ended": ended, "waited": round((run_at or ended) - arrival / 1e9, 1),
                "ran": round(ended - run_at, 1) if run_at else 0, "rc": rc if run_at else "not run",
                "tasks_cap": cap, "peak_tasks": peak})


CORE = {getattr(signal, n) for n in ("SIGQUIT", "SIGILL", "SIGTRAP", "SIGABRT", "SIGBUS", "SIGFPE", "SIGSEGV",
                                     "SIGXCPU", "SIGXFSZ", "SIGSYS") if hasattr(signal, n)}


def cli():
    """main()'s exit: the job's code, or for a job killed by signal N death by the same signal, except 128 + N for
    SIGKILL and SIGSTOP (Python cannot reset them) and the core-dumping signals (no Python core dump)."""
    rc = main()
    if isinstance(rc, int) and rc < 0:
        sig = -rc
        if sig not in CORE | {signal.SIGKILL, signal.SIGSTOP}:
            signal.signal(sig, signal.SIG_DFL)
            os.kill(os.getpid(), sig)
        rc = 128 + sig
    sys.exit(rc)


if __name__ == "__main__":
    cli()
