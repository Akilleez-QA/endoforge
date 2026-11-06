import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { windows } from '../../../experiments/P-50-in-isolate/analyze.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';
import { good } from './fixtures/x1/seeds.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const { files } = candidate();
const input = { name: 'add', contract: files['CONTRACT.md'], tests: files['tests.json'], kernel: good.kernel, glue: good.glue };

test('a real syscall counter sees no spawn or write before commit in the cell, and sees both on the current path', { timeout: 180000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-loop-count-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tracer = join(root, 'syscount');
  execFileSync('gcc', ['-O1', '-o', tracer, here('../../../experiments/P-50-in-isolate/syscount.c')]);
  const extra = { CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: here('../../../tools/asc/node_modules/.bin/asc'),
    ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('./fixtures/x1/fake-codex.mjs')]) };
  for (const arm of ['current', 'isolate-thread', 'isolate-process']) {
    const output = join(root, arm), log = join(root, `${arm}.jsonl`);
    const run = spawnSync(tracer, [log, process.execPath, here('../../../experiments/P-50-in-isolate/count-child.mjs'),
      JSON.stringify({ arm, output, env: extra, inputs: [input, input] })], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, run.stderr);
    const rows = JSON.parse(readFileSync(join(output, 'rows.json')));
    assert.deepEqual(rows.map(row => row.promoted), [true, true]);
    const seen = windows(log);
    for (const row of rows) {
      const { toCommit, commit } = seen[row.id];
      if (arm === 'current') {
        assert(toCommit.spawns.length >= 8, `control saw ${toCommit.spawns.length} spawns`);
        assert(toCommit.writes.some(line => line.includes('ef-compile-')), 'control saw no temp directory');
      } else {
        assert.deepEqual(toCommit.spawns, []);
        assert.deepEqual(toCommit.execs, []);
        assert.deepEqual(toCommit.writes, []);
        assert.deepEqual(commit.spawns, []);
        assert.deepEqual(row.requestsAfter, ['commit']);
        assert.equal(row.jobsAfter, 1);
      }
    }
  }
});
