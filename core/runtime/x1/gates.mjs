import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { glueFindings, hasNonFinite, nonFiniteExpectation, probeProblem, unitDisagreements } from './contract.mjs';
import { unitFindings } from './dimensions.mjs';
import { LayoutError, bufferArity, callKernel, freshKernel, invoke, isBuffer, kernelFuel, layoutOf, parseBufferEntries, probeCalls, scalarKinds } from './measure.mjs';
import { loadKernel } from './meter.mjs';
const glueSchema = JSON.parse(readFileSync(new URL('./glue.schema.json', import.meta.url)));
export const maximumRelativeTolerance = 0.01;
export function testProblems(tests) {
  if (!Array.isArray(tests) || !tests.length) return ['tests.json must be a nonempty array'];
  const problems = [];
  tests.forEach((test, index) => {
    const at = `test ${index}`;
    if (test === null || typeof test !== 'object' || Array.isArray(test)) return problems.push(`${at} must be an object`);
    if (typeof test.fn !== 'string' || !test.fn) problems.push(`${at} needs fn`);
    if (!Array.isArray(test.args)) problems.push(`${at} needs args`);
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
const missing = [...new Set(tests.map(t => t.fn))].filter(n => !exportNames.has(n));
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
  else pass = matches(t.expect, r.out, t.tol);
  allPass &&= pass;
  result.tests.push({ name: t.name, fn: t.fn, args: t.args, expect: t.expectError ? 'error' : t.expect, got: r.err ?? r.out, ...(r.trap ? { trap: true } : {}), ms: +r.ms.toFixed(3), pass });
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
        const trapFns = new Set(glue.traps.map(t => t.fn));
        for (const t of glue.traps) if (!exportNames.has(t.fn)) problems.push(`trap for ${t.fn}, which the module does not export`);
        for (const fn of new Set(tests.filter(t => t.expectError).map(t => t.fn))) if (!trapFns.has(fn)) problems.push(`${fn} traps in tests.json but the glue has no trap message for it`);
        const findings = glueFindings(glue, { source: fs.readFileSync(f('kernel.ts'), 'utf8'), contract: fs.readFileSync(f('CONTRACT.md'), 'utf8') });
        problems.push(...findings.problems);
        codeAdvisory.push(...findings.advisory);
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
result.promotable = Object.values(result.gates).every(g => g.ok);
return result;
} catch (error) {
  if (error?.gates) return error;
  throw error;
}
}
