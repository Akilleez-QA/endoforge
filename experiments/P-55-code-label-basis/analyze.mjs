// Summarises P-55's arms against run C and the old-code rows, with the load at the time each row was written.
// node analyze.mjs <tree> <corpus> <prep> <main output> <base output> <run C dir> <old correlated dir> <P-51 run dir> <summary.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [tree, corpus, prep, main, base, runC, corrOld, p51, output] = process.argv.slice(2);
const { glueFindings } = await import(resolve(tree, 'core/runtime/x1/contract.mjs'));
const { loadCorpus } = await import(resolve(tree, 'experiments/P-51-escape-rate/prepare.mjs'));
const kernels = Object.fromEntries(loadCorpus(corpus, 'cand').map(k => [k.key, k]));
const glueRows = new Map(readFileSync(join(prep, 'mutants.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(r => r.surface === 'glue').map(r => [r.mutant, r]));
// The G7 findings the committed rule gives this glue row, read offline from the row's glue and the kernel's frozen contract.
const g7 = row => { const g = glueRows.get(row.mutant), k = kernels[row.key]; if (!g || !k) return null; return glueFindings(JSON.parse(g.glue), { source: k.source, contract: k.contract }); };
const rows = (dir, arm) => existsSync(join(dir, `${arm}.jsonl`)) ? readFileSync(join(dir, `${arm}.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const loads = dir => existsSync(join(dir, 'load.jsonl')) ? readFileSync(join(dir, 'load.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
// The load for row i of an arm is the first sample whose count for that arm reached i + 1.
const withLoad = (dir, arm) => {
  const samples = loads(dir), list = rows(dir, arm);
  return list.map((row, index) => ({ ...row, load1: samples.find(s => (s.rows[arm] ?? 0) >= index + 1)?.load[0] ?? null }));
};
const attempts = row => row.pool?.flatMap(job => job.attempts ?? []) ?? [];
const failingGates = row => {
  for (const a of attempts(row)) {
    if (!a.reason) continue;
    const found = [...a.reason.matchAll(/"(G\d_\w+)":\{"ok":false/g)].map(m => m[1]);
    if (found.length) return found;
  }
  return [];
};
const where = row => {
  if (row.promoted) return 'promoted';
  if (row.decision?.decision === 'inconclusive') return 'inconclusive';
  if (row.caught && !['unattributed', 'pipeline_stage'].includes(row.caught)) return row.caught;
  const gates = failingGates(row);
  if (gates.length) return gates.join('+');
  const failure = attempts(row).map(a => a.firstFailure).find(f => f && f !== 'residual');
  return failure ?? row.caught ?? 'unknown';
};
const count = (list, cohort) => { const l = list.filter(r => r.cohort === cohort); return { escaped: l.filter(r => r.promoted).length, submitted: l.length }; };
const quantile = (values, q) => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? +s[Math.floor(q * (s.length - 1))].toFixed(1) : null; };
const timing = list => {
  const quiet = list.filter(r => r.load1 !== null && r.load1 <= 16), loaded = list.filter(r => r.load1 === null || r.load1 > 16);
  const stats = l => ({ rows: l.length, gateMs: { p50: quantile(l.map(r => r.timings?.gate), 0.5), p95: quantile(l.map(r => r.timings?.gate), 0.95) }, elapsedMs: { p50: quantile(l.map(r => r.elapsedMs), 0.5), p95: quantile(l.map(r => r.elapsedMs), 0.95) } });
  const l1 = list.map(r => r.load1).filter(Number.isFinite);
  return { load1: { min: Math.min(...l1), p50: quantile(l1, 0.5), max: Math.max(...l1) }, quiet: stats(quiet), loaded: stats(loaded) };
};
const tally = (list, key) => { const out = {}; for (const r of list) out[key(r)] = (out[key(r)] ?? 0) + 1; return out; };
const summary = {};
for (const arm of ['control', 'glue', 'binding', 'sampled', 'correlated']) {
  const now = withLoad(main, arm);
  const before = arm === 'correlated' ? rows(corrOld, arm) : arm === 'binding' ? rows(p51, arm) : rows(runC, arm);
  const was = new Map(before.map(r => [r.mutant, r]));
  summary[arm] = {
    P21: count(now, 'P21'), add: count(now, 'add'), beforeP21: count(before, 'P21'), beforeAdd: count(before, 'add'),
    refusedAt: tally(now.filter(r => !r.promoted), where),
    inconclusive: now.filter(r => r.decision?.decision === 'inconclusive').length,
    gatesPassedDecisionRefused: now.filter(r => r.caught === 'gates_passed_decision_refused').length,
    newlyEscaped: now.filter(r => r.promoted && was.get(r.mutant) && !was.get(r.mutant).promoted).map(r => ({ mutant: r.mutant, op: r.op, before: where(was.get(r.mutant)), ...(arm === 'glue' ? { g7: g7(r) } : {}) })),
    newlyCaught: now.filter(r => !r.promoted && was.get(r.mutant)?.promoted).map(r => ({ mutant: r.mutant, op: r.op, at: where(r) })),
    timing: timing(now),
  };
  if (arm === 'control') summary[arm].refused = now.filter(r => !r.promoted).map(r => ({ mutant: r.mutant, at: where(r), decision: r.decision, error: r.error }));
}
const baseRows = withLoad(base, 'control').map(r => ({ ...r, key: r.key.replace(/^cand-/, 'base-'), mutant: r.mutant.replace(/^cand-/, 'base-') }));
summary.base = { promoted: baseRows.filter(r => r.promoted).length, submitted: baseRows.length, refused: baseRows.filter(r => !r.promoted).map(r => ({ mutant: r.mutant, at: where(r), decision: r.decision, error: r.error })), timing: timing(baseRows) };
writeFileSync(output, `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([arm, s]) => [arm, arm === 'base' ? `${s.promoted}/${s.submitted}` : { P21: s.P21, add: s.add, inconclusive: s.inconclusive, gpdr: s.gatesPassedDecisionRefused, newlyEscaped: s.newlyEscaped.length, newlyCaught: s.newlyCaught.length }]))));
