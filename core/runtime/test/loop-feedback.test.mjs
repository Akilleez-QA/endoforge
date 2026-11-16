import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile } from '../x1/compiler.mjs';
import { hash } from '../x1/host.mjs';
import { compileDiagnostics, diagnosticLimits, runGates } from '../x1/gates.mjs';
import { takeReply } from '../x1/agent.mjs';
import { createPort } from '../x1/loop-port.mjs';
import { candidate } from './fixtures/x1/candidate.mjs';

const asc = fileURLToPath(new URL('../../../tools/asc/node_modules/.bin/asc', import.meta.url));
const broken = 'export function add(a:i32,b:i32):i32{\n  let x: i32 = "s";\n  return undefinedHelper(a);\n}';
const expected = [
  { code: 'TS2322', line: 2, column: 16, message: "Type '~lib/string/String' is not assignable to type 'i32'." },
  { code: 'TS2304', line: 3, column: 10, message: "Cannot find name 'undefinedHelper'." },
];
const kernelFiles = (kernel, tests) => {
  const files = { ...candidate().files, 'kernel.ts': kernel, ...(tests ? { 'tests.json': tests } : {}) };
  return { ...files, 'frozen.sha256': JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) }) };
};
const checkPort = () => {
  const options = { id: 'addition', mode: 'check' }, port = createPort(options);
  return async files => { options.candidate = { files }; return (await port.evaluate()).failures; };
};

test('a failed compile gives the model the compiler code, message, line and column at G2', { timeout: 60000 }, async () => {
  const failures = await checkPort()(kernelFiles(broken));
  assert.deepEqual(failures, { stage: 'compile', tests: [], gates: { G2_compiles: { ok: false,
    why: "TS2322 at line 2, column 16: Type '~lib/string/String' is not assignable to type 'i32'.", diagnostics: expected } } });
});

test('the external compiler reports the same diagnostics, and a timeout stays unavailable', { timeout: 60000 }, async () => {
  const compiled = await compile({ 'kernel.ts': broken }, asc);
  assert.equal(compiled.unavailable, undefined);
  assert.deepEqual(compiled.diagnostics, expected);
  assert.equal(runGates({ ...candidate(), files: kernelFiles(broken), compiled }).gates.G2_compiles.diagnostics[1].code, 'TS2304');
  const slow = await compile({ 'kernel.ts': broken }, asc, { timeoutMs: 1 });
  assert.deepEqual({ ...slow, source: undefined }, { source: undefined, error: 'compiler failed or timed out', unavailable: true });
});

test('diagnostics are capped by count and bytes, and G2 still fails closed', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ code: `TS${2300 + i}`, line: i + 1, column: 1, message: 'x'.repeat(400) }));
  const kept = compileDiagnostics(many);
  assert.ok(kept.length <= diagnosticLimits.entries && kept.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(kept)) <= diagnosticLimits.bytes + kept.length);
  assert.ok(kept.every(entry => entry.message.length === diagnosticLimits.message));
  const { files } = candidate(), compiled = { ...candidate().compiled, error: 'TS2300: x', diagnostics: many };
  const gate = runGates({ ...candidate(), files, compiled }).gates.G2_compiles;
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.diagnostics, kept);
});

test('the next model prompt carries the staged feedback', { timeout: 60000 }, async () => {
  const check = checkPort(), overlay = {}, messages = [], receipt = { turns: 0, tokens: 0, tool_calls: 0 };
  const text = JSON.stringify({ calls: [{ name: 'edit_file', path: 'kernel.ts', content: broken }, { name: 'done' }] });
  await takeReply({ messages, overlay, editable: ['kernel.ts'], check: () => check(kernelFiles(overlay['kernel.ts'])), receipt, limits: { maxTokens: 1000 } }, { usage: 1, text });
  const prompt = JSON.parse(messages.at(-1).content);
  assert.deepEqual(prompt.results.at(-1).check.gates.G2_compiles.diagnostics, expected);
});

test('feedback lists failing tests in test order and marks what passed last round as a regression', { timeout: 60000 }, async () => {
  const tests = JSON.stringify([{ name: 'small', fn: 'add', args: [1, 1], expect: 2 }, { name: 'mixed', fn: 'add', args: [2, 3], expect: 5 }, { name: 'zero', fn: 'add', args: [0, 0], expect: 0 }]);
  const check = checkPort();
  const first = await check(kernelFiles('export function add(a:i32,b:i32):i32{return a==2?a-b:a+b}', tests));
  assert.deepEqual(first.tests.map(t => [t.name, t.regression ?? false]), [['mixed', false]]);
  const second = await check(kernelFiles('export function add(a:i32,b:i32):i32{return a+b+1}', tests));
  assert.equal(second.stage, 'checks');
  assert.equal(second.gates.G4_tests.regression, undefined);
  assert.deepEqual(second.tests.map(t => [t.name, t.regression ?? false]), [['small', true], ['mixed', false], ['zero', true]]);
  const third = await check(kernelFiles(broken, tests));
  assert.deepEqual(Object.keys(third.gates), ['G2_compiles']);
  assert.equal(third.gates.G2_compiles.regression, true);
  assert.deepEqual(third.tests, []);
});
