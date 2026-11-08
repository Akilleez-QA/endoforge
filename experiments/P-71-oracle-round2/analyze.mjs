import { readFileSync, writeFileSync } from 'node:fs';
import { summarize, verdicts as p70Verdicts } from '../P-70-oracle-injected/analyze.mjs';
import { classes } from '../P-70-oracle-injected/mutate.mjs';

export const resamples = 10000;
const caught = status => status === 'flagged' || status === 'corrected';
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function byNeed(rows, metric) {
  const groups = [...Map.groupBy(rows, r => r.need).values()];
  if (!groups.length) return { point: null, lo: null, hi: null, clusters: 0 };
  const next = random(71), values = [];
  for (let r = 0; r < resamples; r++) {
    const sample = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(next() * groups.length)]);
    values.push(metric(sample));
  }
  values.sort((a, b) => a - b);
  return { point: metric(rows), lo: values[Math.floor(0.025 * resamples)], hi: values[Math.ceil(0.975 * resamples) - 1], clusters: groups.length };
}
const share = test => rows => rows.length ? rows.filter(test).length / rows.length : 0;
const specShare = field => rows => { const specs = Map.groupBy(rows, r => r.hash); return specs.size ? [...specs.values()].filter(g => g.some(r => caught(r[field]))).length / specs.size : 0; };

export function needClustered({ pristine, injected }) {
  return {
    falseFlagSpecs: byNeed(pristine, specShare('after')), falseFlagTests: byNeed(pristine, share(r => caught(r.after))),
    recall: byNeed(injected, share(r => caught(r.after))), abstainedPristine: byNeed(pristine, share(r => r.after === 'abstained')),
    recallByClass: Object.fromEntries(classes.map(c => [c, byNeed(injected.filter(r => r.class === c), share(r => caught(r.after)))])),
  };
}

export function verdicts(summary, need) {
  const a = summary.after, base = p70Verdicts(summary), value = classes.filter(c => c !== 'boundary');
  return {
    ...base,
    S2_valueClasses: { bar: 'sign, scale, rounding and swap recall each >= 50% (point)', met: value.every(c => a.recallByClass[c].point >= 0.5) },
    S3_boundary: { bar: 'boundary recall >= 30% (point)', met: a.recallByClass.boundary.point >= 0.3 },
    byNeed: {
      B1: need.falseFlagSpecs.hi <= 0.02, B2: need.recall.point >= 0.5 && need.recall.lo >= 0.4, B3: need.abstainedPristine.hi <= 0.10, S1: need.falseFlagTests.hi <= 0.005,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsPath, output] = process.argv.slice(2);
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')), summary = summarize(rows), need = needClustered(rows);
  const result = { summary, byNeed: need, verdicts: verdicts(summary, need) };
  if (output) writeFileSync(output, JSON.stringify(result, null, 1));
  const fmt = m => m.point === null ? 'n/a' : `${(100 * m.point).toFixed(2)}% [${(100 * m.lo).toFixed(2)}, ${(100 * m.hi).toFixed(2)}]`;
  for (const arm of ['before', 'after']) {
    const s = summary[arm];
    console.log(`${arm}: falseFlagSpecs ${fmt(s.falseFlagSpecs)}; falseFlagTests ${fmt(s.falseFlagTests)}; recall ${fmt(s.recall)}; abstainedPristine ${fmt(s.abstainedPristine)}; abstainedInjected ${fmt(s.abstainedInjected)}; verifiedPristine ${fmt(s.verifiedPristine)}`);
    console.log(`  by class: ${Object.entries(s.recallByClass).map(([c, m]) => `${c} ${fmt(m)} n=${m.n}`).join('; ')}`);
  }
  console.log(`by need (after): falseFlagSpecs ${fmt(need.falseFlagSpecs)}; falseFlagTests ${fmt(need.falseFlagTests)}; recall ${fmt(need.recall)}; abstainedPristine ${fmt(need.abstainedPristine)}`);
  console.log(`  by class: ${Object.entries(need.recallByClass).map(([c, m]) => `${c} ${fmt(m)}`).join('; ')}`);
  console.log(`difference after-before: recall ${fmt(summary.difference.recall)}; falseFlagSpecs ${fmt(summary.difference.falseFlagSpecs)}`);
  console.log(`specs ${summary.specs}, pristine tests ${summary.pristineTests}, injected ${summary.injected}, excluded ${summary.excluded}; missed after ${JSON.stringify(summary.missedAfter)}`);
  console.log(JSON.stringify(result.verdicts));
}
