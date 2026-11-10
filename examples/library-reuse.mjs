import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../core/runtime/isolate-pool.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { openLibrary } from '../core/library/library.mjs';
import { capabilityFromGlue } from '../core/library/key.mjs';
import { candidate } from '../core/runtime/test/fixtures/x1/candidate.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'ef-library-'));
const glue = JSON.parse(candidate().files['glue.json']);
const capability = capabilityFromGlue(glue);
const contractFor = (prose, block) => `${prose}\n\n\`\`\`capability\n${JSON.stringify(block)}\n\`\`\`\n`;
const contract = contractFor('Integer addition on [-10,10].', capability);
const widened = { ...glue, assumption: 'Inputs are integers from minus one hundred to one hundred.',
  exports: glue.exports.map(item => ({ ...item, args: item.args.map(arg => ({ ...arg, range: '-100..100' })) })) };
const widenedContract = contractFor('Integer addition on [-100,100].', capabilityFromGlue(widened));
const env = (record, extra = {}) => ({ ...process.env, ENDOFORGE_CODEX_TEST_DOUBLE: '1', CODEX_HOME: join(work, 'codex-home'), FAKE_CODEX_RECORD: join(work, record),
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('../core/runtime/test/fixtures/x1/fake-codex.mjs')]),
  ENDOFORGE_ASC_CMD: here('../tools/asc/node_modules/.bin/asc'), ...extra });
const stagesRun = record => readdirSync(work).filter(name => name.startsWith(`${record}.`)).map(name => name.split('.')[1]).sort();

const pool = new IsolatePool({ hostPort: here('../core/runtime/x1/host.mjs'), size: 1, isolation: 'thread' });
const library = await openLibrary({ journal: join(work, 'library.jsonl') });
const served = [];
const recorded = { serve: async (need, options) => { const outcome = await library.serve(need, options); served.push(outcome); return outcome; } };
try {
  const first = await runNeed({ need: 'integer add(a,b)', directory: join(work, 'first'), pool, env: env('first', { FAKE_CODEX_CONTRACT: contract }) });
  const [admitted] = await library.admit([{ ledger: join(work, 'first', 'ledger.sqlite'), promotion: join(work, 'first', 'promotion.json'), capability }]);
  const second = await runNeed({ need: 'integer add(a,b)', directory: join(work, 'second'), pool, env: env('second', { FAKE_CODEX_CONTRACT: contract }), library: recorded });
  const secondServed = served.at(-1) ?? null;
  const third = await runNeed({ need: 'integer add(a,b) on [-100,100]', directory: join(work, 'third'), pool,
    env: env('third', { FAKE_CODEX_CONTRACT: widenedContract, FAKE_CODEX_GLUE: JSON.stringify(widened) }), library: recorded });
  const thirdServed = served.at(-1) ?? null;
  console.log(JSON.stringify({
    first: { promoted: first.promoted, reused: Boolean(first.reused), modelStages: stagesRun('first') },
    admitted: { admitted: admitted.admitted, entries: library.size },
    second: { promoted: second.promoted, library: secondServed?.verdict ?? null, reusedFrom: second.reused?.source.candidate === admitted.id ? 'first' : null, modelStages: stagesRun('second') },
    third: { promoted: third.promoted, library: thirdServed?.verdict ?? null, missReason: thirdServed?.verdict === 'miss' ? thirdServed.reason : null, reused: Boolean(third.reused), modelStages: stagesRun('third') },
    journal: join(work, 'library.jsonl'),
  }, null, 2));
} finally {
  await library.close();
  await pool.close();
}
