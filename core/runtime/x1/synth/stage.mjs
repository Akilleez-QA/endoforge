import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseReply } from '../agent.mjs';
import { kernelFuel, callKernel, freshKernel } from '../measure.mjs';
import { loadKernel } from '../meter.mjs';
import { glueProblems, library, propertyProblems, same, swappedLabels } from './invariants.mjs';
import { anchorProblems, discrimination, discriminationScore, mutants, selfConsistent } from './qualify.mjs';
import { runReferences } from './sandbox.mjs';
import { compareUnits } from './units.mjs';
import { vectorsFor } from './vectors.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
export const enabled = env => env.ENDOFORGE_SYNTH === '1';
export const sheetShape = { residual: ['plain-language sentence, at most 8'], quantities: [{ name: 'string', unit: 'string', sign: 'positive|nonnegative|any' }], relations: [{ output: 'string', input: 'string', direction: 'increasing|decreasing' }], invariants: Object.keys(library) };
export const bindingShape = { exports: [{ name: 'exactExportName', params: [{ name: 'exactParameterName', unit: 'unit as stated, or ""', min: 'number|null', max: 'number|null', minInclusive: true, maxInclusive: true, integer: false, codes: '{"1":"label"} for code parameters only' }],
  result: { kind: 'number|code|boolean', unit: 'unit as stated, or ""', decimals: 'integer the contract says to display, or null', codes: '{"1":"label"} or null', min: 'number|null', max: 'number|null' }, monotone: [{ param: 'exactParameterName', direction: 'increasing|decreasing' }] }],
  reference: 'function exactExportName(a, b) { ... }' };
export const prompts = {
  need: need => ({ stage: 'evaluator-need', need, library, sheetShape, instructions: 'You are writing the acceptance evaluator for this request before any implementation exists, and you will never see one. From the request alone, state what must be checked. Write sheet.json with one edit_file call (its JSON matches sheetShape), then done. Name only quantities and relations the request itself supports; choose invariants from library by id.' }),
  binding: (sheet, contract) => ({ stage: 'evaluator-binding', sheet, contract, library, bindingShape, instructions: 'You are writing the acceptance evaluator for the frozen contract below, before any implementation exists; you will never see the implementation or its tests. Write binding.json with one edit_file call, then done. List every export the contract defines, parameters in contract order with exact names. Give each unit as the contract states it, or "" when it states none. Give domain bounds only as the contract states them. Give decimals as the contract says to display. List a monotone relation only where the contract makes it certain. reference is one plain JavaScript source defining one function per export with the exact name and parameter order, computing exactly what the contract specifies in double precision with only Math and Number, throwing an Error wherever the contract requires a trap, and rounding only where the contract rounds the returned value.' }),
};
async function ask(provider, session, prompt, path) {
  const begin = performance.now();
  const reply = await provider.send({ session, messages: [{ role: 'user', content: JSON.stringify(prompt) }] });
  const call = parseReply(reply?.text)?.calls?.find(c => c?.name === 'edit_file' && c.path === path && typeof c.content === 'string');
  if (!call) throw Error(`model reply had no ${path}`);
  return { value: JSON.parse(call.content), text: reply.text, usage: reply.usage ?? 0, ms: performance.now() - begin };
}
export async function createProvider(env) {
  if (env.ENDOFORGE_SYNTH_PROVIDER) return (await import(env.ENDOFORGE_SYNTH_PROVIDER)).createProvider(env);
  const { SpawnClaudeTransport } = await import('../transports.mjs');
  return new SpawnClaudeTransport({ configDir: env.ENDOFORGE_SYNTH_CONFIG_DIR, model: env.ENDOFORGE_SYNTH_MODEL || 'sonnet', base: env });
}
const isNumber = x => typeof x === 'number' && Number.isFinite(x);
// M1: closed shape, exports and arities equal the frozen tests' functions.
function shapeProblems(entry, arity) {
  const problems = [];
  if (!entry || typeof entry.name !== 'string' || !Array.isArray(entry.params) || typeof entry.result !== 'object' || !entry.result) return ['malformed export'];
  if (arity === undefined) problems.push('not a function of the frozen tests');
  else if (entry.params.length !== arity) problems.push(`declares ${entry.params.length} parameters, the frozen tests pass ${arity}`);
  for (const p of entry.params) {
    if (typeof p?.name !== 'string') problems.push('parameter without a name');
    for (const k of ['min', 'max']) if (p?.[k] !== undefined && p[k] !== null && !isNumber(p[k])) problems.push(`${p.name}.${k} is not a number`);
  }
  return problems;
}
// Turns one binding into frozen vectors and a qualification receipt. No model, no candidate.
export async function compileMember(binding, tests) {
  const hash = sha(JSON.stringify(binding)), arities = {};
  for (const t of tests) if (!(t.fn in arities) && Array.isArray(t.args)) arities[t.fn] = t.args.length;
  const exports = {}, plan = [];
  const declared = Array.isArray(binding?.exports) ? binding.exports : [];
  for (const fn of Object.keys(arities)) {
    const entry = declared.find(e => e?.name === fn), problems = shapeProblems(entry, arities[fn]);
    if (typeof binding?.reference !== 'string') problems.push('no reference source');
    exports[fn] = { qualified: !problems.length, failures: problems.map(p => `M1 ${p}`), declaration: entry ? declarationOf(entry) : null };
    if (problems.length) continue;
    const base = tests.find(t => t.fn === fn && !t.expectError)?.args;
    const frozen = vectorsFor(entry, base, `${hash}:${fn}`), dense = vectorsFor(entry, base, `${hash}:${fn}:dense`, 192);
    plan.push({ fn, entry, own: tests.filter(t => t.fn === fn), frozen, dense: dense.calls.filter(c => !frozen.calls.some(f => JSON.stringify(f.args) === JSON.stringify(c.args))) });
  }
  if (!plan.length) return { hash, exports };
  const calls = plan.flatMap(p => [...p.own.map(t => ({ fn: t.fn, args: t.args })), ...p.frozen.calls, ...p.dense]);
  const faults = mutants(binding.reference);
  let runs;
  try { runs = await runReferences([binding.reference, binding.reference, ...faults], calls); }
  catch (error) { for (const p of plan) Object.assign(exports[p.fn], { qualified: false, failures: [`M2 ${error.message}`] }); return { hash, exports }; }
  let offset = 0;
  for (const p of plan) {
    const slice = (run, from, n) => run.results?.slice(offset + from, offset + from + n);
    const nOwn = p.own.length, nFrozen = p.frozen.calls.length, nDense = p.dense.length, record = exports[p.fn];
    const reference = slice(runs[0], 0, nOwn + nFrozen + nDense), again = slice(runs[1], 0, nOwn + nFrozen + nDense);
    offset += nOwn + nFrozen + nDense;
    if (!reference) { Object.assign(record, { qualified: false, failures: [`M2 reference did not load: ${runs[0].load}`] }); continue; }
    if (JSON.stringify(reference) !== JSON.stringify(again)) record.failures.push('M2 two runs differ');
    if (reference.some(r => r.error === 'budget' || /timed out/.test(r.error ?? ''))) record.failures.push('M2 reference exceeded its time budget');
    record.failures.push(...anchorProblems(p.own, reference.slice(0, nOwn)).map(x => `M3 ${x}`));
    const vectorResults = reference.slice(nOwn, nOwn + nFrozen);
    const { kept, dropped } = selfConsistent(p.entry, p.frozen.calls, vectorResults, p.frozen.sweeps);
    const score = discriminationScore(reference.slice(nOwn), runs.slice(2).map(run => ({ results: run.results?.slice(offset - nFrozen - nDense, offset) })), nFrozen);
    if (score.score < discrimination) record.failures.push(`M5 frozen vectors reject ${score.rejected} of ${score.distinguishable} distinguishable reference faults`);
    Object.assign(record, { qualified: !record.failures.length, dropped: dropped.map(x => `M4 ${x}`), discrimination: score, kept,
      vectors: p.frozen.calls.map((c, i) => ({ args: c.args, ...('value' in vectorResults[i] ? { value: vectorResults[i].value } : { throws: true }) })).filter(v => v.throws || Number.isFinite(v.value)) });
  }
  return { hash, exports, reference: binding.reference };
}
function declarationOf(entry) {
  const unit = u => (typeof u === 'string' && u.trim() ? u.trim() : null);
  const codes = c => (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) : null);
  return { args: entry.params.map(p => unit(p?.unit)), result: { unit: unit(entry.result.unit), decimals: Number.isInteger(entry.result.decimals) ? entry.result.decimals : null, codes: entry.result.kind === 'code' ? codes(entry.result.codes) : null } };
}
// Width 1: one member's qualified checks. Width 2: only what both members agree on.
export async function combine(members) {
  const checks = { vectors: [], ranges: [], codes: [], monotone: [], glue: [] };
  const [a, b] = members, fns = Object.keys(a.exports);
  let cross = null;
  if (b) {
    const calls = side => fns.filter(fn => side.exports[fn]?.qualified && (side === a ? b : a).exports[fn]?.qualified).flatMap(fn => side.exports[fn].vectors.map(v => ({ fn, args: v.args })));
    try { [cross] = [await Promise.all([runReferences([b.reference], calls(a)), runReferences([a.reference], calls(b))])]; } catch { cross = null; }
  }
  const crossAt = [0, 0];
  for (const fn of fns) {
    const sides = b ? [a.exports[fn], b.exports[fn]] : [a.exports[fn]];
    const decls = sides.map(s => s?.declaration);
    if (decls.every(Boolean)) {
      const [x, y = x] = decls;
      checks.glue.push({ fn, args: x.args.map((u, i) => (u && y.args[i] && compareUnits(u, y.args[i]) === 'same' ? u : null)),
        result: { unit: x.result.unit && y.result.unit && compareUnits(x.result.unit, y.result.unit) === 'same' ? x.result.unit : null,
          decimals: x.result.decimals === y.result.decimals ? x.result.decimals : null,
          codes: x.result.codes && y.result.codes && JSON.stringify(Object.keys(x.result.codes).sort()) === JSON.stringify(Object.keys(y.result.codes).sort()) && !swappedLabels(x.result.codes, y.result.codes).length ? x.result.codes : null } });
    }
    if (!sides.every(s => s?.qualified)) continue;
    const maps = sides.map((side, k) => {
      const map = new Map();
      side.vectors.forEach((v, i) => {
        if (b) { const other = cross?.[k]?.[0]?.results?.[crossAt[k] + i]; if (!other || !same('value' in other ? { value: other.value } : { throws: true }, v)) return; }
        map.set(i, checks.vectors.push({ fn, ...v }) - 1);
      });
      if (b) crossAt[k] += side.vectors.length;
      return map;
    });
    const [x, y = x] = sides.map(s => s.kept);
    const bound = (u, v, pick) => (Number.isFinite(u) && Number.isFinite(v) ? pick(u, v) : undefined);
    if (x.range && y.range) checks.ranges.push({ fn, min: bound(x.range.min, y.range.min, Math.min), max: bound(x.range.max, y.range.max, Math.max) });
    if (x.codes && y.codes) checks.codes.push({ fn, codes: [...new Set([...x.codes, ...y.codes])] });
    for (const m of x.monotone) if (y.monotone.some(n => n.param === m.param && n.direction === m.direction)) checks.monotone.push({ fn, param: m.param, direction: m.direction, chain: m.chain.filter(i => maps[0].has(i)).map(i => maps[0].get(i)) });
  }
  return checks;
}
export function residualText(evaluator) {
  const lines = [...(evaluator.residual ?? [])];
  const byFn = new Map();
  for (const v of evaluator.checks.vectors) byFn.set(v.fn, (byFn.get(v.fn) ?? 0) + 1);
  for (const [fn, n] of byFn) lines.push(`${fn}: ${n} generated inputs compared with an independent reference written from the contract.`);
  for (const g of evaluator.checks.glue) lines.push(`${g.fn}: result shown in ${g.result.unit ?? 'an unchecked unit'}${g.result.decimals !== null ? ` with ${g.result.decimals} decimals` : ''}; arguments in ${g.args.map(u => u ?? 'unchecked').join(', ')}.`);
  for (const m of evaluator.checks.monotone) lines.push(`${m.fn}: result ${m.direction === 'increasing' ? 'rises' : 'falls'} with argument ${m.param + 1}.`);
  return lines.join('\n');
}
// Starts the need-alone step immediately; finish() binds, compiles, confirms and writes the frozen file.
export function begin({ need, env = process.env, provider: given = null, confirm = null }) {
  const width = env.ENDOFORGE_SYNTH_WIDTH === '2' ? 2 : 1, timings = { needMs: null, bindMs: null, compileMs: null, evaluateMs: null }, usage = { tokens: 0 };
  const providerReady = given ? Promise.resolve(given) : createProvider(env);
  const sheets = providerReady.then(provider => Promise.all(Array.from({ length: width }, (_, k) => ask(provider, `need-${k}`, prompts.need(need), 'sheet.json').catch(error => ({ error: error.message })))));
  sheets.catch(() => {});
  let frozen = null;
  async function finish(root) {
    const start = performance.now();
    let evaluator;
    try {
      const provider = await providerReady, needs = await sheets;
      timings.needMs = Math.max(0, ...needs.map(n => n.ms ?? 0));
      const contract = await readFile(join(root, 'CONTRACT.md'), 'utf8'), tests = JSON.parse(await readFile(join(root, 'tests.json'), 'utf8'));
      const bindStart = performance.now();
      const bindings = await Promise.all(needs.map((sheet, k) => (sheet.error ? Promise.resolve({ error: sheet.error }) : ask(provider, `binding-${k}`, prompts.binding(sheet.value, contract), 'binding.json').catch(error => ({ error: error.message })))));
      timings.bindMs = performance.now() - bindStart;
      for (const x of [...needs, ...bindings]) usage.tokens += x.usage ?? 0;
      const compileStart = performance.now();
      const members = await Promise.all(bindings.map(binding => (binding.error ? { error: binding.error, exports: {} } : compileMember(binding.value, tests))));
      const usable = members.every(m => !m.error);
      const checks = usable ? await combine(members) : { vectors: [], ranges: [], codes: [], monotone: [], glue: [] };
      timings.compileMs = performance.now() - compileStart;
      evaluator = { version: 1, width, library: Object.keys(library), residual: needs.find(n => n.value)?.value?.residual?.slice(0, 8) ?? [],
        members: members.map((m, k) => ({ sheet: needs[k].text ? sha(needs[k].text) : null, binding: m.hash ?? null, error: m.error ?? null,
          exports: Object.fromEntries(Object.entries(m.exports).map(([fn, e]) => [fn, { qualified: e.qualified, failures: e.failures, dropped: e.dropped ?? [], discrimination: e.discrimination ?? null }])) })),
        checks };
    } catch (error) {
      evaluator = { version: 1, width, error: `synthesis failed: ${error.message}`, residual: [], members: [], checks: { vectors: [], ranges: [], codes: [], monotone: [], glue: [] } };
    }
    const text = residualText(evaluator);
    const answer = confirm ? await confirm(text, evaluator) : { approved: true, confirmed_by: 'task contract, no person' };
    evaluator.confirmation = { approved: answer?.approved === true, confirmed_by: String(answer?.confirmed_by ?? 'unknown'), text };
    const content = `${JSON.stringify(evaluator, null, 1)}\n`;
    await mkdir(join(root, 'synth'), { recursive: true });
    await writeFile(join(root, 'synth', 'evaluator.json'), content);
    frozen = { root, hash: sha(content) };
    timings.finishMs = performance.now() - start;
    return frozen;
  }
  async function evaluate(candidate) {
    const start = performance.now();
    try {
      if (!frozen) return { decision: 'abstain', reason: 'no frozen evaluator' };
      const content = await readFile(join(frozen.root, 'synth', 'evaluator.json'), 'utf8');
      if (sha(content) !== frozen.hash) return { decision: 'refuse', reason: 'synthesized evaluator changed after freeze', evaluator: frozen.hash };
      return { ...judge(JSON.parse(content), candidate), evaluator: frozen.hash };
    } finally { timings.evaluateMs = performance.now() - start; }
  }
  return { finish, evaluate, timings, usage, width };
}
// Runs the frozen checks on one compiled candidate, in this process, under the fuel meter.
export function judge(evaluator, candidate) {
  if (!evaluator.confirmation?.approved) return { decision: 'abstain', reason: 'residual not confirmed' };
  const { checks } = evaluator;
  if (!checks.vectors.length && !checks.glue.length) return { decision: 'abstain', reason: evaluator.error ?? 'nothing qualified' };
  const failures = [];
  let outcomes = [];
  if (checks.vectors.length) {
    let loaded;
    try { loaded = loadKernel(Buffer.from(candidate.compiled.wasm, 'base64'), kernelFuel); } catch { return { decision: 'refuse', failures: ['module did not load'] }; }
    const run = order => {
      const kernel = freshKernel(loaded), out = new Array(checks.vectors.length);
      for (const i of order) {
        const v = checks.vectors[i], type = loaded.shape.functions[v.fn];
        if (!type || type.params.length !== v.args.length) { out[i] = { missing: true }; continue; }
        if (type.params.some((t, j) => t !== 'f64' && t !== 'f32' && !Number.isInteger(v.args[j]))) { out[i] = { skipped: true }; continue; }
        const r = callKernel(kernel, v.fn, type.params.map((t, j) => (t === 'i64' ? BigInt(v.args[j]) : v.args[j])));
        out[i] = r.limit ? { limit: r.limit } : r.trap ? { trap: true } : { value: Number(r.value) };
      }
      return out;
    };
    const order = checks.vectors.map((_, i) => i);
    outcomes = run(order);
    const again = run([...order].reverse());
    if (JSON.stringify(outcomes) !== JSON.stringify(again)) failures.push('determinism: two instances disagree');
    checks.vectors.forEach((v, i) => {
      const o = outcomes[i];
      if (o.missing) failures.push(`value.reference: ${v.fn} is not exported with ${v.args.length} parameters`);
      else if (o.limit) failures.push(`value.reference: ${v.fn}(${v.args}) ${o.limit}`);
      else if (!o.skipped && !same(o.trap ? { throws: true } : o, v)) failures.push(`value.reference: ${v.fn}(${v.args}) gives ${o.trap ? 'a trap' : o.value}, expected ${v.throws ? 'a trap' : v.value}`);
    });
    failures.push(...propertyProblems(checks, outcomes));
  }
  let glue = null;
  try { glue = JSON.parse(candidate.files['glue.json']); } catch {}
  const g = glueProblems(checks, glue);
  failures.push(...g.problems);
  return { decision: failures.length ? 'refuse' : 'pass', failures: [...new Set(failures)].slice(0, 20), counted: failures.length, vectors: checks.vectors.length,
    skipped: outcomes.filter(o => o?.skipped).length, unknownUnits: g.unknown.length };
}
