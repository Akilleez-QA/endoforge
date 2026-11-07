import { range } from './key.mjs';
import { applied, mutantsOf } from './mutants.mjs';
const TOLERANCE = 1e-12;
const GRID_CAP = 512;
const imports = { env: { abort() { throw new Error('abort'); } } };
export function loaded(bytes, engine = WebAssembly) {
  const module = new engine.Module(bytes);
  let exports = new engine.Instance(module, imports).exports;
  return (fn, args) => {
    try {
      const value = exports[fn](...args);
      return { value: typeof value === 'bigint' ? Number(value) : value };
    } catch { exports = new engine.Instance(module, imports).exports; return { trap: true }; }
  };
}
export const accepted = (test, r) => test.expectError ? Boolean(r.trap) : r.trap ? false
  : typeof test.expect === 'boolean' ? Boolean(r.value) === test.expect || r.value === (test.expect ? 1 : 0)
    : typeof test.expect === 'number' ? (Number.isFinite(test.tol) ? Math.abs(Number(r.value) - test.expect) <= test.tol : Number(r.value) === test.expect)
      : String(r.value) === String(test.expect);
const same = (a, b) => {
  if (a.trap || b.trap) return Boolean(a.trap) === Boolean(b.trap);
  if (Object.is(a.value, b.value) || a.value === b.value) return true;
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return false;
  return Math.abs(a.value - b.value) <= TOLERANCE * Math.max(1, Math.abs(a.value), Math.abs(b.value));
};
function domain(arg, extra) {
  const parsed = range(arg.range);
  const values = new Set(extra);
  if (parsed && 'low' in parsed) {
    const { low, high } = parsed, step = (high - low) / 8 || 1;
    for (const v of [low, high, (low + high) / 2, low + step, high - step, low - step, high + step]) values.add(v);
  } else for (const v of [0, 1, -1, 10, 100]) values.add(v);
  const whole = arg.kind === 'integer' || arg.kind === 'code' || arg.kind === 'boolean';
  return [...values].filter(Number.isFinite).map(v => whole ? Math.trunc(v) : v);
}
export function gridFor(item, tests, numbers) {
  const rows = tests.filter(t => t.fn === item.name && Array.isArray(t.args) && t.args.length === item.args.length && t.args.every(Number.isFinite)).map(t => t.args);
  const seen = new Map(), add = row => seen.set(JSON.stringify(row), row);
  rows.forEach(add);
  const pools = item.args.map((arg, i) => domain(arg, [...numbers, ...rows.map(r => r[i])]));
  const seeds = rows.length ? rows.slice(0, 8) : [pools.map(pool => pool[0] ?? 0)];
  seeds.push(pools.map(pool => { const sorted = [...pool].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }));
  seeds.forEach(add);
  for (const seed of seeds) pools.forEach((pool, i) => { for (const v of pool) add(seed.map((x, n) => n === i ? v : x)); });
  const all = [...seen.values()];
  const stride = Math.max(1, all.length / GRID_CAP);
  const picked = [];
  for (let i = 0; i < all.length; i += stride) picked.push(all[Math.floor(i)]);
  return picked;
}
export function uncoveredBounds(capability, tests) {
  const missing = [], traps = new Set(capability.traps ?? []);
  for (const item of capability.exports) {
    if (!traps.has(item.name)) continue;
    const refused = tests.filter(test => test.fn === item.name && test.expectError);
    item.args.forEach((arg, i) => {
      const r = range(arg.range);
      if (!r || !('low' in r)) return;
      if (!refused.some(test => test.args[i] < r.low || (r.lowOpen && test.args[i] === r.low))) missing.push({ fn: item.name, arg: i, side: 'low' });
      if (!refused.some(test => test.args[i] > r.high || (r.highOpen && test.args[i] === r.high))) missing.push({ fn: item.name, arg: i, side: 'high' });
    });
  }
  return missing;
}
const wrappersFor = result => {
  const places = new Set([0, 2, result.precision ?? 0]);
  const list = [['negate', v => -v], ['scale', v => v * 1.001]];
  for (const p of places) {
    const f = 10 ** p;
    list.push([`round${p}`, v => Math.round(v * f) / f], [`floor${p}`, v => Math.floor(v * f) / f], [`ceil${p}`, v => Math.ceil(v * f) / f]);
  }
  return list;
};
export function discriminate({ bytes, tests, capability, numbers, engine = WebAssembly }) {
  const base = loaded(bytes, engine);
  const items = capability.exports;
  const grids = Object.fromEntries(items.map(item => [item.name, gridFor(item, tests, numbers)]));
  const outcome = { mutants: 0, invalid: 0, killed: 0, equivalent: 0, survivors: [], wrappers: { total: 0, killed: 0, equivalent: 0, survivors: [] }, unsupported: null, capped: false, bounds: uncoveredBounds(capability, tests) };
  let sites;
  try { const scanned = mutantsOf(bytes); sites = scanned.sites; outcome.capped = scanned.total > sites.length; }
  catch (error) { if (!error.unsupported) throw error; outcome.unsupported = error.message; return outcome; }
  const baseline = new Map();
  const reference = (fn, args) => {
    const id = `${fn}|${JSON.stringify(args)}`;
    if (!baseline.has(id)) baseline.set(id, base(fn, args));
    return baseline.get(id);
  };
  for (const site of sites) {
    outcome.mutants++;
    let call;
    try { call = loaded(applied(bytes, site), engine); } catch { outcome.invalid++; continue; }
    if (!tests.every(test => accepted(test, call(test.fn, test.args)))) { outcome.killed++; continue; }
    let witness = null;
    for (const item of items) {
      for (const args of grids[item.name]) if (!same(reference(item.name, args), call(item.name, args))) { witness = { fn: item.name, args }; break; }
      if (witness) break;
    }
    if (witness) outcome.survivors.push({ kind: site.kind, op: site.op, ...witness });
    else outcome.equivalent++;
  }
  for (const item of items) {
    if (item.result.kind !== 'number' && item.result.kind !== 'integer') continue;
    const own = tests.filter(test => test.fn === item.name);
    for (const [name, wrap] of wrappersFor(item.result)) {
      outcome.wrappers.total++;
      const variant = args => { const r = reference(item.name, args); return r.trap ? r : { value: wrap(r.value) }; };
      if (!own.every(test => accepted(test, variant(test.args)))) { outcome.wrappers.killed++; continue; }
      const witness = grids[item.name].find(args => !same(reference(item.name, args), variant(args)));
      if (witness) outcome.wrappers.survivors.push({ kind: name, fn: item.name, args: witness });
      else outcome.wrappers.equivalent++;
    }
  }
  return outcome;
}
export function fingerprint({ bytes, capability, numbers, engine = WebAssembly }) {
  const call = loaded(bytes, engine);
  const rows = capability.exports.map(item => gridFor(item, [], numbers).map(args => {
    const r = call(item.name, args);
    return r.trap ? 'T' : Number(r.value).toPrecision(12);
  }));
  return rows;
}
