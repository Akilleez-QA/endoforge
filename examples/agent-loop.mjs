import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoopPool } from '../core/runtime/x1/loop.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from '../core/runtime/x1/transports.mjs';

const need = 'A coin-operated turnstile. State 0 is locked, 1 is unlocked. Event 0 is a coin, 1 is a push. A coin unlocks it; a push locks it again. Any other state or event is an error.';

const contract = `# Turnstile
next(state, event) returns the next state.
- state: 0 locked, 1 unlocked. event: 0 coin, 1 push.
- A coin always leaves the turnstile unlocked. A push always leaves it locked.
- Any state or event outside 0..1 traps.
`;
const tests = [
  { name: 'coin unlocks', fn: 'next', args: [0, 0], expect: 1 },
  { name: 'push locks', fn: 'next', args: [1, 1], expect: 0 },
  { name: 'coin while unlocked stays unlocked', fn: 'next', args: [1, 0], expect: 1 },
  { name: 'push while locked stays locked', fn: 'next', args: [0, 1], expect: 0 },
  { name: 'unknown event', fn: 'next', args: [0, 7], expectError: true },
];
const codes = (a, b) => ({ 0: a, 1: b });
const glue = id => JSON.stringify({
  id, assumption: 'The turnstile has exactly two states and two events.', question: 'What state is the turnstile in after this event?',
  exports: [{ name: 'next', label: 'Next turnstile state', headline: true,
    args: [{ name: 'state', kind: 'code', unit: '1', codes: codes('locked', 'unlocked') }, { name: 'event', kind: 'code', unit: '1', codes: codes('coin', 'push') }],
    result: { kind: 'code', unit: '1', codes: codes('locked', 'unlocked') } }],
  traps: [{ fn: 'next', when: 'state or event is outside 0..1', message: 'Unknown turnstile state or event.' }],
});
const guard = 'if (state < 0 || state > 1 || event < 0 || event > 1) abort();';
const buggy = `export function next(state: i32, event: i32): i32 {\n  ${guard}\n  return event == 0 ? 1 : state;\n}\n`;
const fixed = `export function next(state: i32, event: i32): i32 {\n  ${guard}\n  return event == 0 ? 1 : 0;\n}\n`;

const stageOf = messages => messages.filter(m => m.role === 'user').map(m => { try { return JSON.parse(m.content).stage; } catch { return undefined; } }).filter(Boolean).at(-1);
const reply = calls => ({ text: JSON.stringify({ calls }), usage: 10 });
let implementationTurns = 0;
const agent = ({ messages }) => {
  if (stageOf(messages) === 'specification') {
    return reply([{ name: 'edit_file', path: 'CONTRACT.md', content: contract }, { name: 'edit_file', path: 'tests.json', content: JSON.stringify(tests) }, { name: 'done' }]);
  }
  implementationTurns += 1;
  const id = JSON.parse(messages.find(m => m.role === 'user' && m.content.includes('"implementation"')).content).id;
  const kernel = process.argv[2] !== 'stubborn' && implementationTurns > 1 ? fixed : buggy;
  return reply([{ name: 'edit_file', path: 'kernel.ts', content: kernel }, { name: 'edit_file', path: 'glue.json', content: glue(id) }, { name: 'done' }]);
};

const pool = createLoopPool({ provider: scriptedProvider(agent) });
const directory = join(mkdtempSync(join(tmpdir(), 'ef-agent-loop-')), 'turnstile');
try {
  const result = await runNeed({ need, directory, pool, env: { ENDOFORGE_LOOP: 'agent' } });
  console.log(JSON.stringify({
    promoted: result.promoted,
    testDouble: result.testDouble,
    turns: result.agent?.turns,
    exit: result.agent?.exit_reason,
    rounds: result.rounds?.map(round => round.failures ? { failed: Object.keys(round.failures.gates), tests: round.failures.tests.map(test => test.name) } : 'passed'),
    ledger: join(directory, 'ledger.sqlite'),
  }, null, 2));
} finally {
  await pool.close();
}
