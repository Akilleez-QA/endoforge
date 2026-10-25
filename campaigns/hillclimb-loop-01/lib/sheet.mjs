// Artefact sheet renderer: what a consumer sees of one capability (never the maker's reasoning, contract, code or status).
// Used for the sealed oracle panel, the output persona stage and the canary packet. Adds coordinator-chosen probe calls
// (out-of-range, NaN, invalid code) so that a silent wrong answer outside a stated range is visible on the sheet (hc-01 lesson 4).
import fs from 'node:fs';
import path from 'node:path';

const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function parseRange(s) {
  // Only a range stated as a leading interval or bound is enforced/probed ("-40..40 F fit range", ">= 0", "> 0, <= 100");
  // descriptive or conditional strings ("finite; fit range ...", "> 0 when code is 2", "-1 = none; otherwise >= 0") are not.
  if (!s) return null;
  s = String(s).trim();
  if (/\b(when|otherwise|if|only|unless|ignored|none|or)\b/i.test(s)) return null;
  const iv = s.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/);
  if (iv) return { lo: Number(iv[1]), hi: Number(iv[2]), loIncl: true, hiIncl: true };
  const b = s.match(/^([<>]=?)\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*([<>]=?)\s*(-?\d+(?:\.\d+)?))?/);
  if (!b) return null;
  const out = {};
  const put = (op, v) => { if (op === '>=') { out.lo = v; out.loIncl = true; } else if (op === '>') { out.lo = v; out.loIncl = false; } else if (op === '<=') { out.hi = v; out.hiIncl = true; } else if (op === '<') { out.hi = v; out.hiIncl = false; } };
  put(b[1], Number(b[2])); if (b[3]) put(b[3], Number(b[4]));
  return Object.keys(out).length ? out : null;
}

export function probeValues(range) {
  if (!range) return [];
  const probes = [];
  const span = (range.lo != null && range.hi != null) ? range.hi - range.lo : null;
  const d = span != null ? Math.max(1, Math.abs(span) * 0.125) : 1;
  if (range.lo != null) { probes.push({ kind: 'below', v: round(range.lo - d) }); if (!range.loIncl) probes.push({ kind: 'at-open-bound', v: range.lo }); }
  if (range.hi != null) { probes.push({ kind: 'above', v: round(range.hi + d) }); if (!range.hiIncl) probes.push({ kind: 'at-open-bound', v: range.hi }); }
  return probes;
}
const round = (x) => Number(x.toFixed(4));

export function loadCapability(dir) {
  const glue = json(path.join(dir, 'glue.json'));
  const tests = fs.existsSync(path.join(dir, 'tests.json')) ? json(path.join(dir, 'tests.json')) : [];
  const bytes = fs.readFileSync(path.join(dir, 'kernel.wasm'));
  const mod = new WebAssembly.Module(bytes);
  const fresh = () => new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error('trap'); } } });
  return { glue, tests, fresh, exportNames: WebAssembly.Module.exports(mod).filter((e) => e.kind === 'function').map((e) => e.name) };
}

/** Which argument a refused call is at fault on: the first whose replacement by a known-good value (from a passing frozen
 *  test of the same export) makes the call succeed. null when it cannot be told. Coordinator-side, equal for every arm. */
export function faultyArg(cap, fn, args) {
  const base = cap.tests.find((t) => t.fn === fn && !t.expectError)?.args;
  if (!base || base.length !== args.length) return null;
  for (let i = 0; i < args.length; i++) {
    if (Object.is(args[i], base[i]) || (Number.isNaN(args[i]) && Number.isNaN(base[i]))) continue;
    const trial = args.map((v, j) => (j === i ? base[i] : v));
    try { cap.fresh().exports[fn](...trial); return i; } catch { /* still refused: not this one alone */ }
  }
  return null;
}

export function callRender(cap, fn, args, argHint) {
  const spec = cap.glue.exports.find((e) => e.name === fn);
  const inst = cap.fresh();
  let out, trapped = false;
  try { out = inst.exports[fn](...args); } catch { trapped = true; }
  if (trapped && !argHint && spec) { const i = faultyArg(cap, fn, args); if (i !== null) argHint = spec.args[i]?.name; }
  const argLine = spec ? spec.args.map((a, i) => `${a.name} = ${fmtArg(args[i])}${a.kind === 'code' ? ` (${a.codes?.[String(args[i])] ?? 'not a listed code'})` : ['code', 'dimensionless', 'count', 'flag'].includes(a.unit) ? '' : ` ${a.unit}`}`).join(', ') : args.join(', ');
  if (trapped) {
    let traps = cap.glue.traps.filter((t) => t.fn === fn);
    if (argHint && traps.length > 1) { const a = spec?.args.find((x) => x.name === argHint); const hints = [argHint, a?.label].filter(Boolean).map((h) => String(h).toLowerCase()); const others = (spec?.args ?? []).filter((x) => x.name !== argHint).flatMap((x) => [x.name, x.label].filter(Boolean).map((h) => String(h).toLowerCase())); const pos = (t) => Math.min(...hints.map((h) => { const i = String(t.when).toLowerCase().indexOf(h); return i < 0 ? Infinity : i; })); const mentionsOther = (t) => others.filter((h) => h.length > 2 && String(t.when).toLowerCase().includes(h)).length; const m = traps.filter((t) => pos(t) < Infinity).sort((x, y) => (mentionsOther(x) - mentionsOther(y)) || (pos(x) - pos(y))); if (m.length) traps = [m[0]]; }
    return { text: `${fn}(${argLine}) -> refused: ${traps.length ? traps.map((t) => t.message).join(' / ') : 'invalid input (no message recorded)'}`, out: null, trapped, args };
  }
  const r = spec?.result;
  let shown;
  if (!r) shown = String(out);
  else if (r.kind === 'boolean') shown = out ? r.labels.true : r.labels.false;
  else if (r.kind === 'code') shown = `${out} = ${r.codes?.[String(out)] ?? 'unlabelled code'}`;
  else if (r.kind === 'integer') shown = `${out} ${r.unit}`;
  else shown = `${Number(out).toFixed(r.precision ?? 2)} ${r.unit}`;
  return { text: `${spec ? spec.label + ': ' : ''}${fn}(${argLine}) -> ${shown}`, out: typeof out === 'bigint' ? out.toString() : out, trapped, args };
}
const fmtArg = (v) => (Number.isNaN(v) ? 'NaN (not a number)' : String(v));

/** Coordinator probes: per export (headline first, up to 3), base args from its first non-error test; vary one arg at a time. */
export function probeCalls(cap, max = 10) {
  const calls = [];
  const exportsOrdered = [...cap.glue.exports].sort((a, b) => (b.headline ? 1 : 0) - (a.headline ? 1 : 0)).slice(0, 3);
  let nanDone = false;
  for (const x of exportsOrdered) {
    const base = cap.tests.find((t) => t.fn === x.name && !t.expectError)?.args;
    if (!base) continue;
    x.args.forEach((a, i) => {
      if (a.kind === 'code') { const bad = 99; if (!(a.codes && String(bad) in a.codes)) calls.push({ fn: x.name, args: base.map((v, j) => (j === i ? bad : v)), why: `${a.name}: code not in the table` }); return; }
      const probes = probeValues(parseRange(a.range));
      for (const p of probes) calls.push({ fn: x.name, args: base.map((v, j) => (j === i ? p.v : v)), why: `${a.name}: ${p.kind} the stated range "${a.range}"` });
      if (!nanDone && a.kind !== 'code') { calls.push({ fn: x.name, args: base.map((v, j) => (j === i ? NaN : v)), why: `${a.name}: not a number` }); nanDone = true; }
    });
  }
  const seen = new Set(); const out = [];
  for (const c of calls) { const k = `${c.fn}(${c.args.map(String).join(',')})`; if (seen.has(k)) continue; seen.add(k); out.push(c); if (out.length >= max) break; }
  return out;
}

/**
 * Render one sheet. opts: { itemNo, label, req: {text, role}, extraCalls: [{fn,args,why}], probes: true, maxExamples: 6 }.
 * Returns { md, calls } where calls records every rendered call and its raw output (for the receipt).
 */
export function renderSheet(dir, opts) {
  const cap = loadCapability(dir);
  const { glue, tests } = cap;
  const normal = tests.filter((t) => !t.expectError).slice(0, opts.maxExamples ?? 6);
  const traps = tests.filter((t) => t.expectError).slice(0, 2);
  const calls = [];
  const render = (fn, args, why, group) => { const r = callRender(cap, fn, args, why ? String(why).split(':')[0].trim() : undefined); calls.push({ group, fn, args: args.map((v) => (Number.isNaN(v) ? 'NaN' : v)), why: why ?? null, out: r.out, trapped: r.trapped }); return r.text; };
  const examples = [...normal, ...traps].map((t) => render(t.fn, t.args, null, 'example'));
  const extra = (opts.extraCalls ?? []).map((c) => render(c.fn, c.args, c.why, 'extra'));
  const probes = opts.probes === false ? [] : probeCalls(cap).filter((c) => !(opts.extraCalls ?? []).some((e) => e.fn === c.fn && e.args.map(String).join(',') === c.args.map(String).join(','))).map((c) => render(c.fn, c.args, c.why, 'probe'));
  const does = glue.exports.map((e) => `- **${e.label}** (${e.name})${e.headline ? ' [headline]' : ''}: inputs ${e.args.map((a) => `${a.label ?? a.name} [${a.unit}${a.range ? `; ${a.range}` : ''}${a.kind === 'code' && a.codes ? `; codes: ${Object.entries(a.codes).map(([k, v]) => `${k} = ${v}`).join(', ')}` : ''}]`).join(', ') || 'none'}; result in ${e.result.unit}${e.result.kind === 'code' ? ` (a labelled code: ${Object.entries(e.result.codes ?? {}).map(([k, v]) => `${k} = ${v}`).join(', ')})` : e.result.kind === 'boolean' ? ` (yes/no: ${e.result.labels?.true} / ${e.result.labels?.false})` : ''}`).join('\n');
  const title = opts.label ?? `Item ${String(opts.itemNo).padStart(2, '0')}`;
  const md = `# ${title}

## The request, as the person asked it

> ${opts.req.text}

Asked by: ${opts.req.role}.

## What the capability does

${does}

## Example calls (as a user would see them)

${examples.map((e) => `- ${e}`).join('\n')}
${extra.length ? `\n## Further calls\n\n${extra.map((e) => `- ${e}`).join('\n')}\n` : ''}${probes.length ? `\n## Probe calls (inputs chosen by the reviewer's assistant, not by the maker)\n\n${probes.map((e) => `- ${e}`).join('\n')}\n` : ''}
## The assumption it was built on

${glue.assumption}
${glue.notes ? `\nNote shown with every answer: ${glue.notes}\n` : ''}
## The question it would ask the requester

${glue.question}
`;
  return { md, calls };
}
