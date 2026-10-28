#!/usr/bin/env python3
"""diskguard: keep the system drive from filling with regenerable agent leftovers, and raise the alarm before it does.

Written 2026-10-26. The 3.6 TB system drive reached 89 % because every agent work folder installs its own
node_modules (up to 5.6 GB each) and nothing removes them: 2,420 folders in ~/LOCAL LLM (711 created on 10-25 alone),
615 git worktrees of one repo, and 61 agent build folders in ~/.cache. The first survey ran three whole-tree scans at
once and helped crash the Claude app, so diskguard never walks a whole tree: it looks a few levels deep, prunes at
every match, and measures what it freed with statvfs instead of du. Craig: "we need to clear up space on system drive
and find out how to prevent it filling up so fast".

What it removes (only on the system filesystem, only in work folders idle for --idle-hours, never one a process is
using as its working directory or holding a file open in, never a read-only (deliberately frozen) node_modules, never
a folder holding a .diskguard-keep file):
  regenerable   node_modules, .turbo, .parcel-cache, .next inside work folders (reinstall/rebuild brings them back)
  worktrees     with --worktrees: git worktrees that are clean (no tracked or untracked changes), whose ignored files
                are all regenerable, and whose HEAD is already on a remote branch. Their commits stay in the repo
  caches        uv cache prune, npm cache clean, paccache (keep 1 installed version, none of removed packages)
Never: the folder itself when it is not a git worktree, anything with uncommitted or unpushed work, Steam, backups,
the Windows import, or anything outside the work roots below.

    diskguard.py status                  JSON: use %, free, level (ok / warn >= 85 % / critical >= 92 %)
    diskguard.py check                   timer job: alarm (notification + state file) and, at warn or worse, start
                                         the janitor service if it has not run in the last 6 h
    diskguard.py janitor [--apply] [--worktrees] [--idle-hours 48]
                                         without --apply prints what it would remove; log: ~/.local/state/diskguard
"""
import fcntl, json, os, shutil, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOME = Path.home()
STATE = Path(os.environ.get('XDG_STATE_HOME', HOME / '.local/state')) / 'diskguard'
TRASH = HOME / '.local/share/diskguard-trash'
ROOTS = [HOME / 'LOCAL LLM', HOME / '.cache', HOME / 'Code', HOME / 'Work', HOME / 'Projects']
REGEN = {'node_modules', '.turbo', '.parcel-cache', '.next'}
# ignored files a removable worktree may hold; anything else ignored (a local .env, notes, out/ renders) keeps it
IGNORED_OK = REGEN | {'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.vite',
                      '__pycache__', '.pytest_cache', '.DS_Store'}
# a folder holding this file is never cleaned: one another tree depends on while it sits idle (2026-10-26: the
# ABI lane's export imports ~/Work/foundation-engine-latest, idle 2 days, and its node_modules went)
KEEP = '.diskguard-keep'
SKIP = {'.git', 'Steam', '.local', 'Backups', 'Imported-Windows', 'mise', 'uv', 'pip', 'huggingface', 'torch'}
# ~/.cache children that are agent work (the rest are tool caches and installs, handled by `caches`)
CACHE_WORK = ('claude-', 'akilleez-', 'codex-', 'swg-', 'refrigeration-', 'b1')
WARN, CRITICAL, DEPTH, RERUN_H = 85.0, 92.0, 4, 6
# deleting millions of small files is CPU-bound in rm, one core each: one worker per 8 threads (4 on the 32-thread rig)
WORKERS = int(os.environ.get("DISKGUARD_WORKERS", 0)) or max(1, min(8, (os.cpu_count() or 8) // 8))
GB = 2 ** 30


def usage(path='/'):
    s = os.statvfs(path)
    total, free = s.f_blocks * s.f_frsize, s.f_bavail * s.f_frsize
    pct = round(100 * (total - free) / total, 1)
    return {'use_pct': pct, 'free_gb': round(free / GB, 1), 'total_gb': round(total / GB, 1),
            'level': 'critical' if pct >= CRITICAL else 'warn' if pct >= WARN else 'ok'}


def busy_paths():
    """Working directories, executables, path arguments and open files of every process we can see, with all their
    parent directories. Path arguments matter: a Node server reads its code and closes the files, so only its command
    line (`node /…/clone-app/server/index.mjs`) shows which folder it runs from."""
    seen = set()
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        targets = []
        for link in [f'/proc/{pid}/cwd', f'/proc/{pid}/exe'] + [f'/proc/{pid}/fd/{fd}' for fd in _ls(f'/proc/{pid}/fd')]:
            try:
                targets.append(os.readlink(link))
            except OSError:
                pass
        try:
            targets += [a for a in Path(f'/proc/{pid}/cmdline').read_bytes().decode(errors='replace').split('\0')
                        if a.startswith('/')]
        except OSError:
            pass
        for target in targets:
            while target.startswith('/') and target not in seen and target != '/':
                seen.add(target)
                target = os.path.dirname(target)
    return seen


def _ls(d):
    try:
        return os.listdir(d)
    except OSError:
        return []


def newest_mtime(folder):
    """Latest change in the folder and the level below it, skipping regenerable dirs; plus the git index."""
    best = 0.0
    try:
        best = folder.stat().st_mtime
        for e in os.scandir(folder):
            if e.name in REGEN:
                continue
            best = max(best, e.stat(follow_symlinks=False).st_mtime)
            if e.is_dir(follow_symlinks=False) and e.name != '.git':
                for f in _scandir(e.path):
                    if f.name not in REGEN:
                        best = max(best, f.stat(follow_symlinks=False).st_mtime)
    except OSError:
        pass
    git = folder / '.git'
    try:
        index = (Path(git.read_text().split('gitdir:', 1)[1].strip()) if git.is_file() else git) / 'index'
        best = max(best, index.stat().st_mtime)
    except (OSError, IndexError):
        pass
    return best


def _scandir(p):
    try:
        return list(os.scandir(p))
    except OSError:
        return []


def work_folders(roots, dev):
    """Each root's direct children are work folders (~/Code/<repo>/.claude/worktrees/* count too)."""
    for root in roots:
        if not root.is_dir() or root.stat().st_dev != dev:
            continue
        for e in _scandir(root):
            if not e.is_dir(follow_symlinks=False) or e.name in SKIP:
                continue
            if root.name == '.cache' and not (e.name.startswith(CACHE_WORK) or os.path.exists(e.path + '/.git')):
                continue                                  # tool caches and installs live here too; only agent work
            p = Path(e.path)
            if p.stat().st_dev != dev:
                continue
            yield p
            wt = p / '.claude' / 'worktrees'
            if wt.is_dir():
                yield from (Path(w.path) for w in _scandir(wt) if w.is_dir(follow_symlinks=False))


def regenerable_dirs(folder, depth=DEPTH):
    """REGEN dirs within `depth` levels, never descending into one (or into .git / nested worktree pools)."""
    stack = [(folder, 0)]
    while stack:
        d, lvl = stack.pop()
        for e in _scandir(d):
            if not e.is_dir(follow_symlinks=False):
                continue
            if e.name in REGEN:
                if os.access(e.path, os.W_OK):            # a read-only one was frozen on purpose: leave it
                    yield Path(e.path)
            elif lvl + 1 < depth and e.name not in SKIP and not e.name.startswith('.'):
                stack.append((Path(e.path), lvl + 1))


def is_busy(folder, busy):
    return str(folder) in busy                            # busy holds every parent of every path in use


def plan(folders, now, idle_hours):
    """folders: [{'path', 'mtime', 'busy', 'regen': [paths]}] -> list of (path, why). Pure, for tests."""
    out = []
    for f in folders:
        age = (now - f['mtime']) / 3600
        if f['busy'] or age < idle_hours:
            continue
        out += [(r, f'regenerable, folder idle {age:.0f} h') for r in f['regen']]
    return out


def git(folder, *args):
    r = subprocess.run(['git', '-C', str(folder), *args], capture_output=True, text=True, timeout=600)
    return r.returncode, r.stdout


def removable_worktree(folder):
    """A clean linked worktree whose ignored files are regenerable and whose HEAD is on a remote branch."""
    if not (folder / '.git').is_file():
        return None
    rc, out = git(folder, 'status', '--porcelain=v1', '--ignored', '--untracked-files=all')
    if rc != 0:
        return None
    for line in out.splitlines():
        if not line.startswith('!! '):
            return None                                   # tracked change or untracked file: keep
        first = line[3:].strip('"').split('/', 1)[0]
        if first not in IGNORED_OK and not first.endswith(('.log', '.tsbuildinfo')):
            return None
    rc, out = git(folder, 'for-each-ref', '--contains', 'HEAD', '--count=1', 'refs/remotes')
    return 'clean, HEAD is on a remote branch' if rc == 0 and out.strip() else None


def remove(path, log):
    """Move into the trash on the same filesystem (instant, never half-deleted), then delete it."""
    TRASH.mkdir(parents=True, exist_ok=True)
    if path.parent == TRASH:
        dest = path
    else:
        dest = TRASH / f'{time.strftime("%Y%m%d-%H%M%S")}-{os.getpid()}-{abs(hash(str(path))) % 10**8}'
    try:
        if dest != path:
            os.rename(path, dest)
    except OSError:
        dest = path                                       # another subvolume: delete in place
    r = subprocess.run(['rm', '-rf', '--one-file-system', '--', str(dest)], capture_output=True, text=True)
    log({'removed': str(path), 'ok': r.returncode == 0, 'err': r.stderr[-300:]})
    return r.returncode == 0


def caches(apply, log):
    steps = [(['uv', 'cache', 'prune'], 'uv'), (['npm', 'cache', 'clean', '--force'], 'npm'),
             (['sudo', '-n', 'paccache', '-rk1'], 'pacman'), (['sudo', '-n', 'paccache', '-ruk0'], 'pacman removed')]
    for cmd, name in steps:
        if not shutil.which(cmd[0]) or (cmd[0] == 'sudo' and not shutil.which('paccache')):
            continue
        if not apply:
            print(f'would run: {" ".join(cmd)}')
            continue
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        log({'cache': name, 'rc': r.returncode, 'out': (r.stdout + r.stderr)[-300:]})


def janitor(apply, worktrees, idle_hours, roots=ROOTS, dev=None):
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(STATE / 'janitor.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # one janitor at a time (the alarm can start one mid-run)
    except BlockingIOError:
        print('another janitor is running')
        return
    logf = STATE / 'janitor.jsonl'

    guard = threading.Lock()

    def log(rec):
        rec = {'t': time.strftime('%Y-%m-%dT%H:%M:%S'), 'apply': apply, **rec}
        with guard, logf.open('a') as fh:
            fh.write(json.dumps(rec) + '\n')

    start = usage()
    log({'start': start})
    dev = os.stat('/home').st_dev if dev is None else dev    # only the system drive's filesystem
    busy, now = busy_paths(), time.time()
    folders = [{'path': p, 'mtime': newest_mtime(p), 'busy': is_busy(p, busy) or (p / KEEP).exists(),
                'regen': list(regenerable_dirs(p))}
               for p in work_folders(roots, dev)]
    targets = plan(folders, now, idle_hours)
    if apply:                                             # a stopped run leaves half-deleted entries in the trash
        targets = [(p, 'left in the trash by an earlier run') for p in sorted(TRASH.glob('*'))] + targets
    print(f'{len(folders)} work folders, {sum(f["busy"] for f in folders)} in use, {len(targets)} regenerable dirs to remove')
    if apply:
        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(lambda t: remove(t[0], log), targets))
    else:
        for path, why in targets:
            print(f'would remove {path}  ({why})')
    if worktrees:
        repos = set()
        for f in folders:
            if f['busy'] or (now - f['mtime']) / 3600 < idle_hours:
                continue
            why = removable_worktree(f['path'])
            if not why:
                continue
            if apply:
                rc, _ = git(f['path'], 'worktree', 'remove', '--force', str(f['path']))
                log({'worktree': str(f['path']), 'ok': rc == 0})
            else:
                print(f'would remove worktree {f["path"]}  ({why})')
    caches(apply, log)
    end = usage()
    log({'end': end, 'freed_gb': round(end['free_gb'] - start['free_gb'], 1)})
    print(json.dumps({'before': start, 'after': end}))
    if apply:                                             # a dry run is not a run: the alarm may still start one
        (STATE / 'last-janitor').write_text(str(int(time.time())))


def notify(title, body):
    if shutil.which('notify-send'):
        subprocess.run(['notify-send', '-u', 'critical', '-a', 'diskguard', title, body], capture_output=True)


def check():
    STATE.mkdir(parents=True, exist_ok=True)
    u = usage()
    (STATE / 'status.json').write_text(json.dumps({**u, 't': int(time.time())}))
    if u['level'] == 'ok':
        return 0
    notify(f'System drive {u["use_pct"]} % full', f'{u["free_gb"]} GB free. diskguard is clearing regenerable files.')
    try:
        last = int((STATE / 'last-janitor').read_text())
    except (OSError, ValueError):
        last = 0
    if time.time() - last > RERUN_H * 3600:
        subprocess.run(['systemctl', '--user', 'start', '--no-block', 'diskguard-janitor.service'], capture_output=True)
    return 1


def main(argv):
    cmd = argv[0] if argv else 'status'
    if cmd == 'status':
        print(json.dumps(usage()))
        return 0
    if cmd == 'check':
        return check()
    if cmd == 'janitor':
        hours = float(argv[argv.index('--idle-hours') + 1]) if '--idle-hours' in argv else 48
        janitor('--apply' in argv, '--worktrees' in argv, hours)
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
