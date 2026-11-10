import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  : JSON.stringify(value ?? null);
const NUMBER = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const ALIASES = new Map(Object.entries({ '': 'dimensionless', 1: 'dimensionless', none: 'dimensionless', unitless: 'dimensionless', dimensionless: 'dimensionless',
  f: 'degF', '°f': 'degF', degf: 'degF', 'deg f': 'degF', fahrenheit: 'degF', c: 'degC', '°c': 'degC', degc: 'degC', 'deg c': 'degC', celsius: 'degC' }));
const words = text => String(text).trim().replace(/\s+/g, ' ');
const plain = text => words(text).toLowerCase();
export const unit = text => ALIASES.get(plain(text ?? '')) ?? words(text);
export function range(text) {
  if (text === undefined || text === null) return null;
  const value = words(text);
  let match = value.match(new RegExp(`^(${NUMBER})\\s*\\.\\.\\s*(${NUMBER})(.*)$`));
  if (match) return { low: Number(match[1]), high: Number(match[2]), lowOpen: false, highOpen: false, note: note(match[3]) };
  match = value.match(new RegExp(`^([\\[(])\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*([\\])])(.*)$`));
  if (match) return { low: Number(match[2]), high: Number(match[3]), lowOpen: match[1] === '(', highOpen: match[4] === ')', note: note(match[5]) };
  return { text: plain(value) };
}
const note = text => plain(text).replace(/\bfinite\b/g, '').replace(/^[\s,;.]+|[\s,;.]+$/g, '');
const table = codes => codes ? Object.fromEntries(Object.entries(codes).map(([code, label]) => [code, plain(label)])) : undefined;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
function layout(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.kind === 'record') return { fields: Array.isArray(value.fields) ? value.fields.map(item => ({ name: item?.name, ...nested(item) })).sort(byName) : null };
  if (value.kind === 'list') return { max: value.max ?? null, items: nested(value.items) };
  if (value.kind === 'text') return { maxBytes: value.maxBytes ?? null };
  return {};
}
function nested(value) {
  if (!value || typeof value !== 'object') return null;
  return { kind: value.kind, unit: unit(value.unit), range: range(value.range), precision: value.precision, rounding: value.rounding, codes: table(value.codes), labels: table(value.labels), ...layout(value) };
}
function signature(item, trapped) {
  const { result } = item;
  return { args: item.args.map(a => ({ kind: a.kind, unit: unit(a.unit), range: range(a.range), codes: table(a.codes), ...layout(a) })),
    result: { kind: result.kind, unit: unit(result.unit), precision: result.precision, rounding: result.rounding, codes: table(result.codes), labels: table(result.labels), ...layout(result) },
    trap: trapped.has(item.name) };
}
export function capabilityFromGlue(glue) {
  return { exports: glue.exports.map(({ name, args, result }) => ({ name, args, result })), traps: glue.traps.map(t => t.fn) };
}
export function capabilityFromContract(text) {
  const match = String(text).match(/```capability\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
const stripped = text => String(text).replace(/```capability[\s\S]*?```/g, '').replace(/^#.*$/gm, '').replace(/\.\./g, ' .. ');
export function numerals(text) {
  const values = new Set();
  for (const [token] of stripped(text).matchAll(/(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?![\w])/g)) values.add(Number(token));
  return [...values].filter(Number.isFinite).sort((a, b) => a - b);
}
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'over', 'that', 'the', 'then', 'this', 'to', 'with', 'within']);
const stem = word => word.replace(/(ings|ing|ers|er|ies|es|s)$/, '') || word;
export function contractVector(text) {
  const vector = new Map(), bump = term => vector.set(term, (vector.get(term) ?? 0) + 1);
  for (const [word] of stripped(text).toLowerCase().matchAll(/[a-z][a-z-]*/g)) {
    if (STOPWORDS.has(word)) continue;
    const root = stem(word);
    bump(`w:${root}`);
    for (let i = 0; i + 3 <= root.length; i++) bump(`t:${root.slice(i, i + 3)}`);
  }
  return vector;
}
export function similarity(a, b) {
  let shared = 0, left = 0, right = 0;
  for (const [term, weight] of a) { left += weight * weight; if (b.has(term)) shared += weight * b.get(term); }
  for (const weight of b.values()) right += weight * weight;
  return left && right ? Math.round(shared / Math.sqrt(left * right) * 1e6) / 1e6 : 0;
}
export function signatures(capability) {
  const trapped = new Set(capability.traps ?? []);
  return capability.exports.map(item => ({ name: item.name, text: canonical(signature(item, trapped)), value: signature(item, trapped) }));
}
export function ordered(capability) {
  const text = new Map(signatures(capability).map(s => [s.name, s.text]));
  return { ...capability, exports: [...capability.exports].sort((a, b) => text.get(a.name) < text.get(b.name) ? -1 : text.get(a.name) > text.get(b.name) ? 1 : 0) };
}
export function keysOf(capability, contract) {
  const exports = signatures(capability).map(s => s.value).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  return { interface: sha256(canonical({ v: 1, exports })),
    contract: sha256(canonical({ v: 1, exports, numerals: numerals(contract) })),
    prose: sha256(canonical({ v: 1, exports, prose: plain(stripped(contract)) })) };
}
export function binding(needCapability, entryCapability) {
  const need = signatures(needCapability), have = signatures(entryCapability), map = {};
  const taken = new Set();
  for (const item of need) {
    const peers = have.filter(h => h.text === item.text && !taken.has(h.name));
    const twins = need.filter(n => n.text === item.text).length > 1 || peers.length > 1;
    const chosen = twins ? peers.find(h => h.name === item.name) : peers[0];
    if (!chosen) return null;
    taken.add(chosen.name);
    map[item.name] = chosen.name;
  }
  return Object.keys(map).length === have.length ? map : null;
}
export function bindTests(tests, map) {
  return tests.map(test => Object.hasOwn(map, test.fn) ? { ...test, fn: map[test.fn] } : null);
}
