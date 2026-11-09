import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from '../core/runtime/x1/loop.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';

const need = process.argv.slice(2).join(' ');
if (!need.trim()) {
  console.error('usage: ENDOFORGE_CODEX_CMD=codex CODEX_HOME=~/.codex node examples/codex-loop.mjs "<need>"');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'ef-codex-loop-'));
const pool = createLoopPool();
try {
  const result = await runNeed({ need, directory: join(work, 'need'), pool, env: { ...process.env, ENDOFORGE_LOOP: 'isolate' } });
  console.log(JSON.stringify({
    promoted: result.promoted,
    testDouble: result.testDouble,
    error: result.error,
    rounds: result.rounds?.map(round => round.failures ? Object.keys(round.failures.gates) : 'passed'),
    modelSeconds: result.modelMs === undefined ? undefined : +(result.modelMs / 1000).toFixed(1),
    ledger: join(work, 'need', 'ledger.sqlite'),
  }, null, 2));
} finally {
  await pool.close();
}
