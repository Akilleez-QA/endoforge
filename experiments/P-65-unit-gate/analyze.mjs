import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [tree, out, s2a] = process.argv.slice(2);
const { clopperPearson, clusterBootstrap } = await import(resolve(tree, 'experiments/P-51-escape-rate/stats.mjs'));
const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const rows = (dir, arm) => (existsSync(join(dir, `${arm}.jsonl`)) ? jsonl(join(dir, `${arm}.jsonl`)) : []);
const classes = JSON.parse(readFileSync(new URL('./receipt/classification.json', import.meta.url), 'utf8'));
const gates = new Map(jsonl(join(out, 'gates-offline.jsonl')).map(r => [r.mutant, r]));
const evaluator = new Map(jsonl(join(out, 'offline-S2.jsonl')).map(r => [r.mutant, r]));
const failedGates = r => (r.caught ?? '').split('+').filter(g => /^G\d/.test(g));
const pct = (k, n) => `${k} / ${n} (${(100 * k / n).toFixed(2)}%)`;
const summary = (list, escaped) => {
  const k = list.filter(escaped).length, cp = clopperPearson(k, list.length), boot = clusterBootstrap(list, r => r.need, escaped);
  const by = field => Object.fromEntries([...new Set(list.map(r => r[field]))].sort().map(c => [c, `${list.filter(r => r[field] === c && escaped(r)).length} / ${list.filter(r => r[field] === c).length}`]));
  return { escaped: pct(k, list.length), clopperPearson: [cp.lower, cp.upper], bootstrap: boot, byClass: by('class'), byOp: by('op') };
};
const result = {};
const u2 = { control: rows(join(out, 'U2a'), 'control'), sampled: rows(join(out, 'U2a'), 'sampled').filter(r => r.cohort === 'P21'), glue: rows(join(out, 'U2a'), 'glue').filter(r => r.cohort === 'P21') };
const base = { sampled: rows(s2a, 'sampled').filter(r => r.cohort === 'P21'), glue: rows(s2a, 'glue').filter(r => r.cohort === 'P21') };
const u1 = rows(join(out, 'U1a'), 'control');
result.pristine = { U2: `${u2.control.filter(r => r.promoted).length} / ${u2.control.length}`, U2refused: u2.control.filter(r => !r.promoted).map(r => ({ key: r.key, caught: r.caught })),
  U1: `${u1.filter(r => r.promoted).length} / ${u1.length}`, U1refused: u1.filter(r => !r.promoted).map(r => ({ key: r.key, caught: r.caught })) };
const promoted = r => r.promoted;
result.sampledP21 = { U2: summary(u2.sampled, promoted), S2a: summary(base.sampled, promoted).escaped };
result.glueP21 = { U2: summary(u2.glue, promoted), S2a: summary(base.glue, promoted).escaped };
const escapedS2a = base.glue.filter(promoted).map(r => r.mutant), u2glue = new Map(u2.glue.map(r => [r.mutant, r]));
result.byEscapeClass = {};
for (const m of escapedS2a) {
  const c = classes[m] ?? 'unclassified', slot = (result.byEscapeClass[c] ??= { S2a: 0, U2: 0, dev: [0, 0], heldOut: [0, 0] });
  const still = u2glue.get(m)?.promoted ? 1 : 0, dev = /^cand-r[12]\//.test(m);
  slot.S2a++; slot.U2 += still; (dev ? slot.dev : slot.heldOut)[0]++; if (!still) (dev ? slot.dev : slot.heldOut)[1]++;
}
const cross = [];
for (const [arm, list, before] of [['sampled', u2.sampled, base.sampled], ['glue', u2.glue, base.glue]]) {
  const b = new Map(before.map(r => [r.mutant, r]));
  for (const r of list) {
    const was = b.get(r.mutant), offline = gates.get(r.mutant), g9 = offline?.failed.includes('G9_units');
    const expected = was?.promoted && !g9;
    if (Boolean(r.promoted) !== Boolean(expected)) cross.push({ mutant: r.mutant, arm, U2: r.promoted, S2a: was?.promoted ?? null, offlineG9: g9, caught: r.caught });
    if (offline && failedGates(r).includes('G9_units') !== Boolean(g9) && r.caught) cross.push({ mutant: r.mutant, arm, pipelineG9: failedGates(r).includes('G9_units'), offlineG9: g9 });
  }
}
result.crossCheck = { disagreements: cross.length, examples: cross.slice(0, 10) };
const p21 = [...u2.sampled, ...u2.glue];
const g9rows = p21.filter(r => gates.get(r.mutant)?.failed.includes('G9_units'));
const evalRefuses = r => evaluator.get(r.mutant)?.decision === 'refuse';
const otherGates = r => (gates.get(r.mutant)?.failed ?? []).some(g => g !== 'G9_units');
const share = (list, missed) => ({ g9Refusals: list.length, missedByOther: list.filter(missed).length, fraction: list.length ? +(list.filter(missed).length / list.length).toFixed(3) : null });
result.independence = {
  evaluator: share(g9rows, r => !evalRefuses(r)),
  existingGates: share(g9rows, r => !otherGates(r)),
  both: share(g9rows, r => !evalRefuses(r) && !otherGates(r)),
  bySurface: Object.fromEntries(['kernel', 'glue'].map(s => [s, share(g9rows.filter(r => r.surface === s), r => !evalRefuses(r))])),
  evaluatorRefusalsAlsoG9: (() => { const e = p21.filter(evalRefuses); return `${e.filter(r => gates.get(r.mutant)?.failed.includes('G9_units')).length} / ${e.length}`; })(),
  rules: (() => { const c = {}; for (const r of g9rows) for (const rule of new Set((gates.get(r.mutant).units ?? '').split('; ').map(x => x.split(':')[0]))) c[rule] = (c[rule] ?? 0) + 1; return c; })(),
};
const elapsed = list => { const v = list.map(r => r.timings?.gate).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? { p50: v[Math.ceil(v.length / 2) - 1], p95: v[Math.ceil(v.length * 0.95) - 1] } : null; };
result.gateStageMs = { U2: elapsed([...u2.sampled, ...u2.glue]), S2a: elapsed([...base.sampled, ...base.glue]) };
console.log(JSON.stringify(result, null, 1));
