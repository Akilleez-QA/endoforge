#!/usr/bin/env python3
"""job-locks: put every active job's locked decisions in front of the agent at session start, resume and compaction.

Active jobs are listed in ~/.config/job-locks/active.json: ["/path/to/job/manifest.json", ...]. Each manifest's
`locks` object is printed one line per lock (decision or text, who decided, the quoted words), so a Claude Code
SessionStart hook adds them to the context.

    job-locks                    print the locks of every active job
    job-locks add <manifest>     register a job;   job-locks rm <manifest>   unregister it
Hook (in ~/.claude/settings.json):
    "SessionStart": [{"hooks": [{"type": "command", "command": "python3 -B ~/.local/bin/job-locks"}]}]
"""
import json, os, sys, tempfile
from pathlib import Path

REG = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'job-locks' / 'active.json'
WIDTH = 300


class RegistryError(Exception):
    pass


def active():
    try:
        paths = json.loads(REG.read_text())
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as error:
        raise RegistryError(f'the job-locks registry {REG} is unreadable: {error}') from None
    if not isinstance(paths, list):
        raise RegistryError(f'the job-locks registry {REG} is unreadable: it is not a list')
    return [p for p in paths if isinstance(p, str)]


def save(paths):
    REG.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.active-tmp-', dir=REG.parent)
    try:
        with os.fdopen(fd, 'w') as fh:
            fh.write(json.dumps(paths, indent=1))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, REG)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def summary(lock):
    if not isinstance(lock, dict):
        return str(lock)[:WIDTH]
    body = (lock.get('decision') or lock.get('text') or lock.get('plan') or lock.get('words') or lock.get('voice')
            or json.dumps({k: v for k, v in lock.items() if k != 'by'}))
    who = lock.get('by', '')
    line = (f'{body} ({who})' if who else str(body))[:WIDTH]
    extra = [f' EXCEPTION: {v}'[:WIDTH] for k, v in lock.items() if k.startswith('exception')]
    return line + ''.join(extra)


def render(paths):
    out = []
    for p in paths:
        try:
            m = json.loads(Path(p).read_text())
        except (OSError, ValueError) as error:
            out.append(f'WARNING: locked decisions for {p} could not be read ({error}); '
                       'read that manifest before any brief, render or deliverable.')
            continue
        locks = m.get('locks') or {}
        if not locks:
            continue
        name = m.get('name') or m.get('job') or Path(p).parent.parent.name
        out.append(f'LOCKED DECISIONS for job "{name}" ({p}). Re-read before any brief, render or deliverable; '
                   'never contradict one without the user changing it:')
        out += [f'- {k}: {summary(v)}' for k, v in locks.items()]
    return '\n'.join(out)


def main(argv):
    if argv[:1] in (['add'], ['rm']) and len(argv) == 2:
        try:
            paths = active()
            target = str(Path(argv[1]).resolve())
            paths = [p for p in paths if p != target] + ([target] if argv[0] == 'add' else [])
            save(paths)
        except (RegistryError, OSError) as error:
            print(f'job-locks: not changed: {error}', file=sys.stderr)
            return 1
        print('\n'.join(paths) or '(no active jobs)')
        return 0
    try:
        text = render(active())
    except RegistryError as error:
        print(f'WARNING: {error}; locked decisions of active jobs may be missing. Read each job manifest before any '
              'brief, render or deliverable.')
        return 0
    if text:
        print(text)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:
        print(f'WARNING: job-locks failed ({exc}); locked decisions of active jobs may be missing.')
        sys.exit(0)
