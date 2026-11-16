import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLoopPool } from '../../../core/runtime/x1/loop.mjs';
import { verifyArtifact } from '../artifact.mjs';
import { ENGINE_LIMITS, PROCESS_ONLY, assertionProblem, createEngine } from '../engine-host.mjs';
import { FIXED_TIME_MS, deterministic } from '../engine.mjs';
import { KITESURF_CORE } from '../pin.mjs';

const artifact = verifyArtifact();
const needsEngine = artifact.status === 'ready' ? { timeout: 120000 } : { skip: `kitesurf artifact ${artifact.reason}` };
const html = readFileSync(new URL('fixtures/inspect.html', import.meta.url), 'utf8');
const viewport = [390, 844];
const small = { html: '<p>ok</p>', viewport: [100, 100], expect: [{ select: 'p', count: 1 }] };
const list = items => ({ html: `<ul>${'<li>item text here</li>'.repeat(items)}</ul>`, viewport, expect: [{ select: 'li', count: items }] });
const engineFor = (t, options) => { const engine = createEngine(options); t.after(() => engine.close()); return engine; };
const observed = result => result.results.map(entry => [entry.pass, entry.observed]);

test('a missing artifact gives outcome_unknown, never a pass, and bad requests are refused before the engine', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ef-engine-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = await engineFor(t, { dir: `${dir}/` }).inspect(small);
  assert.equal(result.status, 'outcome_unknown');
  assert.match(result.reason, /kitesurf artifact not usable \(missing kitesurf_core_bg.wasm\)/);
  const engine = engineFor(t);
  assert.throws(() => engine.inspect({ ...small, viewport: [0, 10] }), /viewport/);
  assert.throws(() => engine.inspect({ ...small, expect: [] }), /nonempty/);
  for (const bad of [{ select: 'p' }, { select: 'p', count: 1, text: 'x' }, { select: 'p', pixel: [0, 0, 0] }, { page: 'other' }, { select: 'p', box: { wider: 1 } }, { select: 'p', attr: { 'x"]': 'y' } }])
    assert.ok(assertionProblem(bad), JSON.stringify(bad));
  assert.equal(engine.stats().started, 0);
});

test('the run wrapper fixes both clocks and seeds getRandomValues, then restores them', () => {
  const RealDate = Date;
  const draw = () => deterministic(() => [new Date().getTime(), Date.now(), [...crypto.getRandomValues(new Uint8Array(4))], new Date(5).getTime()]);
  assert.deepEqual(draw(), draw());
  assert.deepEqual(draw().slice(0, 2), [FIXED_TIME_MS, FIXED_TIME_MS]);
  assert.equal(draw()[3], 5);
  assert.equal(globalThis.Date, RealDate);
  assert.ok(Date.now() > FIXED_TIME_MS);
  assert.equal(Object.hasOwn(crypto, 'getRandomValues'), false);
});

test('inspect passes and fails each assertion with what it observed and what it needs', needsEngine, async t => {
  const engine = engineFor(t);
  const passing = await engine.inspect({ html, viewport, expect: [{ select: 'li', count: 2 }, { select: 'li', text: 'Milk' }, { select: '#add', attr: { 'aria-label': 'Add item' } },
    { select: '#add', style: { display: 'block', 'background-color': 'rgb(0, 0, 255)' } }, { select: '#add', box: { minWidth: 44, minHeight: 44, inViewport: true } },
    { select: '#add', apart: '#title' }, { page: 'noHorizontalOverflow' }], png: true });
  assert.equal(passing.status, 'completed');
  assert.equal(passing.pass, true, JSON.stringify(passing.results));
  assert.deepEqual([passing.png.length > 0, Buffer.from(passing.png).readUInt32BE(16), Buffer.from(passing.png).readUInt32BE(20)], [true, 390, 844]);
  const failing = await engine.inspect({ html: html.replace('width: 48px; height: 48px', 'width: 30px; height: 20px').replace('<div id="spare"></div>', '<div style="width: 500px; height: 4px"></div>'),
    viewport, expect: [{ select: 'li', count: 1 }, { select: 'li', text: 'Bread' }, { select: '#add', attr: { 'aria-label': 'Remove', role: 'button' } },
      { select: '#add', style: { display: 'inline' } }, { select: '#add', box: { minWidth: 44, minHeight: 44 } }, { select: '#add', apart: '#overlap' },
      { select: 'nav', text: 'x' }, { select: '[[', count: 0 }, { page: 'noHorizontalOverflow' }] });
  assert.equal(failing.pass, false);
  assert.deepEqual(observed(failing), [
    [false, 'li count 2, needs 1'], [false, 'li text "Milk", needs "Bread"'],
    [false, '#add aria-label "Add item", needs "Remove"; #add role absent, needs "button"'], [false, '#add display block, needs inline'],
    [false, '#add box 30x20 at 8,48, needs minWidth 44, minHeight 44'], [false, '#add and #overlap overlap by 10x10, needs apart'],
    [false, 'nav matched nothing'], [false, '[[ is not a selector the engine accepts'],
    [false, 'page overflows horizontally: div right edge 500 passes the viewport width 390, needs noHorizontalOverflow']]);
});

test('a document that fetches never passes and the bridge only counts the refused requests', needsEngine, async t => {
  const result = await engineFor(t).inspect({ html: '<p>x</p><img src="a.png"><link rel="stylesheet" href="s.css">', viewport, expect: [{ select: 'p', count: 1 }] });
  assert.equal(result.pass, false);
  assert.equal(result.fetches, 2);
  assert.deepEqual(result.results.at(-1), { assertion: { fetch: 'none' }, pass: false,
    observed: 'document requested 2 resource(s): https://kitesurf.local/a.png, https://kitesurf.local/s.css, needs none' });
});

test('one warm worker is reused without restore and renders the same bytes as a fresh one', needsEngine, async t => {
  const engine = engineFor(t), page = { ...small, html, png: true };
  const warm = await engine.start();
  const first = await engine.inspect(page), second = await engine.inspect(page);
  assert.deepEqual([first.engine.generation, second.engine.generation, second.engine.checks, second.glueImports], [1, 1, 2, 1]);
  assert.deepEqual(first.engine.warm, { pages: warm.pages, externrefs: warm.externrefs });
  assert.ok(second.pages >= first.pages && first.pages >= warm.pages);
  assert.ok(Number.isSafeInteger(second.externrefs) && second.externrefs > 0);
  const fresh = await engineFor(t).inspect(page);
  assert.deepEqual(Buffer.from(fresh.png), Buffer.from(second.png));
});

test('the engine has no memory snapshot or restore path, and its limits are the design values', () => {
  for (const name of ['engine.mjs', 'engine-host.mjs']) {
    const source = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]);
    assert.deepEqual(imports.filter(path => !['node:perf_hooks', 'node:worker_threads', '../../core/runtime/isolate-wasm.mjs', './artifact.mjs', './pin.mjs'].includes(path)), [], name);
    assert.doesNotMatch(source, /tsrs-reuse|snapshot|restore|memory\.buffer\)?\.set|new Uint8Array\(exports\.memory/i, name);
  }
  assert.deepEqual(ENGINE_LIMITS, { maxChecks: 1000, maxGrowthBytes: 16 * 1024 * 1024, timeoutMs: 5000 });
});

test('an engine fault ends only its worker as outcome_unknown and a replacement serves the next check', needsEngine, async t => {
  const engine = engineFor(t, { maximumPages: 200 });
  assert.equal((await engine.inspect(small)).pass, true);
  const faulted = await engine.inspect(list(4000));
  assert.deepEqual([faulted.status, faulted.pass, faulted.reason], ['outcome_unknown', undefined, 'engine fault: unreachable']);
  const next = await engine.inspect(small);
  assert.deepEqual([next.status, next.pass, next.engine.generation], ['completed', true, 2]);
  assert.deepEqual(engine.stats(), { started: 2, replaced: 1, checks: 3, faults: 1 });
  const slow = engineFor(t, { timeoutMs: 20 });
  await slow.start();
  const stopped = await slow.inspect(list(20000));
  assert.deepEqual([stopped.status, stopped.reason], ['outcome_unknown', 'engine check exceeded 20 ms']);
  assert.equal((await slow.inspect(small)).engine.generation, 2);
});

test('the worker is replaced after N checks and after 16 MiB of growth since warm', needsEngine, async t => {
  const counted = engineFor(t, { maxChecks: 2 });
  const generations = [];
  for (let i = 0; i < 5; i++) generations.push((await counted.inspect(small)).engine.generation);
  assert.deepEqual(generations, [1, 1, 2, 2, 3]);
  const grown = engineFor(t);
  const warm = await grown.inspect(small), big = await grown.inspect(list(20000)), after = await grown.inspect(small);
  assert.ok((big.pages - warm.pages) * 65536 >= ENGINE_LIMITS.maxGrowthBytes);
  assert.deepEqual([big.pass, big.engine.generation, after.engine.generation, grown.stats().replaced], [true, 1, 2, 1]);
});

test('a loop cell pool with render on reaches the engine in its own worker; off by default and refused in thread cells', needsEngine, async t => {
  assert.throws(() => createLoopPool({ render: true, isolation: 'thread' }), new RegExp(PROCESS_ONLY));
  const pool = createLoopPool({ primes: 1, render: true });
  t.after(() => pool.close());
  const job = render => pool.run({ ledger: 'caller', reference: {}, candidates: ['render'], portOptions: { mode: 'inspect', render } });
  const result = await job({ html, viewport, expect: [{ select: '#add', box: { minWidth: 44 } }, { select: 'li', count: 2 }] });
  assert.equal(result.status, 'completed', result.reason);
  assert.equal(result.isolation, 'process');
  assert.deepEqual([result.report.stage, result.report.pass, result.report.engine.generation], ['inspected', true, 1]);
  assert.deepEqual(result.toolingWasmModules.map(entry => entry.sha256), [KITESURF_CORE.sha256]);
  assert.equal((await job({ ...small, expect: [{ select: 'p', count: 2 }] })).report.results[0].observed, 'p count 1, needs 2');
  const plain = createLoopPool({ primes: 1 });
  t.after(() => plain.close());
  const off = await plain.run({ ledger: 'caller', reference: {}, candidates: ['render'], portOptions: { mode: 'inspect', render: small } });
  assert.deepEqual([off.status, off.reason, off.toolingWasmModules], ['outcome_unknown', 'render engine is off in this cell', undefined]);
});
