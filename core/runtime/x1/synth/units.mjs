// Reusable invariant: units by dimension and scale. A unit that doesn't parse is
// unknown and never refuses; two that parse must agree in dimension, scale and offset.
const D = (dims, scale = 1, offset = '') => ({ dims, scale, offset });
const mass = { M: 1 }, length = { L: 1 }, time = { T: 1 }, temp = { K: 1 }, none = {};
const energy = { M: 1, L: 2, T: -2 }, power = { M: 1, L: 2, T: -3 }, pressure = { M: 1, L: -1, T: -2 }, volume = { L: 3 };
const current = { I: 1 }, voltage = { M: 1, L: 2, T: -3, I: -1 }, money = { $: 1 };
const btu = 1055.05585262;
const table = {
  kg: D(mass), g: D(mass, 1e-3), mg: D(mass, 1e-6), lb: D(mass, 0.45359237), lbm: D(mass, 0.45359237), oz: D(mass, 0.028349523125),
  m: D(length), mm: D(length, 1e-3), cm: D(length, 1e-2), km: D(length, 1e3), ft: D(length, 0.3048), in: D(length, 0.0254), yd: D(length, 0.9144), mi: D(length, 1609.344),
  s: D(time), ms: D(time, 1e-3), min: D(time, 60), h: D(time, 3600), day: D(time, 86400),
  K: D(temp, 1, 'K'), degF: D(temp, 5 / 9, 'F'), degC: D(temp, 1, 'C'), degR: D(temp, 5 / 9, 'R'),
  Pa: D(pressure), kPa: D(pressure, 1e3), MPa: D(pressure, 1e6), bar: D(pressure, 1e5), psi: D(pressure, 6894.757293168), psia: D(pressure, 6894.757293168, 'abs'), psig: D(pressure, 6894.757293168, 'gauge'), inHg: D(pressure, 3386.389),
  J: D(energy), kJ: D(energy, 1e3), MJ: D(energy, 1e6), Btu: D(energy, btu), Wh: D(energy, 3600), kWh: D(energy, 3.6e6), cal: D(energy, 4.184), kcal: D(energy, 4184),
  W: D(power), kW: D(power, 1e3), MW: D(power, 1e6), hp: D(power, 745.69987158227022), MBH: D(power, btu * 1000 / 3600),
  L: D(volume, 1e-3), mL: D(volume, 1e-6), gal: D(volume, 0.003785411784), cfm: D({ L: 3, T: -1 }, 0.3048 ** 3 / 60), gpm: D({ L: 3, T: -1 }, 0.003785411784 / 60),
  A: D(current), mA: D(current, 1e-3), V: D(voltage), kV: D(voltage, 1e3), VA: D(power), kVA: D(power, 1e3), Hz: D({ T: -1 }),
  USD: D(money), '%': D(none, 0.01), 1: D(none),
};
const words = {
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
  meter: 'm', meters: 'm', metre: 'm', metres: 'm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm', foot: 'ft', feet: 'ft', inch: 'in', inches: 'in',
  sec: 's', second: 's', seconds: 's', minute: 'min', minutes: 'min', mins: 'min', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', days: 'day',
  kelvin: 'K', '°f': 'degF', f: 'degF', degf: 'degF', fahrenheit: 'degF', '°c': 'degC', degc: 'degC', celsius: 'degC', '°r': 'degR', rankine: 'degR',
  pa: 'Pa', kpa: 'kPa', mpa: 'MPa', inhg: 'inHg', btu: 'Btu', btus: 'Btu', joule: 'J', joules: 'J', kj: 'kJ', wh: 'Wh', kwh: 'kWh',
  watt: 'W', watts: 'W', w: 'W', kw: 'kW', kilowatt: 'kW', kilowatts: 'kW', horsepower: 'hp', mbh: 'MBH',
  liter: 'L', liters: 'L', litre: 'L', litres: 'L', l: 'L', ml: 'mL', gallon: 'gal', gallons: 'gal', amp: 'A', amps: 'A', ampere: 'A', amperes: 'A', a: 'A',
  volt: 'V', volts: 'V', v: 'V', kv: 'kV', va: 'VA', kva: 'kVA', hz: 'Hz', hertz: 'Hz', usd: 'USD', $: 'USD', dollars: 'USD',
  percent: '%', pct: '%', ratio: '1', fraction: '1', dimensionless: '1', unitless: '1', '-': '1',
};
const superscript = { '²': 2, '³': 3 };
function atom(text) {
  const match = /^(.*?)(?:\^(-?\d)|([²³])|(?<=[a-zA-Z])([23]))?$/.exec(text);
  const base = match[1], power = Number(match[2] ?? superscript[match[3]] ?? match[4] ?? 1);
  const unit = table[base] ?? table[words[base.toLowerCase()]];
  if (!unit) return null;
  return { dims: Object.fromEntries(Object.entries(unit.dims).map(([k, v]) => [k, v * power])), scale: unit.scale ** power, offset: unit.offset };
}
// Parse 'g/m', 'kg/s', 'Btu/h', 'W/(m2 K)', 'grams per metre'. Returns null when unknown.
export function parseUnit(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().replace(/\s+per\s+/gi, '/').replace(/[()]/g, ' ').replace(/[·*]/g, ' ').replace(/\s*\/\s*/g, '/').trim();
  if (/^(btu\/hr?|btuh)$/i.test(s)) s = 'Btu/h';
  if (!s) return null;
  const [top, ...bottoms] = s.split('/'), atoms = [];
  const add = (part, sign) => part.split(/\s+/).filter(Boolean).every(piece => { const a = atom(piece); if (a) atoms.push([a, sign]); return Boolean(a); });
  if (!add(top, 1)) return null;
  for (const bottom of bottoms) if (!add(bottom, -1)) return null;
  if (!atoms.length) return null;
  const out = { dims: {}, scale: 1, offset: atoms.length === 1 ? atoms[0][0].offset : '' };
  for (const [a, sign] of atoms) {
    for (const [k, v] of Object.entries(a.dims)) out.dims[k] = (out.dims[k] ?? 0) + sign * v;
    out.scale *= sign > 0 ? a.scale : 1 / a.scale;
  }
  for (const k of Object.keys(out.dims)) if (!out.dims[k]) delete out.dims[k];
  return out;
}
// 'same' | 'different' | 'unknown'
export function compareUnits(a, b) {
  const x = parseUnit(a), y = parseUnit(b);
  if (!x || !y) return 'unknown';
  const keys = new Set([...Object.keys(x.dims), ...Object.keys(y.dims)]);
  for (const k of keys) if ((x.dims[k] ?? 0) !== (y.dims[k] ?? 0)) return 'different';
  if (Math.abs(x.scale / y.scale - 1) > 1e-6) return 'different';
  return !x.offset || !y.offset || x.offset === y.offset ? 'same' : 'different';
}
