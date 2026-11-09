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
const capability = capabilityFromGlue(JSON.parse(candidate().files['glue.json']));
const contract = `Integer addition on [-10,10].\n\n\`\`\`capability\n${JSON.stringify(capability)}\n\`\`\`\n`;
const env = (record, extra = {}) => ({ ...process.env, ENDOFORGE_CODEX_TEST_DOUBLE: '1', CODEX_HOME: join(work, 'codex-home'), FAKE_CODEX_RECORD: join(work, record),
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('../core/runtime/test/fixtures/x1/fake-codex.mjs')]),
  ENDOFORGE_ASC_CMD: here('../tools/asc/node_modules/.bin/asc'), ...extra });
const stagesRun = record => readdirSync(work).filter(name => name.startsWith(`${record}.`)).map(name => name.split('.')[1]).sort();

const pool = new IsolatePool({ hostPort: here('../core/runtime/x1/host.mjs'), size: 1, isolation: 'thread' });
const library = await openLibrary({ journal: join(work, 'library.jsonl') });
try {
  const first = await runNeed({ need: 'integer add(a,b)', directory: join(work, 'first'), pool, env: env('first') });
  const [admitted] = await library.admit([{ ledger: join(work, 'first', 'ledger.sqlite'), promotion: join(work, 'first', 'promotion.json'), capability }]);
  const second = await runNeed({ need: 'integer add(a,b)', directory: join(work, 'second'), pool, env: env('second', { FAKE_CODEX_CONTRACT: contract }), library });
  const third = await runNeed({ need: 'integer add(a,b)', directory: join(work, 'third'), pool, env: env('third'), library });
  console.log(JSON.stringify({
    first: { promoted: first.promoted, modelStages: stagesRun('first') },
    admitted: { admitted: admitted.admitted, entries: library.size },
    second: { promoted: second.promoted, reusedFrom: second.reused?.source.candidate === admitted.id ? 'first' : null, modelStages: stagesRun('second') },
    third: { promoted: third.promoted, reused: Boolean(third.reused), modelStages: stagesRun('third') },
    journal: join(work, 'library.jsonl'),
  }, null, 2));
} finally {
  await library.close();
  await pool.close();
}
