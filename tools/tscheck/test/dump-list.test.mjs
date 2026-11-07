import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BASELINE, createContainedRoute } from '../contained-route.mjs';
import { globalScopeKernels } from './global-scope-kernels.mjs';

const candidate = (kernel, tests = [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]) => ({ files: { 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests) } });
const add = body => `export function add(a: i32, b: i32): i32 { ${body} }`;
const CORPUS = [
  candidate(add('return a + b;')),
  candidate(add('return "x";')),
  candidate(add('return a - b;')),
  candidate(add('throw new Error("no");')),
  candidate('const unused: number = 1;\nexport function add(a: i32, b: i32): i32 { let t: i32 = a; t += b; return t; }'),
  candidate('export function add(a: i32, b: i32): i32 { return a + c; }\nconst n: string = 5;'),
  candidate(BASELINE),
  ...globalScopeKernels().map(item => candidate(item.kernel)),
];
const verdict = receipt => ({ status: receipt.status, reason: receipt.reason, passed: receipt.passed, total: receipt.total, comparedRuns: receipt.comparedRuns,
  diagnostics: (receipt.diagnostics || []).map(({ file, line, column, code }) => ({ file, line, column, code })), artifact: receipt.artifact });
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'ef-dump-ts-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };

for (const check of ['fused', 'sibling']) {
  test(`${check}: repeated sheds during in-flight checked attempts change no verdict and add no outcome_unknown`, { timeout: 240000 }, async t => {
    const plain = createContainedRoute({ check, width: 4, deadlineMs: 1000, dumpList: false });
    t.after(() => plain.close());
    const expected = await Promise.all(CORPUS.map(item => plain.check(item).then(verdict)));
    assert.ok(expected.every(item => item.status !== 'outcome_unknown'));
    const directory = temp(t);
    const route = createContainedRoute({ check, width: 4, deadlineMs: 1000, dumpList: { directory, floor: 1, holdMs: 200, intervalMs: 20 } });
    t.after(() => route.close());
    await route.ready();
    const pid = route.pool.pid, file = join(directory, `${pid}-endoforge-cohort.json`);
    assert.ok(existsSync(file));
    let sheds = 0;
    const timer = setInterval(() => { try { process.kill(pid, 'SIGUSR2'); sheds += 1; } catch {} }, 25);
    const rounds = [];
    for (let round = 0; round < 3; round++) rounds.push(await Promise.all(CORPUS.map(item => route.check(item).then(verdict))));
    clearInterval(timer);
    assert.ok(sheds >= 10, `only ${sheds} sheds`);
    for (const got of rounds) assert.deepEqual(got, expected);
    assert.equal(route.pool.stats.unknown, 0);
    assert.equal(route.pool.stats.cohortLosses, 0);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, pid);
    await route.close();
    assert.deepEqual(readdirSync(directory), []);
  });
}

test('a shed drops the idle Workers\' reused instances and reports less, and the next check starts a fresh instance with the same verdict', { timeout: 120000 }, async t => {
  const directory = temp(t);
  const route = createContainedRoute({ width: 4, deadlineMs: 1000, dumpList: { directory, floor: 1, holdMs: 60000, intervalMs: 20 } });
  t.after(() => route.close());
  const first = await Promise.all(CORPUS.slice(0, 8).map(item => route.check(item).then(verdict)));
  const file = join(directory, `${route.pool.pid}-endoforge-cohort.json`);
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  const deadline = Date.now() + 5000;
  while (read().sheddable_bytes === 0 && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
  const before = read().sheddable_bytes;
  assert.ok(before > 1048576, `reported ${before}`);
  const writes = route.pool.dump.writes;
  process.kill(route.pool.pid, 'SIGUSR2');
  while (route.pool.dump.writes === writes && Date.now() < deadline + 2000) await new Promise(done => setTimeout(done, 10));
  assert.equal(read().sheddable_bytes, 0);
  assert.ok(route.pool.dump.idle <= 1);
  const again = await Promise.all(CORPUS.slice(0, 8).map(item => route.check(item).then(verdict)));
  assert.deepEqual(again, first);
});
