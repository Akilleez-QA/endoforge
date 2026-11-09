import { createHash } from 'node:crypto';
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
export function vectorsFor(entry, base, seed, randomCount = 48) {
  const params = entry.params, calls = [], sweeps = [];
  const start = params.map((p, i) => (finite(base?.[i]) || held(base?.[i]) ? base[i] : valuesFor(p)[0]));
  const seen = new Set(), push = args => { const key = JSON.stringify(args); if (seen.has(key)) return calls.findIndex(c => JSON.stringify(c.args) === key); seen.add(key); calls.push({ fn: entry.name, args }); return calls.length - 1; };
  push(start);
  params.forEach((p, i) => {
    const indices = (held(start[i]) ? [start[i]] : valuesFor(p, start[i])).map(v => push(start.map((s, j) => (j === i ? v : s))));
    sweeps.push({ param: i, indices: [...new Set(indices)] });
  });
  const rnd = random(seed);
  for (let k = 0; k < randomCount; k++) push(params.map((p, i) => (held(start[i]) ? start[i] : inside(p, rnd, start[i]))));
  return { calls, sweeps };
}
