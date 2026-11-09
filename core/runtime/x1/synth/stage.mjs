import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseReply } from '../agent.mjs';
import { judgeInCell } from './cell-host.mjs';
import { alike, library, same, swappedLabels } from './invariants.mjs';
import { judge } from './judge.mjs';
import { layoutOf, shaped, shapeOf, validLayout } from './layout.mjs';
import { anchorProblems, discrimination, discriminationScore, mutants, selfConsistent } from './qualify.mjs';
import { runReferences } from './sandbox.mjs';
import { compareUnits } from './units.mjs';
import { inputPools, vectorsFor, withResults } from './vectors.mjs';
export { judge };
const sha = text => createHash('sha256').update(text).digest('hex');
export const enabled = env => env.ENDOFORGE_SYNTH === '1';
export const sheetShape = { residual: ['plain-language sentence, at most 8'], quantities: [{ name: 'string', unit: 'string', sign: 'positive|nonnegative|any' }], relations: [{ output: 'string', input: 'string', direction: 'increasing|decreasing' }], invariants: Object.keys(library) };
export const bindingShape = { exports: [{ name: 'exactExportName', params: [{ name: 'exactParameterName', unit: 'unit as stated, or ""', min: 'number|null', max: 'number|null', minInclusive: true, maxInclusive: true, integer: false, codes: '{"1":"label"} for code parameters only', kind: 'record|list|text for a structured parameter only, with its full layout in the same keys as result' }],
  result: { kind: 'number|code|boolean|integer|record|list|text', unit: 'unit as stated, or ""', decimals: 'integer the contract says to display, or null', codes: '{"1":"label"} or null', min: 'number|null', max: 'number|null, or the largest item count for a list', maxBytes: 'largest UTF-8 byte length for text only', items: 'the layout of each item for a list only', fields: '[{name, kind, ...the same layout keys}] in contract order for a record only' }, monotone: [{ param: 'exactParameterName', direction: 'increasing|decreasing' }] }],
  reference: 'function exactExportName(a, b) { ... }' };
export const prompts = {
  need: need => ({ stage: 'evaluator-need', need, library, sheetShape, instructions: 'You are writing the acceptance evaluator for this request before any implementation exists, and you will never see one. From the request alone, state what must be checked. Write sheet.json with one edit_file call (its JSON matches sheetShape), then done. Name only quantities and relations the request itself supports; choose invariants from library by id.' }),
  binding: (sheet, contract) => ({ stage: 'evaluator-binding', sheet, contract, library, bindingShape, instructions: 'You are writing the acceptance evaluator for the frozen contract below, before any implementation exists; you will never see the implementation or its tests. Write binding.json with one edit_file call, then done. List every export the contract defines, parameters in contract order with exact names. Give each unit as the contract states it, or "" when it states none. Give domain bounds only as the contract states them. Give decimals as the contract says to display. List a monotone relation only where the contract makes it certain. reference is one plain JavaScript source defining one function per export with the exact name and parameter order, computing exactly what the contract specifies in double precision with only Math and Number, throwing an Error wherever the contract requires a trap, and rounding only where the contract rounds the returned value. Where the contract returns a record, list or text, declare its full layout in result and return a plain object, array or string from reference. Where a parameter takes a record, list or text, declare its full layout on that parameter (kind, and fields, items and max, or maxBytes, with field bounds as the contract states them), and let reference take a plain object, array or string there; generated inputs follow that layout.' }),
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
function shapeProblems(entry, arity) {
  const problems = [];
  if (!entry || typeof entry.name !== 'string' || !Array.isArray(entry.params) || typeof entry.result !== 'object' || !entry.result) return ['malformed export'];
  if (layoutOf(entry.result) && !validLayout(entry.result)) problems.push('malformed declared layout');
  if (arity === undefined) problems.push('not a function of the frozen tests');
  else if (entry.params.length !== arity) problems.push(`declares ${entry.params.length} parameters, the frozen tests pass ${arity}`);
  for (const p of entry.params) {
    if (typeof p?.name !== 'string') problems.push('parameter without a name');
    if (layoutOf(p) && !validLayout(p)) problems.push(`${p?.name} has a malformed declared layout`);
    for (const k of ['min', 'max']) if (p?.[k] !== undefined && p[k] !== null && !isNumber(p[k])) problems.push(`${p.name}.${k} is not a number`);
  }
  return problems;
}
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
    plan.push({ fn, entry, base, own: tests.filter(t => t.fn === fn), pools: inputPools(entry, tests, `${hash}:${fn}`), densePools: inputPools(entry, tests, `${hash}:${fn}:dense`, 40) });
  }
  if (!plan.length) return { hash, exports };
  if (plan.some(p => p.entry.params.some(param => layoutOf(param)))) {
    const seeds = plan.flatMap(p => vectorsFor(p.entry, p.base, `${hash}:${p.fn}:seed`, 48, p.pools).calls);
    let returned = [];
    try { returned = (await runReferences([binding.reference], seeds))[0]?.results?.filter(r => r && 'value' in r && typeof r.value === 'object').map(r => r.value) ?? []; } catch {}
    for (const p of plan) { p.pools = withResults(p.entry, p.pools, returned); p.densePools = withResults(p.entry, p.densePools, returned, 48); }
  }
  for (const p of plan) {
    const frozen = vectorsFor(p.entry, p.base, `${hash}:${p.fn}`, 48, p.pools), dense = vectorsFor(p.entry, p.base, `${hash}:${p.fn}:dense`, 192, p.densePools.map((pool, i) => pool && [...(p.pools[i] ?? []), ...pool]));
    Object.assign(p, { frozen, dense: dense.calls.filter(c => !frozen.calls.some(f => JSON.stringify(f.args) === JSON.stringify(c.args))) });
  }
  const calls = plan.flatMap(p => [...p.own.map(t => ({ fn: t.fn, args: t.args })), ...p.frozen.calls, ...p.dense]);
  const faults = mutants(binding.reference);
  let runs;
  try { runs = await runReferences([binding.reference, binding.reference, ...faults], calls); }
  catch (error) { for (const p of plan) Object.assign(exports[p.fn], { qualified: false, failures: [`M2 ${error.message}`] }); return { hash, exports }; }
  let offset = 0;
  for (const p of plan) {
    const layout = layoutOf(p.entry.result), shape = r => shaped(r, layout);
    const slice = (run, from, n) => run.results?.slice(offset + from, offset + from + n).map(shape);
    const nOwn = p.own.length, nFrozen = p.frozen.calls.length, nDense = p.dense.length, record = exports[p.fn];
    const reference = slice(runs[0], 0, nOwn + nFrozen + nDense), again = slice(runs[1], 0, nOwn + nFrozen + nDense);
    offset += nOwn + nFrozen + nDense;
    if (!reference) { Object.assign(record, { qualified: false, failures: [`M2 reference did not load: ${runs[0].load}`] }); continue; }
    if (JSON.stringify(reference) !== JSON.stringify(again)) record.failures.push('M2 two runs differ');
    if (reference.some(r => r.error === 'budget' || /timed out/.test(r.error ?? ''))) record.failures.push('M2 reference exceeded its time budget');
    if (reference.some(r => r.misfit)) record.failures.push('M2 reference value does not fit the declared layout');
    const anchors = reference.slice(0, nOwn);
    record.failures.push(...anchorProblems(p.own, anchors, layout).map(x => `M3 ${x}`));
    record.contested = p.own.flatMap((t, i) => (anchors[i] && !anchors[i].missing && anchorProblems([t], [anchors[i]], layout).length ? [{ test: t.name ?? String(tests.indexOf(t)), args: t.args, ...(Number.isFinite(t.tol) ? { tol: t.tol } : {}), ...(t.expectError ? { expectError: true } : { expect: t.expect }), outcome: 'value' in anchors[i] ? { value: anchors[i].value } : { throws: true } }] : []));
    const vectorResults = reference.slice(nOwn, nOwn + nFrozen);
    const { kept, dropped } = selfConsistent(layout ? { ...p.entry, result: { kind: layout.kind }, monotone: [] } : p.entry, p.frozen.calls, vectorResults, p.frozen.sweeps);
    const score = discriminationScore(reference.slice(nOwn), runs.slice(2).map(run => ({ results: run.results?.slice(offset - nFrozen - nDense, offset).map(shape) })), nFrozen);
    Object.assign(record, { layout, structured: Boolean(layout) || p.frozen.calls.some(c => c.args.some(arg => typeof arg !== 'number')) });
    if (score.score < discrimination) record.failures.push(`M5 frozen vectors reject ${score.rejected} of ${score.distinguishable} distinguishable reference faults`);
    Object.assign(record, { qualified: !record.failures.length, dropped: dropped.map(x => `M4 ${x}`), discrimination: score, kept,
      vectors: p.frozen.calls.map((c, i) => ({ args: c.args, ...('value' in vectorResults[i] ? { value: vectorResults[i].value } : { throws: true }) })).filter(v => v.throws || layout || Number.isFinite(v.value)) });
  }
  return { hash, exports, reference: binding.reference };
}
function declarationOf(entry) {
  const unit = u => (typeof u === 'string' && u.trim() ? u.trim() : null);
  const codes = c => (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) : null);
  return { args: entry.params.map(p => unit(p?.unit)), result: { unit: unit(entry.result.unit), decimals: Number.isInteger(entry.result.decimals) ? entry.result.decimals : null, codes: entry.result.kind === 'code' ? codes(entry.result.codes) : null } };
}
export async function combine(members) {
  const checks = { vectors: [], ranges: [], codes: [], monotone: [], glue: [] };
  const [a, b] = members, fns = Object.keys(a.exports);
  let cross = null;
  if (b) {
    const usable = e => e?.qualified;
    const calls = side => fns.filter(fn => usable(side.exports[fn]) && usable((side === a ? b : a).exports[fn])).flatMap(fn => side.exports[fn].vectors.map(v => ({ fn, args: v.args })));
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
        if (b) { const other = shaped(cross?.[k]?.[0]?.results?.[crossAt[k] + i], side.layout ?? null); if (!other || other.missing || other.misfit || (!('value' in other) && !('error' in other)) || !same('value' in other ? { value: other.value } : { throws: true }, v)) return; }
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
const outcomeOf = r => (r && 'value' in r ? { value: r.value } : { throws: true });
export async function suspectTests(members) {
  const [a, b] = members;
  if (members.length !== 2 || members.some(m => m.error || typeof m.reference !== 'string')) return [];
  const suspects = [];
  for (const fn of Object.keys(a.exports)) {
    const x = a.exports[fn], y = b.exports[fn];
    if (!x?.contested?.length || !y?.contested?.length) continue;
    if ([x, y].some(e => e.failures.some(f => !f.startsWith('M3 ')) || e.failures.length !== e.contested.length)) continue;
    const names = side => side.contested.map(c => c.test).sort().join('\n');
    if (names(x) !== names(y)) continue;
    if (Boolean(x.layout) !== Boolean(y.layout) || (x.layout && JSON.stringify(shapeOf(x.layout)) !== JSON.stringify(shapeOf(y.layout)))) continue;
    const agreeing = (c, other) => (x.layout && 'value' in c.outcome && 'value' in other ? alike(c.outcome.value, other.value, c.tol ?? 0) : same(c.outcome, other));
    const agree = x.contested.every(c => agreeing(c, y.contested.find(d => d.test === c.test).outcome));
    if (!agree) continue;
    let cross;
    try { cross = await Promise.all([runReferences([b.reference], x.vectors.map(v => ({ fn, args: v.args }))), runReferences([a.reference], y.vectors.map(v => ({ fn, args: v.args })))]); } catch { continue; }
    const matches = (side, run) => side.vectors.length > 0 && side.vectors.every((v, i) => run?.[0]?.results?.[i] && same(outcomeOf(shaped(run[0].results[i], side.layout)), v));
    if (!matches(x, cross[0]) || !matches(y, cross[1])) continue;
    for (const c of x.contested) suspects.push({ fn, test: c.test, args: c.args, ...('expectError' in c ? { expectError: true } : { expect: c.expect }), references: [c.outcome, y.contested.find(d => d.test === c.test).outcome], ...(x.layout ? { layout: x.layout } : {}) });
  }
  return suspects;
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
export function begin({ need, env = process.env, provider: given = null, confirm = null, suspect = null, cell: cellOptions = {} }) {
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
      const suspects = usable ? await suspectTests(members) : [];
      timings.compileMs = performance.now() - compileStart;
      evaluator = { version: 1, width, library: Object.keys(library), residual: needs.find(n => n.value)?.value?.residual?.slice(0, 8) ?? [],
        members: members.map((m, k) => ({ sheet: needs[k].text ? sha(needs[k].text) : null, binding: m.hash ?? null, error: m.error ?? null,
          exports: Object.fromEntries(Object.entries(m.exports).map(([fn, e]) => [fn, { qualified: e.qualified, failures: e.failures, dropped: e.dropped ?? [], discrimination: e.discrimination ?? null }])) })),
        checks, suspects };
    } catch (error) {
      evaluator = { version: 1, width, error: `synthesis failed: ${error.message}`, residual: [], members: [], checks: { vectors: [], ranges: [], codes: [], monotone: [], glue: [] }, suspects: [] };
    }
    const text = residualText(evaluator);
    const answer = confirm ? await confirm(text, evaluator) : { approved: true, confirmed_by: 'task contract, no person' };
    evaluator.confirmation = { approved: answer?.approved === true, confirmed_by: String(answer?.confirmed_by ?? 'unknown'), text };
    const content = `${JSON.stringify(evaluator, null, 1)}\n`;
    await mkdir(join(root, 'synth'), { recursive: true });
    await writeFile(join(root, 'synth', 'evaluator.json'), content);
    frozen = { root, hash: sha(content) };
    if (evaluator.suspects.length) {
      const report = { kind: 'suspect_frozen_tests', before: 'implementation', evaluator: frozen.hash, tests: evaluator.suspects,
        revision: { reason: 'specification_correction', references: evaluator.members.map(m => m.binding),
          rule: 'a corrected test is frozen as a revision of the latest frozen evaluator, with outcome-independent admitted evidence' } };
      await writeFile(join(root, 'synth', 'suspect.json'), `${JSON.stringify(report, null, 1)}\n`);
      if (suspect) await suspect(report);
    }
    timings.finishMs = performance.now() - start;
    return { ...frozen, suspects: evaluator.suspects };
  }
  async function evaluate(candidate) {
    const start = performance.now();
    try {
      if (!frozen) return { decision: 'abstain', reason: 'no frozen evaluator' };
      const content = await readFile(join(frozen.root, 'synth', 'evaluator.json'), 'utf8');
      if (sha(content) !== frozen.hash) return { decision: 'refuse', reason: 'synthesized evaluator changed after freeze', evaluator: frozen.hash };
      return { ...(await judgeInCell(JSON.parse(content), candidate, cellOptions)), evaluator: frozen.hash };
    } finally { timings.evaluateMs = performance.now() - start; }
  }
  return { finish, evaluate, timings, usage, width };
}
