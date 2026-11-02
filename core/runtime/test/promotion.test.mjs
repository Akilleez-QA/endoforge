import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../isolate-pool.mjs';
import { runNeed } from '../x1/pipeline.mjs';
import { ledger } from '../x1/ledger.mjs';
import { python } from './fixtures/ledger-fixture.mjs';
for (const isolation of ['thread', 'process']) test(`generation to local promotion; refusal and tamper: ${isolation}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-promotion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1',
    ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fileURLToPath(new URL('./fixtures/x1/fake-codex.mjs', import.meta.url))]),
    ENDOFORGE_ASC_CMD: fileURLToPath(new URL('./fixtures/x1/fake-asc.mjs', import.meta.url)) };
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('../x1/host.mjs', import.meta.url)), size: 2, isolation });
  t.after(() => pool.close());
  const directory = join(root, 'addition');
  const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env });
  assert.equal(result.promoted, true); assert.equal(result.testDouble, true);
  assert(Object.values(result.timings).every(n => Number.isFinite(n) && n >= 0));
  const decision = JSON.parse(await readFile(join(directory, 'promotion.json')));
  assert.equal(decision.scope, 'qualification'); assert.equal(decision.sha256, result.decision);
  const request = { reference: { ledger: join(directory, 'ledger.sqlite'), identity: decision.frozen_evaluator },
    candidate: result.candidate, receipt: result.receipt };
  assert.equal((await ledger('promote', { ...request, receipt: { ...result.receipt, hash: '0'.repeat(64) }, decisionPath: join(root, 'wrong-hash.json') })).decision, 'refuse');
  for (const gate of ['G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G7_glue']) {
    const forged = await python(`
import json, sys
from core.ledger.ledger import Ledger
r = json.load(sys.stdin)
l = Ledger(r['ledger'])
record = next(x for x in l.records() if x['id'] == 'receipt')
record['id'] = r['gate']
residual = next(x for x in record['data']['observations'][0]['report']['attempts'][0]['results'] if x['check'] == 'residual')
x1 = json.loads(residual['reason'])
x1['gates'][r['gate']]['ok'] = False
residual['reason'] = json.dumps(x1)
print(json.dumps(dict(id=record['id'], hash=l.append(record))))
`, { ledger: request.reference.ledger, gate });
    assert.equal((await ledger('promote', { ...request, receipt: forged, decisionPath: join(root, `${gate}.json`) })).decision, 'refuse');
  }
  const failed = await runNeed({ need: 'addition', directory: join(root, 'bad-glue'), pool, env: { ...env, FAKE_CODEX_MODE: 'glue' } });
  assert.equal(failed.promoted, false); assert.equal(failed.error, undefined);
  await python(`
import json, sqlite3, sys
r = json.load(sys.stdin)
with sqlite3.connect(r['ledger']) as db:
    db.execute('DROP TRIGGER no_update')
    db.execute("UPDATE records SET hash=? WHERE id='receipt'", ('f' * 64,))
print('{}')
`, { ledger: request.reference.ledger });
  assert.equal((await ledger('promote', { ...request, decisionPath: join(root, 'tamper.json') })).decision, 'refuse');
});

test('P-22 labelled twelve-record smoke harness and stage accounting', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-p22-ci-')), output = join(root, 'output');
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, P22_OUTPUT: output, P22_LIMIT: '3' }; delete env.P22_NEEDS_ROOT;
  await new Promise((resolve, reject) => execFile(process.execPath,
    [fileURLToPath(new URL('../../../experiments/P-22-real-need-to-candidate/run.mjs', import.meta.url)), '--fake'],
    { env, timeout: 50000 }, error => error ? reject(error) : resolve()));
  const summary = JSON.parse(await readFile(join(output, 'summary.json')));
  assert.equal(summary.testDouble, true); assert.equal(summary.rows.length, 12);
  assert.deepEqual(summary.cohorts.map(c => [c.count, c.promoted]), [[3, 3], [3, 3], [3, 3], [3, 3]]);
  for (const row of summary.rows) {
    assert.equal(row.promoted, true); assert.equal(Object.keys(row.timings).length, 8);
    const { total, ...stages } = row.timings;
    assert(Object.values(stages).every(Number.isFinite));
    assert(Object.values(stages).reduce((a, b) => a + b, 0) <= total + 1);
  }
});
