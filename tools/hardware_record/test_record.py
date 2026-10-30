import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.hardware_record import record as h


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / 'receipt'
        identity = {k: {'str': 'test', 'int': 1, 'dict': {'test': 'v1'}, 'list': [{'name': 'disk', 'size': 100, 'type': 'disk'}]}[v] for k, v in h.SCHEMA['identity'].items()}
        gate = h.gate_result([0.0] * 5, 8 * 1024**3)
        cells = {mode: {k: h.describe(list(range(1, 21))) for k in ('compute', 'allocation', 'process_start')} for mode in ('pinned', 'unpinned')}
        controls = {k: {'enforced': None} for k in h.SCHEMA['controls']}
        controls.update(affinity={'enforced': True, 'probe': {'exit': 0}}, quiet_gate=gate, quiet_gate_after=gate, noise_baseline={'status': 'measured', 'cells': cells})
        with patch.object(h, 'snapshot', return_value=identity), patch.object(h, 'controls', return_value=controls):
            self.assertEqual(h.collect(self.out), 'qualified-with-limits')

    def mutate(self, filename, change, rehash=False):
        p = self.out / filename
        value = json.loads(p.read_text())
        change(value)
        h.write(p, value)
        if rehash:
            self.mutate('record.json', lambda r: r['receipts'].update({filename: h.digest(p)}))

    def test_valid_record_and_current_environment(self):
        r = h.validate(self.out)
        h.validate(self.out, r['identity'])
        self.assertRaises(FileExistsError, h.collect, self.out)

    def test_receipt_corruption_and_missing_receipt(self):
        for filename in h.SCHEMA['receipt_files']:
            p = self.out / filename
            original = p.read_bytes()
            p.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, filename):
                h.validate(self.out)
            p.unlink()
            self.assertRaises(FileNotFoundError, h.validate, self.out)
            p.write_bytes(original)

    def test_schema_and_claim_rejections(self):
        for key, value in [('schema', 'wrong'), ('status', 'qualified'), ('limits', []), ('controls', {}), ('receipts', {})]:
            original = (self.out / 'record.json').read_bytes()
            self.mutate('record.json', lambda r: r.update({key: value}))
            self.assertRaises(ValueError, h.validate, self.out)
            (self.out / 'record.json').write_bytes(original)

    def test_reopen_each_environment_component(self):
        r = h.validate(self.out)
        for key in h.SCHEMA['reopen_on']:
            current = copy.deepcopy(r['identity'])
            current[key] = 'changed'
            with self.assertRaisesRegex(ValueError, 'reopen'):
                h.validate(self.out, current)
        self.mutate('record.json', lambda r: r.update(created_at='2000-01-01T00:00:00+00:00'))
        self.assertRaises(ValueError, h.validate, self.out, r['identity'])

    def test_gate_known_good_bad_and_threshold_boundary(self):
        self.assertTrue(h.gate_result([2.0] * 5, 4096 * 1024**2)['pass'])
        self.assertFalse(h.gate_result([0, 0, 0, 0, 4.01], 8 * 1024**3)['pass'])
        self.assertFalse(h.gate_result([2.01] * 5, 8 * 1024**3)['pass'])
        self.assertFalse(h.gate_result([0] * 5, 0)['pass'])
        self.assertEqual(h.describe([10] * 20)['cv'], 0)
        self.assertEqual(h.describe([10] * 20)['p95_over_median'], 1)

    def test_reject_forged_enforcement_gate_and_statistics(self):
        for change in (lambda c: c['memory.max'].update(enforced=True), lambda c: c['quiet_gate'].update({'pass': False}), lambda c: c['noise_baseline']['cells']['pinned']['compute'].update(cv=999)):
            original = (self.out / 'controls.json').read_bytes()
            self.mutate('controls.json', change, True)
            self.assertRaises(ValueError, h.validate, self.out)
            (self.out / 'controls.json').write_bytes(original)
            self.mutate('record.json', lambda r: r['receipts'].update({'controls.json': h.digest(self.out / 'controls.json')}))

    def test_reject_changed_snapshot_and_probe_source(self):
        self.mutate('after.json', lambda r: r.update(kernel='changed'), True)
        self.assertRaises(ValueError, h.validate, self.out)
        self.mutate('record.json', lambda r: r.update(status='failed'))
        r = h.validate(self.out)
        with self.assertRaisesRegex(ValueError, 'failed qualification'):
            h.validate(self.out, r['identity'])
        self.mutate('precommit.json', lambda r: r.update(source_sha256='0' * 64), True)
        with self.assertRaisesRegex(ValueError, 'probe source changed'):
            h.validate(self.out, r['identity'])

    def test_capacity_refusal_restores_affinity(self):
        original = h.os.sched_getaffinity(0)
        with patch.object(h, 'memory', return_value={'MemAvailable': 0}):
            self.assertEqual(h.noise()['status'], 'refused')
        self.assertEqual(h.os.sched_getaffinity(0), original)


if __name__ == '__main__':
    unittest.main()
