// Seeded random input generator for probe P-03. Shared by the evaluator (fixed invariant
// input set), the equivalence filter and the disagreement search, each with its own seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNITS = ['psi', 'psig', 'kPa', 'bar'];
const KPA = { psi: 6.894757293168, psig: 6.894757293168, kPa: 1, bar: 100 };
const POINTS = ['pt-01', 'pt-02', 'pt-03', 'pt-04', 'pt-05', 'pt-06', 'pt-07', 'pt-08'];

function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function int(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
function round(x, places) { const p = 10 ** places; return Math.round(x * p) / p; }

function randomBasis(rnd) {
  const r = rnd();
  if (r < 0.42) return 'gauge';
  if (r < 0.84) return 'absolute';
  if (r < 0.92) return undefined;      // missing basis
  if (r < 0.96) return null;
  return pick(rnd, ['Gauge', 'ABS', 'g', '']); // unrecognised strings
}

function randomQuantityInKpaAbs(rnd) {
  // Roughly 0 .. 3000 kPa absolute, with a cluster near atmosphere.
  const r = rnd();
  if (r < 0.2) return 101.325 + (rnd() - 0.5) * 20;
  if (r < 0.6) return rnd() * 700;
  return rnd() * 3000;
}

function expressIn(kpaAbs, unit, basis, atmKpa, rnd) {
  // Express an absolute kPa quantity in the given unit and basis; may yield negative gauge.
  let kpa = kpaAbs;
  if (basis === 'gauge') kpa = kpaAbs - atmKpa;
  const v = kpa / KPA[unit];
  return round(v, int(rnd, 0, 4));
}

export function randomEvent(rnd) {
  if (rnd() < 0.03) {
    return { type: pick(rnd, ['noop', 'reconcile ', 'RECONCILE', 'other']), readings: [], reference: [] };
  }
  const atmKpa = rnd() < 0.3 ? 101.325 : round(95 + rnd() * 12, 3);
  const atmosphere = rnd() < 0.8 ? { value_kpa: atmKpa, source: `src:baro-${int(rnd, 1, 3)}` } : null;
  const target = { unit: pick(rnd, UNITS), basis: pick(rnd, ['gauge', 'absolute']) };
  const tolerance = { minor: round(rnd() * 2, 3), major: round(2 + rnd() * 10, 3) };
  if (rnd() < 0.1) tolerance.minor = 0;

  const nRef = int(rnd, 0, 6);
  const refPoints = [...POINTS].sort(() => rnd() - 0.5).slice(0, nRef);
  const truth = {};
  const reference = refPoints.map((point, i) => {
    const kpaAbs = randomQuantityInKpaAbs(rnd);
    truth[point] = kpaAbs;
    const unit = pick(rnd, UNITS);
    const basis = unit === 'psig' ? (rnd() < 0.8 ? 'gauge' : randomBasis(rnd)) : pick(rnd, ['gauge', 'absolute']);
    return { point, source: `ref:table-${int(rnd, 1, 2)}#${i}`, value: expressIn(kpaAbs, unit, basis === 'gauge' ? 'gauge' : 'absolute', atmKpa, rnd), unit, basis };
  });

  const nRead = int(rnd, 0, 7);
  const readings = [];
  for (let i = 0; i < nRead; i++) {
    const point = rnd() < 0.8 && refPoints.length ? pick(rnd, refPoints) : pick(rnd, POINTS);
    const unit = pick(rnd, UNITS);
    let basis = unit === 'psig' ? (rnd() < 0.7 ? 'gauge' : randomBasis(rnd)) : randomBasis(rnd);
    const effBasis = unit === 'psig' ? 'gauge' : (basis === 'gauge' ? 'gauge' : 'absolute');
    let kpaAbs;
    if (truth[point] !== undefined && rnd() < 0.75) {
      // Near the reference: sometimes exactly at a tolerance boundary in the target unit.
      const r = rnd();
      const tolInKpa = (r < 0.15 ? tolerance.minor : r < 0.3 ? tolerance.major : (rnd() - 0.5) * 30 / KPA[target.unit]) * KPA[target.unit];
      kpaAbs = truth[point] + (rnd() < 0.5 ? tolInKpa : -tolInKpa);
    } else {
      kpaAbs = randomQuantityInKpaAbs(rnd);
    }
    const reading = { id: `rd-${i}`, point, source: `src:sensor-${int(rnd, 1, 9)}`, value: expressIn(kpaAbs, unit, effBasis, atmKpa, rnd), unit, basis };
    if (basis === undefined) delete reading.basis;
    if (rnd() < 0.02) reading.unit = pick(rnd, ['PSI', 'kpa', 'Bar', 'mbar', '']);
    readings.push(reading);
  }
  return { type: 'reconcile', readings, reference, atmosphere, target, tolerance };
}

export function randomState(rnd) {
  if (rnd() < 0.5) return { seen: {} };
  const seen = {};
  for (const p of POINTS) if (rnd() < 0.3) seen[p] = pick(rnd, ['match', 'minor', 'major', 'no-reference']);
  return { seen };
}

export function makeInputs(seed, n) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ state: randomState(rnd), event: randomEvent(rnd) });
  return out;
}
