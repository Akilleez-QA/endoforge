// P-56 needs. R: verbatim P-21 requests, read from the atomizer baseline-20 runs.
// H: fixed-interface requests with held-out checks the model never sees.
// Each H need names its exports, parameter order, units, formula, constants and trap
// rule, so a held-out value is decided by the text and not by the author's judgement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const rIds = 'C-015 CC-036 CC-011 CC-014 CC-025 CC-027 C-007 C-019 CC-002 C-016 CC-001 CC-007 C-012 C-005 CC-026 CC-022 C-010 C-006 CC-013 CC-009'.split(' ');
export const readR = (root, id) => readFileSync(join(root, id, 'atoms/direct/in/need/NEED.md'), 'utf8');

const tail = 'Freeze your own tests before code, including boundary and trap cases. Include complete declarative glue.';
const within = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const HP_W = 745.699872;
const r404a = [[5, -37], [10, -28], [20, -14], [30, -3], [40, 6], [60, 22], [80, 35], [100, 46]];
function interpolate(table, x) {
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  throw Error('out of table');
}
const dewPointF = (tF, rh) => {
  const t = (tF - 32) * 5 / 9, a = 17.62, b = 243.12, g = Math.log(rh / 100) + a * t / (b + t);
  return (b * g / (a - g)) * 9 / 5 + 32;
};

// Each case: [fn, args] for a value computed by `reference`, or [fn, args, 'trap'].
export const hNeeds = [
  { id: 'H01', from: 'CC-036',
    need: `Convert electrical kilowatts to mechanical horsepower. Export exactly one function kwToHp(kw: f64): f64 returning kw * 1000 / 745.699872, unrounded. Valid input is 0 <= kw <= 10000; any other input, including NaN, must trap with abort(). ${tail}`,
    reference: { kwToHp: kw => { if (!within(kw, 0, 10000)) throw Error('trap'); return kw * 1000 / HP_W; } },
    cases: [['kwToHp', [6.2]], ['kwToHp', [0]], ['kwToHp', [10000]], ['kwToHp', [0.001]], ['kwToHp', [745.699872]], ['kwToHp', [-0.5], 'trap'], ['kwToHp', [10000.01], 'trap']] },
  { id: 'H02', from: 'CC-025',
    need: `Three-phase motor output in horsepower. Export exactly threePhaseHp(volts: f64, amps: f64, powerFactor: f64, efficiency: f64): f64 returning sqrt(3) * volts * amps * powerFactor * efficiency / 745.699872, unrounded. Valid inputs: 100 <= volts <= 1000, 0 <= amps <= 2000, 0 < powerFactor <= 1, 0 < efficiency <= 1. Any other input traps with abort(). ${tail}`,
    reference: { threePhaseHp: (v, a, pf, e) => { if (!within(v, 100, 1000) || !within(a, 0, 2000) || !(pf > 0 && pf <= 1) || !(e > 0 && e <= 1)) throw Error('trap'); return Math.sqrt(3) * v * a * pf * e / HP_W; } },
    cases: [['threePhaseHp', [460, 7.8, 0.85, 0.9]], ['threePhaseHp', [100, 0, 1, 1]], ['threePhaseHp', [1000, 2000, 1, 1]], ['threePhaseHp', [208, 12.5, 0.8, 0.88]], ['threePhaseHp', [99.9, 10, 0.9, 0.9], 'trap'],
      ['threePhaseHp', [460, 10, 0, 0.9], 'trap'], ['threePhaseHp', [460, 10, 0.9, 1.01], 'trap'], ['threePhaseHp', [460, -1, 0.9, 0.9], 'trap']] },
  { id: 'H03', from: 'CC-002, CC-013',
    need: `Dew point from dry-bulb temperature and relative humidity with the Magnus formula over water at all temperatures. Export exactly dewPointF(tempF: f64, rhPercent: f64): f64. Convert tempF to Celsius T = (tempF - 32) * 5 / 9; gamma = ln(rhPercent / 100) + 17.62 * T / (243.12 + T); dew point in Celsius = 243.12 * gamma / (17.62 - gamma); return it in Fahrenheit (C * 9 / 5 + 32), unrounded. Valid inputs: -40 <= tempF <= 140 and 0 < rhPercent <= 100. Any other input traps with abort(). ${tail}`,
    reference: { dewPointF: (t, rh) => { if (!within(t, -40, 140) || !(rh > 0 && rh <= 100)) throw Error('trap'); return dewPointF(t, rh); } },
    cases: [['dewPointF', [60, 60]], ['dewPointF', [-10, 50]], ['dewPointF', [140, 100]], ['dewPointF', [-40, 1]], ['dewPointF', [75, 35]], ['dewPointF', [32, 100]], ['dewPointF', [60, 0], 'trap'], ['dewPointF', [141, 50], 'trap'], ['dewPointF', [60, 100.5], 'trap']] },
  { id: 'H04', from: 'CC-014',
    need: `Liquid overfeed in a bottom-feed recirculated evaporator. With a recirculation ratio n:1, the pump feeds n pounds of liquid per pound evaporated. Export exactly two functions: liquidReturnLbPerMin(evaporatedLbPerMin: f64, ratio: f64): f64 returning evaporatedLbPerMin * (ratio - 1), and outletQuality(ratio: f64): f64 returning the vapor mass fraction leaving the evaporator, 1 / ratio. Both unrounded. Valid inputs: 0 <= evaporatedLbPerMin <= 10000 and 1 <= ratio <= 10. Any other input traps with abort(). ${tail}`,
    reference: { liquidReturnLbPerMin: (m, n) => { if (!within(m, 0, 10000) || !within(n, 1, 10)) throw Error('trap'); return m * (n - 1); },
      outletQuality: n => { if (!within(n, 1, 10)) throw Error('trap'); return 1 / n; } },
    cases: [['liquidReturnLbPerMin', [12.5, 3]], ['liquidReturnLbPerMin', [0, 4]], ['liquidReturnLbPerMin', [10000, 10]], ['liquidReturnLbPerMin', [7, 1]], ['outletQuality', [3]], ['outletQuality', [1]], ['outletQuality', [10]],
      ['liquidReturnLbPerMin', [5, 0.99], 'trap'], ['outletQuality', [10.5], 'trap'], ['liquidReturnLbPerMin', [-1, 3], 'trap']] },
  { id: 'H05', from: 'CC-027, C-007',
    need: `Subcooling check. Export exactly two functions. subcoolingF(saturatedCondensingF: f64, liquidLineF: f64): f64 returns saturatedCondensingF - liquidLineF, unrounded; both inputs must be in -100..200 inclusive, otherwise trap with abort(). subcoolStatus(subcoolF: f64, targetLowF: f64, targetHighF: f64): i32 returns 0 when subcoolF < targetLowF, 1 when targetLowF <= subcoolF <= targetHighF, 2 when subcoolF > targetHighF; it traps with abort() when targetLowF > targetHighF or any input is NaN. ${tail}`,
    reference: { subcoolingF: (s, l) => { if (!within(s, -100, 200) || !within(l, -100, 200)) throw Error('trap'); return s - l; },
      subcoolStatus: (x, lo, hi) => { if ([x, lo, hi].some(Number.isNaN) || lo > hi) throw Error('trap'); return x < lo ? 0 : x <= hi ? 1 : 2; } },
    cases: [['subcoolingF', [110, 90]], ['subcoolingF', [-100, 200]], ['subcoolingF', [95.5, 101.25]], ['subcoolStatus', [20, 8, 14]], ['subcoolStatus', [8, 8, 14]], ['subcoolStatus', [14, 8, 14]], ['subcoolStatus', [7.99, 8, 14]],
      ['subcoolStatus', [10, 10, 10]], ['subcoolingF', [201, 90], 'trap'], ['subcoolStatus', [10, 14, 8], 'trap']] },
  { id: 'H06', from: 'CC-001, CC-026',
    need: `Superheat from suction pressure using this fixed R-404A saturation table, pressure in psig to temperature in F: 5:-37, 10:-28, 20:-14, 30:-3, 40:6, 60:22, 80:35, 100:46. Interpolate linearly between adjacent rows; no extrapolation. Export exactly satTempF(psig: f64): f64 returning the interpolated saturation temperature, and superheatF(psig: f64, suctionLineF: f64): f64 returning suctionLineF - satTempF(psig). Both unrounded. psig outside 5..100 inclusive, NaN, or suctionLineF outside -100..200 inclusive traps with abort(). ${tail}`,
    reference: { satTempF: p => { if (!within(p, 5, 100)) throw Error('trap'); return interpolate(r404a, p); },
      superheatF: (p, t) => { if (!within(p, 5, 100) || !within(t, -100, 200)) throw Error('trap'); return t - interpolate(r404a, p); } },
    cases: [['satTempF', [5]], ['satTempF', [100]], ['satTempF', [25]], ['satTempF', [50]], ['satTempF', [87.5]], ['superheatF', [33, 10]], ['superheatF', [10, -28]], ['superheatF', [65, 40]],
      ['satTempF', [4.9], 'trap'], ['satTempF', [100.1], 'trap'], ['superheatF', [30, 201], 'trap']] },
  { id: 'H07', from: 'CC-022',
    need: `Pressure change per degree between two saturation points. Export exactly psiPerDegreeF(p1Psig: f64, t1F: f64, p2Psig: f64, t2F: f64): f64 returning (p2Psig - p1Psig) / (t2F - t1F), unrounded. Every input must be in -500..5000 inclusive. It traps with abort() when t1F equals t2F, when any input is outside that range, or when any input is NaN. ${tail}`,
    reference: { psiPerDegreeF: (p1, t1, p2, t2) => { if (![p1, t1, p2, t2].every(x => within(x, -500, 5000)) || t1 === t2) throw Error('trap'); return (p2 - p1) / (t2 - t1); } },
    cases: [['psiPerDegreeF', [100, 40, 103.47, 41]], ['psiPerDegreeF', [180, 95, 140, 80]], ['psiPerDegreeF', [-500, -500, 5000, 5000]], ['psiPerDegreeF', [10, 20, 10, 30]], ['psiPerDegreeF', [55.5, 12.25, 61.75, 15.5]],
      ['psiPerDegreeF', [100, 40, 120, 40], 'trap'], ['psiPerDegreeF', [100, 40, 5001, 41], 'trap']] },
  { id: 'H08', from: 'C-005',
    need: `Refrigerant held in a full liquid line. Export exactly lineChargeLb(lengthFt: f64, innerDiameterIn: f64, liquidDensityLbPerFt3: f64): f64 returning (pi / 4) * (innerDiameterIn / 12)^2 * lengthFt * liquidDensityLbPerFt3, unrounded, and metersToFeet(meters: f64): f64 returning meters / 0.3048. Valid inputs: 0 <= lengthFt <= 1000, 0 < innerDiameterIn <= 6, 0 < liquidDensityLbPerFt3 <= 100, 0 <= meters <= 1000. Any other input traps with abort(). ${tail}`,
    reference: { lineChargeLb: (l, d, r) => { if (!within(l, 0, 1000) || !(d > 0 && d <= 6) || !(r > 0 && r <= 100)) throw Error('trap'); return Math.PI / 4 * (d / 12) ** 2 * l * r; },
      metersToFeet: m => { if (!within(m, 0, 1000)) throw Error('trap'); return m / 0.3048; } },
    cases: [['lineChargeLb', [3.28084, 0.19, 66.5]], ['lineChargeLb', [3.28084, 0.43, 66.5]], ['lineChargeLb', [0, 1, 70]], ['lineChargeLb', [1000, 6, 100]], ['metersToFeet', [1]], ['metersToFeet', [1000]],
      ['lineChargeLb', [10, 0, 70], 'trap'], ['lineChargeLb', [10, 0.5, 100.5], 'trap'], ['metersToFeet', [-0.1], 'trap']] },
  { id: 'H09', from: 'CC-009',
    need: `Refrigerant inventory of an evaporator. Export exactly evaporatorInventoryLb(volumeFt3: f64, liquidFraction: f64, liquidDensityLbPerFt3: f64, vaporDensityLbPerFt3: f64): f64 returning volumeFt3 * (liquidFraction * liquidDensityLbPerFt3 + (1 - liquidFraction) * vaporDensityLbPerFt3), unrounded. Valid inputs: 0 <= volumeFt3 <= 10000, 0 <= liquidFraction <= 1, 0 < liquidDensityLbPerFt3 <= 100, 0 <= vaporDensityLbPerFt3 <= liquidDensityLbPerFt3. Any other input traps with abort(). ${tail}`,
    reference: { evaporatorInventoryLb: (v, f, rl, rv) => { if (!within(v, 0, 10000) || !within(f, 0, 1) || !(rl > 0 && rl <= 100) || !(rv >= 0 && rv <= rl)) throw Error('trap'); return v * (f * rl + (1 - f) * rv); } },
    cases: [['evaporatorInventoryLb', [16, 0.25, 42.8, 0.09]], ['evaporatorInventoryLb', [16, 0, 42.8, 0.09]], ['evaporatorInventoryLb', [16, 1, 42.8, 0.09]], ['evaporatorInventoryLb', [10000, 0.5, 100, 100]], ['evaporatorInventoryLb', [0, 0.3, 40, 0.1]],
      ['evaporatorInventoryLb', [16, 1.01, 42.8, 0.09], 'trap'], ['evaporatorInventoryLb', [16, 0.25, 42.8, 43], 'trap'], ['evaporatorInventoryLb', [16, 0.25, 0, 0], 'trap']] },
  { id: 'H10', from: 'C-006',
    need: `Maximum flammable refrigerant charge for a room. Export exactly maxChargeKg(roomAreaM2: f64, installHeightM: f64, lflKgPerM3: f64): f64 returning 2.5 * lflKgPerM3^(5/4) * installHeightM * sqrt(roomAreaM2), unrounded, and r290MaxChargeKg(roomAreaM2: f64, installHeightM: f64): f64 returning maxChargeKg with lflKgPerM3 = 0.038. Valid inputs: 0 < roomAreaM2 <= 1000, 0 < installHeightM <= 3, 0 < lflKgPerM3 <= 1. Any other input traps with abort(). ${tail}`,
    reference: { maxChargeKg: (a, h, l) => { if (!(a > 0 && a <= 1000) || !(h > 0 && h <= 3) || !(l > 0 && l <= 1)) throw Error('trap'); return 2.5 * l ** 1.25 * h * Math.sqrt(a); },
      r290MaxChargeKg: (a, h) => { if (!(a > 0 && a <= 1000) || !(h > 0 && h <= 3)) throw Error('trap'); return 2.5 * 0.038 ** 1.25 * h * Math.sqrt(a); } },
    cases: [['r290MaxChargeKg', [20, 1]], ['r290MaxChargeKg', [1000, 3]], ['r290MaxChargeKg', [0.01, 0.6]], ['maxChargeKg', [16, 2.2, 0.307]], ['maxChargeKg', [1000, 3, 1]], ['maxChargeKg', [50, 1.8, 0.038]],
      ['r290MaxChargeKg', [0, 1], 'trap'], ['r290MaxChargeKg', [20, 3.01], 'trap'], ['maxChargeKg', [20, 1, 1.5], 'trap']] },
];

const relative = 1e-6;
export function heldOutTests(need) {
  return need.cases.map(([fn, args, trap], index) => {
    const name = `heldout-${index}`;
    if (trap) {
      let threw = false;
      try { need.reference[fn](...args); } catch { threw = true; }
      if (!threw) throw Error(`${need.id} ${name}: reference does not trap`);
      return { name, fn, args, expectError: true };
    }
    const value = need.reference[fn](...args);
    if (!Number.isFinite(value)) throw Error(`${need.id} ${name}: reference not finite`);
    return Number.isInteger(value) && fn === 'subcoolStatus' ? { name, fn, args, expect: value } : { name, fn, args, expect: value, tol: relative * Math.max(1, Math.abs(value)) };
  });
}
