#!/usr/bin/env python3
"""memguard: keep the desktop, the Claude app and the Codex app alive when other work eats memory.

Written 2026-10-26 after the Claude app went down at 00:58: a Kimodo job started as its own service (outside heavy-run,
no cap) grew to 15 GB and the kernel failed allocations. Craig: "how did that happen you just built fixes to prevent",
"and codex", "you have root". heavy-run only governs jobs started through it; memguard covers everything else.

Two halves, every number scaled to this machine's RAM:
  protect   reserved memory (cgroup memory.low) for the apps people use: the Claude desktop app 12 % of RAM, the
            ChatGPT/Codex app 6 %, the desktop session 4 %. The ancestors up to user.slice get the total (root,
            persistent); the app scopes are found by their processes every pass, since their unit names change.
  throttle  any other unit that grows past 8 % of RAM gets heavy-run's per-job ceiling (MemoryHigh = 45 % of RAM /
            slots, CPU weight 40). If unprotected jobs together pass 45 % of RAM, the largest is held at its current
            size. MemoryHigh slows a job down by reclaiming from it; nothing is killed.

    memguard.py --install    root half (ancestor reservations) once; needs sudo
    memguard.py --once       one pass, then exit; --dry-run prints the actions instead
    memguard.py              loop every 10 s (memguard.service)
"""
import json, os, re, subprocess, sys, time
from pathlib import Path

CG = Path('/sys/fs/cgroup')
USER = CG / f'user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service'
STATE = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'memguard'
GB = 2 ** 30
# exe basenames whose unit is protected -> (app, share of RAM). An app spread over several scopes (launcher plus main)
# gets its share on the largest scope and 1 GB on the others.
PROTECT = {'claude-desktop': ('claude', 0.12), 'claude': ('claude', 0.12), 'ChatGPT': ('codex', 0.06)}
DESKTOP_SHARE, TOTAL_SHARE, BIG_SHARE, HEAVY_SHARE = 0.04, 0.25, 0.08, 0.45
NEVER_THROTTLE = ('session.slice', 'heavy.slice', 'init.scope')   # the desktop; heavy.slice has its own ceilings


def ram():
    return int(re.search(r'^MemTotal:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1]) * 1024


def slots(total):
    cpus = os.cpu_count() or 1
    return max(1, min(total // (48 * GB), max(1, cpus // 8)))


def units():
    """Leaf units (scopes and services) under the user manager: name, slice path, memory, exe basenames."""
    out = []
    for path in USER.rglob('*'):
        if not path.is_dir() or not path.name.endswith(('.scope', '.service')):
            continue
        try:
            current = int((path / 'memory.current').read_text())
            high = (path / 'memory.high').read_text().strip()
            low = int((path / 'memory.low').read_text())
            pids = [int(p) for p in (path / 'cgroup.procs').read_text().split()]
        except (OSError, ValueError):
            continue
        exes = set()
        for pid in pids[:64]:
            try:
                exes.add(os.path.basename(os.readlink(f'/proc/{pid}/exe')))
            except OSError:
                pass
        out.append({'unit': path.name, 'rel': str(path.relative_to(USER)), 'current': current,
                    'high': None if high == 'max' else int(high), 'low': low, 'exes': sorted(exes)})
    return out


def plan(found, total, n_slots):
    """The set-property actions for one pass. Pure, so it can be tested on a made-up machine."""
    actions = []
    big, per_job, budget = int(total * BIG_SHARE), int(total * HEAVY_SHARE / n_slots), int(total * HEAVY_SHARE)
    unprotected, apps = [], {}
    for u in found:
        hit = [PROTECT[e] for e in u['exes'] if e in PROTECT]
        if hit:
            apps.setdefault(hit[0][0], []).append((u, hit[0][1]))
            continue
        if u['rel'].startswith(NEVER_THROTTLE):
            continue
        unprotected.append(u)
        if u['current'] > big and (u['high'] is None or u['high'] > per_job):
            actions.append((u['unit'], {'MemoryHigh': per_job, 'CPUWeight': 40},
                            f"throttle {u['unit']} at {u['current'] / GB:.1f} GB (big job, cap {per_job / GB:.0f} GB)"))
    for app, scopes in apps.items():
        main = max(scopes, key=lambda x: x[0]['current'])[0]
        for u, share in scopes:
            want = int(total * share) if u is main else GB
            if abs(u['low'] - want) > GB // 4:
                actions.append((u['unit'], {'MemoryLow': want}, f'protect {app} ({want / GB:.0f} GB reserved)'))
    if sum(u['current'] for u in unprotected) > budget and unprotected:
        top = max(unprotected, key=lambda u: u['current'])
        hold = max(top['current'], GB)
        if top['high'] is None or top['high'] > hold:
            actions.append((top['unit'], {'MemoryHigh': hold, 'CPUWeight': 40},
                            f"hold {top['unit']} at {hold / GB:.1f} GB (unprotected jobs over {budget / GB:.0f} GB)"))
    return actions


def apply(actions, dry):
    STATE.mkdir(parents=True, exist_ok=True)
    for unit, props, why in actions:
        args = [f'{k}={v}' for k, v in props.items()]
        if dry:
            print(f'would set {unit} {" ".join(args)}  # {why}')
            continue
        r = subprocess.run(['systemctl', '--user', 'set-property', '--runtime', unit, *args], capture_output=True, text=True)
        line = {'t': time.strftime('%Y-%m-%dT%H:%M:%S'), 'unit': unit, 'set': props, 'why': why, 'ok': r.returncode == 0}
        if r.returncode:
            line['err'] = r.stderr.strip()[:200]
        with open(STATE / 'actions.jsonl', 'a') as fh:
            fh.write(json.dumps(line) + '\n')


def vm_tuning(total):
    """Kernel headroom, scaled to RAM (added after the 01:22 Codex app GPU-process crash, Craig: "codex desktop
    crashing"): the NVIDIA driver and Electron GPU processes failed large allocations at 01:23 and 01:26 while RAM was
    fragmented (no free blocks of 512 KB or more) with only a 66 MB free pool. Keep a free pool of 1 % of RAM (64 MB to
    2 GB), start reclaim a little earlier (1.5 % of RAM between watermarks; 3 % kept kswapd busy) and compact proactively."""
    return {'vm.min_free_kbytes': max(65536, min(2 * 2 ** 20, total // 1024 // 100)),
            'vm.watermark_scale_factor': 150, 'vm.compaction_proactiveness': 40}


def install():
    """Root half: reserve the protected total on every ancestor (memory.low only works if the parents hold it too)."""
    total, uid = ram(), os.getuid()
    conf = ''.join(f'{k} = {v}\n' for k, v in vm_tuning(total).items())
    subprocess.run(['sudo', '-n', 'tee', '/etc/sysctl.d/99-memguard.conf'], input='# memguard (akilleez forge/endoforge/tools/throttle)\n' + conf,
                   text=True, stdout=subprocess.DEVNULL, check=True)
    subprocess.run(['sudo', '-n', 'sysctl', '-q', '-p', '/etc/sysctl.d/99-memguard.conf'], check=True)
    want = int(total * TOTAL_SHARE)
    for unit in ('user.slice', f'user-{uid}.slice', f'user@{uid}.service'):
        subprocess.run(['sudo', '-n', 'systemctl', 'set-property', unit, f'MemoryLow={want}'], check=True)
    for unit, share in (('app.slice', TOTAL_SHARE - DESKTOP_SHARE), ('session.slice', DESKTOP_SHARE)):
        subprocess.run(['systemctl', '--user', 'set-property', unit, f'MemoryLow={int(total * share)}'], check=True)
    print(conf.strip().replace('\n', '; '))
    print(f'reserved {want / GB:.0f} GB up to user.slice (app.slice {(TOTAL_SHARE - DESKTOP_SHARE) * total / GB:.0f} GB, '
          f'session.slice {DESKTOP_SHARE * total / GB:.0f} GB)')


def main():
    args = sys.argv[1:]
    if '--install' in args:
        return install()
    while True:
        total = ram()
        apply(plan(units(), total, slots(total)), '--dry-run' in args)
        if '--once' in args or '--dry-run' in args:
            return 0
        time.sleep(10)


if __name__ == '__main__':
    sys.exit(main())
