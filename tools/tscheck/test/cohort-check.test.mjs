import assert from 'node:assert/strict';
import test from 'node:test';
import { createContainedRoute } from '../contained-route.mjs';

const candidate = (kernel, tests = [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]) => ({ files: { 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests) } });
const add = body => `export function add(a: i32, b: i32): i32 { ${body} }`;
const CORPUS = [
  candidate(add('return a + b;')),
  candidate(add('return "x";')),
  candidate(add('return a - b;')),
  candidate(add('for (;;);')),
  candidate(add('return (globalThis as any).process ? 1 : a + b;')),
  candidate(add('return Math.random() > 2 ? 0 : a + b;')),
  candidate(add('throw new Error("no");')),
  candidate('const unused: number = 1;\nexport function add(a: i32, b: i32): i32 { let t: i32 = a; t += b; return t; }'),
  candidate('export function add(a: i32, b: i32): i32 { return a + b }\nexport function twice(a: i32): i32 { return add(a, a); }', [{ name: 't', fn: 'twice', args: [4], expect: 8 }, { name: 'a', fn: 'add', args: [1, 1], expect: 3 }]),
  candidate('export function add(a: i32, b: i32): i32 { return a + c; }\nconst n: string = 5;'),
];
const verdict = receipt => ({ status: receipt.status, reason: receipt.reason, passed: receipt.passed, total: receipt.total, comparedRuns: receipt.comparedRuns,
  diagnostics: (receipt.diagnostics || []).map(({ file, line, column, code }) => ({ file, line, column, code })), artifact: receipt.artifact });
const bomb = candidate(`${add('return a + b;')}\n${Array.from({ length: 150000 }, (_, index) => `const v${index}: string = 1;`).join('\n')}`);

test('a check in the cohort gives the same verdicts as the check on the supervisor', { timeout: 180000 }, async t => {
  const verdicts = {};
  for (const check of ['supervisor', 'sibling', 'fused']) {
    const route = createContainedRoute({ check, width: 4, deadlineMs: 300 });
    t.after(() => route.close());
    verdicts[check] = await Promise.all(CORPUS.map(item => route.check(item).then(verdict)));
    assert.ok(verdicts[check].every(item => item.status !== 'outcome_unknown'), check);
  }
  assert.deepEqual(new Set(verdicts.supervisor.map(item => item.reason)), new Set([null, 'typescript', 'tests', 'deadline']));
  assert.deepEqual(verdicts.sibling, verdicts.supervisor);
  assert.deepEqual(verdicts.fused, verdicts.supervisor);
});

for (const check of ['sibling', 'fused']) {
  test(`${check}: a checker Worker that dies loses only its own attempt, as outcome_unknown, and it isn't run again`, { timeout: 180000 }, async t => {
    const route = createContainedRoute({ check, width: 4, deadlineMs: 1000, checker: { checkDeadlineMs: 120000 } });
    t.after(() => route.close());
    await route.ready();
    const good = CORPUS[0];
    const results = await Promise.all([good, bomb, good, good, good, good, good].map(item => route.check(item)));
    assert.equal(results[1].status, 'outcome_unknown');
    assert.equal(results[1].reason, 'checker_lost');
    assert.equal(results[1].detail, 'ERR_WORKER_OUT_OF_MEMORY');
    assert.ok(results.filter((_, index) => index !== 1).every(item => item.status === 'completed'));
    const { dispatched, cohortStarts, unknown } = route.pool.stats;
    assert.deepEqual({ dispatched, cohortStarts, unknown }, { dispatched: 7, cohortStarts: 1, unknown: 1 });
    assert.equal((await route.check(good)).status, 'completed');
  });

  test(`${check}: a cohort killed mid-check reports every attempt in flight outcome_unknown and retries none`, { timeout: 180000 }, async t => {
    const width = 4;
    const route = createContainedRoute({ check, width, deadlineMs: 1000 });
    t.after(() => route.close());
    await route.ready();
    const slow = candidate(`${add('return a + b;')}\n${Array.from({ length: 4000 }, (_, index) => `export const v${index}: number = ${index};`).join('\n')}`);
    const pending = Array.from({ length: width * 2 }, () => route.check(slow));
    await new Promise(done => setTimeout(done, 60));
    process.kill(route.pool.pid, 'SIGKILL');
    const results = await Promise.all(pending);
    const unknown = results.filter(item => item.status === 'outcome_unknown');
    assert.equal(unknown.length, width);
    assert.ok(unknown.every(item => item.reason === 'cohort_exit'));
    assert.equal(results.filter(item => item.status === 'completed').length, width, 'queued attempts run once on the replacement');
    assert.equal(route.pool.stats.dispatched, width * 2, 'no attempt was dispatched twice');
    assert.equal(route.pool.stats.cohortStarts, 2);
  });
}
