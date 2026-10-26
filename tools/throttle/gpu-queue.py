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
Tickets default to ~/.local/state/gpu-queue; GPU_QUEUE_DIR overrides that path.
"""
import argparse, json, os, signal, subprocess, sys, tempfile, threading, time


def queue_dir():
    return os.environ.get("GPU_QUEUE_DIR", os.path.expanduser("~/.local/state/gpu-queue"))


QDIR = queue_dir()
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
    require_host()
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


def keep_alive(path, data, poll, stopped):
    while not stopped.wait(poll):
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
    try:
        with open(health_path or HEALTH) as fh:
            gpus = json.load(fh).get("gpus") or []
    except (OSError, ValueError):
        return "no GPU health sample"
    if not gpus:
        return "no GPU pressure metrics"
    for gpu in gpus:
        for key, frac in (("framebuffer_mib", float(env.get("GPU_QUEUE_VRAM_FRAC", 0.60))),
                          ("bar1_mib", float(env.get("GPU_QUEUE_BAR1_FRAC", 0.50)))):
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
    max_load = float(env.get("GPU_QUEUE_MAX_LOAD", round((os.cpu_count() or 1) * 0.875, 1)))
    if load1 >= max_load:
        return f"load {load1:.1f} (start under {max_load:.1f})"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--priority", type=int, default=5)
    ap.add_argument("--poll", type=int, default=30, help="seconds between checks")
    ap.add_argument("--max-wait", type=float, default=6 * 3600, help="seconds to wait for health and headroom")
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    if not cmd:
        ap.error("no command given after --")
    me = f"{a.priority}-{time.time_ns()}-{os.getpid()}.ticket"
    path = os.path.join(QDIR, me)
    poll = max(a.poll, 5)
    data = {"name": a.name, "cmd": cmd, "cwd": os.getcwd(),
            "pid": os.getpid(), "pidns": pid_namespace()}
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

    signal.signal(signal.SIGTERM, lambda *_: (release(), sys.exit(143)))
    started, last_why = time.time(), None
    try:
        while True:
            heartbeat(path, data)
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
                ahead = [t for t in q if t[3] != me and (t[0], t[1]) < (a.priority, int(me.split('-')[1]))]
                print(f"gpu-queue: {a.name} waiting, {len(ahead)} ahead", file=sys.stderr, flush=True)
            time.sleep(poll)
        heartbeat(path, data)
        worker = threading.Thread(target=keep_alive, args=(path, data, poll, stopped), daemon=True)
        worker.start()
        print(f"gpu-queue: {a.name} running", file=sys.stderr, flush=True)
        rc = subprocess.call(cmd)
        if rc == 75:
            print("gpu-queue: launcher still busy (75); job not run, requeue later", file=sys.stderr)
        return rc
    finally:
        release()


if __name__ == "__main__":
    sys.exit(main())
