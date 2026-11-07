import assert from 'node:assert/strict';
import test from 'node:test';
import { createContainedRoute, ROUTE } from '../contained-route.mjs';
import { TSRS_MODULE } from '../pin.mjs';

const candidate = (kernel, tests = [{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]) => ({ files: { 'kernel.ts': kernel, 'tests.json': JSON.stringify(tests) } });

test('checked TypeScript is emitted and run contained, with the lane on the receipt', { timeout: 120000 }, async t => {
  const route = createContainedRoute();
  t.after(() => route.close());
  const good = await route.check(candidate('export function add(a: i32, b: i32): i32 { return a + b; }'));
  assert.equal(good.status, 'completed');
  assert.equal(good.lane, 'compatibility');
  assert.equal(good.route, ROUTE);
  assert.equal(good.passed, 1);
  assert.equal(good.comparedRuns, 2);
  assert.equal(good.compiler.sha256, TSRS_MODULE.sha256);
  assert.match(good.artifact['/proj/kernel.js'], /^[0-9a-f]{64}$/);
});

test('a type error stops before anything runs', { timeout: 120000 }, async t => {
  const route = createContainedRoute();
  t.after(() => route.close());
  const bad = await route.check(candidate('export function add(a: i32, b: i32): i32 { return "x"; }'));
  assert.equal(bad.reason, 'typescript');
  assert.equal(bad.diagnostics[0].code, 2322);
  assert.equal(bad.artifact, undefined);
});

test('emitted code gets refusals for failed tests, runaway work and absent modules', { timeout: 120000 }, async t => {
  const route = createContainedRoute({ deadlineMs: 300 });
  t.after(() => route.close());
  assert.equal((await route.check(candidate('export function add(a: i32, b: i32): i32 { return a - b; }'))).reason, 'tests');
  assert.equal((await route.check(candidate('export function add(a: i32, b: i32): i32 { for (;;); }'))).reason, 'deadline');
  const absent = await route.check(candidate('export function add(a: i32, b: i32): i32 { return (globalThis as any).process ? 1 : a + b; }'));
  assert.equal(absent.status, 'completed');
});
