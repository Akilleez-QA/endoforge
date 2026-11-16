import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { capabilityAgreement, capabilityBlock, glueFindings, hasNonFinite, nonFiniteExpectation, probeProblem, unitDisagreements } from './contract.mjs';
import { unitFindings } from './dimensions.mjs';
import { LayoutError, bufferArity, callKernel, freshKernel, invoke, isBuffer, kernelFuel, layoutOf, layoutTable, parseBufferEntries, probeCalls, scalarKinds } from './measure.mjs';
import { loadKernel } from './meter.mjs';
const glueSchema = JSON.parse(readFileSync(new URL('./glue.schema.json', import.meta.url)));
export const maximumRelativeTolerance = 0.01;
export const renderForm = 'a render test is { name, fn, args, render: { viewport: [width, height], expect: [assertion, ...] } }, optionally with steps: [{ fn, event }, ...]';
export const assertionForms = Object.freeze({
  count: '{ select, count: n }, n an integer from 0 to 4096',
  text: '{ select, text: "rendered text" }',
  attr: '{ select, attr: { name: "value", ... } }, attribute names and string values',
  style: '{ select, style: { property: "value", ... } }, lowercase CSS property names and nonempty string values',
  box: '{ select, box: { minWidth, minHeight, maxWidth, maxHeight, inViewport } }, at least one key, sizes finite numbers from 0 to 4096 with min at most max, inViewport a boolean',
  apart: '{ select, apart: "other selector" }',
  pixel: '{ select, pixel: "#rrggbb" }',
  page: '{ page: "noHorizontalOverflow" }',
});
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sizeKeys = ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'];
const digestLike = /png|digest|sha-?256|screenshot/i, digestValue = /^(?:sha-?256:)?[0-9a-f]{64}$|^data:image\//i;
const selectorProblem = value => (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value) ? 'must be a nonempty CSS selector string of at most 256 characters' : null);
export function renderSelectors(test) {
  return (Array.isArray(test?.render?.expect) ? test.render.expect : []).flatMap(item => [item?.select, item?.apart]).filter(value => typeof value === 'string');
}
function jsonProblem(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'holds a non-finite number';
  if (typeof value === 'string' || typeof value === 'boolean') return null;
  if (Array.isArray(value)) return value.map(jsonProblem).find(Boolean) ?? null;
  if (plain(value)) return Object.values(value).map(jsonProblem).find(Boolean) ?? null;
  return 'must be a number, boolean, string, record or list without null';
}
function assertionProblems(item, at) {
  if (!plain(item)) return [`${at} must be an object, one of: ${Object.values(assertionForms).join('; ')}`];
  const kinds = Object.keys(item).filter(key => key !== 'select');
  if (kinds.includes('feature')) return [`${at} names a feature; this version locates elements by select only, as in { select: "button#add", box: { minWidth: 44 } }`];
  if (kinds.length !== 1 || !Object.hasOwn(assertionForms, kinds[0])) return [`${at} must have exactly one assertion kind (${Object.keys(assertionForms).join(', ')}) besides select, as in { select: "li", count: 1 }; it has ${kinds.join(', ') || 'none'}`];
  const [kind] = kinds, value = item[kind], form = `${at} ${kind} must be ${assertionForms[kind]}`;
  if (kind === 'page') return Object.hasOwn(item, 'select') || value !== 'noHorizontalOverflow' ? [form] : [];
  const problems = [], selector = selectorProblem(item.select);
  if (selector) problems.push(`${at} select ${selector}`);
  if (kind === 'count' && !(Number.isInteger(value) && value >= 0 && value <= 4096)) problems.push(form);
  if (kind === 'text' && typeof value !== 'string') problems.push(form);
  if (kind === 'attr' && !(plain(value) && Object.keys(value).length && Object.entries(value).every(([name, text]) => /^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name) && typeof text === 'string'))) problems.push(form);
  if (kind === 'style' && !(plain(value) && Object.keys(value).length && Object.entries(value).every(([name, text]) => /^-?[a-z][a-z0-9-]*$/.test(name) && typeof text === 'string' && text.trim()))) problems.push(form);
  if (kind === 'apart' && selectorProblem(value)) problems.push(form);
  if (kind === 'pixel' && !(typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value))) problems.push(form);
  if (kind === 'box') {
    const sized = key => !Object.hasOwn(value, key) || (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 4096);
    const ordered = axis => !(Object.hasOwn(value, `min${axis}`) && Object.hasOwn(value, `max${axis}`)) || value[`min${axis}`] <= value[`max${axis}`];
    if (!(plain(value) && Object.keys(value).length && Object.keys(value).every(key => [...sizeKeys, 'inViewport'].includes(key)) && sizeKeys.every(sized)
      && (!Object.hasOwn(value, 'inViewport') || typeof value.inViewport === 'boolean') && ordered('Width') && ordered('Height'))) problems.push(form);
  }
  return problems;
}
function digestProblems(value, at) {
  if (typeof value === 'string') return digestValue.test(value) ? [`${at} holds a digest or image; render tests assert structure, layout and style, never a PNG digest`] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const where = Array.isArray(value) ? `${at}[${key}]` : `${at}.${key}`;
    return digestLike.test(key) ? [`${where} names a digest or screenshot; render tests assert structure, layout and style, never a PNG digest`] : digestProblems(item, where);
  });
}
function reducerProblems(step, at, view) {
  if (!plain(step)) return [`${at} must be an object { fn, event }`];
  const extra = Object.keys(step).filter(key => !['fn', 'event'].includes(key)), problems = [];
  if (extra.length) problems.push(`${at} has ${extra.join(', ')}; a step is { fn, event }`);
  if (typeof step.fn !== 'string' || !identifier.test(step.fn) || step.fn === view) problems.push(`${at} fn must name a reducer export fn(state, event) -> state other than the view export ${view}`);
  const event = Object.hasOwn(step, 'event') ? jsonProblem(step.event) : 'is missing';
  if (event) problems.push(`${at} event ${event}`);
  return problems;
}
function renderProblems(test, at) {
  const digests = digestProblems(test, '').map(problem => `${at} ${problem.slice(1)}`);
  if (digests.length) return digests;
  if (Object.hasOwn(test, 'property')) return [`${at} has property; property render tests are not supported yet, so reach the state with steps: [{ fn, event }, ...]`];
  const problems = [], extra = Object.keys(test).filter(key => !['name', 'fn', 'args', 'render', 'steps'].includes(key));
  if (extra.length) problems.push(`${at} is a render test and also has ${extra.join(', ')}; ${renderForm}, and value expectations belong in a separate test`);
  const { render } = test;
  if (!plain(render) || Object.keys(render).some(key => !['viewport', 'expect'].includes(key))) return [...problems, `${at} render must be { viewport, expect } only; ${renderForm}`];
  const { viewport } = render;
  if (!(Array.isArray(viewport) && viewport.length === 2 && viewport.every(side => Number.isInteger(side) && side >= 1 && side <= 4096))) problems.push(`${at} render.viewport must be [width, height], integers from 1 to 4096`);
  if (!Array.isArray(render.expect) || !render.expect.length) problems.push(`${at} render.expect must be a nonempty list of assertions of kind ${Object.keys(assertionForms).join(', ')}, as in [{ select: "li", count: 1 }]`);
  else render.expect.forEach((item, index) => problems.push(...assertionProblems(item, `${at} render.expect[${index}]`)));
  if (Object.hasOwn(test, 'steps')) {
    if (!Array.isArray(test.steps) || !test.steps.length || test.steps.length > 64) problems.push(`${at} steps must be a list of 1 to 64 { fn, event } reducer calls`);
    else test.steps.forEach((step, index) => problems.push(...reducerProblems(step, `${at} steps[${index}]`, test.fn)));
  }
  return problems;
}
export const isRenderTest = test => plain(test) && Object.hasOwn(test, 'render');
export const reducersOf = test => (Array.isArray(test?.steps) ? test.steps.map(step => step?.fn) : []).filter(fn => typeof fn === 'string');
export function testProblems(tests) {
  if (!Array.isArray(tests) || !tests.length) return ['tests.json must be a nonempty array'];
  const problems = [];
  tests.forEach((test, index) => {
    const at = `test ${index}`;
    if (test === null || typeof test !== 'object' || Array.isArray(test)) return problems.push(`${at} must be an object`);
    if (typeof test.fn !== 'string' || !test.fn) problems.push(`${at} needs fn`);
    if (!Array.isArray(test.args)) problems.push(`${at} needs args`);
    if (isRenderTest(test)) return problems.push(...renderProblems(test, at));
    if (Object.hasOwn(test, 'steps')) problems.push(`${at} has steps without render; steps belong to render tests: ${renderForm}`);
    const expects = Object.hasOwn(test, 'expect');
    if (test.expectError === true) return undefined;
    if (Object.hasOwn(test, 'expectError') && test.expectError !== false) problems.push(`${at} has an expectError that is not a boolean`);
    if (!expects) return problems.push(`${at} asserts nothing`);
    const { expect, tol } = test, numbers = [];
    const leaves = (value, path) => {
      const where = path ? ` at expect${path}` : '';
      if (typeof value === 'number') {
        numbers.push(value);
        if (!Number.isFinite(value)) problems.push(`${at} expects a non-finite number${where}`);
        else if (Number.isInteger(value) && !Number.isSafeInteger(value)) problems.push(`${at} expects an integer past exact range${where}; use a string`);
      } else if (typeof value === 'boolean' || typeof value === 'string') return;
      else if (path && value === null) problems.push(`${at} expects null${where}`);
      else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}[${index}]`));
      else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) leaves(item, `${path}.${key}`);
      else problems.push(`${at} expects neither a number, boolean nor string${where}`);
    };
    if (Array.isArray(expect) && !(Array.isArray(test.args) && test.args.some(arg => arg !== null && typeof arg === 'object'))) problems.push(`${at} expects a list from scalar arguments; a list result needs the structured state it comes from, or a record around it`);
    else leaves(expect, '');
    if (Object.hasOwn(test, 'tol')) {
      const structured = expect !== null && typeof expect === 'object';
      if (!numbers.length || (!structured && typeof expect !== 'number')) problems.push(`${at} has tol on a non-number`);
      else if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) problems.push(`${at} has an invalid tol`);
      else if (numbers.some(value => tol > maximumRelativeTolerance * Math.max(1, Math.abs(value)))) problems.push(`${at} has a tol above ${maximumRelativeTolerance} of ${structured ? 'a value it expects' : 'its value'}`);
    }
    return undefined;
  });
  return problems;
}
class KernelAbort extends Error {}
const isObject = value => value !== null && typeof value === 'object';
export function matches(expect, got, tol) {
  if (isObject(got) && !isObject(expect)) return false;
  if (typeof expect === 'boolean') return Boolean(got) === expect || got === (expect ? 1 : 0);
  if (typeof expect === 'number') return Number.isFinite(tol) ? Math.abs(Number(got) - expect) <= tol : Number(got) === expect;
  if (Array.isArray(expect)) return Array.isArray(got) && got.length === expect.length && expect.every((item, index) => matches(item, got[index], tol));
  if (isObject(expect)) {
    if (!isObject(got) || Array.isArray(got)) return false;
    const keys = Object.keys(expect);
    return Object.keys(got).length === keys.length && keys.every(key => Object.hasOwn(got, key) && matches(expect[key], got[key], tol));
  }
  return String(got) === String(expect);
}
const nonFiniteText = (key, value) => (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);
const shown = value => (isObject(value) ? JSON.stringify(value, nonFiniteText) : String(value));
const shownArgs = args => (args.some(isObject) ? args.map(shown).join(', ') : String(args));
function valueProblems(type, at, inResult) {
  const out = [], { kind } = type;
  const stray = allowed => { for (const key of ['fields', 'items', 'max', 'maxBytes', 'codes', 'labels', 'precision']) if (Object.hasOwn(type, key) && !allowed.includes(key)) out.push(`${at}: ${kind} value with ${key}`); };
  if (scalarKinds.includes(kind)) {
    stray(['codes', 'labels', 'precision']);
    if (!type.unit) out.push(`${at}: ${kind} value without a unit`);
    if (kind === 'code' && !type.codes) out.push(`${at}: code value without a codes table`);
    if (inResult && kind === 'number' && !Number.isInteger(type.precision)) out.push(`${at}: number value without precision`);
    if (inResult && kind === 'boolean' && !type.labels) out.push(`${at}: boolean value without true/false labels`);
    return out;
  }
  if (kind === 'record') {
    stray(['fields']);
    if (!type.fields) out.push(`${at}: record without fields`);
    else {
      if (new Set(type.fields.map(field => field.name)).size !== type.fields.length) out.push(`${at}: duplicate field names`);
      for (const field of type.fields) out.push(...valueProblems(field, `${at}.${field.name}`, inResult));
    }
  } else if (kind === 'list') {
    stray(['items', 'max']);
    if (!type.max) out.push(`${at}: list without max`);
    if (!type.items) out.push(`${at}: list without items`);
    else out.push(...valueProblems(type.items, `${at}[]`, inResult));
  } else if (kind === 'text') {
    stray(['maxBytes']);
    if (!type.maxBytes) out.push(`${at}: text without maxBytes`);
  }
  if (!out.length) try { layoutOf(type); } catch (error) { out.push(`${at}: ${error.message}`); }
  return out;
}
function codeLeaves(type, value, at, visit) {
  if (!isObject(type)) return;
  if (type.kind === 'code') visit(type, value, at);
  else if (type.kind === 'record' && Array.isArray(type.fields) && isObject(value)) for (const field of type.fields) codeLeaves(field, value[field.name], `${at}.${field.name}`, visit);
  else if (type.kind === 'list' && Array.isArray(value)) for (const item of value) codeLeaves(type.items, item, `${at}[]`, visit);
}
function mediaProblems(entry) {
  const out = [], nested = (type, at) => {
    if (!isObject(type)) return;
    if (Object.hasOwn(type, 'media')) out.push(`${at}: media belongs on a text result only, not inside a structured value`);
    for (const field of Array.isArray(type.fields) ? type.fields : []) nested(field, `${at}.${field.name}`);
    nested(type.items, `${at}[]`);
  };
  const { result } = entry;
  if (Object.hasOwn(result, 'media') && result.kind !== 'text') out.push(`${entry.name}: media ${result.media} on a ${result.kind} result; media belongs on a text result only`);
  for (const field of Array.isArray(result.fields) ? result.fields : []) nested(field, `${entry.name} result.${field.name}`);
  nested(result.items, `${entry.name} result[]`);
  return out;
}
const layoutText = type => { try { return JSON.stringify(layoutTable(type)); } catch { return null; } };
function renderGlueProblems(glue, tests) {
  const problems = glue.exports.flatMap(mediaProblems), described = new Map(glue.exports.map(x => [x.name, x]));
  for (const t of tests.filter(isRenderTest)) {
    const view = described.get(t.fn);
    if (view && !(view.result.kind === 'text' && view.result.media === 'text/html')) problems.push(`${t.fn} is named by render test ${t.name ?? t.fn}, so its glue result must be { kind: "text", media: "text/html", maxBytes }`);
    for (const fn of new Set(reducersOf(t))) {
      const reducer = described.get(fn);
      if (!reducer) continue;
      const state = layoutText(reducer.args[0]);
      if (reducer.args.length !== 2 || !state || state !== layoutText(reducer.result)) problems.push(`${fn} is a step of render test ${t.name ?? t.fn}, so it must be a reducer ${fn}(state, event) -> state whose result has the layout of its state argument`);
      else if (view && layoutText(view.args[0]) !== state) problems.push(`render test ${t.name ?? t.fn}: ${t.fn}'s first argument must have the layout of ${fn}'s state`);
    }
  }
  return [...new Set(problems)];
}
function functionNames(bytes) {
  let p = 8;
  const uint = () => { let n = 0, shift = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  while (p < bytes.length) {
    const section = bytes[p++], end = uint() + p;
    if (section === 7) {
      const names = [];
      for (let count = uint(); count; count--) {
        const length = uint(), name = bytes.subarray(p, p + length).toString(); p += length;
        const kind = bytes[p++]; uint(); if (kind === 0) names.push(name);
      }
      return new Set(names);
    }
    p = end;
  }
  return new Set();
}
export function runGates(candidate) {
const { id: dir, files, compiled } = candidate;
const f = n => n;
const fs = { existsSync: n => Object.hasOwn(files, n), readFileSync: n => {
  if (!Object.hasOwn(files, n)) throw Error(`missing ${n}`);
  return files[n];
} };
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try {
const result = { at: new Date().toISOString(), gates: {}, tests: [], promotable: false };
const fail = (g, why) => { result.gates[g] = { ok: false, why }; throw result; };
if (!fs.existsSync(f('frozen.sha256'))) fail('G1_frozen', 'no frozen.sha256');
const frozen = JSON.parse(fs.readFileSync(f('frozen.sha256'), 'utf8'));
if (sha(f('CONTRACT.md')) !== frozen.contract) fail('G1_frozen', 'CONTRACT.md changed after freeze');
if (sha(f('tests.json')) !== frozen.tests) fail('G1_frozen', 'tests.json changed after freeze');
let frozenTests;
try { frozenTests = JSON.parse(fs.readFileSync(f('tests.json'), 'utf8')); } catch { fail('G1_frozen', 'tests.json is not JSON'); }
const weak = testProblems(frozenTests);
if (weak.length) fail('G1_frozen', weak.slice(0, 20).join('; '));
result.gates.G1_frozen = { ok: true };
if (!compiled || compiled.error || compiled.source !== sha(f('kernel.ts'))) fail('G2_compiles', compiled?.error || 'compile binding differs');
const bytes = Buffer.from(compiled.wasm, 'base64');
let loaded;
try { loaded = loadKernel(bytes, kernelFuel); }
catch (error) { fail('G2_compiles', `module rejected: ${error.message}`); }
const imports = loaded.shape.imports.filter(i => !(i.module === 'env' && i.name === 'abort'));
if (imports.length) fail('G2_compiles', `unexpected imports: ${imports.map(i => i.module + '.' + i.name).join(', ')}`);
result.gates.G2_compiles = { ok: true, wasmBytes: bytes.length, wasmSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
const tests = JSON.parse(fs.readFileSync(f('tests.json'), 'utf8'));
const exportNames = functionNames(bytes);
const missing = [...new Set(tests.flatMap(t => [t.fn, ...reducersOf(t)]))].filter(n => !exportNames.has(n));
if (missing.length) fail('G3_exports', `missing exports: ${missing.join(', ')}`);
result.gates.G3_exports = { ok: true, exports: [...exportNames] };
function instantiate() {
  const kernel = loaded.start((m, fl, l, c) => { throw new KernelAbort(`abort at ${l}:${c}`); });
  return { inst: kernel.instance, kernel };
}
try { instantiate(); } catch (error) { fail('G2_compiles', `instantiation failed: ${error.message}`); }
const bounds = [];
const entries = fs.existsSync(f('glue.json')) ? parseBufferEntries(fs.readFileSync(f('glue.json'), 'utf8')) : new Map();
let fuelUsed = 0;
function runAll() {
  const { kernel } = instantiate();
  const outs = [];
  for (const t of tests) {
    const t0 = process.hrtime.bigint();
    let out, err = null, trap = false;
    try {
      if (!entries.has(t.fn) && t.args.some(isObject)) throw new LayoutError(`${t.fn} gets a structured argument, and its glue declares no buffer layout`);
      out = invoke(kernel, entries.get(t.fn), t.fn, t.args);
    } catch (e) {
      err = String(e.message || e);
      trap = e instanceof WebAssembly.RuntimeError || e instanceof KernelAbort;
      if (kernel.exhausted()) bounds.push('fuel exhausted');
      else if (e instanceof RangeError) bounds.push('stack exhausted');
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    outs.push({ out: typeof out === 'bigint' ? out.toString() : out, err, trap, ms });
  }
  fuelUsed = Math.max(fuelUsed, Math.min(kernel.used(), kernelFuel));
  return outs;
}
const run1 = runAll();
let allPass = true;
tests.forEach((t, i) => {
  const r = run1[i];
  let pass;
  if (t.expectError) pass = r.trap;
  else if (r.err !== null) pass = false;
  else pass = isRenderTest(t) || matches(t.expect, r.out, t.tol);
  allPass &&= pass;
  result.tests.push({ name: t.name, fn: t.fn, args: t.args, expect: t.expectError ? 'error' : isRenderTest(t) ? 'render' : t.expect, got: r.err ?? r.out, ...(r.trap ? { trap: true } : {}), ms: +r.ms.toFixed(3), pass });
});
result.gates.G4_tests = { ok: allPass, passed: result.tests.filter(t => t.pass).length, total: tests.length };
result.gates.G6_bounded = { ok: !bounds.length, ...(bounds.length ? { why: bounds[0] } : {}), maxMs: Math.max(...run1.map(r => r.ms)), fuelUsed };
const run2 = runAll();
const same = run1.every((r, i) => shown(r.out) === shown(run2[i].out) && (r.err === null) === (run2[i].err === null));
result.gates.G5_deterministic = { ok: same };
{
  const problems = [], codeAdvisory = [];
  if (!fs.existsSync(f('glue.json'))) problems.push('no glue.json');
  else {
    let glue = null;
    try { glue = JSON.parse(fs.readFileSync(f('glue.json'), 'utf8')); } catch (e) { problems.push(`glue.json is not JSON: ${e.message}`); }
    if (glue) {
      const schema = glueSchema;
      problems.push(...validate(glue, schema, schema, 'glue'));
      if (!problems.length) {
        if (glue.id !== path.basename(dir)) problems.push(`glue.id ${glue.id} is not the folder name ${path.basename(dir)}`);
        const described = new Map(glue.exports.map(x => [x.name, x]));
        for (const n of exportNames) if (!described.has(n)) problems.push(`export ${n} has no glue entry`);
        for (const n of described.keys()) if (!exportNames.has(n)) problems.push(`glue describes ${n}, which the module does not export`);
        if (described.size !== glue.exports.length) problems.push('duplicate export names in glue');
        for (const x of glue.exports) {
          if (!exportNames.has(x.name)) continue;
          const type = loaded.shape.functions[x.name], arity = type.params.length, r = x.result;
          if (bufferArity(x) !== arity) problems.push(`${x.name}: glue lists ${x.args.length} args${isBuffer(r) ? ' and a result buffer' : ''}, the export takes ${arity}`);
          else {
            x.args.forEach((a, i) => { if (isBuffer(a) && type.params[i] !== 'i32') problems.push(`${x.name}.${a.name}: a ${a.kind} buffer pointer must be an i32 parameter, the export takes ${type.params[i]}`); });
            if (isBuffer(r) && type.params.at(-1) !== 'i32') problems.push(`${x.name}: the result buffer pointer must be an i32 parameter, the export takes ${type.params.at(-1)}`);
            if (isBuffer(r) && type.results.length) problems.push(`${x.name}: writes its result buffer, so the export must return nothing`);
          }
          for (const a of x.args) {
            if (isBuffer(a)) { problems.push(...valueProblems(a, `${x.name}.${a.name}`, false)); continue; }
            if (!a.unit) problems.push(`${x.name}.${a.name}: ${a.kind} argument without a unit`);
            if (a.kind === 'code' && !a.codes) problems.push(`${x.name}.${a.name}: code argument without a codes table`);
          }
          if (isBuffer(r)) problems.push(...valueProblems(r, `${x.name} result`, true));
          else {
            if (!r.unit) problems.push(`${x.name}: ${r.kind} result without a unit`);
            for (const key of ['fields', 'items', 'max', 'maxBytes']) if (Object.hasOwn(r, key)) problems.push(`${x.name}: ${r.kind} result with ${key}`);
            if (r.kind === 'number' && !Number.isInteger(r.precision)) problems.push(`${x.name}: number result without precision`);
            if (r.kind === 'code' && !r.codes) problems.push(`${x.name}: code result without a codes table`);
            if (r.kind === 'boolean' && !r.labels) problems.push(`${x.name}: boolean result without true/false labels`);
          }
          const returned = tests.map((t, i) => [t, run1[i]]).filter(([t, o]) => t.fn === x.name && o.err === null).map(([, o]) => o.out);
          if (r.kind === 'code' && r.codes) {
            for (const c of new Set(returned.map(String))) if (!(c in r.codes)) problems.push(`${x.name}: returned code ${c} in the tests, which the glue does not label`);
          } else if (isBuffer(r)) {
            const unlabelled = new Set();
            for (const out of returned) codeLeaves(r, out, `${x.name} result`, (leaf, value, at) => { if (leaf.codes && !(String(value) in leaf.codes)) unlabelled.add(`${at}: returned code ${value} in the tests, which the glue does not label`); });
            problems.push(...unlabelled);
          }
        }
        problems.push(...renderGlueProblems(glue, tests));
        const trapFns = new Set(glue.traps.map(t => t.fn));
        for (const t of glue.traps) if (!exportNames.has(t.fn)) problems.push(`trap for ${t.fn}, which the module does not export`);
        for (const fn of new Set(tests.filter(t => t.expectError).map(t => t.fn))) if (!trapFns.has(fn)) problems.push(`${fn} traps in tests.json but the glue has no trap message for it`);
        const findings = glueFindings(glue, { source: fs.readFileSync(f('kernel.ts'), 'utf8'), contract: fs.readFileSync(f('CONTRACT.md'), 'utf8') });
        problems.push(...findings.problems);
        codeAdvisory.push(...findings.advisory);
        const capability = capabilityBlock(fs.readFileSync(f('CONTRACT.md'), 'utf8'));
        problems.push(...(capability.error ? [capability.error] : capabilityAgreement(capability.block, glue)));
      }
    }
  }
  const advisory = [...codeAdvisory];
  try { advisory.push(...unitDisagreements(JSON.parse(fs.readFileSync(f('glue.json'), 'utf8')))); } catch {}
  result.gates.G7_glue = problems.length ? { ok: false, why: problems.slice(0, 20).join('; ') } : { ok: true, ...(advisory.length ? { advisory: advisory.slice(0, 20) } : {}) };
}
{
  let glue = null;
  try { glue = JSON.parse(fs.readFileSync(f('glue.json'), 'utf8')); } catch {}
  if (glue?.exports) {
    const outputs = tests.map((t, i) => ({ fn: t.fn, out: run1[i].out, err: run1[i].err }));
    const { problems, checks } = unitFindings(glue, { source: fs.existsSync(f('kernel.ts')) ? fs.readFileSync(f('kernel.ts'), 'utf8') : '', outputs });
    result.gates.G9_units = problems.length ? { ok: false, why: problems.slice(0, 10).join('; '), checks } : { ok: true, checks };
  }
}
{
  const expected = nonFiniteExpectation(fs.readFileSync(f('CONTRACT.md'), 'utf8'), Object.keys(loaded.shape.functions));
  const calls = probeCalls(tests, loaded.shape.functions, entries), kernel = calls.length ? freshKernel(loaded) : null, problems = [], unjudged = {};
  for (const { fn, args } of calls) {
    const outcome = callKernel(kernel, fn, args, entries.get(fn)), expectation = expected[fn];
    if (outcome.limit) { problems.push(`${fn}(${shownArgs(args)}): ${outcome.limit}`); break; }
    const problem = probeProblem(expectation, outcome);
    if (problem) problems.push(`${fn}(${shownArgs(args)}): ${problem}`);
    else if (!outcome.trap && ['permitted', 'excluded', 'silent'].includes(expectation) && hasNonFinite(outcome.value)) unjudged[expectation] = (unjudged[expectation] ?? 0) + 1;
  }
  result.gates.G8_nonfinite = { ok: !problems.length, probes: calls.length, ...(problems.length ? { why: problems.slice(0, 5).join('; ') } : {}), ...(Object.keys(unjudged).length ? { unjudged } : {}) };
}
function validate(v, s, root, at) {
  const out = [];
  if (s.$ref) { const t = s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], root); return validate(v, t, root, at); }
  const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  if (s.type && !(s.type === type || (s.type === 'integer' && type === 'number' && Number.isInteger(v)))) return [`${at}: expected ${s.type}`];
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: must be one of ${s.enum.join('|')}`);
  if (type === 'string') {
    if (s.minLength != null && v.length < s.minLength) out.push(`${at}: shorter than ${s.minLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: does not match ${s.pattern}`);
  }
  if (type === 'number') {
    if (s.minimum != null && v < s.minimum) out.push(`${at}: below ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) out.push(`${at}: above ${s.maximum}`);
  }
  if (type === 'array') {
    if (s.minItems != null && v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`);
    if (s.items) v.forEach((x, i) => out.push(...validate(x, s.items, root, `${at}[${i}]`)));
  }
  if (type === 'object') {
    const keys = Object.keys(v);
    for (const r of s.required ?? []) if (!(r in v)) out.push(`${at}: missing ${r}`);
    if (s.minProperties != null && keys.length < s.minProperties) out.push(`${at}: fewer than ${s.minProperties} entries`);
    for (const k of keys) {
      if (s.propertyNames) out.push(...validate(k, s.propertyNames, root, `${at}.${k} (name)`));
      if (s.properties && k in s.properties) out.push(...validate(v[k], s.properties[k], root, `${at}.${k}`));
      else if (s.additionalProperties === false) out.push(`${at}.${k}: not allowed (closed schema)`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(...validate(v[k], s.additionalProperties, root, `${at}.${k}`));
    }
  }
  return out;
}
const renderCount = tests.filter(isRenderTest).length;
if (renderCount) result.gates.G10_render = { ok: false, unexecuted: renderCount, why: `${renderCount} render test${renderCount === 1 ? '' : 's'}: only the view calls ran (G4-G6); steps and assertions need the render gate, which does not exist yet, so this kernel cannot be promoted` };
result.promotable = Object.values(result.gates).every(g => g.ok);
return result;
} catch (error) {
  if (error?.gates) return error;
  throw error;
}
}
