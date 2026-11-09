import { createHash } from 'node:crypto';
import { alike, relative, same } from './invariants.mjs';
import { laidOut } from './layout.mjs';
// Fixed meta-gates for a synthesized evaluator. None of them sees a candidate.
export const discrimination = 0.8;
const swaps = [[/^<=$/, '<'], [/^<$/, '<='], [/^>=$/, '>'], [/^>$/, '>='], [/^\+$/, '-'], [/^-$/, '+'], [/^\*$/, '/'], [/^\/$/, '*'], [/^&&$/, '||'], [/^\|\|$/, '&&'],
  [/^Math\.round$/, 'Math.floor'], [/^Math\.floor$/, 'Math.ceil'], [/^Math\.ceil$/, 'Math.floor'], [/^Math\.min$/, 'Math.max'], [/^Math\.max$/, 'Math.min'], [/^Math\.trunc$/, 'Math.round']];
const lexer = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|Math\.[a-z]+|\d+(?:\.\d+)?(?:e[-+]?\d+)?|<=|>=|&&|\|\||[-+*/<>]|[A-Za-z_$][\w$]*|\s+|.)/g;
// Seeded faults in the reference: constant shift, comparison flip, operator swap, rounding swap, argument swap.
export function mutants(source, cap = 40) {
  const parts = source.match(lexer) ?? [], out = [];
  parts.forEach((part, i) => {
    const set = replacement => out.push(parts.map((p, j) => (j === i ? replacement : p)).join(''));
    if (/^\d/.test(part) && !/^["'`/]/.test(part)) { const n = Number(part); set(String(n === 0 ? 1 : n * 1.01)); if (Number.isInteger(n)) set(String(n + 1)); return; }
    for (const [pattern, replacement] of swaps) if (pattern.test(part)) { if (part === '-' && /[(,=]\s*$/.test(parts.slice(0, i).join(''))) break; set(replacement); break; }
  });
  for (const m of source.matchAll(/(function\s+[\w$]+\s*\(\s*)([\w$]+)(\s*,\s*)([\w$]+)/g)) out.push(source.replace(m[0], m[1] + m[4] + m[3] + m[2]));
  const unique = [...new Set(out)].filter(m => m !== source);
  if (unique.length <= cap) return unique;
  const order = unique.map(m => [createHash('sha256').update(m).digest('hex'), m]).sort(([a], [b]) => (a < b ? -1 : 1));
  return order.slice(0, cap).map(([, m]) => m);
}
const outcome = r => ('value' in r ? { value: r.value } : { throws: true });
// M3: the reference reproduces every frozen test of this export.
export function anchorProblems(tests, results, layout = null) {
  const problems = [];
  tests.forEach((test, i) => {
    const r = results[i];
    if (!r || r.missing) return problems.push(`${test.name ?? i}: no reference function`);
    if (test.expectError) { if (!('error' in r)) problems.push(`${test.name ?? i}: reference returns where the test expects a trap`); return undefined; }
    if ('error' in r) return problems.push(`${test.name ?? i}: reference throws`);
    if (layout) {
      const declared = laidOut(test.expect, layout);
      if (declared === undefined || !alike(declared, r.value, Number.isFinite(test.tol) ? test.tol : undefined)) problems.push(`${test.name ?? i}: reference gives ${JSON.stringify(r.value)}, test expects ${JSON.stringify(test.expect)}`);
      return undefined;
    }
    const expect = typeof test.expect === 'boolean' ? Number(test.expect) : Number(test.expect);
    if (!Number.isFinite(expect)) return undefined;
    const tol = Number.isFinite(test.tol) ? test.tol : relative * Math.max(1, Math.abs(expect));
    if (Math.abs(r.value - expect) > tol) problems.push(`${test.name ?? i}: reference gives ${r.value}, test expects ${expect}`);
    return undefined;
  });
  return problems;
}
// M4: keep only declarations the reference itself satisfies.
export function selfConsistent(entry, calls, results, sweeps) {
  const kept = { range: null, monotone: [], codes: null }, dropped = [];
  const values = results.map((r, i) => [calls[i], r]).filter(([, r]) => 'value' in r);
  const { min, max, codes } = entry.result;
  if (Number.isFinite(min) || Number.isFinite(max)) {
    const bad = values.find(([, r]) => (Number.isFinite(min) && r.value < min) || (Number.isFinite(max) && r.value > max));
    if (bad) dropped.push(`range: reference gives ${bad[1].value} at (${bad[0].args})`); else kept.range = { min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined };
  }
  if (codes && entry.result.kind === 'code') {
    const bad = values.find(([, r]) => !(String(r.value) in codes));
    if (bad) dropped.push(`codes: reference returns ${bad[1].value}`); else kept.codes = Object.keys(codes);
  }
  for (const relation of entry.monotone ?? []) {
    const param = entry.params.findIndex(p => p.name === relation.param), sweep = sweeps.find(s => s.param === param);
    if (!sweep || !['increasing', 'decreasing'].includes(relation.direction)) { dropped.push(`monotone ${relation.param}: no such parameter`); continue; }
    const chain = sweep.indices.filter(i => 'value' in results[i]).sort((a, b) => calls[a].args[param] - calls[b].args[param]);
    const broken = chain.some((i, k) => k && (relation.direction === 'increasing' ? results[i].value < results[chain[k - 1]].value : results[i].value > results[chain[k - 1]].value));
    if (broken || chain.length < 3) dropped.push(`monotone ${relation.param}: ${broken ? 'reference breaks it' : 'too few points'}`); else kept.monotone.push({ param, direction: relation.direction, chain });
  }
  const outside = calls.findIndex((c, i) => 'value' in results[i] && entry.params.some((p, j) => !p.codes && ((Number.isFinite(p.min) && (c.args[j] < p.min || (p.minInclusive === false && c.args[j] === p.min))) || (Number.isFinite(p.max) && (c.args[j] > p.max || (p.maxInclusive === false && c.args[j] === p.max))))));
  if (outside >= 0) dropped.push(`domain: reference returns outside the declared domain at (${calls[outside].args})`);
  return { kept, dropped };
}
// M5: of the reference's seeded faults that a denser sample can tell apart, the frozen vectors must reject at least 80%.
export function discriminationScore(reference, mutantRuns, frozenCount) {
  let distinguishable = 0, rejected = 0;
  for (const run of mutantRuns) {
    if (!run.results) continue;
    const differs = index => !same(outcome(run.results[index]), outcome(reference[index]));
    const any = run.results.some((_, i) => differs(i));
    if (!any) continue;
    distinguishable += 1;
    if (run.results.slice(0, frozenCount).some((_, i) => differs(i))) rejected += 1;
  }
  return { distinguishable, rejected, score: distinguishable ? rejected / distinguishable : 1 };
}
