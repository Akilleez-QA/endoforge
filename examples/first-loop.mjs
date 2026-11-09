import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from '../core/runtime/x1/loop.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from '../core/runtime/x1/transports.mjs';
import { candidate } from '../core/runtime/test/fixtures/x1/candidate.mjs';
import { inputFor, modelFor } from '../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { good, seeds } from '../core/runtime/test/fixtures/x1/seeds.mjs';

const need = 'integer add(a,b)';
const kernel = process.argv[2] === 'wrong' ? seeds[1] : good;
const { files } = candidate();
const script = modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], kernel.kernel, kernel.glue));
const pool = createLoopPool({ provider: scriptedProvider(script) });
const directory = join(mkdtempSync(join(tmpdir(), 'ef-first-loop-')), 'addition');
try {
  const result = await runNeed({ need, directory, pool, env: { ENDOFORGE_LOOP: 'agent' } });
  console.log(JSON.stringify({
    need,
    promoted: result.promoted,
    testDouble: result.testDouble,
    turns: result.agent?.turns,
    rounds: result.rounds?.map(round => round.failures ? Object.keys(round.failures.gates) : 'passed'),
    ledger: join(directory, 'ledger.sqlite'),
  }, null, 2));
} finally {
  await pool.close();
}
