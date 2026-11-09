import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from '../core/runtime/x1/loop.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from '../core/runtime/x1/transports.mjs';
import { inputFor, modelFor } from '../core/runtime/test/fixtures/x1/scripted-model.mjs';

const need = 'a counter that handles increment, decrement and reset events and never goes below zero';
const contract = `next(count, event) returns the counter after one event.
State: count, an integer of at least 0. Events: 0 increment, 1 decrement, 2 reset.
Decrement at 0 stays at 0. A negative count or any other event traps.

\`\`\`capability
{"exports":[{"name":"next","args":[{"name":"count","kind":"integer","unit":"1"},{"name":"event","kind":"code","unit":"1","codes":{"0":"increment","1":"decrement","2":"reset"}}],"result":{"kind":"integer","unit":"1"}}],"traps":["next"]}
\`\`\`
`;
const tests = JSON.stringify([
  { name: 'increment', fn: 'next', args: [3, 0], expect: 4 },
  { name: 'decrement', fn: 'next', args: [3, 1], expect: 2 },
  { name: 'decrement at zero stays zero', fn: 'next', args: [0, 1], expect: 0 },
  { name: 'reset', fn: 'next', args: [7, 2], expect: 0 },
  { name: 'unknown event traps', fn: 'next', args: [3, 9], expectError: true },
  { name: 'negative count traps', fn: 'next', args: [-1, 0], expectError: true },
]);
const kernel = `export function next(count: i32, event: i32): i32 {
  if (count < 0) throw new Error("negative count");
  if (event == 0) return count + 1;
  if (event == 1) return count > 0 ? count - 1 : 0;
  if (event == 2) return 0;
  throw new Error("unknown event");
}`;
const glue = JSON.stringify({
  id: 'counter', assumption: 'The count starts at zero and changes by one event at a time.',
  question: 'Should decrement at zero stay at zero rather than fail?',
  exports: [{ name: 'next', label: 'Apply one event to the counter',
    args: [{ name: 'count', kind: 'integer', unit: '1' },
      { name: 'event', kind: 'code', unit: '1', codes: { 0: 'increment', 1: 'decrement', 2: 'reset' } }],
    result: { kind: 'integer', unit: '1' } }],
  traps: [{ fn: 'next', when: 'count is negative or event is not 0, 1 or 2', message: 'Invalid count or event.' }],
});
const pool = createLoopPool({ provider: scriptedProvider(modelFor(inputFor(contract, tests, kernel, glue))) });
const directory = join(mkdtempSync(join(tmpdir(), 'ef-counter-')), 'counter');
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
