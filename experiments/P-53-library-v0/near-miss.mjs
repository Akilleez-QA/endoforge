import { canonical, range, unit } from '../../core/library/key.mjs';
const FACTORS = { g: ['kg', v => v / 1000], kg: ['g', v => v * 1000], lb: ['kg', v => v * 0.45359237], m: ['ft', v => v * 3.28084], ft: ['m', v => v * 0.3048],
  kW: ['hp', v => v * 1.34102], hp: ['kW', v => v * 0.7457], psi: ['kPa', v => v * 6.89476], psig: ['kPa', v => v * 6.89476], kPa: ['psi', v => v * 0.145038],
  degF: ['degC', v => (v - 32) / 1.8], degC: ['degF', v => v * 1.8 + 32], dimensionless: ['percent', v => v * 100] };
const swapUnit = name => FACTORS[unit(name)] ?? [`milli-${name}`, v => v * 1000];
const clone = value => JSON.parse(JSON.stringify(value));
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (text, from, to) => from ? text.replace(new RegExp(`(?<![\\w.])${escape(from)}(?![\\w])`, 'g'), to) : text;
const mapExpect = (tests, fn, change) => tests.map(t => t.fn === fn && typeof t.expect === 'number' ? { ...t, expect: change(t.expect), ...(Number.isFinite(t.tol) ? { tol: Math.abs(change(t.tol + t.expect) - change(t.expect)) } : {}) } : t);
const firstLiteral = (text, avoid) => (text.replace(/^#.*$/gm, '').match(/(?<![\w.])\d+\.\d+(?![\w])/g) ?? []).find(n => !avoid.has(Number(n))) ?? null;
export function declaredCases({ key, capability, contract, tests }) {
  const cases = [], base = capability.exports.find(e => e.result.kind === 'number') ?? capability.exports[0];
  if (!base) return cases;
  const index = capability.exports.indexOf(base), fn = base.name;
  const values = tests.filter(t => t.fn === fn && typeof t.expect === 'number');
  const add = (klass, flavour, edit) => {
    const next = { capability: clone(capability), contract, tests: clone(tests) };
    edit(next, next.capability.exports[index]);
    cases.push({ key, arm: flavour === 'prose_only' ? 'C' : 'A', class: klass, flavour, ...next });
  };
  const [to, change] = swapUnit(base.result.unit ?? '');
  add('units', 'blind', (n, e) => { e.result.unit = to; n.contract = word(contract, base.result.unit, to); });
  if (values.length) add('units', 'visible', (n, e) => { e.result.unit = to; n.contract = word(contract, base.result.unit, to); n.tests = mapExpect(n.tests, fn, change); });
  const numberArg = base.args.findIndex(a => a.kind === 'number');
  if (numberArg >= 0) add('units', 'blind_arg', (n, e) => { const a = e.args[numberArg]; const [other] = swapUnit(a.unit ?? ''); n.contract = word(contract, a.unit, other); a.unit = other; });
  const p = base.result.precision ?? 0, q = p > 0 ? p - 1 : p + 1, f = 10 ** q;
  const stated = `\nReturn the result rounded to ${q} decimal places.\n`;
  add('rounding', 'blind', (n, e) => { e.result.precision = q; n.contract = contract + stated; });
  if (values.length) add('rounding', 'visible', (n, e) => { e.result.precision = q; n.contract = contract + stated; n.tests = n.tests.map(t => t.fn === fn && typeof t.expect === 'number' ? { ...t, expect: Math.round(t.expect * f) / f, tol: undefined } : t); });
  add('rounding', 'blind_mode', (n, e) => { e.result.rounding = 'floor'; n.contract = `${contract}\nRound the result down.\n`; });
  add('rounding', 'prose_only', n => { n.contract = `${contract}\nRound the result down, never to nearest.\n`; });
  const target = base.args.findIndex(a => { const r = range(a.range); return r && 'low' in r && r.high > r.low; });
  if (target >= 0) {
    const a = base.args[target], r = range(a.range), lowered = r.high - Math.max(1, (r.high - r.low) / 10);
    const edit = (n, e) => { e.args[target].range = `${r.low}..${lowered}`; n.contract = word(contract, String(r.high), String(lowered)); };
    add('boundary', 'blind', edit);
    const row = tests.find(t => t.fn === fn && !t.expectError && Array.isArray(t.args));
    if (row) add('boundary', 'visible', (n, e) => { edit(n, e); n.tests = [...n.tests, { name: 'old top now refused', fn, args: row.args.map((v, i) => i === target ? r.high : v), expectError: true }]; });
    add('boundary', 'blind_open', (n, e) => { e.args[target].range = `[${r.low}, ${r.high})`; n.contract = `${contract}\nThe upper limit is exclusive.\n`; });
  }
  if (values.some(t => t.expect !== 0)) add('sign', 'visible', n => { n.contract = `${contract}\nReport the result with its sign reversed.\n`; n.tests = mapExpect(n.tests, fn, v => -v); });
  else if (values.length) add('sign', 'blind', n => { n.contract = `${contract}\nReport the result with its sign reversed.\n`; });
  add('sign', 'prose_only', n => { n.contract = `${contract}\nReport the result with its sign reversed.\n`; });
  const avoid = new Set(base.args.flatMap(a => { const r = range(a.range); return r && 'low' in r ? [r.low, r.high] : []; }));
  const literal = firstLiteral(contract, avoid);
  const restate = n => { n.contract = literal ? word(contract, literal, String(Number(literal) * 1.002)) : `${contract}\nApply the correction factor 1.002.\n`; };
  add('constants', 'blind', restate);
  if (values.some(t => t.expect !== 0)) add('constants', 'visible', n => { restate(n); n.tests = mapExpect(n.tests, fn, v => v * 1.002); });
  return cases;
}
export const CLASSES = { wrong_rounding: 'rounding', boundary_errors: 'boundary', swapped_units: 'units', sign_errors: 'sign', wrong_constants: 'constants' };
export function mutantCase(row, kernel, accepted) {
  if (row.surface !== 'kernel' || !CLASSES[row.class] || row.correlatedNonFinite) return null;
  const tests = JSON.parse(row.correlatedTests);
  return { key: row.key, arm: accepted(tests) ? 'B' : 'M', class: CLASSES[row.class], flavour: row.op, capability: kernel.capability, contract: kernel.contract, tests };
}
export const caseId = c => canonical([c.key, c.arm, c.class, c.flavour, c.contract.length, c.tests.length]);
