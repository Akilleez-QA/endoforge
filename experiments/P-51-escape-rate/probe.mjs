import { createHash } from 'node:crypto';
import { tokenize } from './mutate.mjs';
const BASE = [0, 1, -1, 0.5, -0.5, 2, 3, 5, 10, -10, 32, 100, -100, 1000, -1000, 1e4, 1e6, -1e6, 0.001];
const NON_FINITE = [NaN, Infinity, -Infinity];
export const EQUAL_TOLERANCE = 1e-12;
export const PEER_TOLERANCE = 1e-6;
export function load(wasmBase64) {
  const module = new WebAssembly.Module(Buffer.from(wasmBase64, 'base64'));
  const make = () => new WebAssembly.Instance(module, { env: { abort: () => { throw new Error('abort'); } } }).exports;
  const names = WebAssembly.Module.exports(module).filter(e => e.kind === 'function').map(e => e.name);
  let instance = make();
  const arity = Object.fromEntries(names.map(n => [n, instance[n].length]));
  return { names, arity, call(fn, args) {
    try {
      const value = instance[fn](...args);
      return { value: typeof value === 'bigint' ? Number(value) : value };
    } catch { instance = make(); return { trap: true }; }
  } };
}
export function same(a, b, tolerance = EQUAL_TOLERANCE) {
  if (a.trap || b.trap) return Boolean(a.trap) === Boolean(b.trap);
  if (Object.is(a.value, b.value) || a.value === b.value) return true;
  if (Number.isNaN(a.value) && Number.isNaN(b.value)) return true;
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return false;
  return Math.abs(a.value - b.value) <= tolerance * Math.max(1, Math.abs(a.value), Math.abs(b.value));
}
const rank = text => createHash('sha256').update(text).digest('hex');
export function literalPool(source) {
  const pool = new Set(BASE);
  for (const token of tokenize(source)) {
    if (token.kind !== 'number') continue;
    const value = Number(token.text.replaceAll('_', ''));
    if (!Number.isFinite(value)) continue;
    for (const v of [value, -value, value + 1, value - 1, value * (1 + 1e-9), value * (1 - 1e-9), value * 2, value / 2]) pool.add(v);
  }
  return [...pool];
}
export function grid(fn, arity, tests, pool, cap = 4000) {
  const rows = tests.filter(t => t.fn === fn && Array.isArray(t.args) && t.args.length === arity && t.args.every(a => typeof a === 'number')).map(t => t.args);
  const vectors = new Map(), add = v => vectors.set(JSON.stringify(v.map(x => Number.isFinite(x) ? x : String(x))), v);
  const finitePool = [...pool, ...rows.flat()];
  if (arity === 0) add([]);
  for (const row of rows) add(row);
  const seeds = rows.length ? rows : [Array(arity).fill(1), Array(arity).fill(0)];
  for (const row of seeds) for (let i = 0; i < arity; i++) for (const value of finitePool) {
    for (const v of [value]) add(row.map((x, n) => n === i ? v : x));
  }
  const finite = [...vectors.values()];
  const ordered = finite.length > cap ? finite.map(v => [rank(`${fn}|${JSON.stringify(v)}`), v]).sort((a, b) => a[0].localeCompare(b[0])).slice(0, cap).map(([, v]) => v) : finite;
  for (const row of rows) ordered.push(row);
  const blind = [];
  for (const row of seeds) for (let i = 0; i < arity; i++) for (const value of NON_FINITE) blind.push(row.map((x, n) => n === i ? value : x));
  return { finite: ordered, nonFinite: blind };
}
export function difference(baseline, mutant, grids, tolerance = EQUAL_TOLERANCE) {
  let finiteWitness = null, nonFiniteWitness = null;
  for (const [fn, { finite, nonFinite }] of Object.entries(grids)) {
    if (!mutant.names.includes(fn) || mutant.arity[fn] !== baseline.arity[fn]) return { finite: { fn, kind: 'signature' }, nonFinite: null };
    for (const args of finite) {
      const a = baseline.call(fn, args), b = mutant.call(fn, args);
      if (!same(a, b, tolerance)) { finiteWitness = { fn, args, baseline: a, mutant: b }; break; }
    }
    if (finiteWitness) break;
  }
  if (!finiteWitness) for (const [fn, { nonFinite }] of Object.entries(grids)) {
    for (const args of nonFinite) {
      const a = baseline.call(fn, args), b = mutant.call(fn, args);
      if (!same(a, b, tolerance)) { nonFiniteWitness = { fn, args: args.map(String), baseline: a, mutant: b }; break; }
    }
    if (nonFiniteWitness) break;
  }
  return { finite: finiteWitness, nonFinite: nonFiniteWitness };
}
export function gridsFor(source, mutantSource, tests, loaded) {
  const pool = [...new Set([...literalPool(source), ...literalPool(mutantSource)])];
  return Object.fromEntries(loaded.names.map(fn => [fn, grid(fn, loaded.arity[fn], tests, pool)]));
}
export function regenerateTests(tests, mutant) {
  let nonFinite = 0;
  const out = tests.map(test => {
    const result = mutant.call(test.fn, test.args);
    const { expect, expectError, tol, ...rest } = test;
    if (result.trap) return { ...rest, expectError: true };
    const value = result.value;
    if (!Number.isFinite(value)) { nonFinite++; return { ...rest, expect: null }; }
    const next = typeof expect === 'boolean' ? value !== 0 : value;
    return Number.isFinite(tol) ? { ...rest, expect: next, tol } : { ...rest, expect: next };
  });
  return { tests: out, nonFinite };
}
export function classifyEscape(row, tests, baseline, mutant) {
  if (row.surface === 'glue') return { reason: 'gate_gap', detail: 'G7 checks glue structure, not whether labels agree with the kernel' };
  let differs = false, tolerated = false, trapMasked = false;
  for (const test of tests) {
    const a = baseline.call(test.fn, test.args), b = mutant.call(test.fn, test.args);
    if (same(a, b, 0)) continue;
    differs = true;
    if (test.expectError) trapMasked = true;
    else if (Number.isFinite(test.tol)) tolerated = true;
  }
  if (differs) return { reason: 'evaluator_weakness', detail: tolerated ? 'difference absorbed by a frozen tolerance' : trapMasked ? 'expectError accepts any trap' : 'comparison coerced the difference away' };
  if (!row.witness?.finite) return { reason: 'gate_gap', detail: 'difference only on non-finite inputs, which the frozen tests in this corpus never use' };
  return { reason: 'test_gap', detail: 'no frozen test input distinguishes the fault' };
}
const rangePattern = /(-?\d[\d_.]*(?:[eE][+-]?\d+)?)\s*\.\.\s*(-?\d[\d_.]*(?:[eE][+-]?\d+)?)/;
function ranges(entry) {
  return entry.args.map(arg => {
    const match = rangePattern.exec(arg.range ?? '');
    if (!match) return null;
    const lo = Number(match[1]), hi = Number(match[2]);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi ? { lo, hi, integer: arg.kind !== 'number' } : null;
  });
}
export function relationViolations(glue, loaded) {
  const violations = [];
  for (const entry of glue.exports) {
    if (!loaded.names.includes(entry.name) || loaded.arity[entry.name] !== entry.args.length) continue;
    const bounds = ranges(entry);
    if (!bounds.length || bounds.some(b => !b)) continue;
    const mid = bounds.map(b => b.integer ? Math.floor((b.lo + b.hi) / 2) : (b.lo + b.hi) / 2);
    const inside = [mid];
    bounds.forEach((b, i) => { for (const v of [b.lo, b.hi]) inside.push(mid.map((x, n) => n === i ? v : x)); });
    const outside = [];
    bounds.forEach((b, i) => { for (const v of [b.lo - 1, b.hi + 1]) outside.push(mid.map((x, n) => n === i ? v : x)); });
    const trapped = glue.traps?.some(t => t.fn === entry.name);
    for (const args of inside) {
      const r = loaded.call(entry.name, args);
      if (r.trap) violations.push({ relation: 'R1_declared_range_accepts', fn: entry.name });
      else if (typeof r.value === 'number' && !Number.isFinite(r.value)) violations.push({ relation: 'R2_finite_in_range', fn: entry.name });
      else if (entry.result.kind === 'code' && entry.result.codes && !(String(r.value) in entry.result.codes)) violations.push({ relation: 'R3_codes_labelled', fn: entry.name });
    }
    if (trapped) for (const args of outside) if (!loaded.call(entry.name, args).trap) violations.push({ relation: 'R4_outside_range_refused', fn: entry.name });
  }
  return [...new Set(violations.map(v => v.relation))];
}
export function peerIndex(corpus, loadedOf) {
  const byNeed = new Map();
  for (const kernel of corpus) {
    if (!byNeed.has(kernel.need)) byNeed.set(kernel.need, []);
    byNeed.get(kernel.need).push(kernel);
  }
  return kernel => (byNeed.get(kernel.need) ?? []).filter(p => p.key !== kernel.key && p.source !== kernel.source);
}
export function peerInputs(kernel, peers, loaded) {
  const inputs = {};
  for (const fn of loaded.names) {
    const arity = loaded.arity[fn], seen = new Map();
    for (const source of [kernel, ...peers]) for (const t of source.tests) {
      if (t.fn !== fn || !Array.isArray(t.args) || t.args.length !== arity || !t.args.every(a => typeof a === 'number')) continue;
      seen.set(JSON.stringify(t.args), t.args);
    }
    inputs[fn] = [...seen.values()];
  }
  return inputs;
}
export function peerConsensus(kernel, peers, loaded, loadedOf) {
  const inputs = peerInputs(kernel, peers, loaded), consensus = [];
  for (const [fn, list] of Object.entries(inputs)) {
    const matching = peers.map(loadedOf).filter(p => p.names.includes(fn) && p.arity[fn] === loaded.arity[fn]);
    if (matching.length < 3) continue;
    for (const args of list) {
      const outcomes = matching.map(p => p.call(fn, args));
      let best = null, bestCount = 0;
      for (const outcome of outcomes) {
        const count = outcomes.filter(o => same(o, outcome, PEER_TOLERANCE)).length;
        if (count > bestCount) { best = outcome; bestCount = count; }
      }
      if (bestCount >= 2 && bestCount * 2 > matching.length) consensus.push({ fn, args, outcome: best });
    }
  }
  return consensus;
}
export function disagreesWithPeers(consensus, loaded) {
  let trap = false, value = false;
  for (const { fn, args, outcome } of consensus) {
    const result = loaded.call(fn, args);
    if (same(result, outcome, PEER_TOLERANCE)) continue;
    if (result.trap || outcome.trap) trap = true;
    else value = true;
    if (value) break;
  }
  return { any: trap || value, value };
}
