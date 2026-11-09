import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000 });
const loop = args => JSON.parse(run(process.execPath, ['examples/first-loop.mjs', ...args]));
const gates = ledger => run('python3', ['-I', 'examples/show-gates.py', ledger]);

test('the README example promotes the addition kernel, prints all nine passing gates and writes a kernel that adds', { timeout: 180000 }, t => {
  const result = loop([]);
  t.after(() => rmSync(dirname(dirname(result.ledger)), { recursive: true, force: true }));
  assert.deepEqual({ ...result, ledger: undefined }, { need: 'integer add(a,b)', promoted: true, testDouble: true, turns: 2, rounds: ['passed'], ledger: undefined });
  const printed = gates(result.ledger);
  assert.match(printed, /^ledger records: task, admitted_input, frozen_evaluator, candidate, receipt$/m);
  for (const gate of ['G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G7_glue', 'G8_nonfinite', 'G9_units'])
    assert.match(printed, new RegExp(`^  ${gate} +pass\\b`, 'm'));
  assert.match(printed, /^decision: promote$/m);
  const module = printed.match(/^kernel: (.+) \(57 bytes\)$/m)[1];
  assert.equal(run(process.execPath, ['-e', 'const { readFileSync } = require("node:fs"); const { exports } = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(process.argv[1]))); console.log(exports.add(2, 3))', module]), '5\n');
});

test('the README example refuses the subtracting kernel at G4 after seven turns', { timeout: 180000 }, t => {
  const result = loop(['wrong']);
  t.after(() => rmSync(dirname(dirname(result.ledger)), { recursive: true, force: true }));
  assert.equal(result.promoted, false);
  assert.equal(result.turns, 7);
  assert.deepEqual(result.rounds, Array(6).fill(['G4_tests']));
  const printed = gates(result.ledger);
  assert.match(printed, /^  G4_tests +FAIL  \{"passed": 0, "total": 1\}$/m);
  assert.match(printed, /^decision: refuse$/m);
  assert.doesNotMatch(printed, /^kernel:/m);
});
