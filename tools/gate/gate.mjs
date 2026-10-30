#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASC = process.env.ENDOFORGE_ASC || path.resolve(HERE, '../../node_modules/.bin/asc');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [cmd, dirArg] = process.argv.slice(2);
if (!cmd || !dirArg) { console.error('usage: gate.mjs freeze|run <dir>'); process.exit(2); }
const dir = path.resolve(dirArg);
const f = (n) => path.join(dir, n);

if (cmd === 'freeze') {
  for (const n of ['CONTRACT.md', 'tests.json']) if (!fs.existsSync(f(n))) { console.error(`missing ${n}`); process.exit(2); }
  if (fs.existsSync(f('kernel.ts'))) { console.error('refusing to freeze: kernel.ts already exists (tests must be frozen before any code)'); process.exit(2); }
  JSON.parse(fs.readFileSync(f('tests.json'), 'utf8'));
  const rec = { at: new Date().toISOString(), contract: sha(f('CONTRACT.md')), tests: sha(f('tests.json')) };
  fs.writeFileSync(f('frozen.sha256'), JSON.stringify(rec, null, 2) + '\n');
  console.log(`frozen contract ${rec.contract.slice(0, 16)}… tests ${rec.tests.slice(0, 16)}…`);
  process.exit(0);
}

if (cmd !== 'run') { console.error('unknown command'); process.exit(2); }
const result = { at: new Date().toISOString(), gates: {}, tests: [], promotable: false };
const fail = (g, why) => { result.gates[g] = { ok: false, why }; finish(); };
const finish = () => { fs.writeFileSync(f('result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ promotable: result.promotable, gates: result.gates }, null, 1)); process.exit(result.promotable ? 0 : 1); };
if (!fs.existsSync(f('frozen.sha256'))) fail('G1_frozen', 'no frozen.sha256');
const frozen = JSON.parse(fs.readFileSync(f('frozen.sha256'), 'utf8'));
if (sha(f('CONTRACT.md')) !== frozen.contract) fail('G1_frozen', 'CONTRACT.md changed after freeze');
if (sha(f('tests.json')) !== frozen.tests) fail('G1_frozen', 'tests.json changed after freeze');
result.gates.G1_frozen = { ok: true };
if (!fs.existsSync(f('kernel.ts'))) fail('G2_compiles', 'no kernel.ts');
let diag = '';
try {
  execFileSync(ASC, [f('kernel.ts'), '--runtime', 'stub', '-O3', '--noAssert', '-o', f('kernel.wasm'), '--textFile', f('kernel.wat')], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
} catch (e) { diag = String(e.stderr || e.message); fail('G2_compiles', diag.slice(0, 2000)); }
const bytes = fs.readFileSync(f('kernel.wasm'));
const mod = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(mod).filter(i => !(i.module === 'env' && i.name === 'abort'));
if (imports.length) fail('G2_compiles', `unexpected imports: ${imports.map(i => i.module + '.' + i.name).join(', ')}`);
result.gates.G2_compiles = { ok: true, wasmBytes: bytes.length, wasmSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
const tests = JSON.parse(fs.readFileSync(f('tests.json'), 'utf8'));
const exportNames = new Set(WebAssembly.Module.exports(mod).filter(e => e.kind === 'function').map(e => e.name));
const missing = [...new Set(tests.map(t => t.fn))].filter(n => !exportNames.has(n));
if (missing.length) fail('G3_exports', `missing exports: ${missing.join(', ')}`);
result.gates.G3_exports = { ok: true, exports: [...exportNames] };

function instantiate() {
  let aborted = null;
  const inst = new WebAssembly.Instance(mod, { env: { abort: (m, fl, l, c) => { aborted = `abort at ${l}:${c}`; throw new Error(aborted); } } });
  return { inst, abortedRef: () => aborted };
}
function runAll() {
  const { inst } = instantiate();
  const outs = [];
  for (const t of tests) {
    const t0 = process.hrtime.bigint();
    let out, err = null;
    try { out = inst.exports[t.fn](...t.args); } catch (e) { err = String(e.message || e); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    outs.push({ out: typeof out === 'bigint' ? out.toString() : out, err, ms });
  }
  return outs;
}
const run1 = runAll();
let allPass = true;
tests.forEach((t, i) => {
  const r = run1[i];
  let pass;
  if (t.expectError) pass = r.err !== null;
  else if (r.err !== null) pass = false;
  else if (typeof t.expect === 'boolean') pass = Boolean(r.out) === t.expect || r.out === (t.expect ? 1 : 0);
  else if (typeof t.expect === 'number') pass = Number.isFinite(t.tol) ? Math.abs(Number(r.out) - t.expect) <= t.tol : Number(r.out) === t.expect;
  else pass = String(r.out) === String(t.expect);
  if (r.ms > 2000) { pass = false; r.err = (r.err || '') + ' [over 2000 ms]'; }
  allPass &&= pass;
  result.tests.push({ name: t.name, fn: t.fn, args: t.args, expect: t.expectError ? 'error' : t.expect, got: r.err ?? r.out, ms: +r.ms.toFixed(3), pass });
});
result.gates.G4_tests = { ok: allPass, passed: result.tests.filter(t => t.pass).length, total: tests.length };
result.gates.G6_bounded = { ok: run1.every(r => r.ms <= 2000), maxMs: Math.max(...run1.map(r => r.ms)) };
const run2 = runAll();
const same = run1.every((r, i) => String(r.out) === String(run2[i].out) && (r.err === null) === (run2[i].err === null));
result.gates.G5_deterministic = { ok: same };
{
  const problems = [];
  if (!fs.existsSync(f('glue.json'))) problems.push('no glue.json');
  else {
    let glue = null;
    try { glue = JSON.parse(fs.readFileSync(f('glue.json'), 'utf8')); } catch (e) { problems.push(`glue.json is not JSON: ${e.message}`); }
    if (glue) {
      const schema = JSON.parse(fs.readFileSync(path.join(HERE, 'glue.schema.json'), 'utf8'));
      problems.push(...validate(glue, schema, schema, 'glue'));
      if (!problems.length) {
        if (glue.id !== path.basename(dir)) problems.push(`glue.id ${glue.id} is not the folder name ${path.basename(dir)}`);
        const described = new Map(glue.exports.map(x => [x.name, x]));
        for (const n of exportNames) if (!described.has(n)) problems.push(`export ${n} has no glue entry`);
        for (const n of described.keys()) if (!exportNames.has(n)) problems.push(`glue describes ${n}, which the module does not export`);
        if (described.size !== glue.exports.length) problems.push('duplicate export names in glue');
        const { inst } = instantiate();
        for (const x of glue.exports) {
          if (!exportNames.has(x.name)) continue;
          const arity = inst.exports[x.name].length;
          if (x.args.length !== arity) problems.push(`${x.name}: glue lists ${x.args.length} args, the export takes ${arity}`);
          for (const a of x.args) if (a.kind === 'code' && !a.codes) problems.push(`${x.name}.${a.name}: code argument without a codes table`);
          const r = x.result;
          if (r.kind === 'number' && !Number.isInteger(r.precision)) problems.push(`${x.name}: number result without precision`);
          if (r.kind === 'code' && !r.codes) problems.push(`${x.name}: code result without a codes table`);
          if (r.kind === 'boolean' && !r.labels) problems.push(`${x.name}: boolean result without true/false labels`);
          if (r.kind === 'code') {
            const seen = new Set(tests.map((t, i) => [t, run1[i]]).filter(([t, o]) => t.fn === x.name && o.err === null).map(([, o]) => String(o.out)));
            for (const c of seen) if (!(c in r.codes)) problems.push(`${x.name}: returned code ${c} in the tests, which the glue does not label`);
          }
        }
        const trapFns = new Set(glue.traps.map(t => t.fn));
        for (const t of glue.traps) if (!exportNames.has(t.fn)) problems.push(`trap for ${t.fn}, which the module does not export`);
        for (const fn of new Set(tests.filter(t => t.expectError).map(t => t.fn))) if (!trapFns.has(fn)) problems.push(`${fn} traps in tests.json but the glue has no trap message for it`);
      }
    }
  }
  result.gates.G7_glue = problems.length ? { ok: false, why: problems.slice(0, 20).join('; ') } : { ok: true };
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
finish();
