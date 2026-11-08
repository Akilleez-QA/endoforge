import { readFileSync, writeFileSync } from 'node:fs';
import { classes } from './mutate.mjs';

export const resamples = 10000;
const caught = status => status === 'flagged' || status === 'corrected';
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function clustered(rows, metric) {
  const groups = [...Map.groupBy(rows, r => r.hash).values()];
  const point = metric(rows);
  if (!groups.length) return { point: null, lo: null, hi: null, n: 0, clusters: 0 };
  const next = random(70), values = [];
  for (let r = 0; r < resamples; r++) {
    const sample = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(next() * groups.length)]);
    values.push(metric(sample));
  }
  values.sort((a, b) => a - b);
  return { point, lo: values[Math.floor(0.025 * resamples)], hi: values[Math.ceil(0.975 * resamples) - 1], n: rows.length, clusters: groups.length };
}
const share = test => rows => rows.length ? rows.filter(test).length / rows.length : 0;
const specShare = (field) => rows => { const specs = Map.groupBy(rows, r => r.hash); return specs.size ? [...specs.values()].filter(g => g.some(r => caught(r[field]))).length / specs.size : 0; };

export function summarize({ pristine, injected, excluded }) {
  const arm = field => ({
    falseFlagSpecs: clustered(pristine, specShare(field)),
    falseFlagTests: clustered(pristine, share(r => caught(r[field]))),
    recall: clustered(injected, share(r => caught(r[field]))),
    abstainedPristine: clustered(pristine, share(r => r[field] === 'abstained')),
    abstainedInjected: clustered(injected, share(r => r[field] === 'abstained')),
    verifiedPristine: clustered(pristine, share(r => r[field] === 'verified')),
    recallByClass: Object.fromEntries(classes.map(c => [c, clustered(injected.filter(r => r.class === c), share(r => caught(r[field])))])),
    injectedStatus: Object.fromEntries([...Map.groupBy(injected, r => r[field])].map(([k, v]) => [k, v.length])),
    pristineStatus: Object.fromEntries([...Map.groupBy(pristine, r => r[field])].map(([k, v]) => [k, v.length])),
  });
  const paired = (rows, metric) => clustered(rows, sample => metric(sample.map(r => ({ ...r, field: r.after }))) - metric(sample.map(r => ({ ...r, field: r.before }))));
  return {
    specs: new Set(pristine.map(r => r.hash)).size, pristineTests: pristine.length, injected: injected.length, excluded: excluded.length,
    injectedByClass: Object.fromEntries(classes.map(c => [c, injected.filter(r => r.class === c).length])),
    before: arm('before'), after: arm('after'),
    difference: { recall: paired(injected, share(r => caught(r.field))), falseFlagSpecs: paired(pristine, specShare('field')) },
    falseFlagsAfter: pristine.filter(r => caught(r.after)).map(r => ({ hash: r.hash, need: r.need, index: r.index })),
    missedAfter: Object.fromEntries(classes.map(c => [c, Object.fromEntries([...Map.groupBy(injected.filter(r => r.class === c && !caught(r.after)), r => r.after)].map(([k, v]) => [k, v.length]))])),
  };
}

export function verdicts(summary) {
  const a = summary.after;
  return {
    B1_falseFlagSpecs: { bar: 'upper 95% bound <= 2%', met: a.falseFlagSpecs.hi <= 0.02 },
    B2_recall: { bar: 'point >= 50% and lower 95% bound >= 40%', met: a.recall.point >= 0.5 && a.recall.lo >= 0.4 },
    B3_abstention: { bar: 'abstained pristine tests, upper 95% bound <= 10%', met: a.abstainedPristine.hi <= 0.10 },
    S1_falseFlagTests: { bar: 'upper 95% bound <= 0.5%', met: a.falseFlagTests.hi <= 0.005 },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsPath, output] = process.argv.slice(2);
  const summary = summarize(JSON.parse(readFileSync(rowsPath, 'utf8')));
  const result = { summary, verdicts: verdicts(summary) };
  if (output) writeFileSync(output, JSON.stringify(result, null, 1));
  const fmt = m => m.point === null ? 'n/a' : `${(100 * m.point).toFixed(2)}% [${(100 * m.lo).toFixed(2)}, ${(100 * m.hi).toFixed(2)}] (n=${m.n}, specs=${m.clusters})`;
  for (const arm of ['before', 'after']) {
    const s = summary[arm];
    console.log(`${arm}: falseFlagSpecs ${fmt(s.falseFlagSpecs)}; falseFlagTests ${fmt(s.falseFlagTests)}; recall ${fmt(s.recall)}; abstainedPristine ${fmt(s.abstainedPristine)}; verifiedPristine ${fmt(s.verifiedPristine)}`);
    console.log(`  by class: ${Object.entries(s.recallByClass).map(([c, m]) => `${c} ${fmt(m)}`).join('; ')}`);
  }
  console.log(`difference after-before: recall ${fmt(summary.difference.recall)}; falseFlagSpecs ${fmt(summary.difference.falseFlagSpecs)}`);
  console.log(JSON.stringify(result.verdicts));
}
