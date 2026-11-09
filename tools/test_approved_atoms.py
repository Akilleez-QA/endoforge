"""GAP-EF-005: approved-atoms registry lifecycle, pinning, consumers, replay and CLI."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from tools import approved_atoms as aa

REPO = Path(__file__).resolve().parents[1]


class Registry(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='ef-atoms-')
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.store = self.dir / 'atoms.jsonl'
        self.reg = aa.Registry(self.store)

    def rows(self):
        return [json.loads(line) for line in self.store.read_text().splitlines()]

    def approved(self, atom_id='rho', value=1.5):
        atom = self.reg.register(atom_id, 'number', value, 'CoolProp')
        return self.reg.transition(atom_id, atom['sha256'], 'approved', 'operator')

    def test_register_approve_resolve_retire(self):
        atom = self.reg.register('rho', 'number', 1.5, 'CoolProp')
        self.assertEqual((atom['approval'], atom['approved_by'], atom['approved_at']), ('pending', None, None))
        self.assertEqual(atom['sha256'], aa.digest(atom))
        ref = [{'id': 'rho', 'sha256': atom['sha256']}]
        with self.assertRaises(ValueError):
            self.reg.resolve(ref, 'deck')
        approved = self.reg.transition('rho', atom['sha256'], 'approved', 'operator')
        self.assertEqual(approved['approved_by'], 'operator')
        self.assertIsNotNone(aa.datetime.fromisoformat(approved['approved_at']).utcoffset())
        self.assertEqual(self.reg.resolve(ref, 'deck')[0]['value'], 1.5)
        self.reg.resolve(ref + ref, 'deck')
        self.reg.resolve(ref, 'report')
        self.assertEqual(self.reg.list_consumers('rho'), ['deck', 'report'])
        self.assertEqual([r['event'] for r in self.rows()], ['atom', 'atom', 'consumer', 'consumer'])
        retired = self.reg.transition('rho', atom['sha256'], 'retired')
        self.assertEqual((retired['approval'], retired['approved_by']), ('retired', 'operator'))
        with self.assertRaises(ValueError):
            self.reg.resolve(ref, 'deck')
        self.assertEqual(self.reg.get('rho')['approval'], 'retired')

    def test_content_is_immutable_and_digest_pinned(self):
        atom = self.approved()
        with self.assertRaises(ValueError):
            self.reg.register('rho', 'number', 2.0, 'CoolProp')
        with self.assertRaises(ValueError):
            self.reg.register('rho', 'number', 1.5, 'CoolProp')
        with self.assertRaises(ValueError):
            self.reg.transition('rho', '0' * 64, 'retired')
        with self.assertRaises(ValueError):
            self.reg.resolve([{'id': 'rho', 'sha256': '0' * 64}], 'deck')
        self.assertEqual(self.reg.get('rho'), atom)
        self.assertEqual(len(self.rows()), 2)

    def test_invalid_transitions(self):
        atom = self.reg.register('a', 'claim', 'text', 'IIAR 2-2021')
        for approval, by in [('pending', None), ('approved', None), ('approved', ' '), ('bogus', 'x')]:
            with self.subTest(approval=approval, by=by), self.assertRaises(ValueError):
                self.reg.transition('a', atom['sha256'], approval, by)
        self.reg.transition('a', atom['sha256'], 'retired')
        for approval in ['approved', 'retired', 'pending']:
            with self.subTest(after_retired=approval), self.assertRaises(ValueError):
                self.reg.transition('a', atom['sha256'], approval, 'operator')
        with self.assertRaises(ValueError):
            self.reg.transition('missing', atom['sha256'], 'retired')

    def test_registration_refusals(self):
        cases = [('', 'number', 1, 'CoolProp'), ('x', 'colour', 1, 'CoolProp'), ('x', 'number', 1, ''),
                 ('x', 'number', 1, 'wikipedia'), ('x', 'number', 1, 'IIAR '), ('x', 'number', 1, 'owner_signoff soon'),
                 ('x', 'number', float('nan'), 'CoolProp')]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                self.reg.register(*case)
        self.reg.register('ok', 'safety_value', {'limit': 3}, 'owner_signoff 2026-11-08')
        self.assertEqual([r['atom']['id'] for r in self.rows()], ['ok'])

    def test_resolve_refusals(self):
        self.approved()
        for refs, consumer in [({'id': 'rho'}, 'deck'), ([{'id': 'rho'}], 'deck'),
                               ([{'id': 'rho', 'sha256': 'x', 'extra': 1}], 'deck'), ([], ''), (['rho'], 'deck'),
                               ([{'id': 'missing', 'sha256': '0' * 64}], 'deck')]:
            with self.subTest(refs=refs), self.assertRaises(ValueError):
                self.reg.resolve(refs, consumer)

    def test_batch_resolution_is_all_or_nothing(self):
        good = self.approved('a')
        pending = self.reg.register('b', 'number', 2, 'CoolProp')
        refs = [{'id': 'a', 'sha256': good['sha256']}, {'id': 'b', 'sha256': pending['sha256']}]
        with self.assertRaises(ValueError):
            self.reg.resolve(refs, 'deck')
        self.assertEqual(self.reg.list_consumers('a'), [])

    def test_second_writer_replays_incrementally(self):
        atom = self.reg.register('rho', 'number', 1.5, 'CoolProp')
        other = aa.Registry(self.store)
        other.transition('rho', atom['sha256'], 'approved', 'operator')
        self.assertEqual(self.reg.get('rho')['approval'], 'approved')
        offset = self.reg._offset
        self.assertEqual(offset, self.store.stat().st_size)
        self.reg.resolve([{'id': 'rho', 'sha256': atom['sha256']}], 'deck')
        self.assertEqual(other.list_consumers('rho'), ['deck'])

    def test_tampered_store_is_refused(self):
        self.approved()
        lines = self.store.read_text().splitlines(keepends=True)
        cases = {
            'truncated': ''.join(lines[:1]),
            'partial': ''.join(lines) + '{"event":"atom"',
            'not-json': ''.join(lines) + 'nope\n',
            'not-object': ''.join(lines) + '[]\n',
            'content-edit': lines[0].replace('1.5', '9.5') + lines[1],
            'unknown-event': ''.join(lines) + '{"event":"delete","id":"rho"}\n',
            'consumer-before-approval': lines[0] + '{"consumer":"deck","event":"consumer","id":"rho"}\n',
            'consumer-extra-field': ''.join(lines) + '{"consumer":"deck","event":"consumer","id":"rho","x":1}\n',
            'naive-approval-time': lines[0] + lines[1].replace('+00:00', ''),
        }
        for label, text in cases.items():
            with self.subTest(label=label):
                path = self.dir / (label + '.jsonl')
                if label == 'truncated':
                    reader = aa.Registry(self.store)
                    reader.get('rho')
                    self.store.write_text(text)
                    with self.assertRaises(ValueError):
                        reader.get('rho')
                    self.store.write_text(''.join(lines))
                    continue
                path.write_text(text)
                with self.assertRaises(ValueError):
                    aa.Registry(path).get('rho')

    def test_failed_write_is_not_reported_and_leaves_state_replayable(self):
        atom = self.reg.register('rho', 'number', 1.5, 'CoolProp')
        size = self.store.stat().st_size
        real = aa.os.fsync
        calls = []

        def fail_once(fd):
            calls.append(fd)
            if len(calls) == 1:
                raise OSError(28, 'No space left on device')
            return real(fd)

        with mock.patch.object(aa.os, 'fsync', fail_once):
            with self.assertRaises(OSError):
                self.reg.transition('rho', atom['sha256'], 'approved', 'operator')
        self.assertEqual(self.store.stat().st_size, size)
        self.assertEqual(aa.Registry(self.store).get('rho')['approval'], 'pending')
        self.assertEqual(self.reg.get('rho')['approval'], 'pending')
        self.assertEqual(self.reg.transition('rho', atom['sha256'], 'approved', 'operator')['approval'], 'approved')


class Cli(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='ef-atoms-cli-')
        self.addCleanup(temp.cleanup)
        self.store = str(Path(temp.name) / 'atoms.jsonl')

    def call(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = aa.main(['--store', self.store, *argv])
        return code, out.getvalue()

    def test_commands(self):
        code, out = self.call('add', 'line', 'narration_line', '"hello"', 'owner_signoff 2026-11-08')
        atom = json.loads(out)
        self.assertEqual((code, atom['value']), (0, 'hello'))
        self.assertEqual(json.loads(self.call('approve', 'line', atom['sha256'], '--by', 'op')[1])['approval'],
                         'approved')
        self.assertEqual(json.loads(self.call('get', 'line')[1])['approved_by'], 'op')
        aa.Registry(self.store).resolve([{'id': 'line', 'sha256': atom['sha256']}], 'deck')
        self.assertEqual(json.loads(self.call('consumers', 'line')[1]), ['deck'])
        self.assertEqual(json.loads(self.call('retire', 'line', atom['sha256'])[1])['approval'], 'retired')

    def test_refusals_exit_2(self):
        for argv in [('add', 'x', 'number', 'not-json', 'CoolProp'), ('get', 'missing'),
                     ('add', 'x', 'number', '1', 'guess')]:
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as stop:
                    self.call(*argv)
                self.assertEqual(stop.exception.code, 2)

    def test_module_entry_point(self):
        done = subprocess.run([sys.executable, '-B', 'tools/approved_atoms.py', '--store', self.store, 'add', 'n',
                               'number', '3', 'CoolProp'], cwd=REPO, capture_output=True, text=True,
                              env=dict(os.environ, PYTHONPATH=''))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)['value'], 3)


if __name__ == '__main__':
    unittest.main()
