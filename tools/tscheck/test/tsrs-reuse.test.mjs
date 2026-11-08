import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createBaseline, runCheck } from '../check-core.mjs';
import { BASELINE, projectFor } from '../contained-route.mjs';
import { TSRS_MODULE } from '../pin.mjs';
import { createReusingRunTsc, exposePrepare, memoryImage } from '../tsrs-reuse.mjs';
import { globalScopeKernels } from './global-scope-kernels.mjs';

const VENDOR = new URL('../node_modules/@tsrs/wasm/', import.meta.url);
const core = await import(`data:text/javascript;base64,${Buffer.from(exposePrepare(readFileSync(new URL('core.js', VENDOR), 'utf8'))).toString('base64')}`);
const module = new WebAssembly.Module(readFileSync(new URL('tsrs.wasm', VENDOR)));
const fresh = { core, module, compiler: TSRS_MODULE };
const reusing = (options, io = {}) => {
  const reuse = createReusingRunTsc(core, options);
  const runTsc = (m, request, host, given = {}) => reuse.runTsc(m, request, host, { ...given, ...io });
  return { reuse, compiler: { core: { ...core, runTsc }, module, compiler: TSRS_MODULE } };
};
const add = body => `export function add(a: i32, b: i32): i32 { ${body} }\n`;
const CORPUS = [
  add('return a + b;'),
  add('return "x";'),
  'export function add(a: i32, b: i32): i32 { return a + c; }\nconst n: string = 5;\n',
  `${add('return a + b;')}${Array.from({ length: 300 }, (_, index) => `export const v${index}: number = ${index};`).join('\n')}\n`,
  'const unused: number = 1;\nexport function add(a: i32, b: i32): i32 { let t: i32 = a; t += b; return t; }\n',
  'export class Box<T> { constructor(readonly value: T) {} map<U>(f: (v: T) => U): Box<U> { return new Box(f(this.value)); } }\n',
];
const outcome = report => ({ exitCode: report.exitCode, diagnostics: report.diagnostics, artifact: report.artifact, checkedSources: report.checkedSources });
const check = (compiler, kernel, options = {}) => {
  try { return outcome(runCheck(compiler, projectFor(kernel), { emit: true, ...options })); } catch (error) { return { threw: error.message.replace(/\(.*$/s, '') }; }
};
const shuffled = (items, seed) => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const other = seed % (index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
};

test('exposing prepare needs exactly one private prepare in the pinned core', () => {
  assert.throws(() => exposePrepare('export function runTsc() {}'), /exactly one/);
  assert.throws(() => exposePrepare('\nfunction prepare(a) {}\nfunction prepare(b) {}'), /exactly one/);
  assert.match(exposePrepare('const a = 1;\nfunction prepare(module) {}'), /\nexport function prepare\(module\)/);
});

test('a reused instance restored from its image gives what a fresh instance gives, in any order', { timeout: 120000 }, () => {
  const expected = CORPUS.map(kernel => check(fresh, kernel));
  const { reuse, compiler } = reusing({ growthMb: 256 });
  for (const seed of [1, 2, 3]) {
    const order = shuffled(CORPUS.map((_, index) => index), seed);
    for (const index of order) assert.deepEqual(check(compiler, CORPUS[index]), expected[index], `seed ${seed} kernel ${index}`);
  }
  assert.equal(reuse.stats.instances, 1);
  assert.equal(reuse.stats.reused, CORPUS.length * 3 - 1);
});

test('dead stack and memory grown by earlier runs do not reach a check', { timeout: 120000 }, () => {
  const pristine = memoryImage(new WebAssembly.Instance(module, core.prepare(module, { flags: 0 }, {}, {}).imports).exports.memory);
  assert.ok(pristine.start > 0 && pristine.end <= pristine.length);
  let poisoned = 0;
  const poison = memory => {
    const bytes = new Uint8Array(memory.buffer);
    bytes.fill(0xa5, 0, pristine.start);
    bytes.fill(0xa5, pristine.length, bytes.byteLength);
    poisoned += 1;
  };
  const expected = CORPUS.map(kernel => check(fresh, kernel));
  const { compiler } = reusing({ growthMb: 256 }, { beforeRun: poison });
  for (const round of [0, 1]) CORPUS.forEach((kernel, index) => assert.deepEqual(check(compiler, kernel), expected[index], `round ${round} kernel ${index}`));
  assert.equal(poisoned, CORPUS.length * 2);
});

test('a trap discards the instance and the next check matches a fresh one', { timeout: 120000 }, () => {
  const { reuse, compiler } = reusing();
  const expected = check(fresh, CORPUS[1]);
  assert.deepEqual(check(compiler, CORPUS[0]), check(fresh, CORPUS[0]));
  const trapped = check(compiler, `export const deep = ${'('.repeat(50000)}1${')'.repeat(50000)};\n`);
  assert.match(trapped.threw, /tsrs trapped/);
  assert.equal(reuse.stats.discarded, 1);
  assert.deepEqual(check(compiler, CORPUS[1]), expected);
  assert.equal(reuse.stats.instances, 2);
});

test('an instance that grew past its limit is replaced and the next check matches a fresh one', { timeout: 120000 }, () => {
  const { reuse, compiler } = reusing({ growthMb: 1 });
  const big = `${add('return a + b;')}${Array.from({ length: 6000 }, (_, index) => `export const v${index}: { a: number, b: string } = { a: ${index}, b: "${index}" };`).join('\n')}\n`;
  assert.deepEqual(check(compiler, big), check(fresh, big));
  assert.deepEqual(check(compiler, CORPUS[2]), check(fresh, CORPUS[2]));
  assert.ok(reuse.stats.discarded >= 1);
  assert.ok(reuse.stats.instances >= 2);
});

test('a host baseline gives the full check verdict and emit, including kernels that change the global scope', { timeout: 300000 }, () => {
  const { compiler } = reusing();
  const baseline = createBaseline(compiler, projectFor(BASELINE));
  const kernels = [...CORPUS, BASELINE, ...globalScopeKernels().map(item => item.kernel)];
  let diagnosed = 0;
  for (const kernel of kernels) {
    const full = check(fresh, kernel);
    assert.deepEqual(check(compiler, kernel, { baseline }), full, kernel.slice(0, 80));
    if (full.diagnostics?.some(item => !item.file?.startsWith('/proj/'))) diagnosed += 1;
  }
  assert.ok(diagnosed >= 10, 'the adversarial set reaches diagnostics in the default library');
});

test('a baseline is ignored for a different project shape and refused with build info', () => {
  const baseline = createBaseline(fresh, projectFor(BASELINE));
  const other = { ...projectFor(add('return a + b;')), tsconfig: { ...projectFor('').tsconfig, compilerOptions: { ...projectFor('').tsconfig.compilerOptions, strict: false } } };
  assert.deepEqual(outcome(runCheck(fresh, other, { emit: true, baseline })), outcome(runCheck(fresh, other, { emit: true })));
  assert.throws(() => runCheck(fresh, projectFor(BASELINE), { baseline, buildInfo: null }), /exclusive/);
  assert.throws(() => createBaseline(fresh, projectFor('export const n: number = "x";\n')), /check clean/);
});

test('a shed drops the idle instance and image, the next check starts fresh with the same result, and a shed during a run drops nothing', { timeout: 120000 }, () => {
  const expected = CORPUS.map(kernel => check(fresh, kernel));
  let during = null;
  const { reuse, compiler } = reusing({ growthMb: 256 }, { beforeRun: () => { if (during === 'probe') during = reuse.shed(); } });
  assert.equal(reuse.held(), 0);
  assert.deepEqual(check(compiler, CORPUS[0]), expected[0]);
  const held = reuse.held();
  assert.ok(held > 8 * 1048576, `held ${held}`);
  assert.equal(reuse.shed(), held);
  assert.equal(reuse.held(), 0);
  assert.equal(reuse.shed(), 0);
  for (const [index, kernel] of CORPUS.entries()) assert.deepEqual(check(compiler, kernel), expected[index]);
  assert.equal(reuse.stats.instances, 2);
  assert.equal(reuse.stats.shed, 1);
  during = 'probe';
  assert.deepEqual(check(compiler, CORPUS[1]), expected[1]);
  assert.equal(during, 0);
  assert.equal(reuse.stats.instances, 2);
  assert.ok(reuse.held() > 0);
});
