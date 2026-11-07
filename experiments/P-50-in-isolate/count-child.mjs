import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { idOf, implementation, reply, specification } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';

const { arm, output, inputs, env: extra } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const repository = new URL('../../', import.meta.url).pathname;
const mark = name => statSync(`/__ef_mark__/${name}`, { throwIfNoEntry: false });
const isolate = arm.startsWith('isolate'), agent = arm.startsWith('agent');
const script = ({ messages, turn }) => {
  const input = inputs.find(entry => entry.name === JSON.parse(messages[0].content).need.split(': ')[1]);
  if (turn === 0) return reply(specification(input));
  return reply(turn === 1 ? implementation(input, idOf(messages)) : { calls: [{ name: 'done' }] });
};
const pool = isolate || agent ? createLoopPool({ isolation: arm.endsWith('process') ? 'process' : 'thread', size: 1, waits: arm.includes('release') ? 'release' : 'hold', ...(agent ? { provider: scriptedProvider(script) } : {}) })
  : new IsolatePool({ hostPort: join(repository, 'core/runtime/x1/host.mjs'), size: 1 });
await pool.ready();
const bridge = pool.ledger.request.bind(pool.ledger), run = pool.run.bind(pool);
let requests = [], jobs = 0;
pool.ledger.request = (action, ...rest) => { requests.push(action); return bridge(action, ...rest); };
pool.run = (...args) => { jobs += 1; return run(...args); };
const base = { ...process.env, ...extra, ...(isolate ? { ENDOFORGE_LOOP: 'isolate' } : agent ? { ENDOFORGE_LOOP: 'agent' } : {}) };
mkdirSync(output, { recursive: true });
const rows = [];
for (const [index, input] of inputs.entries()) {
  const id = `${arm}-${index}`, directory = join(output, id);
  let before;
  requests = []; jobs = 0;
  const observe = stage => {
    if (stage === 'generated' || stage === 'need') before = { requests: requests.length, jobs };
    mark(`${id}/${stage}`);
  };
  const result = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory, pool, observe, limits: { maxTurns: 2, maxTokens: 64000 },
    env: { ...base, FAKE_CODEX_CONTRACT: input.contract, FAKE_CODEX_TESTS: input.tests, FAKE_CODEX_KERNEL: input.kernel, FAKE_CODEX_GLUE: input.glue } });
  rows.push({ id, name: input.name, promoted: result.promoted, requestsBefore: before?.requests, requestsTotal: requests.length, requestsAfter: requests.slice(before?.requests), jobsAfter: jobs - (before?.jobs ?? 0) });
}
await pool.close();
writeFileSync(join(output, 'rows.json'), JSON.stringify(rows));
