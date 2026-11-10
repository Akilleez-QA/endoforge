"""D-07: tools/check_comments.py keep-rules, comment forms, file set, output and exit codes."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'tools' / 'check_comments.py'
_spec = importlib.util.spec_from_file_location('check_comments', SCRIPT)
cc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cc)


def lines(path, text):
    return [n for n, _ in cc.comments(path, text)]


class CommentForms(unittest.TestCase):
    def test_slash_slash(self):
        self.assertEqual(lines('a.mjs', 'const a = 1;\n// why\n  // indented\n'), [2, 3])

    def test_block_comment_lines(self):
        text = '/*\n * one\n *\n */\n/** doc */\nconst x = 1;\n'
        self.assertEqual(lines('a.js', text), [1, 2, 3, 4, 5])

    def test_star_without_space_is_code(self):
        self.assertEqual(lines('a.js', 'const a = 2\n*3;\n'), [])

    def test_end_of_line_slash_comment_after_code(self):
        self.assertEqual(cc.comments('a.ts', 'const a = 1; // tail\n'), [(1, '// tail')])
        self.assertEqual(cc.comments('a.mjs', 'if (x) {   // why\n  y();\n}\n'), [(1, '// why')])

    def test_inline_block_comment_after_and_between_code(self):
        self.assertEqual(cc.comments('a.js', 'f(a, /* b */ c);\n'), [(1, '/* b */')])
        self.assertEqual(cc.comments('a.js', 'x(); /* one\n two */ y();\n'), [(1, '/* one'), (2, 'two */')])
        self.assertEqual(lines('a.js', 'import/* a */(1);\n'), [1])

    def test_slash_forms_in_each_suffix(self):
        for suffix in ('.mjs', '.js', '.cjs', '.ts', '.rs'):
            with self.subTest(suffix=suffix):
                self.assertEqual(lines('f' + suffix, 'x\n// c\n/* c */\n'), [2, 3])

    def test_hash_in_shell_and_makefile(self):
        for path in ('run.sh', 'Makefile', 'sub/Makefile'):
            with self.subTest(path=path):
                self.assertEqual(lines(path, 'a:\n# c\n\t# d\n\techo hi\n'), [2, 3])

    def test_hash_is_not_a_comment_in_javascript(self):
        self.assertEqual(lines('a.mjs', '#private = 1;\n'), [])

    def test_slash_is_not_a_comment_in_shell(self):
        self.assertEqual(lines('a.sh', '// not a comment\n'), [])

    def test_python_hash_comments(self):
        text = 'x = 1  # trailing\n# full line\ns = "# in a string"\n'
        self.assertEqual(lines('a.py', text), [1, 2])

    def test_python_docstring_is_not_a_comment(self):
        self.assertEqual(lines('a.py', '"""Doc.\n# inside docstring\n"""\ndef f():\n    """Doc."""\n'), [])

    def test_text_is_stripped(self):
        self.assertEqual(cc.comments('a.mjs', '    // spaced   \n'), [(1, '// spaced')])
        self.assertEqual(cc.comments('a.py', 'x = 1   #  note  \n'), [(1, '#  note')])


class LexedNotComments(unittest.TestCase):
    def test_strings(self):
        for text in ("const u = 'http://x';\n", 'const s = "/* not */";\n', "s = 'it\\'s // x';\n",
                     's = "a\\"// b";\n', "s = 'line \\\n// continued';\n"):
            with self.subTest(text=text):
                self.assertEqual(lines('a.mjs', text), [])

    def test_template_literals(self):
        for text in ('t = `// a\n/* b */`;\n', 't = `${a /* real */}`;\n', 't = `x ${`// ${y}`} // z`;\n',
                     't = `${ {a: 1}.a } // t`;\n', 't = `\\`// e`;\n'):
            with self.subTest(text=text):
                expected = [1] if 'real' in text else []
                self.assertEqual(lines('a.mjs', text), expected)

    def test_template_then_code_comment(self):
        self.assertEqual(cc.comments('a.mjs', 'f(`${x}`); // after\n'), [(1, '// after')])

    def test_regular_expressions(self):
        for text in ('const r = /\\/\\/ x/;\n', 'const r = /[/*]/g;\n', 'x.replace(/\\/*$/, "");\n',
                     'return /a\\/\\/b/.test(s);\n', 'if (!/\\/\\//.test(s)) f();\n', 'a = [/\\/*/, /x/];\n',
                     'const r = /[\\]/]\\/\\//;\n', '}\n/ab\\/\\/c/.test(s);\n', 'const r = /=\\/\\//;\n'):
            with self.subTest(text=text):
                self.assertEqual(lines('a.mjs', text), [])

    def test_division_is_not_a_regex(self):
        self.assertEqual(cc.comments('a.mjs', 'const h = a / b / c; // ratio\n'), [(1, '// ratio')])
        self.assertEqual(cc.comments('a.mjs', 'x = (a) / 2 // half\n'), [(1, '// half')])
        self.assertEqual(cc.comments('a.mjs', 'x = a[0] / 2 /* q */\n'), [(1, '/* q */')])
        self.assertEqual(cc.comments('a.mjs', 'x = 10 / 2; // n\n'), [(1, '// n')])
        self.assertEqual(cc.comments('a.mjs', "x = 's' / 2; // n\n"), [(1, '// n')])

    def test_private_names_and_shebang(self):
        self.assertEqual(lines('a.mjs', '#!/usr/bin/env node // x\nclass A { #p = 1; }\n'), [])

    def test_regressions_from_the_repository(self):
        for rel in ('tools/tscheck/test/verdict.test.mjs', 'core/runtime/test/contained-js.test.mjs'):
            with self.subTest(path=rel):
                text = (REPO / rel).read_text(encoding='utf8')
                self.assertEqual(cc.comments(rel, text), [])
        text = ("  '@ts-nocheck after a block comment': [project(listed(), "
                "{ '/proj/a.ts': `/* x */ // @ts-nocheck\\n${bad}` }), /@ts-nocheck/],\n"
                "for (const source of ['exports.main = () => import/* a */(1);', "
                "'exports.main = () => import // b\\n(1);']) {}\n")
        self.assertEqual(lines('a.mjs', text), [])

    def test_rust_literals(self):
        text = ('fn f<\'a>(s: &\'a str) -> char { let u = "http://x"; let r = r#"/* "// */"#; let c = \'/\';\n'
                "let q = '\\''; let b = br\"//\"; '\"' }\n")
        self.assertEqual(lines('a.rs', text), [])
        self.assertEqual(cc.comments('a.rs', 'let a = 1; // tail\n/* outer /* inner */ still */ x\n'),
                         [(1, '// tail'), (2, '/* outer /* inner */ still */')])

    def test_unterminated_input_is_a_syntax_error(self):
        for text in ('x = "abc\n', 'x = `abc\n', '/* open\n', 'x = /abc\n'):
            with self.subTest(text=text), self.assertRaises(SyntaxError):
                cc.comments('a.mjs', text)

    def test_owned_tool_trees_are_clean(self):
        files = subprocess.run(['git', 'ls-files', '--', 'tools/conductor', 'tools/job', 'tools/lib', 'tools/tscheck',
                                'tools/atomizer'], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
        found = []
        for rel in files:
            if cc.checked(rel):
                found += [(rel, n, s) for n, s in cc.comments(rel, (REPO / rel).read_text(encoding='utf8'))]
        self.assertEqual(found, [])


class KeepRules(unittest.TestCase):
    DIRECTIVES = ('@ts-check', '@ts-ignore', 'eslint-disable-next-line', 'noqa: E501', 'type: ignore',
                  'pragma: no cover', 'pylint: disable=x', 'SPDX-License-Identifier: GPL-3.0-only',
                  '-*- coding: utf-8 -*-', 'fmt: off', 'istanbul ignore next', 'c8 ignore next')

    def test_shebang_on_first_line_kept(self):
        self.assertEqual(lines('a.sh', '#!/bin/sh\necho\n'), [])
        self.assertEqual(lines('a.py', '#!/usr/bin/env python3\nx = 1\n'), [])
        self.assertEqual(lines('a.mjs', '#!/usr/bin/env node\nx\n'), [])

    def test_shebang_after_first_line_is_a_comment(self):
        self.assertEqual(lines('a.sh', 'echo\n#!/bin/sh\n'), [2])
        self.assertEqual(lines('a.py', 'x = 1\n#!/usr/bin/env python3\n'), [2])

    def test_each_directive_kept_in_each_form(self):
        for d in self.DIRECTIVES:
            for path, text in (('a.mjs', f'// {d}\n'), ('a.js', f'/* {d} */\n'), ('a.ts', f' * {d}\n'),
                               ('a.sh', f'# {d}\n'), ('Makefile', f'# {d}\n'), ('a.py', f'x = 1  # {d}\n')):
                with self.subTest(directive=d, path=path):
                    self.assertEqual(lines(path, text), [])

    def test_c8_needs_a_following_space(self):
        self.assertEqual(lines('a.mjs', '// c8\n// abc8 x\n'), [1])

    def test_licence_header_kept_through_spdx(self):
        text = '// SPDX-License-Identifier: GPL-3.0-only\n// Copyright notice\n'
        self.assertEqual(lines('a.mjs', text), [2])

    def test_near_misses_are_comments(self):
        for word in ('ts-check', 'type ignore', 'fmt off', 'pyl int'):
            with self.subTest(word=word):
                self.assertEqual(lines('a.mjs', f'// {word}\n'), [1])


class FileSet(unittest.TestCase):
    def test_suffixes_and_skips(self):
        for path in ('a.mjs', 'a.js', 'a.cjs', 'a.ts', 'a.py', 'a.rs', 'a.sh', 'Makefile', 'tools/x/Makefile'):
            with self.subTest(path=path):
                self.assertTrue(cc.checked(path))
        for path in ('a.md', 'a.json', 'a.yml', 'a.c', 'TODELETE/a.mjs', 'experiments/P-1/a.py',
                     'node_modules/a.js', 'vendor/a.rs'):
            with self.subTest(path=path):
                self.assertFalse(cc.checked(path))


class Command(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='ef-comments-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)

    def add(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf8')
        subprocess.run(['git', 'add', '--', rel], cwd=self.root, check=True)

    def run_script(self, *args):
        return subprocess.run([sys.executable, '-I', str(SCRIPT), *args], cwd=self.root,
                              capture_output=True, text=True)

    def test_exit_zero_without_comments(self):
        self.add('src/a.mjs', '#!/usr/bin/env node\n// @ts-check\nexport const a = 1;\n')
        self.add('src/b.py', '"""Doc."""\nx = 1  # noqa: E501\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertIn('0 comment lines', result.stderr)

    def test_exit_one_lists_every_file_and_line(self):
        self.add('src/a.mjs', 'export const a = 1;\n// why\n/* block\n * more\n */\n')
        self.add('src/b.py', 'x = 1\n# reason\n')
        self.add('run.sh', '#!/bin/sh\n# step\necho\n')
        self.add('Makefile', 'all:\n# target\n\ttrue\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.splitlines(), [
            'Makefile:2: # target',
            'run.sh:2: # step',
            'src/a.mjs:2: // why',
            'src/a.mjs:3: /* block',
            'src/a.mjs:4: * more',
            'src/a.mjs:5: */',
            'src/b.py:2: # reason',
        ])
        self.assertIn('7 comment lines', result.stderr)

    def test_untracked_and_skipped_files_ignored(self):
        self.add('a.mjs', 'export const a = 1;\n')
        (self.root / 'loose.mjs').write_text('// untracked\n', encoding='utf8')
        self.add('experiments/P-1/x.py', '# skipped\n')
        self.add('TODELETE/x.mjs', '// skipped\n')
        self.add('node_modules/x.js', '// skipped\n')
        self.add('vendor/x.rs', '// skipped\n')
        self.add('notes.md', '# heading\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_paths_limit_the_file_set(self):
        self.add('one/a.mjs', '// c\n')
        self.add('two/b.mjs', '// c\n')
        result = self.run_script('two')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.splitlines(), ['two/b.mjs:1: // c'])

    def test_text_is_truncated_to_80_characters(self):
        self.add('a.mjs', '// ' + 'x' * 100 + '\n')
        result = self.run_script()
        self.assertEqual(result.stdout.splitlines(), ['a.mjs:1: ' + ('// ' + 'x' * 100)[:80]])

    def test_untokenizable_python_exits_two(self):
        self.add('bad.py', 'x = (\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 2)
        self.assertIn('bad.py: cannot tokenize', result.stderr)

    def test_end_of_line_comments_listed(self):
        self.add('a.mjs', 'const u = "http://x"; // tail\nf(/* arg */ 1);\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.splitlines(), ['a.mjs:1: // tail', 'a.mjs:2: /* arg */'])

    def test_unterminated_javascript_exits_two(self):
        self.add('bad.mjs', 'const s = `open\n')
        result = self.run_script()
        self.assertEqual(result.returncode, 2)
        self.assertIn('bad.mjs: cannot tokenize: unterminated template literal at line 1', result.stderr)

    def test_help_lists_usage(self):
        result = self.run_script('--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('usage: python3 -I tools/check_comments.py [PATH ...]', result.stdout)

    def test_main_in_process(self):
        self.add('a.mjs', '// c\n')
        cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, cwd)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cc.main([]), 1)
        self.assertEqual(out.getvalue(), 'a.mjs:1: // c\n')


class MatchesCounter(unittest.TestCase):
    def test_lint_target_runs_checker(self):
        text = (REPO / 'Makefile').read_text(encoding='utf8')
        lint = text.split('\nlint:\n', 1)[1].split('\n\n', 1)[0]
        self.assertIn('tools/check_comments.py', lint)


if __name__ == '__main__':
    unittest.main()
