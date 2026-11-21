import { createHash } from 'node:crypto';

const dimensions = ['tokens', 'verifyMs', 'dollars'];
export function budgetVector(value) {
  if (!value || Object.keys(value).length !== dimensions.length ||
      !dimensions.every(key => Object.hasOwn(value, key) && Number.isSafeInteger(value[key]) && value[key] >= 0)) throw new TypeError('invalid budget vector');
  return { ...value };
}
const canonical = value => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new TypeError('Forge Core requires JSON values');
};
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function forgeAddress({ goal, inputs, codeVersion }) {
  if (typeof goal !== 'string' || !goal || typeof codeVersion !== 'string' || !codeVersion) throw new TypeError('goal and codeVersion required');
  return hash({ goal, inputs, codeVersion });
}
export function reduceForgeResults(merge, rows) {
  if (merge !== 'set-union') throw new TypeError('unsupported merge');
  const values = new Map();
  for (const row of rows) {
    if (!Array.isArray(row.value)) throw new TypeError('set-union requires arrays');
    for (const value of row.value) values.set(canonical(value), value);
  }
  const value = [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
  return { value, hash: hash({ merge, value }) };
}
export class ForgeBudget {
  constructor(limit, depth = 0) {
    this.limit = budgetVector(limit);
    this.remaining = { ...this.limit };
    this.spent = { tokens: 0, verifyMs: 0, dollars: 0 };
    this.ownSpent = { ...this.spent };
    this.ancestors = new Set();
    this.depth = depth;
  }
  reserve(cost) {
    cost = budgetVector(cost);
    if (dimensions.some(key => cost[key] > this.remaining[key])) throw new Error('budget exceeded');
    for (const key of dimensions) this.remaining[key] -= cost[key];
  }
  charge(cost) {
    this.reserve(cost);
    for (const key of dimensions) {
      this.spent[key] += cost[key];
      this.ownSpent[key] += cost[key];
    }
  }
  settle(child) {
    for (const key of dimensions) {
      this.remaining[key] += child.remaining[key];
      this.spent[key] += child.spent[key];
    }
  }
  snapshot() {
    return { depth: this.depth, ownSpent: { ...this.ownSpent }, spent: { ...this.spent }, remaining: { ...this.remaining } };
  }
}
