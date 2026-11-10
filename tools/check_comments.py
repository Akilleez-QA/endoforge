"""Refuse code comment lines in tracked source files (D-07).

Usage: python3 -I tools/check_comments.py [PATH ...]

Lists every tracked file under PATH (default: the whole checkout) with git ls-files, skips TODELETE/, experiments/,
node_modules and vendor/, and reads .mjs, .js, .cjs, .ts, .py, .rs, .sh and Makefile files. Python comments, whole
line or end of line, are found with tokenize; .sh and Makefile lines starting with #. JavaScript, TypeScript and Rust
are lexed: every // and /* */ comment is found wherever it starts, and each line a block comment spans is reported,
while comment-like text inside strings, template literals (with ${} nesting), regular expression literals, Rust
character literals and raw strings is not. A shebang on line 1 is kept, as is any comment naming a tool directive or licence header: @ts-, eslint, noqa,
type:, pragma, pylint, SPDX, -*-, fmt:, istanbul, "c8 ". Prints file:line: text for each comment found and exits 1,
or exits 0 when there are none. Exits 2 when git ls-files fails, a Python file cannot be tokenized, or a lexed file
has an unterminated comment, string, template literal or regular expression.
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


def hash_comments(text):
    found = []
    for i, line in enumerate(text.split('\n')):
        s = line.strip()
        if i == 0 and s.startswith('#!'):
            continue
        if s.startswith('#') and not KEEP.search(s):
            found.append((i + 1, s))
    return found


REGEX_AFTER = frozenset(('return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
                         'do', 'else', 'yield', 'await', 'extends'))


def word_char(ch):
    return ch.isalnum() or ch in '_$' or ord(ch) > 127


class SlashLexer:
    def __init__(self, text, rust):
        self.text = text
        self.rust = rust
        self.n = len(text)
        self.found = []
        self.prev = ('start', '')
        self.braces = []

    def line_at(self, pos):
        return self.text.count('\n', 0, pos) + 1

    def emit(self, start, end):
        first = self.line_at(start)
        for k, part in enumerate(self.text[start:end].split('\n')):
            s = part.strip()
            if s and not KEEP.search(s):
                self.found.append((first + k, s))

    def fail(self, what, pos):
        raise SyntaxError(f'unterminated {what} at line {self.line_at(pos)}')

    def regex_allowed(self):
        kind, value = self.prev
        if kind == 'start':
            return True
        if kind == 'word':
            return value in REGEX_AFTER
        if kind == 'punct':
            return value not in ')]'
        return False

    def ends_operand(self, i):
        j = i - 1
        while j >= 0 and self.text[j] in ' \t\r':
            j -= 1
        if j >= 0 and self.text[j] == '\n':
            return False
        kind, value = self.prev
        if kind in ('value', 'postfix'):
            return True
        if kind == 'word':
            return value not in REGEX_AFTER
        return kind == 'punct' and value in ')]'

    def increment(self, i, op):
        self.prev = ('postfix', op) if self.ends_operand(i) else ('punct', op)
        return i + 2

    def block_end(self, i):
        if not self.rust:
            end = self.text.find('*/', i + 2)
            if end < 0:
                self.fail('block comment', i)
            return end + 2
        depth = 0
        j = i
        while j < self.n:
            if self.text.startswith('/*', j):
                depth += 1
                j += 2
            elif self.text.startswith('*/', j):
                depth -= 1
                j += 2
                if depth == 0:
                    return j
            else:
                j += 1
        self.fail('block comment', i)

    def quoted_end(self, i, quote):
        j = i + 1
        while j < self.n:
            ch = self.text[j]
            if ch == '\\':
                j += 2
                continue
            if ch == quote:
                return j + 1
            if ch == '\n' and not self.rust:
                break
            j += 1
        self.fail('string', i)

    def template(self, j, start):
        while j < self.n:
            ch = self.text[j]
            if ch == '\\':
                j += 2
                continue
            if ch == '`':
                self.prev = ('value', '`')
                return j + 1
            if self.text.startswith('${', j):
                self.braces.append('template')
                self.prev = ('punct', '{')
                return j + 2
            j += 1
        self.fail('template literal', start)

    def regex_end(self, i):
        j = i + 1
        in_class = False
        while j < self.n:
            ch = self.text[j]
            if ch == '\\':
                j += 2
                continue
            if ch == '\n':
                break
            if in_class:
                in_class = ch != ']'
            elif ch == '[':
                in_class = True
            elif ch == '/':
                j += 1
                while j < self.n and word_char(self.text[j]):
                    j += 1
                return j
            j += 1
        self.fail('regular expression', i)

    def rust_quote(self, i):
        text = self.text
        if text.startswith('\\', i + 1):
            end = text.find("'", i + 3)
            if end < 0:
                self.fail('character literal', i)
            return end + 1, True
        if i + 2 < self.n and text[i + 2] == "'" and text[i + 1] != '\n':
            return i + 3, True
        return i + 1, False

    def raw_string_end(self, j):
        hashes = 0
        while j + hashes < self.n and self.text[j + hashes] == '#':
            hashes += 1
        if j + hashes >= self.n or self.text[j + hashes] != '"':
            return None
        close = '"' + '#' * hashes
        end = self.text.find(close, j + hashes + 1)
        if end < 0:
            self.fail('raw string', j)
        return end + len(close)

    def word(self, i):
        j = i + 1
        while j < self.n and word_char(self.text[j]):
            j += 1
        word = self.text[i:j]
        if self.rust and word in ('r', 'br'):
            raw = self.raw_string_end(j)
            if raw:
                self.prev = ('value', '"')
                return raw
        self.prev = ('value' if word[0].isdigit() else 'word', word)
        return j

    def step(self, i):
        text = self.text
        ch = text[i]
        if ch.isspace():
            return i + 1
        if text.startswith('//', i):
            end = text.find('\n', i)
            end = self.n if end < 0 else end
            self.emit(i, end)
            return end
        if text.startswith('/*', i):
            end = self.block_end(i)
            self.emit(i, end)
            return end
        if self.rust and ch == "'":
            end, literal = self.rust_quote(i)
            if literal:
                self.prev = ('value', ch)
            return end
        if ch in '"\'':
            self.prev = ('value', ch)
            return self.quoted_end(i, ch)
        if ch == '`' and not self.rust:
            return self.template(i + 1, i)
        if not self.rust and text.startswith(('++', '--'), i):
            return self.increment(i, text[i:i + 2])
        if ch == '/' and not self.rust and self.regex_allowed():
            self.prev = ('value', '/')
            return self.regex_end(i)
        if word_char(ch) or (ch == '#' and not self.rust):
            return self.word(i)
        if ch == '{':
            self.braces.append('brace')
        elif ch == '}' and self.braces and self.braces.pop() == 'template':
            return self.template(i + 1, i)
        self.prev = ('punct', ch)
        return i + 1

    def run(self):
        i = 0
        if self.text.startswith('#!'):
            i = self.text.find('\n')
            i = self.n if i < 0 else i
        while i < self.n:
            i = self.step(i)
        return self.found


def slash_comments(text, rust=False):
    return SlashLexer(text, rust).run()


def comments(path, text):
    if path.endswith('.py'):
        return python_comments(text)
    if path.endswith(HASH_SUFFIXES):
        return hash_comments(text)
    return slash_comments(text, rust=path.endswith('.rs'))


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
