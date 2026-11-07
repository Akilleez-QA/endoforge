import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Usage: node analyze.mjs <run tree with P-51 copied in> <S1 output> <S2 output> [offline S1 rows]
const [tree, s1, s2, offline] = process.argv.slice(2);
const { clopperPearson, clusterBootstrap } = await import(resolve(tree, 'experiments/P-51-escape-rate/stats.mjs'));
const rows = (dir, arm) => readFileSync(join(dir, `${arm}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const synthRefused = r => !r.promoted && r.decision === null && r.caught === 'gates_passed_decision_refused';
const arms = { S0: { dir: s1, escaped: r => r.promoted || synthRefused(r) }, S1: { dir: s1, escaped: r => r.promoted }, S2: { dir: s2, escaped: r => r.promoted } };
const pct = (k, n) => `${k} / ${n} (${(100 * k / n).toFixed(2)}%)`;
const out = {};
for (const [name, { dir, escaped }] of Object.entries(arms)) {
  const control = rows(dir, 'control'), sampled = rows(dir, 'sampled'), glue = rows(dir, 'glue');
  const summary = (list, cohort) => {
    const picked = list.filter(r => r.cohort === cohort), k = picked.filter(escaped).length, cp = clopperPearson(k, picked.length);
    const boot = cohort === 'P21' ? clusterBootstrap(picked, r => r.need, escaped) : null;
    const by = field => Object.fromEntries([...new Set(picked.map(r => r[field]))].sort().map(c => [c, `${picked.filter(r => r[field] === c && escaped(r)).length} / ${picked.filter(r => r[field] === c).length}`]));
    return { escaped: pct(k, picked.length), clopperPearson: [cp.lower, cp.upper], oneSidedUpper: cp.oneSidedUpper, bootstrap: boot, byClass: by('class'), byOp: by('op'),
      finiteVisible: `${picked.filter(r => r.witness?.finite && escaped(r)).length} / ${picked.filter(r => r.witness?.finite).length}`,
      nonFiniteOnly: `${picked.filter(r => r.witness && !r.witness.finite && escaped(r)).length} / ${picked.filter(r => r.witness && !r.witness.finite).length}` };
  };
  out[name] = { pristine: `${control.filter(r => r.promoted).length} / ${control.length}`, pristineRefused: control.filter(r => !r.promoted).map(r => ({ key: r.key, caught: r.caught, decision: r.decision?.decision ?? null })),
    sampledP21: summary(sampled, 'P21'), sampledAdd: summary(sampled, 'add'), glueP21: summary(glue, 'P21'), glueAdd: summary(glue, 'add'),
    harnessErrors: [...control, ...sampled, ...glue].filter(r => r.caught === 'harness_error' || /harness/.test(r.error ?? '')).length,
    elapsedP50Ms: (() => { const v = [...sampled, ...glue].map(r => r.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b); return v[Math.ceil(v.length / 2) - 1]; })() };
}
if (offline) {
  const pipeline = new Map(rows(s1, 'sampled').concat(rows(s1, 'glue'), rows(s1, 'control')).map(r => [r.mutant, r]));
  const off = readFileSync(offline, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const relevant = off.filter(r => pipeline.has(r.mutant) && arms.S0.escaped(pipeline.get(r.mutant)));
  const disagree = relevant.filter(r => (r.decision === 'refuse') !== synthRefused(pipeline.get(r.mutant)));
  out.crossCheck = { rows: relevant.length, disagree: disagree.length, examples: disagree.slice(0, 5).map(r => r.mutant) };
}
console.log(JSON.stringify(out, null, 1));
