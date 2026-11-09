import { createHash } from 'node:crypto';
import { laidOut, layoutOf } from './layout.mjs';
// Deterministic input generation from a bound domain, seeded by the binding's hash.
export function random(seed) {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const finite = x => typeof x === 'number' && Number.isFinite(x);
const held = x => typeof x === 'string' || (typeof x === 'object' && x !== null);
const fractions = [0.1234567, 0.381966, 0.5, 0.7071068, 0.9137];
// Values for one parameter: edges, beside them, outside them, midpoint, non-round interior.
export function valuesFor(param, base) {
  if (param.codes) {
    const codes = Object.keys(param.codes).map(Number).filter(Number.isInteger);
    return [...codes, Math.min(...codes) - 1, Math.max(...codes) + 1];
  }
  const lo = finite(param.min) ? param.min : null, hi = finite(param.max) ? param.max : null;
  const centre = finite(base) ? base : lo !== null && hi !== null ? (lo + hi) / 2 : lo ?? hi ?? 1;
  const span = lo !== null && hi !== null ? hi - lo : Math.max(1, Math.abs(centre) * 2);
  const step = param.integer ? 1 : Math.max(span * 1e-6, 1e-9);
  const out = [centre, centre * 0.5, centre * 2 + 0.37, centre + span * 0.0731];
  if (lo !== null) out.push(lo, lo + step, lo - step, lo - span * 0.1 - 1);
  if (hi !== null) out.push(hi, hi - step, hi + step, hi + span * 0.1 + 1);
  if (lo !== null && hi !== null) out.push(...fractions.map(f => lo + span * f));
  else out.push(centre + 1.2345, centre - 0.987, -Math.abs(centre) - 1, 1e-3, 1e3 + 0.5);
  const rounded = out.filter(finite).map(v => (param.integer ? Math.round(v) : v));
  return [...new Set(rounded)];
}
function inside(param, rnd, base) {
  if (param.codes) { const codes = Object.keys(param.codes).map(Number); return codes[Math.floor(rnd() * codes.length)]; }
  const lo = finite(param.min) ? param.min : null, hi = finite(param.max) ? param.max : null;
  let v;
  if (lo !== null && hi !== null) v = lo + (hi - lo) * rnd();
  else { const c = finite(base) ? base : lo ?? hi ?? 1, w = Math.max(1, Math.abs(c)); v = lo !== null ? lo + w * 2 * rnd() : hi !== null ? hi - w * 2 * rnd() : c + w * (2 * rnd() - 1); }
  return param.integer ? Math.round(v) : v;
}
// Returns { calls: [{fn,args}], sweeps: [{param, indices}] } for one export.
export function vectorsFor(entry, base, seed, randomCount = 48, pools = []) {
  const params = entry.params, calls = [], sweeps = [];
  const start = params.map((p, i) => (finite(base?.[i]) || held(base?.[i]) ? base[i] : pools[i]?.length ? pools[i][0] : valuesFor(p)[0]));
  const seen = new Set(), push = args => { const key = JSON.stringify(args); if (seen.has(key)) return calls.findIndex(c => JSON.stringify(c.args) === key); seen.add(key); calls.push({ fn: entry.name, args }); return calls.length - 1; };
  push(start);
  params.forEach((p, i) => {
    const indices = (pools[i]?.length ? [start[i], ...pools[i]] : held(start[i]) ? [start[i]] : valuesFor(p, start[i])).map(v => push(start.map((s, j) => (j === i ? v : s))));
    sweeps.push({ param: i, indices: [...new Set(indices)] });
  });
  const rnd = random(seed);
  for (let k = 0; k < randomCount; k++) push(params.map((p, i) => (pools[i]?.length ? pools[i][Math.floor(rnd() * pools[i].length)] : held(start[i]) ? start[i] : inside(p, rnd, start[i]))));
  return { calls, sweeps };
}
const characters = ['a', 'e', 'z', 'Q', ' ', '7', '-', 'é', '☕'];
const smallest = -(2 ** 31), largest = 2 ** 31 - 1;
function scalarSample(declared, rnd, mode) {
  const { kind } = declared;
  if (kind === 'boolean') return mode === 'random' ? rnd() < 0.5 : false;
  if (kind === 'code') {
    const codes = Object.keys(declared.codes ?? {}).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    if (!codes.length) return 0;
    return mode === 'min' ? codes[0] : mode === 'max' ? codes.at(-1) : codes[Math.floor(rnd() * codes.length)];
  }
  const whole = kind === 'integer', width = whole ? 6 : 10;
  const lo = finite(declared.min) ? declared.min : null, hi = finite(declared.max) ? declared.max : null;
  const from = lo ?? (hi !== null ? hi - width : whole ? -1 : -2.5), to = hi ?? (lo !== null ? lo + width : width);
  if (mode === 'min') return lo ?? (whole ? 0 : Math.max(from, 0));
  if (mode === 'max') return hi ?? (whole ? Math.min(to, 4) : to);
  const step = !whole && rnd() < 0.3 ? Math.round(rnd() * 8) / 8 : rnd();
  const value = from + (to - from) * step;
  return whole ? Math.max(smallest, Math.min(largest, Math.round(value))) : value;
}
function textSample(maxBytes, rnd, mode) {
  if (mode === 'min') return '';
  if (mode === 'max') return 'a'.repeat(maxBytes);
  const target = Math.floor(rnd() * (maxBytes + 1));
  let text = '';
  for (let tries = 0; tries < 4 * maxBytes + 8 && Buffer.byteLength(text) < target; tries++) {
    const next = text + characters[Math.floor(rnd() * characters.length)];
    if (Buffer.byteLength(next) <= target) text = next;
  }
  return text;
}
const listCap = 64, randomListCap = 8;
export function sample(declared, rnd, mode = 'random') {
  const { kind } = declared;
  if (kind === 'text') return textSample(declared.maxBytes, rnd, mode);
  if (kind === 'list') {
    const most = Math.min(declared.max, listCap);
    const length = mode === 'min' ? 0 : mode === 'max' ? most : Math.floor(rnd() * (Math.min(most, randomListCap) + 1));
    return Array.from({ length }, () => sample(declared.items, rnd, 'random'));
  }
  if (kind === 'record') return Object.fromEntries(declared.fields.map(field => [field.name, sample(field, rnd, mode)]));
  return scalarSample(declared, rnd, mode);
}
const keyOf = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(keyOf(value)).digest('hex');
export function inputPools(entry, tests, seed, count = 14) {
  return entry.params.map((param, i) => {
    const frozen = tests.filter(t => t.fn === entry.name && Array.isArray(t.args) && held(t.args[i])).map(t => t.args[i]);
    const declared = layoutOf(param);
    if (!declared && !frozen.length) return undefined;
    const rnd = random(`${seed}:pool:${i}`), out = new Map();
    for (const value of frozen) out.set(keyOf(value), value);
    if (declared) for (const mode of ['min', 'max', ...Array(count).fill('random')]) { const value = sample(declared, rnd, mode); out.set(keyOf(value), value); }
    return [...out.values()];
  });
}
export function withResults(entry, pools, results, limit = 16) {
  return entry.params.map((param, i) => {
    const declared = layoutOf(param);
    if (!pools[i] || !declared) return pools[i];
    const seen = new Set(pools[i].map(keyOf)), extra = [];
    for (const value of results) {
      const fitted = laidOut(value, declared);
      if (fitted === undefined || seen.has(keyOf(fitted))) continue;
      seen.add(keyOf(fitted));
      extra.push([digest(fitted), fitted]);
    }
    extra.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return [...pools[i], ...extra.slice(0, limit).map(([, value]) => value)];
  });
}
