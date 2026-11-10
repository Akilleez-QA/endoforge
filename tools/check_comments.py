"""Refuse code comment lines in tracked source files (D-07).

Usage: python3 -I tools/check_comments.py [PATH ...]

Lists every tracked file under PATH (default: the whole checkout) with git ls-files, skips TODELETE/, experiments/,
node_modules and vendor/, and reads .mjs, .js, .cjs, .ts, .py, .rs, .sh and Makefile files. Python comments are
found with tokenize; .sh and Makefile lines starting with #; the others lines starting with //, /*, "* ", a lone *
or */. A shebang on line 1 is kept, as is any comment naming a tool directive or licence header: @ts-, eslint, noqa,
type:, pragma, pylint, SPDX, -*-, fmt:, istanbul, "c8 ". Prints file:line: text for each comment found and exits 1,
or exits 0 when there are none. Exits 2 when git ls-files fails or a Python file cannot be tokenized.
"""
import io
import re
import subprocess
import sys
import tokenize

KEEP = re.compile(r'(@ts-|eslint|noqa|type:|pragma|pylint|SPDX|-\*-|fmt:|istanbul|c8 )')
SKIP = ('TODELETE/', 'experiments/', 'node_modules', 'vendor/')
SUFFIXES = ('.mjs', '.js', '.cjs', '.ts', '.py', '.rs', '.sh', 'Makefile')
HASH_SUFFIXES = ('.sh', 'Makefile')
USAGE = 'usage: python3 -I tools/check_comments.py [PATH ...]'


def checked(path):
    return not path.startswith(SKIP) and path.endswith(SUFFIXES)


def python_comments(text):
    found = []
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        if tok.type != tokenize.COMMENT:
            continue
        if tok.start[0] == 1 and tok.string.startswith('#!'):
            continue
        if KEEP.search(tok.string):
            continue
        found.append((tok.start[0], tok.string.strip()))
    return found


def line_comments(text, hashy):
    found = []
    for i, line in enumerate(text.split('\n')):
        s = line.strip()
        if i == 0 and s.startswith('#!'):
            continue
        if hashy:
            comment = s.startswith('#')
        else:
            comment = s.startswith('//') or s.startswith('/*') or s.startswith('* ') or s == '*' or s == '*/'
        if comment and not KEEP.search(s):
            found.append((i + 1, s))
    return found


def comments(path, text):
    if path.endswith('.py'):
        return python_comments(text)
    return line_comments(text, path.endswith(HASH_SUFFIXES))


def tracked(paths):
    out = subprocess.run(['git', 'ls-files', '-z', '--', *paths], capture_output=True, check=True).stdout
    return [p for p in out.decode('utf8', errors='surrogateescape').split('\0') if p]


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    if any(a in ('-h', '--help') for a in args):
        print(USAGE)
        parts = (__doc__ or '').split('\n\n', 2)
        if len(parts) == 3:
            print(parts[2].strip())
        return 0
    try:
        files = tracked(args or ['.'])
    except (OSError, subprocess.CalledProcessError) as err:
        print(f'check_comments: git ls-files failed: {err}', file=sys.stderr)
        return 2
    found = []
    broken = []
    for f in files:
        if not checked(f):
            continue
        with open(f, encoding='utf8', errors='replace') as handle:
            text = handle.read()
        try:
            hits = comments(f, text)
        except (tokenize.TokenError, SyntaxError) as err:
            broken.append(f'{f}: cannot tokenize: {err}')
            continue
        found.extend(f'{f}:{line}: {s[:80]}' for line, s in hits)
    for line in found:
        print(line)
    for line in broken:
        print(line, file=sys.stderr)
    print(f'{len(found)} comment lines', file=sys.stderr)
    if broken:
        return 2
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())
