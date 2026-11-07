import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [after, before, output] = process.argv.slice(2);
const rows = (dir, arm) => readFileSync(join(dir, `${arm}.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const nonFiniteOnly = row => row.witness && !row.witness.finite;
const where = row => {
  const failure = row.pool?.flatMap(job => job.attempts ?? []).map(a => a.firstFailure).find(Boolean);
  if (row.inconclusive || row.decision?.decision === 'inconclusive') return 'inconclusive';
  if (failure && failure !== 'residual') return failure;
  return row.caught ?? (row.promoted ? 'promoted' : 'unknown');
};
const table = (list, key) => { const out = {}; for (const row of list) { const name = key(row); out[name] ??= { escaped: 0, submitted: 0 }; out[name].submitted++; if (row.promoted) out[name].escaped++; } return out; };
const quantile = (values, q) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
const summary = {};
const refused = new Set(rows(after, 'control').filter(row => !row.promoted).map(row => row.key));
for (const arm of ['control', 'sampled', 'glue']) {
  const now = rows(after, arm), old = arm === 'control' || arm === 'sampled' || arm === 'glue' ? rows(before, arm) : [];
  const was = new Map(old.map(row => [row.mutant, row]));
  const entry = summary[arm] = {};
  for (const cohort of [...new Set(now.map(row => row.cohort))]) {
    const list = now.filter(row => row.cohort === cohort), prior = old.filter(row => row.cohort === cohort);
    entry[cohort] = { onRefusedPristine: table(list.filter(row => refused.has(row.key)), () => 'all').all, onPromotingPristine: { after: table(list.filter(row => !refused.has(row.key)), () => 'all').all, before: table(prior.filter(row => !refused.has(row.key)), () => 'all').all }, after: table(list, () => 'all').all, before: table(prior, () => 'all').all,
      byClassAfter: table(list, row => row.class), byClassBefore: table(prior, row => row.class), byOpAfter: table(list, row => row.op),
      finiteVisible: { after: table(list.filter(r => !nonFiniteOnly(r)), () => 'all').all, before: table(prior.filter(r => !nonFiniteOnly(r)), () => 'all').all },
      nonFiniteOnly: { after: table(list.filter(nonFiniteOnly), () => 'all').all, before: table(prior.filter(nonFiniteOnly), () => 'all').all },
      caughtAt: Object.fromEntries(Object.entries(table(list.filter(r => !r.promoted), where)).map(([k, v]) => [k, v.submitted])),
      newlyCaught: list.filter(r => !r.promoted && was.get(r.mutant)?.promoted).length, newlyEscaped: list.filter(r => r.promoted && was.get(r.mutant) && !was.get(r.mutant).promoted).map(r => r.mutant),
      gateMs: { p50: quantile(list.map(r => r.timings?.gate), 0.5), p95: quantile(list.map(r => r.timings?.gate), 0.95) }, elapsedMs: { p50: quantile(list.map(r => r.elapsedMs), 0.5) } };
  }
  entry.refusedOrUnknown = arm === 'control' ? now.filter(r => !r.promoted).map(r => ({ mutant: r.mutant, where: where(r), decision: r.decision, pool: r.pool })) : undefined;
  entry.inconclusive = now.filter(r => where(r) === 'inconclusive').length;
  entry.harnessError = now.filter(r => r.caught === 'harness_error' || (r.error && !r.promoted)).length;
}
writeFileSync(output, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, (k, v) => (k === 'byClassBefore' || k === 'byOpAfter' ? undefined : v)).slice(0, 6000));
