"""Refuse URL.pathname used as a filesystem path in tracked source files.

Usage: python3 -I tools/check_file_url_paths.py [PATH ...]

Lists every tracked file under PATH (default: the whole checkout) with git ls-files and reads .mjs, .js, .cjs, .ts,
.mts, .cts, .sh and Makefile files, skipping node_modules, vendor/ and every frozen experiment (a directory
experiments/<name>/ with a tracked RESULT.md, whose measured scripts are not rewritten). A line that reads .pathname,
or destructures pathname from an object, is reported unless ALLOW names that file and a fragment of that line, which
is kept only for a URL that is not a file: URL. Prints file:line: text for each finding and the fix, and exits 1, or
exits 0 when there are none. Exits 2 when git ls-files fails.
"""
import re
import subprocess
import sys

SUFFIXES = ('.mjs', '.js', '.cjs', '.ts', '.mts', '.cts', '.sh', 'Makefile')
SKIP_PARTS = ('node_modules', 'vendor')
PATTERN = re.compile(r'\.pathname\b|\{[^}]*\bpathname\b[^}]*\}\s*=')
ALLOW = (
    ('tools/hillclimb/bin/hillclimb.mjs', 'path.extname(new URL(r.url).pathname)'),
)
FIX = ('use fileURLToPath(new URL(...)) from node:url; URL.pathname keeps percent-encoding, '
       'so paths with spaces break')
USAGE = 'usage: python3 -I tools/check_file_url_paths.py [PATH ...]'


def frozen_experiments(files):
    return {p[:-len('RESULT.md')] for p in files
            if p.startswith('experiments/') and p.count('/') == 2 and p.endswith('/RESULT.md')}


def checked(path, frozen):
    if any(part in SKIP_PARTS for part in path.split('/')):
        return False
    if any(path.startswith(d) for d in frozen):
        return False
    return path.endswith(SUFFIXES)


def allowed(path, line):
    return any(path == p and fragment in line for p, fragment in ALLOW)


def findings(path, text):
    return [(n, line.strip()) for n, line in enumerate(text.split('\n'), 1)
            if PATTERN.search(line) and not allowed(path, line)]


def tracked(paths):
    out = subprocess.run(['git', 'ls-files', '-z', '--', *paths], capture_output=True, check=True).stdout
    return [p for p in out.decode('utf8', errors='surrogateescape').split('\0') if p]


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    if any(a in ('-h', '--help') for a in args):
        print(USAGE)
        return 0
    try:
        files = tracked(args or ['.'])
        frozen = frozen_experiments(tracked(['experiments']))
    except (OSError, subprocess.CalledProcessError) as err:
        print(f'check_file_url_paths: git ls-files failed: {err}', file=sys.stderr)
        return 2
    found = []
    for f in files:
        if not checked(f, frozen):
            continue
        with open(f, encoding='utf8', errors='replace') as handle:
            found.extend(f'{f}:{n}: {s[:100]}' for n, s in findings(f, handle.read()))
    for line in found:
        print(line)
    if found:
        print(f'{len(found)} URL.pathname uses: {FIX}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
