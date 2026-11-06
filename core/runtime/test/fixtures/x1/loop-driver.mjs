import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { admit, createLoopPool, evaluateAndCommit } from '../../../x1/loop.mjs';
import { runNeed } from '../../../x1/pipeline.mjs';
import { scriptedProvider } from '../../../x1/transports.mjs';
import { candidate } from './candidate.mjs';
import { implementation, inputFor, reply, specification } from './scripted-model.mjs';
import { good } from './seeds.mjs';

const { root, isolation = 'thread', action = 'run', agent = false, resume = false, directory, kill, editFile, count = 1, log } = JSON.parse(process.argv[2]);
const hostPort = new URL('./loop-stage-port.mjs', import.meta.url).pathname;
const { files } = candidate(), model = inputFor(files['CONTRACT.md'], files['tests.json'], good.kernel, good.glue);
const script = ({ messages }) => {
  const stage = JSON.parse(messages.at(-1).content).stage;
  return reply(stage === 'specification' ? specification(model) : implementation(model, JSON.parse(messages.at(-1).content).id));
};
const pool = createLoopPool({ isolation, hostPort, primes: 1, jobTimeoutMs: 30000, ...(agent ? { provider: scriptedProvider(script) } : {}) });
const env = { ...process.env, ENDOFORGE_LOOP: agent ? 'agent' : 'isolate', CODEX_HOME: join(root, 'unused-home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1',
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, new URL('./fake-codex.mjs', import.meta.url).pathname]) };
const observe = stage => {
  if (stage === 'generated' && editFile) appendFileSync(editFile, '\n');
  if (kill === stage) process.kill(process.pid, 'SIGKILL');
  if (kill === `${stage}+sent`) setImmediate(() => process.kill(process.pid, 'SIGKILL'));
};
await pool.ready();
if (action === 'resume') {
  const read = name => readFileSync(join(directory, 'candidate', name), 'utf8');
  const files = Object.fromEntries(['CONTRACT.md', 'tests.json', 'frozen.sha256', 'kernel.ts', 'glue.json'].map(name => [name, read(name)]));
  const reference = { ledger: join(directory, 'ledger.sqlite'), root: join(directory, 'oracle'), identity: process.argv[3] };
  const admission = await admit(pool, reference);
  const candidate = { id: directory.split('/').pop(), files };
  const outcome = await evaluateAndCommit(pool, { candidate, reference, admission, decisionPath: join(directory, 'retry-promotion.json') });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} else {
  for (let i = 0; i < count; i++) {
    const target = count === 1 ? directory : join(directory, `n${i}`);
    const result = await runNeed({ need: 'integer add(a,b)', directory: target, pool, env, observe, resume });
    if (log) appendFileSync(log, `${JSON.stringify({ target, promoted: result.promoted, candidate: result.candidate, receipt: result.receipt })}\n`);
    if (count === 1) process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
await pool.close();
