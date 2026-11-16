import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compile } from '../x1/compiler.mjs';
import { capabilityProblems } from '../x1/generator.mjs';
import { renderSelectors, runGates, testProblems } from '../x1/gates.mjs';
import { hash } from '../x1/host.mjs';

const asc = fileURLToPath(new URL('../../../tools/asc/node_modules/.bin/asc', import.meta.url));
const source = `export function next(state: usize, event: usize, out: usize): void {
  store<i32>(out, load<i32>(state) + load<i32>(event));
}

export function view(state: usize, out: usize): void {
  if (load<i32>(state) < 0) abort();
  const page = '<!doctype html><ul><li>item</li></ul>';
  for (let i = 0; i < page.length; i++) store<u8>(out + 4 + <usize>i, <u8>page.charCodeAt(i));
  store<u32>(out, <u32>page.length);
}
`;
const module = 'AGFzbQEAAAABEwNgBH9/f38AYAJ/fwBgA39/fwACDQEDZW52BWFib3J0AAADAwIBAgUFAQEBgAgHGAMEbmV4dAACBHZpZXcAAQZtZW1vcnkCAAwBAgp7AmYBAX8gACgCAEEASARAQQBBAEEAQQAQAAsDQCACQZwIKAIAQQF2IgBIBEAgAUEEaiACaiAAIAJNBH9BfwUgAkEBdEGgCGovAQALOgAAIAJBAWohAgwBCwsgAUGcCCgCAEEBdjYCAAsSACACIAAoAgAgASgCAGo2AgALC18CAEGMCAsBXABBmAgLUQIAAABKAAAAPAAhAGQAbwBjAHQAeQBwAGUAIABoAHQAbQBsAD4APAB1AGwAPgA8AGwAaQA+AGkAdABlAG0APAAvAGwAaQA+ADwALwB1AGwAPg==';
const state = { kind: 'record', fields: [{ name: 'count', kind: 'integer', unit: '1' }] };
const event = { kind: 'record', fields: [{ name: 'add', kind: 'integer', unit: '1' }] };
const page = { kind: 'text', maxBytes: 256, media: 'text/html' };
const exportsOf = viewResult => [
  { name: 'next', args: [{ name: 'state', ...state }, { name: 'event', ...event }], result: state },
  { name: 'view', args: [{ name: 'state', ...state }], result: viewResult },
];
const contractFor = (viewResult = page) => [
  'A counter screen: next(state, event) adds the event amount to the count, and view(state) returns the page as a complete HTML document.',
  '', '```capability', JSON.stringify({ exports: exportsOf(viewResult), traps: [] }), '```',
].join('\n');
const glueFor = (viewResult = page, nextResult = state) => {
  const [next, view] = structuredClone(exportsOf(viewResult));
  return { id: 'counter', assumption: 'The count stays within the 32-bit integer range.', question: 'What does the counter screen show now?',
    exports: [{ ...next, label: 'Apply an event', result: structuredClone(nextResult) }, { ...view, label: 'Show the counter screen' }], traps: [] };
};
const valueTest = { name: 'adds', fn: 'next', args: [{ count: 1 }, { add: 2 }], expect: { count: 3 } };
const renderTest = { name: 'shows one item', fn: 'view', args: [{ count: 0 }], steps: [{ fn: 'next', event: { add: 1 } }],
  render: { viewport: [390, 844], expect: [{ select: 'li', count: 1 }, { select: 'li', text: 'item' }, { page: 'noHorizontalOverflow' }] } };
function candidate({ tests = [valueTest, renderTest], glue = glueFor(), contract = contractFor() } = {}) {
  const files = { 'CONTRACT.md': contract, 'kernel.ts': source, 'tests.json': JSON.stringify(tests), 'glue.json': JSON.stringify(glue) };
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  return { id: 'counter', files, compiled: { source: hash(source), wasm: module } };
}
const failing = result => Object.entries(result.gates).filter(([, gate]) => !gate.ok).map(([name]) => name);
const shape = 'a render test is { name, fn, args, render: { viewport: [width, height], expect: [assertion, ...] } }, optionally with steps: [{ fn, event }, ...]';
const base = { name: 'shows one item', fn: 'view', args: [{ count: 0 }], render: { viewport: [390, 844], expect: [{ select: 'li', count: 1 }] } };
const withRender = (render, extra = {}) => ({ ...base, render: { ...base.render, ...render }, ...extra });
const kinds = 'count, text, attr, style, box, apart, pixel, page';

const examples = [
  ['every assertion kind, after reducer steps', withRender({ expect: [{ select: 'li', count: 1 }, { select: 'li', text: 'item' }, { select: 'button', attr: { 'aria-label': 'Add' } }, { select: 'li', style: { color: 'rgb(0, 0, 0)' } },
    { select: 'button', box: { minWidth: 44, minHeight: 44, inViewport: true } }, { select: 'ul', apart: 'button' }, { select: 'li', pixel: '#000000' }, { page: 'noHorizontalOverflow' }] }, { steps: [{ fn: 'next', event: { add: 1 } }] }), []],
  ['a property instead of steps', { ...base, property: { fn: 'next', events: [{ add: 1 }], states: 16 } }, ['test 0 has property; property render tests are not supported yet, so reach the state with steps: [{ fn, event }, ...]']],
  ['no assertions', withRender({ expect: [] }), [`test 0 render.expect must be a nonempty list of assertions of kind ${kinds}, as in [{ select: "li", count: 1 }]`]],
  ['an unknown assertion kind', withRender({ expect: [{ select: 'li', visible: true }] }), [`test 0 render.expect[0] must have exactly one assertion kind (${kinds}) besides select, as in { select: "li", count: 1 }; it has visible`]],
  ['two kinds in one assertion', withRender({ expect: [{ select: 'li', count: 1, text: 'x' }] }), [`test 0 render.expect[0] must have exactly one assertion kind (${kinds}) besides select, as in { select: "li", count: 1 }; it has count, text`]],
  ['a feature instead of a selector', withRender({ expect: [{ feature: 'add-button', box: { minWidth: 44 } }] }), ['test 0 render.expect[0] names a feature; this version locates elements by select only, as in { select: "button#add", box: { minWidth: 44 } }']],
  ['a negative count', withRender({ expect: [{ select: 'li', count: -1 }] }), ['test 0 render.expect[0] count must be { select, count: n }, n an integer from 0 to 4096']],
  ['a box with min above max', withRender({ expect: [{ select: 'li', box: { minWidth: 50, maxWidth: 40 } }] }), ['test 0 render.expect[0] box must be { select, box: { minWidth, minHeight, maxWidth, maxHeight, inViewport } }, at least one key, sizes finite numbers from 0 to 4096 with min at most max, inViewport a boolean']],
  ['a colour name for a pixel', withRender({ expect: [{ select: 'li', pixel: 'red' }] }), ['test 0 render.expect[0] pixel must be { select, pixel: "#rrggbb" }']],
  ['an unknown page check', withRender({ expect: [{ page: 'noVerticalOverflow' }] }), ['test 0 render.expect[0] page must be { page: "noHorizontalOverflow" }']],
  ['an assertion without a selector', withRender({ expect: [{ count: 1 }] }), ['test 0 render.expect[0] select must be a nonempty CSS selector string of at most 256 characters']],
  ['a viewport outside 1..4096', withRender({ viewport: [0, 5000] }), ['test 0 render.viewport must be [width, height], integers from 1 to 4096']],
  ['an expect value beside render', { ...base, expect: '<p>' }, [`test 0 is a render test and also has expect; ${shape}, and value expectations belong in a separate test`]],
  ['the view as its own step', { ...base, steps: [{ fn: 'view', event: { add: 1 } }] }, ['test 0 steps[0] fn must name a reducer export fn(state, event) -> state other than the view export view']],
  ['a null event', { ...base, steps: [{ fn: 'next', event: null }] }, ['test 0 steps[0] event must be a number, boolean, string, record or list without null']],
  ['a PNG digest key', withRender({ pngSha256: 'x' }), ['test 0 render.pngSha256 names a digest or screenshot; render tests assert structure, layout and style, never a PNG digest']],
  ['a digest as expected text', withRender({ expect: [{ select: 'li', text: 'a'.repeat(64) }] }), ['test 0 render.expect[0].text holds a digest or image; render tests assert structure, layout and style, never a PNG digest']],
  ['steps on a value test', { name: 'adds', fn: 'next', args: [1], expect: 1, steps: [{ fn: 'next', event: 1 }] }, [`test 0 has steps without render; steps belong to render tests: ${shape}`]],
];

for (const [title, frozen, want] of examples) {
  test(`G1 render test: ${title} gives ${want.length ? 'its refusal' : 'no problem'}`, () => assert.deepEqual(testProblems([frozen]), want));
}

test('render selectors are collected for the engine check that slice 3b adds', () => {
  assert.deepEqual(renderSelectors(withRender({ expect: [{ select: 'li', count: 1 }, { select: 'ul', apart: 'button' }, { page: 'noHorizontalOverflow' }] })), ['li', 'ul', 'button']);
});

test('a kernel with render tests runs its view under G4-G6 and is never promotable before the render gate exists', () => {
  const result = runGates(candidate());
  assert.deepEqual(failing(result), ['G10_render']);
  assert.equal(result.promotable, false);
  assert.equal(result.gates.G10_render.unexecuted, 1);
  assert.equal(result.tests[1].expect, 'render');
  assert.equal(result.tests[1].got, '<!doctype html><ul><li>item</li></ul>');
  assert.equal(result.tests[1].pass, true);
  assert.equal(result.gates.G5_deterministic.ok, true);
  assert.equal(result.gates.G6_bounded.ok, true);
});

test('without render tests the same kernel promotes, so the refusal comes from the render tests alone', () => {
  const result = runGates(candidate({ tests: [valueTest] }));
  assert.deepEqual(failing(result), []);
  assert.equal(result.promotable, true);
  assert.equal(Object.hasOwn(result.gates, 'G10_render'), false);
});

test('a render test whose view call traps, or whose state does not encode, fails G4', () => {
  const [trapped, unencoded] = [[{ count: -2 }], [{ count: 0, extra: 1 }]].map(args => runGates(candidate({ tests: [valueTest, { ...renderTest, args }] })));
  for (const result of [trapped, unencoded]) {
    assert.equal(result.gates.G4_tests.ok, false);
    assert.equal(result.tests[1].pass, false);
    assert.equal(result.promotable, false);
  }
  assert.equal(trapped.tests[1].trap, true, JSON.stringify(trapped.tests[1]));
});

test('G7 refuses a render test that names an export without an HTML view result', () => {
  const rest = { ...renderTest };
  delete rest.steps;
  const result = runGates(candidate({ tests: [valueTest, { ...rest, fn: 'next', args: [{ count: 0 }, { add: 1 }] }] }));
  assert.equal(result.gates.G1_frozen.ok, true);
  assert.equal(result.gates.G7_glue.why, 'next is named by render test shows one item, so its glue result must be { kind: "text", media: "text/html", maxBytes }');
});

test('G1 refuses a frozen render test with a digest before any code runs', () => {
  const result = runGates(candidate({ tests: [valueTest, withRender({ expect: [{ select: 'li', text: 'a'.repeat(64) }] })] }));
  assert.equal(result.gates.G1_frozen.ok, false);
  assert.match(result.gates.G1_frozen.why, /never a PNG digest/);
});

test('G3 requires every reducer a render test steps through', () => {
  const result = runGates(candidate({ tests: [valueTest, { ...renderTest, steps: [{ fn: 'reset', event: { add: 0 } }] }] }));
  assert.equal(result.gates.G3_exports.why, 'missing exports: reset');
});

test('the freeze refuses a render test whose steps name an export the capability block does not declare as a reducer', () => {
  assert.deepEqual(capabilityProblems(contractFor(), [valueTest, renderTest]), []);
  assert.deepEqual(capabilityProblems(contractFor(), [valueTest, { ...renderTest, steps: [{ fn: 'reset', event: { add: 0 } }] }]),
    ['render test shows one item steps through reset, which the capability block does not export; declare reset(state, event) -> state there']);
  assert.deepEqual(capabilityProblems(contractFor(), [valueTest, { ...renderTest, steps: [{ fn: 'view', event: { add: 0 } }] }]),
    ['render test shows one item steps through view, so the capability block must declare it as a reducer view(state, event) -> state whose result has the layout of its state argument']);
});

test('G7 requires the view to take the state its reducer steps produce', () => {
  const glue = glueFor();
  glue.exports[1].args[0].fields = [...glue.exports[1].args[0].fields, { name: 'other', kind: 'integer', unit: '1' }];
  assert.match(runGates(candidate({ glue })).gates.G7_glue.why, /render test shows one item: view's first argument must have the layout of next's state/);
});

test('G7 requires text/html media on the view and the same media in the capability block', () => {
  const plain = { kind: 'text', maxBytes: 256 };
  assert.equal(runGates(candidate({ glue: glueFor(plain), contract: contractFor(plain) })).gates.G7_glue.why,
    'view is named by render test shows one item, so its glue result must be { kind: "text", media: "text/html", maxBytes }');
  assert.equal(runGates(candidate({ contract: contractFor(plain) })).gates.G7_glue.why,
    'view result media: the capability block says nothing, glue.json says "text/html"');
  assert.equal(runGates(candidate({ glue: glueFor(plain) })).gates.G7_glue.why,
    'view is named by render test shows one item, so its glue result must be { kind: "text", media: "text/html", maxBytes }; view result media: the capability block says "text/html", glue.json says nothing');
});

test('G7 keeps media on a text result only', () => {
  const glue = glueFor();
  glue.exports[0].args[0].fields[0].media = 'text/html';
  assert.match(runGates(candidate({ glue })).gates.G7_glue.why, /glue\.exports\[0\]\.args\[0\]\.fields\[0\]\.media: not allowed \(closed schema\)/);
  const wrongKind = glueFor({ kind: 'integer', unit: '1', media: 'text/html' });
  assert.match(runGates(candidate({ glue: wrongKind })).gates.G7_glue.why, /view: media text\/html on a integer result; media belongs on a text result only/);
  const otherMedia = glueFor({ ...page, media: 'image/png' });
  assert.match(runGates(candidate({ glue: otherMedia })).gates.G7_glue.why, /glue\.exports\[1\]\.result\.media: must be one of text\/html/);
});

test('G7 requires each step to be a reducer whose result keeps its state layout', () => {
  const renamed = glueFor(page, { kind: 'record', fields: [{ name: 'total', kind: 'integer', unit: '1' }] });
  assert.match(runGates(candidate({ glue: renamed, contract: contractFor() })).gates.G7_glue.why,
    /next is a step of render test shows one item, so it must be a reducer next\(state, event\) -> state whose result has the layout of its state argument/);
});

test('the embedded view module is what the pinned compiler builds from its source', { skip: !existsSync(asc) && 'run make loop-setup to install the pinned AssemblyScript compiler' }, async () => {
  const compiled = await compile({ 'kernel.ts': source }, asc);
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.wasm, module);
});
