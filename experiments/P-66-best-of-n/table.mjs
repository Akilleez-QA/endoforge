import { readFileSync } from 'node:fs';

const analysis = JSON.parse(readFileSync(process.argv[2] ?? new URL('./receipt/analysis.json', import.meta.url), 'utf8'));
const f = (v, d = 3) => v === null || v === undefined ? '–' : typeof v === 'number' ? v.toFixed(d) : String(v);
const pct = v => v === null || v === undefined ? '–' : `${(100 * v).toFixed(1)}%`;
for (const v of Object.values(analysis.views)) {
  console.log(`\n### ${v.name} view, ${v.needs} needs\n`);
  console.log('| Strategy | Pass rate | Cost per promoted (LEU) | Lower bound | Calls per promoted | Model-s per promoted | Failed per promoted | Time p50 / p90 s | Escapes |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of v.table) console.log(`| \`${r.strategy}\` | ${pct(r.passRate)} | ${f(r.costPerPromoted, 4)} | ${f(r.costLowerPerPromoted, 4)} | ${f(r.callsPerPromoted, 2)} | ${f(r.modelSecondsPerPromoted, 1)} | ${f(r.failedPerPromoted, 2)} | ${f(r.timeP50, 1)} / ${f(r.timeP90, 1)} | ${r.escapes} |`);
  console.log(`\nDecision: ${JSON.stringify(v.decision)}; named arms: ${JSON.stringify(v.namedDecision)}`);
  console.log(`\npass@k: ${v.passAtK.map(p => `k=${p.k} ${pct(p.observed)} (indep. ${pct(p.independent)})`).join('; ')}. Saturation k=${v.saturationK}. Failure ICC ${f(v.failureIcc)} [${(v.failureIccInterval ?? []).map(x => f(x)).join(', ')}].`);
}
for (const r of Object.values(analysis.router)) {
  console.log(`\n### Router, ${r.name} view: fit ${r.fitNeeds.length}, held-out ${r.heldNeeds.length}\n`);
  console.log('| Strategy on held-out | Pass rate | Cost per promoted | Time p50 s |');
  console.log('|---|---|---|---|');
  for (const x of r.fixedOnHeldOut) console.log(`| \`${x.strategy}\` | ${pct(x.passRate)} | ${f(x.costPerPromoted, 4)} | ${f(x.timeP50, 1)} |`);
  console.log(`| router (ε=0.1, mean of 1000) | ${pct(r.exploring.passRate)} [${r.exploring.passInterval.map(pct).join(', ')}] | ${f(r.exploring.costPerPromoted, 4)} [${r.exploring.costInterval.map(x => f(x, 4)).join(', ')}] | ${f(r.exploring.timeP50, 1)} |`);
  console.log(`| router greedy | ${pct(r.greedy.passRate)} | ${f(r.greedy.costPerPromoted, 4)} | ${f(r.greedy.timeP50, 1)} |`);
  console.log(`| oracle | ${pct(r.oracle.passRate)} | ${f(r.oracle.costPerPromoted, 4)} | ${f(r.oracle.timeP50, 1)} |`);
  console.log(`\nBest fixed: ${r.bestFixed.winner}; bar ${JSON.stringify(r.bar)}; gap closed exploring ${f(r.exploring.gapClosed)}, greedy ${f(r.greedy.gapClosed)}\n`);
  console.log('| Need | Group | Greedy choice | Oracle | Exploring frequency |');
  console.log('|---|---|---|---|---|');
  for (const d of r.decisions) console.log(`| ${d.need} | ${d.group} | \`${d.chosen}\` | \`${d.oracle}\` | ${Object.entries(r.exploringFrequency[d.need]).map(([s, p]) => `${s} ${p}`).join(', ')} |`);
}
