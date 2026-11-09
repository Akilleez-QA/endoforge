import { compareUnits } from './units.mjs';
// The reusable invariant library. Deterministic, authored offline; the model selects
// and parameterizes entries, it never writes their code.
export const library = Object.freeze({
  'value.reference': 'Every result equals an independent reference written from the contract, on generated inputs across the declared domain.',
  'boundary.domain': 'Inputs at, just inside and just outside each declared edge: the kernel traps exactly where the contract excludes the input.',
  'rounding.probe': 'Non-round interior inputs, so rounding or truncation inside the kernel shows in the unrounded result.',
  'range.result': 'Every returned value lies in the declared result range, including its sign.',
  'monotone': 'The result moves in the declared direction as one input rises with the others fixed.',
  'codes.result': 'A code result is one of the declared codes.',
  'units.glue': 'Each argument and the result carry the declared unit, compared by dimension and scale.',
  'precision.glue': 'The displayed decimals equal the decimals the contract states.',
  'codes.glue': 'Each code keeps its declared label.',
  'determinism': 'Two fresh instances, the second calling in reverse order, give identical results.',
});
export const relative = 1e-9;
export const alike = (a, b, tolerance) => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= (tolerance ?? relative * Math.max(1, Math.abs(b)));
  }
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => alike(item, b[i], tolerance));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every(name => Object.hasOwn(b, name) && alike(a[name], b[name], tolerance));
  }
  return a !== undefined && a === b;
};
export const same = (a, b) => {
  if (a.throws || b.throws) return Boolean(a.throws) === Boolean(b.throws);
  return alike(a.value, b.value);
};
const tokens = text => new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []);
const overlap = (a, b) => { const x = tokens(a), y = tokens(b); const both = [...x].filter(t => y.has(t)).length; return both / Math.max(1, new Set([...x, ...y]).size); };
// A label is swapped when it matches another code's declared label and not its own.
export function swappedLabels(declared, glue) {
  const swapped = [];
  for (const [code, label] of Object.entries(glue ?? {})) {
    if (!(code in (declared ?? {}))) continue;
    const own = overlap(label, declared[code]);
    for (const [other, text] of Object.entries(declared)) if (other !== code && overlap(label, text) >= 0.5 && overlap(label, text) > own && own < 0.5) { swapped.push(`${code}: "${label}" reads as ${other}`); break; }
  }
  return swapped;
}
export function glueProblems(checks, glue) {
  const problems = [], unknown = [];
  const entries = new Map((glue?.exports ?? []).map(entry => [entry.name, entry]));
  for (const declared of checks.glue) {
    const entry = entries.get(declared.fn);
    if (!entry) continue;
    for (const [index, unit] of declared.args.entries()) {
      const arg = entry.args?.[index];
      if (!unit || !arg) continue;
      const verdict = compareUnits(unit, arg.unit);
      if (verdict === 'different') problems.push(`units.glue: ${declared.fn} argument ${index + 1} is ${arg.unit}, the evaluator declares ${unit}`);
      if (verdict === 'unknown') unknown.push(`${declared.fn}#${index + 1}`);
    }
    if (declared.result.unit) {
      const verdict = compareUnits(declared.result.unit, entry.result?.unit);
      if (verdict === 'different') problems.push(`units.glue: ${declared.fn} result is ${entry.result?.unit}, the evaluator declares ${declared.result.unit}`);
      if (verdict === 'unknown') unknown.push(`${declared.fn}#result`);
    }
    if (Number.isInteger(declared.result.decimals) && Number.isInteger(entry.result?.precision) && entry.result.kind === 'number' && entry.result.precision !== declared.result.decimals)
      problems.push(`precision.glue: ${declared.fn} shows ${entry.result.precision} decimals, the contract states ${declared.result.decimals}`);
    if (declared.result.codes) for (const swap of swappedLabels(declared.result.codes, entry.result?.codes)) problems.push(`codes.glue: ${declared.fn} ${swap}`);
  }
  return { problems, unknown };
}
export function propertyProblems(checks, outcomes) {
  const problems = [];
  const at = index => outcomes[index];
  for (const { fn, min, max } of checks.ranges) checks.vectors.forEach((v, i) => {
    const o = at(i);
    if (v.fn !== fn || !o || o.trap || o.skipped) return;
    if ((min !== undefined && o.value < min - relative * Math.max(1, Math.abs(min))) || (max !== undefined && o.value > max + relative * Math.max(1, Math.abs(max))))
      problems.push(`range.result: ${fn}(${v.args}) = ${o.value}, outside [${min ?? '-inf'}, ${max ?? 'inf'}]`);
  });
  for (const { fn, codes } of checks.codes) checks.vectors.forEach((v, i) => {
    const o = at(i);
    if (v.fn === fn && o && !o.trap && !o.skipped && !codes.includes(String(o.value))) problems.push(`codes.result: ${fn}(${v.args}) returned undeclared code ${o.value}`);
  });
  for (const { fn, param, direction, chain } of checks.monotone) {
    const points = chain.map(i => [checks.vectors[i].args[param], at(i)]).filter(([, o]) => o && !o.trap && !o.skipped);
    for (let k = 1; k < points.length; k++) {
      const step = points[k][1].value - points[k - 1][1].value, slack = relative * Math.max(1, Math.abs(points[k][1].value));
      if (direction === 'increasing' ? step < -slack : step > slack) { problems.push(`monotone: ${fn} does not ${direction === 'increasing' ? 'rise' : 'fall'} with argument ${param + 1} between ${points[k - 1][0]} and ${points[k][0]}`); break; }
    }
  }
  return problems;
}
