import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { poolBreach } from '../../core/runtime/test/fixtures/pool-breach.mjs';

const digest = createHash('sha256').update(readFileSync(new URL('./PRECOMMIT.md', import.meta.url))).digest('hex');
assert.equal(readFileSync(new URL('./receipt/precommit.sha256', import.meta.url), 'utf8').split(/\s/)[0], digest);
const summary = { precommit: digest, started: new Date().toISOString(), node: process.version, size: 8, runs: [] };
for (const isolation of ['thread', 'process']) for (const breach of ['heap', 'wasm_memory']) {
  const cleanup = [], started = performance.now();
  try {
    const result = await poolBreach({ after: fn => cleanup.push(fn) }, isolation, breach);
    const { failed, survivors, replacement, expected } = result;
    const good = [...survivors, replacement];
    const row = { isolation, breach, elapsedMs: Math.round(performance.now() - started),
      workcellsLost: result.workcellsLost, siblingsLost: result.siblingsLost,
      distinctInitialWorkcells: result.distinctInitialWorkcells, chain: result.chain,
      replacementCorrect: isDeepStrictEqual(replacement.report, expected),
      replacementDistinct: ![failed, ...survivors].some(r => r.workcell === replacement.workcell),
      jobs: [failed, ...good].map(r => ({ workcell: r.workcell, status: r.status, reason: r.reason,
        cgroup: r.cgroup, outcomes: r.receipts.map(item => item.record.data.outcome_state),
        hashes: r.receipts.map(item => item.hash) })) };
    summary.runs.push(row);
    writeFileSync(new URL('./receipt/summary.json', import.meta.url), JSON.stringify(summary) + '\n');
    console.log(JSON.stringify({ ...row, jobs: undefined }));
    assert.equal(row.workcellsLost, 1);
    assert.equal(row.siblingsLost, 0);
    assert.equal(row.distinctInitialWorkcells, 8);
    assert.deepEqual(row.chain, { receipts: 17, verified: true });
    assert(row.replacementCorrect && row.replacementDistinct);
    assert.equal(failed.status, isolation === 'process' ? 'rejected' : 'outcome_unknown');
    assert.equal(failed.reason, isolation === 'process' ? breach : 'limit');
  } finally {
    for (const fn of cleanup.reverse()) await fn();
  }
}
