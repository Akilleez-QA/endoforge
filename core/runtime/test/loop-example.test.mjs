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

test('the README counter example promotes the reducer, prints all nine passing gates and writes a kernel that counts', { timeout: 180000 }, t => {
  const result = JSON.parse(run(process.execPath, ['examples/counter-loop.mjs']));
  t.after(() => rmSync(dirname(dirname(result.ledger)), { recursive: true, force: true }));
  assert.deepEqual({ ...result, ledger: undefined }, { need: 'a counter that handles increment, decrement and reset events and never goes below zero',
    promoted: true, testDouble: true, turns: 2, rounds: ['passed'], ledger: undefined });
  const printed = gates(result.ledger);
  assert.match(printed, /^ledger records: task, admitted_input, frozen_evaluator, candidate, receipt$/m);
  for (const gate of ['G1_frozen', 'G2_compiles', 'G3_exports', 'G4_tests', 'G5_deterministic', 'G6_bounded', 'G7_glue', 'G8_nonfinite', 'G9_units'])
    assert.match(printed, new RegExp(`^  ${gate} +pass\\b`, 'm'));
  assert.match(printed, /^  G2_compiles +pass  \{"wasmBytes": 293\}$/m);
  assert.match(printed, /^  G4_tests +pass  \{"passed": 6, "total": 6\}$/m);
  assert.match(printed, /^  G9_units +pass  \{"checks": \{"next": "dimensionless"\}\}$/m);
  assert.match(printed, /^decision: promote$/m);
  const module = printed.match(/^kernel: (.+) \(293 bytes\)$/m)[1];
  const host = 'const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); const { next } = new WebAssembly.Instance(m, { env: { abort() { throw Error("abort") } } }).exports; let c = 0; for (const e of [0, 0, 0, 1, 2, 1]) { c = next(c, e); process.stdout.write(c + " ") } console.log()';
  assert.equal(run(process.execPath, ['-e', host, module]), '1 2 3 2 0 0 \n');
});

test('the tutorial turnstile example fails G4 once, repairs and promotes; stubborn is refused at the turn limit', { timeout: 180000 }, t => {
  const result = JSON.parse(run(process.execPath, ['examples/agent-loop.mjs']));
  t.after(() => rmSync(dirname(dirname(result.ledger)), { recursive: true, force: true }));
  assert.deepEqual({ ...result, ledger: undefined }, { promoted: true, testDouble: true, turns: 3, exit: 'stop',
    rounds: [{ failed: ['G4_tests'], tests: ['push locks'] }, 'passed'], ledger: undefined });
  const printed = gates(result.ledger);
  assert.match(printed, /^  G4_tests +pass  \{"passed": 5, "total": 5\}$/m);
  assert.match(printed, /^decision: promote$/m);
  const module = printed.match(/^kernel: (.+) \(114 bytes\)$/m)[1];
  const host = 'const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); const { next } = new WebAssembly.Instance(m, { env: { abort() { throw Error("trap") } } }).exports; let out = [next(0, 0), next(1, 1)]; try { next(0, 7) } catch (e) { out.push(e.message) } console.log(out.join(" "))';
  assert.equal(run(process.execPath, ['-e', host, module]), '1 0 trap\n');
  const stubborn = JSON.parse(run(process.execPath, ['examples/agent-loop.mjs', 'stubborn']));
  t.after(() => rmSync(dirname(dirname(stubborn.ledger)), { recursive: true, force: true }));
  assert.equal(stubborn.promoted, false);
  assert.equal(stubborn.exit, 'max_turns');
  assert.equal(stubborn.turns, 7);
  const refused = gates(stubborn.ledger);
  assert.match(refused, /^  G4_tests +FAIL  \{"passed": 4, "total": 5\}$/m);
  assert.match(refused, /^decision: refuse$/m);
});
