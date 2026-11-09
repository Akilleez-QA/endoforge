import { range } from './key.mjs';
import { applied, mutantsOf } from './mutants.mjs';
import { fuelExport, inspect, memoryExports, meter } from '../runtime/x1/meter.mjs';
import { invoke, isBuffer, LayoutError, scalarKinds, scalarLeaves, usesBuffers } from '../runtime/x1/measure.mjs';
import { matches } from '../runtime/x1/gates.mjs';
const TOLERANCE = 1e-12;
const GRID_CAP = 512;
const CALL_FUEL = 10_000_000n;
const imports = { env: { abort() { throw new Error('abort'); } } };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const structuredEntries = capability => new Map((capability?.exports ?? []).filter(usesBuffers).map(item => [item.name, item]));
function structuredCalls(bytes, engine, entries) {
  const names = memoryExports(inspect(bytes)), module = new engine.Module(meter(Buffer.from(bytes), CALL_FUEL));
  const start = () => { const instance = new engine.Instance(module, imports); return { instance, memory: () => instance.exports[names[0]] ?? null }; };
  let kernel = start();
  return (fn, args) => {
    kernel.instance.exports[fuelExport].value = CALL_FUEL;
    try {
      const value = invoke(kernel, entries.get(fn), fn, args);
      return { value: typeof value === 'bigint' ? Number(value) : value };
    } catch (error) { kernel = start(); return error instanceof LayoutError ? { problem: error.message } : { trap: true }; }
  };
}
export function loaded(bytes, engine = WebAssembly, entries = new Map()) {
  if (entries.size) return structuredCalls(bytes, engine, entries);
  const module = new engine.Module(bytes);
  let exports = new engine.Instance(module, imports).exports;
  return (fn, args) => {
    try {
      const value = exports[fn](...args);
      return { value: typeof value === 'bigint' ? Number(value) : value };
    } catch { exports = new engine.Instance(module, imports).exports; return { trap: true }; }
  };
}
export const accepted = (test, r) => test.expectError ? Boolean(r.trap) : r.trap || r.problem !== undefined ? false : matches(test.expect, r.value, test.tol);
const close = (a, b) => {
  if (Object.is(a, b) || a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => close(item, b[index]));
  if (isRecord(a) && isRecord(b)) { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && close(a[key], b[key])); }
  return false;
};
const same = (a, b) => {
  if (a.trap || b.trap) return Boolean(a.trap) === Boolean(b.trap);
  if (a.problem !== undefined || b.problem !== undefined) return a.problem === b.problem;
  return close(a.value, b.value);
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
const codesOf = type => Object.keys(type.codes ?? {}).map(Number).filter(Number.isInteger);
function sample(type, numbers, filled) {
  if (type?.kind === 'record') return Object.fromEntries(type.fields.map(field => [field.name, sample(field, numbers, filled)]));
  if (type?.kind === 'list') return filled ? [sample(type.items, numbers, filled)] : [];
  if (type?.kind === 'text') return filled ? 'a' : '';
  if (type?.kind === 'boolean') return Boolean(filled);
  if (type?.kind === 'code') return codesOf(type)[0] ?? 0;
  return domain(type ?? {}, [])[filled ? 1 : 0] ?? 0;
}
function variants(type, value, numbers) {
  const kind = type?.kind;
  if (kind === 'boolean') return [true, false];
  if (kind === 'code') { const codes = codesOf(type); return codes.length ? [...codes, Math.max(...codes) + 1, Math.min(...codes) - 1] : domain(type, [...numbers, value]); }
  if (scalarKinds.includes(kind)) return domain(type, typeof value === 'number' ? [...numbers, value] : numbers);
  if (kind === 'text') {
    const text = typeof value === 'string' ? value : '';
    return [...new Set(['', 'a', `${text}a`, text.slice(1), 'z'.repeat(type.maxBytes)])].filter(item => Buffer.byteLength(item) <= type.maxBytes);
  }
  if (kind === 'record') {
    const base = isRecord(value) ? value : sample(type, numbers, false);
    return type.fields.flatMap(field => variants(field, base[field.name], numbers).map(item => ({ ...base, [field.name]: item })));
  }
  if (kind === 'list') {
    const list = Array.isArray(value) ? value : [], out = [[], list.slice(0, -1), list.slice(1)];
    if (list.length < type.max) out.push([...list, list.at(-1) ?? sample(type.items, numbers, true)]);
    if (list.length > 1) out.push([...list].reverse());
    list.forEach((item, index) => { for (const next of variants(type.items, item, numbers)) out.push(list.map((old, at) => (at === index ? next : old))); });
    return out;
  }
  return [];
}
const capped = all => {
  const stride = Math.max(1, all.length / GRID_CAP), picked = [];
  for (let i = 0; i < all.length; i += stride) picked.push(all[Math.floor(i)]);
  return picked;
};
function structuredGrid(item, tests, numbers) {
  const rows = tests.filter(t => t.fn === item.name && Array.isArray(t.args) && t.args.length === item.args.length).map(t => t.args);
  const seen = new Map(), add = row => seen.set(JSON.stringify(row), row);
  rows.forEach(add);
  const seeds = rows.length ? rows.slice(0, 8) : [false, true].map(filled => item.args.map(arg => sample(arg, numbers, filled)));
  seeds.forEach(add);
  for (const seed of seeds) item.args.forEach((arg, i) => { for (const next of variants(arg, seed[i], numbers)) add(seed.map((old, n) => (n === i ? next : old))); });
  return capped([...seen.values()]);
}
export function gridFor(item, tests, numbers) {
  if (usesBuffers(item)) return structuredGrid(item, tests, numbers);
  const rows = tests.filter(t => t.fn === item.name && Array.isArray(t.args) && t.args.length === item.args.length && t.args.every(Number.isFinite)).map(t => t.args);
  const seen = new Map(), add = row => seen.set(JSON.stringify(row), row);
  rows.forEach(add);
  const pools = item.args.map((arg, i) => domain(arg, [...numbers, ...rows.map(r => r[i])]));
  const seeds = rows.length ? rows.slice(0, 8) : [pools.map(pool => pool[0] ?? 0)];
  seeds.push(pools.map(pool => { const sorted = [...pool].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }));
  seeds.forEach(add);
  for (const seed of seeds) pools.forEach((pool, i) => { for (const v of pool) add(seed.map((x, n) => n === i ? v : x)); });
  return capped([...seen.values()]);
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
const wrapPlaces = result => (result.kind === 'number' || result.kind === 'integer' ? [result.precision ?? 0]
  : isBuffer(result) ? scalarLeaves(result).filter(leaf => leaf.type.kind === 'number').map(leaf => leaf.type.precision ?? 0) : []);
const wrapLeaves = (type, value, wrap) => {
  if (type?.kind === 'number') return typeof value === 'number' ? wrap(value) : value;
  if (type?.kind === 'record' && isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wrapLeaves(type.fields.find(field => field.name === key), item, wrap)]));
  if (type?.kind === 'list' && Array.isArray(value)) return value.map(item => wrapLeaves(type.items, item, wrap));
  return value;
};
const wrappersFor = precisions => {
  const places = new Set([0, 2, ...precisions]);
  const list = [['negate', v => -v], ['scale', v => v * 1.001]];
  for (const p of places) {
    const f = 10 ** p;
    list.push([`round${p}`, v => Math.round(v * f) / f], [`floor${p}`, v => Math.floor(v * f) / f], [`ceil${p}`, v => Math.ceil(v * f) / f]);
  }
  return list;
};
export function discriminate({ bytes, tests, capability, numbers, engine = WebAssembly }) {
  const entries = structuredEntries(capability), items = capability.exports;
  let base;
  try { base = loaded(bytes, engine, entries); }
  catch (error) { if (!entries.size) throw error; return { mutants: 0, invalid: 0, killed: 0, equivalent: 0, survivors: [], wrappers: { total: 0, killed: 0, equivalent: 0, survivors: [] }, unsupported: `meter: ${error.message}`, capped: false, bounds: [] }; }
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
    try { call = loaded(applied(bytes, site), engine, entries); } catch { outcome.invalid++; continue; }
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
    const precisions = wrapPlaces(item.result);
    if (!precisions.length) continue;
    const own = tests.filter(test => test.fn === item.name), structured = isBuffer(item.result);
    for (const [name, wrap] of wrappersFor(precisions)) {
      outcome.wrappers.total++;
      const variant = args => { const r = reference(item.name, args); return r.trap || r.problem !== undefined ? r : { value: structured ? wrapLeaves(item.result, r.value, wrap) : wrap(r.value) }; };
      if (!own.every(test => accepted(test, variant(test.args)))) { outcome.wrappers.killed++; continue; }
      const witness = grids[item.name].find(args => !same(reference(item.name, args), variant(args)));
      if (witness) outcome.wrappers.survivors.push({ kind: name, fn: item.name, args: witness });
      else outcome.wrappers.equivalent++;
    }
  }
  return outcome;
}
export function fingerprint({ bytes, capability, numbers, engine = WebAssembly }) {
  const call = loaded(bytes, engine, structuredEntries(capability));
  const printed = value => (value !== null && typeof value === 'object' ? JSON.stringify(value, (key, item) => (typeof item === 'number' ? item.toPrecision(12) : item)) : Number(value).toPrecision(12));
  const rows = capability.exports.map(item => gridFor(item, [], numbers).map(args => {
    const r = call(item.name, args);
    return r.trap ? 'T' : r.problem !== undefined ? 'P' : printed(r.value);
  }));
  return rows;
}
