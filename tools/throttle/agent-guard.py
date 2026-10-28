#!/usr/bin/env python3
"""agent-guard: a Claude Code PreToolUse hook that refuses Bash commands which have already cost us work or stability.

Written 2026-10-26 (Craig: "do it in code and mechanisms", "improve the system"). Each rule comes from a logged mistake:
  shared-git   whole-tree `git stash`, `reset --hard`, `checkout .`/`-f`, `restore .`, `clean -f` in a checkout with
               uncommitted changes (naming specific files is allowed: that touches only those files). A stash in the shared integration worktree swept the audio session's mixer edits
               (mistake #81); several sessions share checkouts, and their changes are invisible in one session.
  add-all      `git add -A` / `--all` with no paths, or `git add .`: stages other sessions' files. Stage by path.
  whole-tree   du / ncdu / dust / gdu / `btrfs filesystem du` on a drive or a big root, or `find` there without a
               -maxdepth of 4 or less. Three such scans at once over a 3.2 TB Btrfs helped crash the Claude app
               (mistake #96). Use `diskguard status`, or measure a specific folder.

A refused command gets exit 2 and a reason (Claude Code shows it to the agent, which then adjusts). When the agent is
sure (every uncommitted change is its own, say), it adds `AGENT_GUARD_OK=1` in front of the command. Each refusal is
logged to ~/.local/state/agent-guard/refusals.jsonl. Anything this cannot parse is allowed: the hook must never be the
thing that stops work it does not understand.

Install: ~/.local/bin/agent-guard, and in ~/.claude/settings.json
    "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "python3 -B ~/.local/bin/agent-guard"}]}]}
"""
import json, os, re, shlex, subprocess, sys, time
from pathlib import Path

HOME = Path.home()
WRAPPERS = {'sudo', 'nice', 'ionice', 'timeout', 'env', 'command', 'exec', 'time', 'nohup', 'stdbuf', 'chrt',
            'taskset', 'heavy-run', 'systemd-run'}
# wrapper options that take a separate value (sudo -n takes none: `sudo -n btrfs` must still see btrfs)
WRAPPER_ARGS = {'nice': ('-n',), 'ionice': ('-c', '-n', '-p'), 'timeout': ('-k', '-s', '--signal', '--kill-after'),
                'sudo': ('-u', '-g', '-C'), 'chrt': ('-p',), 'taskset': ('-c',)}
SCANNERS = {'du', 'ncdu', 'dust', 'gdu', 'duc'}
OVERRIDE = 'AGENT_GUARD_OK=1'


def big_roots():
    """Paths whose full walk is a whole-drive scan: drive roots, mount points and the big shared folders."""
    roots = {Path('/'), Path('/home'), Path('/mnt'), Path('/var'), Path('/usr'), HOME}
    roots |= {HOME / d for d in ('LOCAL LLM', '.cache', 'Work', 'Code', 'Projects', 'Imported-Windows', '.local',
                                 '.local/share')}
    try:
        for line in Path('/proc/self/mounts').read_text().splitlines():
            parts = line.split()
            if len(parts) > 2 and parts[2] in ('btrfs', 'ext4', 'xfs', 'ntfs3', 'ntfs', 'zfs', 'cifs', 'vfat'):
                roots.add(Path(parts[1].replace('\\040', ' ')))
    except OSError:
        pass
    return roots


def segments(command):
    """Split a shell command into simple commands at ; && || | and newlines (quotes respected)."""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=';&|')
        lex.whitespace_split = True
        lex.commenters = ''
        tokens = list(lex)
    except ValueError:
        return []
    out, cur = [], []
    for t in tokens:
        if t and set(t) <= set(';&|'):
            if cur:
                out.append(cur)
            cur = []
        else:
            cur.append(t)
    if cur:
        out.append(cur)
    return out


def program(tokens):
    """(name, args) of the real command, past assignments and wrappers like sudo, nice, ionice -c3, timeout 300."""
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', t):
            i += 1
            continue
        name = os.path.basename(t)
        if name in WRAPPERS:
            i += 1
            if name == 'systemd-run':
                while i < len(tokens) and tokens[i] != '--':
                    i += 1
                i += 1
                continue
            takes = WRAPPER_ARGS.get(name, ())
            while i < len(tokens) and (tokens[i].startswith('-') or re.match(r'^\d+(\.\d+)?[smhd]?$', tokens[i])):
                i += 1 + (tokens[i] in takes)
            continue
        return name, tokens[i + 1:]
    return None, []


def resolve(path, cwd):
    p = Path(os.path.expanduser(path.replace('$HOME', str(HOME))))
    return (p if p.is_absolute() else Path(cwd) / p).resolve(strict=False)


def dirty(repo):
    try:
        r = subprocess.run(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=normal'],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and bool(r.stdout.strip())


def check_git(args, cwd):
    repo = cwd
    while len(args) >= 2 and args[0] in ('-C', '-c'):
        if args[0] == '-C':
            repo = str(resolve(args[1], cwd))
        args = args[2:]
    if not args:
        return None
    sub, rest = args[0], args[1:]
    paths = [a for a in rest if not a.startswith('-')]
    whole = not paths or any(a in ('.', ':/', './', '*') for a in paths)   # the whole tree, not named files
    if sub == 'add' and ((any(a in ('-A', '--all') for a in rest) and not paths) or any(a in ('.', ':/', './') for a in paths)):
        return ('add-all', 'git add -A / . stages every changed file in the checkout, including other sessions\' '
                'work. Stage your own files by path: git add <file> <file>.')
    destructive = (
        (sub == 'stash' and (not rest or rest[0] not in ('list', 'show'))) or
        (sub == 'reset' and any(a in ('--hard', '--merge', '--keep') for a in rest)) or
        (sub == 'checkout' and (any(a in ('.', ':/', './') for a in paths) or '-f' in rest or '--force' in rest)) or
        (sub == 'restore' and '--staged' not in rest and whole) or
        (sub == 'clean' and any(re.match(r'^-[a-zA-Z]*f', a) or a == '--force' for a in rest)))
    if destructive and dirty(repo):
        return ('shared-git', f'`git {sub}` would hide or discard uncommitted changes in {repo}, and other sessions '
                'may own some of them (a stash once swept another session\'s edits). Compare with git diff or '
                'git show HEAD:<file>, or commit your own files by path. If every uncommitted change is yours, '
                f'prefix the command with {OVERRIDE}.')
    return None


def check_scan(name, args, cwd):
    roots = big_roots()
    if name in SCANNERS or name == 'btrfs':
        if name == 'btrfs':
            if len(args) < 2 or args[0] not in ('filesystem', 'fi') or args[1] != 'du':
                return None
            args = args[2:]
        paths = [a for a in args if not a.startswith('-')] or ['.']
        hit = [p for p in paths if resolve(p, cwd) in roots]
        if hit:
            return ('whole-tree', f'`{name}` on {hit[0]} walks a whole drive or a big shared folder (three such scans '
                    'helped crash the Claude app on 2026-10-26). Use `diskguard status` for the drive, or measure one '
                    'specific folder with `ionice -c3 du -sh <folder>`.')
    if name == 'find':
        paths = []
        for a in args:
            if a.startswith(('-', '(', '!')):
                break
            paths.append(a)
        depth = None
        if '-maxdepth' in args:
            try:
                depth = int(args[args.index('-maxdepth') + 1])
            except (ValueError, IndexError):
                pass
        hit = [p for p in (paths or ['.']) if resolve(p, cwd) in roots]
        if hit and (depth is None or depth > 4):
            return ('whole-tree', f'`find` on {hit[0]} without -maxdepth 4 or less walks a whole drive or big shared '
                    'folder. To find files by name use `plocate -i <name>` (the system drive is indexed nightly; '
                    '/mnt is not), add -maxdepth 4 or less, or search one specific folder.')
    return None


def evaluate(command, cwd):
    """(rule, reason) for the first refused simple command, else None."""
    if OVERRIDE in command:
        return None
    for seg in segments(command):
        if seg and seg[0] == 'cd' and len(seg) > 1:
            cwd = str(resolve(seg[1], cwd))
            continue
        name, args = program(seg)
        if name == 'git':
            found = check_git(args, cwd)
        elif name:
            found = check_scan(name, args, cwd)
        else:
            found = None
        if found:
            return found
    return None


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return 0
    if event.get('tool_name') != 'Bash':
        return 0
    command = (event.get('tool_input') or {}).get('command') or ''
    cwd = event.get('cwd') or os.getcwd()
    try:
        found = evaluate(command, cwd)
    except Exception:                                   # never block on our own bug
        return 0
    if not found:
        return 0
    rule, reason = found
    try:
        state = Path(os.environ.get('XDG_STATE_HOME', HOME / '.local/state')) / 'agent-guard'
        state.mkdir(parents=True, exist_ok=True)
        with (state / 'refusals.jsonl').open('a') as fh:
            fh.write(json.dumps({'t': time.strftime('%Y-%m-%dT%H:%M:%S'), 'rule': rule, 'cwd': cwd,
                                 'session': event.get('session_id'), 'command': command[:500]}) + '\n')
    except OSError:
        pass
    print(f'agent-guard ({rule}): {reason}', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
