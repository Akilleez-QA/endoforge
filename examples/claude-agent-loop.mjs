import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createLoopPool } from '../core/runtime/x1/loop.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { WarmClaudeTransport } from '../core/runtime/x1/transports.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  model: { type: 'string', default: 'sonnet' },
  effort: { type: 'string', default: 'low' },
  'config-dir': { type: 'string' },
  command: { type: 'string', default: 'claude' },
} });
const need = positionals.join(' ');
if (!need.trim()) {
  console.error('usage: node examples/claude-agent-loop.mjs [--model M] [--effort E] [--config-dir DIR] [--command CLI] "<need>"');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'ef-claude-loop-'));
const transport = new WarmClaudeTransport({
  instances: [{ name: 'login', ...(values['config-dir'] ? { configDir: values['config-dir'] } : {}) }],
  model: values.model, effort: values.effort, command: values.command.includes('/') ? resolve(values.command) : values.command, cwd: mkdtempSync(join(work, 'empty-')),
});
const pool = createLoopPool({ provider: transport });
try {
  await transport.start();
  const result = await runNeed({ need, directory: join(work, 'need'), pool, env: { ENDOFORGE_LOOP: 'agent' } });
  console.log(JSON.stringify({
    promoted: result.promoted,
    testDouble: result.testDouble,
    turns: result.agent?.turns,
    tokens: result.agent?.tokens,
    exit: result.agent?.exit_reason ?? result.error,
    rounds: result.rounds?.map(round => round.failures ? Object.keys(round.failures.gates) : 'passed'),
    modelSeconds: +(result.modelMs / 1000).toFixed(1),
    ledger: join(work, 'need', 'ledger.sqlite'),
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
} finally {
  await pool.close();
  await transport.close();
}
