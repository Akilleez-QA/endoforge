import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { IsolatePool } from '../../isolate-pool.mjs';
import { evaluateCandidates } from '../../../engine/evaluator.mjs';
import { createPort } from './identity-port.mjs';
import { fixture, hostPort, python } from './ledger-fixture.mjs';

export async function poolBreach(t, isolation, breach, size = 8) {
  let pool, abort;
  t.after(async () => {
    if (!pool) return;
    writeFileSync(abort, 'abort');
    await pool.close();
  });
  const { reference, job, directory } = await fixture(t);
  abort = join(directory, 'abort');
  const barrier = join(directory, 'barrier'), release = join(directory, 'release');
  mkdirSync(barrier);
  const wasm = breach === 'wasm_memory';
  pool = new IsolatePool({ isolation, size, cgroupRoot: process.env.EF_TEST_CGROUP_ROOT,
    hostPort: wasm ? fileURLToPath(new URL('./wasm-port.mjs', import.meta.url)) : hostPort,
    resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 }, wasmMemoryMaxMb: 64 });
  const expected = await evaluateCandidates(reference, ['pass', 'effects'], await createPort());
  const healthy = wasm ? { action: 'instantiate', bytes: [0, 97, 115, 109, 1, 0, 0, 0] } : {};
  const failedJob = pool.run(job([wasm ? 'pass' : 'heap'], { abort, barrier, participants: size,
    ...(wasm ? { action: 'grow', pages: 4096 } : {}) }));
  const siblings = Array.from({ length: size - 1 }, () => pool.run(job(['pass', 'effects'],
    { ...healthy, abort, barrier, participants: size, release })));
  const queued = pool.run(job(['pass', 'effects'], healthy));
  const failed = await failedJob;
  writeFileSync(release, 'go');
  const survivors = await Promise.all(siblings), replacement = await queued;
  await pool.close();
  const results = [failed, ...survivors, replacement];
  const chain = await python(`
import json, sqlite3, sys
from core.ledger.ledger import Ledger
r = json.load(sys.stdin)
records = Ledger(r['ledger']).records()
with sqlite3.connect(r['ledger']) as db:
    hashes = dict(db.execute('SELECT id, hash FROM records'))
print(json.dumps(dict(receipts=sum(row['kind'] == 'receipt' for row in records),
    verified=all(hashes[item['record']['id']] == item['hash'] for item in r['receipts']))))
`, { ledger: reference.ledger, receipts: results.flatMap(r => r.receipts) });
  return { failed, survivors, replacement, expected, chain,
    workcellsLost: results.filter(r => r.report === null).length,
    siblingsLost: survivors.filter(r => r.status !== 'completed' || !isDeepStrictEqual(r.report, expected)).length,
    distinctInitialWorkcells: new Set([failed, ...survivors].map(r => r.workcell)).size };
}
