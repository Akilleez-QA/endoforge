"""GAP-EF-006: bounded campaign repair leaves the failed candidate and frozen evaluators untouched."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from tools.factory_campaign import repair


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Repair(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='ef-repair-')
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.kernel = self.dir / 'kernel.ts'
        self.kernel.write_text('export function step(s, e) { return s - e; }\n')
        self.evals = self.dir / 'evals.json'
        self.evals.write_text('{"cases": [[1, 2, 3]]}\n')

    def patch(self, **over):
        args = dict(source=self.kernel, expected_sha=sha(self.kernel), before='s - e', after='s + e',
                    frozen_paths=[self.evals], classification='implementation-defect', rounds=0)
        args.update(over)
        return repair.patch(**args)

    def test_patch_writes_new_artifact_and_preserves_evidence(self):
        original = self.kernel.read_bytes()
        frozen = sha(self.evals)
        receipt = self.patch()
        output = self.dir / 'kernel.ts.repair-1'
        self.assertEqual(output.read_text(), 'export function step(s, e) { return s + e; }\n')
        self.assertEqual(self.kernel.read_bytes(), original)
        self.assertEqual(sha(self.evals), frozen)
        self.assertEqual(receipt, {'version': 1, 'round': 1, 'sourceSha256': hashlib.sha256(original).hexdigest(),
                                   'patchedSha256': sha(output), 'patchedPath': str(output),
                                   'frozenHashes': {str(self.evals): frozen},
                                   'classification': 'implementation-defect'})

    def test_second_round_patches_the_first_repair(self):
        first = Path(self.patch(limit=2)['patchedPath'])
        second = self.patch(source=first, expected_sha=sha(first), before='return', after='return 0 +', rounds=1,
                            limit=2)
        output = Path(second['patchedPath'])
        self.assertEqual(output.name, 'kernel.ts.repair-2')
        self.assertEqual(output.read_text(), 'export function step(s, e) { return 0 + s + e; }\n')
        with self.assertRaises(ValueError):
            self.patch(source=output, expected_sha=sha(output), before='0 +', after='', rounds=2, limit=2)

    def test_glue_target(self):
        glue = self.dir / 'glue.json'
        glue.write_text('{"route": "a"}')
        receipt = self.patch(source=glue, expected_sha=sha(glue), before='"a"', after='"b"')
        self.assertEqual(Path(receipt['patchedPath']).name, 'glue.json.repair-1')

    def test_refusals(self):
        other = self.dir / 'evals.ts'
        other.write_text('s - e')
        link = self.dir / 'link'
        link.symlink_to(self.kernel)
        linked = self.dir / 'sub'
        linked.mkdir()
        (linked / 'kernel.ts').symlink_to(self.kernel)
        cases = {
            'contract dispute': dict(classification='contract-defect'),
            'eval dispute': dict(classification='eval-defect'),
            'limit reached': dict(rounds=1),
            'bool round': dict(rounds=False),
            'negative round': dict(rounds=-1),
            'other file': dict(source=other, expected_sha=sha(other)),
            'symlink candidate': dict(source=linked / 'kernel.ts'),
            'skipped round name': dict(rounds=1, limit=3),
            'changed candidate': dict(expected_sha='0' * 64),
            'absent text': dict(before='nothing here'),
            'empty text': dict(before=''),
            'ambiguous text': dict(before='e'),
            'no frozen evaluators': dict(frozen_paths=[]),
            'candidate frozen': dict(frozen_paths=[self.evals, self.kernel]),
        }
        for label, over in cases.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                self.patch(**over)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['evals.json', 'evals.ts', 'kernel.ts', 'link',
                                                                       'sub'])

    def test_existing_repair_is_never_overwritten(self):
        self.patch()
        with self.assertRaises(FileExistsError):
            self.patch(after='s * e')
        self.assertIn('s + e', (self.dir / 'kernel.ts.repair-1').read_text())

    def test_frozen_mutation_discards_the_repair(self):
        real = Path.open

        def opened(path, mode='r', *args, **kwargs):
            stream = real(path, mode, *args, **kwargs)
            if 'x' in mode:
                self.evals.write_text('{"cases": []}\n')
            return stream

        with mock.patch.object(Path, 'open', opened), self.assertRaises(RuntimeError):
            self.patch()
        self.assertFalse((self.dir / 'kernel.ts.repair-1').exists())


if __name__ == '__main__':
    unittest.main()
