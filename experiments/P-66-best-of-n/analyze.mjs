import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify } from './classify.mjs';
import { strategies, namedArms, sampleOf, evaluateNeed, aggregate, decide, passAtK, failureIcc, quantile, rng } from './strategies.mjs';
import { features, fitRouter, runHeldOut, oracle, score, routerSettings } from './router.mjs';

const [output, stage = 'main', write] = process.argv.slice(2);
const here = path => new URL(path, import.meta.url);
const lines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const all = lines(join(output, 'rows.jsonl')).filter(row => row.stage === stage);
const rows = all.filter(row => row.complete);
const p56Rows = lines(here('../P-56-model-effort/receipt/rows.jsonl'));
const classFile = join(output, stage, 'classification.json');
const classes = existsSync(join(output, stage)) && rows.some(row => existsSync(join(output, stage, `${row.need}--${row.arm}--${row.sample}.content.json`))) ? classify(rows, join(output, stage)) : JSON.parse(readFileSync(here('./receipt/classification.json'), 'utf8'));
writeFileSync(classFile, JSON.stringify(classes, null, 1));

const needs = [...new Set(rows.map(row => row.need))];
const splitOf = Object.fromEntries(rows.map(row => [row.need, row.split]));
const frozenNeeds = new Set(classes.filter(c => c.class === 'frozen-wrong').map(c => c.need));
const perNeed = Object.fromEntries(needs.map(need => [need, evaluateNeed(rows.filter(row => row.need === need).map(sampleOf))]));
const groupOf = need => features(need, p56Rows).group;
const round = (value, digits = 4) => value === null || value === undefined ? null : +value.toFixed(digits);
const tidy = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]));

function view(name, viewNeeds) {
  const table = strategies.map(s => tidy(aggregate(perNeed, viewNeeds, s)));
  const decision = decide(table);
  const named = decide(table.filter(row => namedArms.includes(row.strategy)));
  const counts = viewNeeds.map(need => rows.filter(row => row.need === need && row.arm === 'sonnet-low' && row.promoted).length);
  const m = 8;
  const curve = passAtK(counts, m).map(tidy);
  const icc = failureIcc(counts, m);
  const random = rng(66);
  const boot = Array.from({ length: 2000 }, () => { const pick = viewNeeds.map(() => counts[Math.floor(random() * counts.length)]); return failureIcc(pick, m); }).filter(Number.isFinite).sort((a, b) => a - b);
  const iccInterval = boot.length ? [boot[Math.floor(0.025 * boot.length)], boot[Math.floor(0.975 * boot.length)]] : null;
  const saturation = curve.find(point => point.observed >= curve.at(-1).observed - 0.01)?.k ?? null;
  return { name, needs: viewNeeds.length, needList: viewNeeds, table, decision, namedDecision: named, passAtK: curve, saturationK: saturation, failureIcc: round(icc), failureIccInterval: iccInterval?.map(v => round(v)), lowPromotedPerNeed: Object.fromEntries(viewNeeds.map((n, i) => [n, counts[i]])) };
}

function routerView(name, viewNeeds) {
  const fitNeeds = viewNeeds.filter(need => splitOf[need] === 'fit'), heldNeeds = viewNeeds.filter(need => splitOf[need] === 'heldout');
  const state = fitRouter({ fitNeeds, perNeed, groupOf, p56Rows });
  const fixed = strategies.map(s => tidy(aggregate(perNeed, heldNeeds, s)));
  const best = decide(fixed);
  const bestRow = fixed.find(row => row.strategy === best.winner);
  const bestPass = Math.max(...fixed.map(row => row.passRate ?? 0));
  const greedyDecisions = runHeldOut({ state, heldNeeds, perNeed, groupOf, epsilon: 0, seed: null });
  const greedy = score(perNeed, greedyDecisions);
  const runs = Array.from({ length: routerSettings.seeds }, (_, seed) => { const d = runHeldOut({ state, heldNeeds, perNeed, groupOf, epsilon: routerSettings.epsilon, seed: seed + 1 }); return { d, s: score(perNeed, d) }; });
  const meanOf = key => runs.reduce((t, r) => t + (r.s[key] ?? 0), 0) / runs.length;
  const pct = (key, q) => { const v = runs.map(r => r.s[key]).filter(Number.isFinite).sort((a, b) => a - b); return v[Math.floor(q * (v.length - 1))]; };
  const exploring = { passRate: meanOf('passRate'), costPerPromoted: meanOf('costPerPromoted'), failedPerPromoted: meanOf('failedPerPromoted'), costInterval: [pct('costPerPromoted', 0.05), pct('costPerPromoted', 0.95)], passInterval: [pct('passRate', 0.05), pct('passRate', 0.95)],
    timeP50: quantile(runs.flatMap(r => r.s.times.map(x => ({ t: x.t, w: x.w / runs.length }))), 0.5) };
  const oracleDecisions = oracle(perNeed, heldNeeds);
  const oracleScore = score(perNeed, oracleDecisions);
  const gap = (c) => bestRow && oracleScore.costPerPromoted !== null && bestRow.costPerPromoted > oracleScore.costPerPromoted ? (bestRow.costPerPromoted - c) / (bestRow.costPerPromoted - oracleScore.costPerPromoted) : null;
  const frequency = Object.fromEntries(heldNeeds.map(need => [need, Object.fromEntries(strategies.map(s => [s, round(runs.filter(r => r.d.find(x => x.need === need).chosen === s).length / runs.length, 3)]).filter(([, v]) => v > 0))]));
  const bar = { costMet: exploring.costPerPromoted <= (bestRow?.costPerPromoted ?? Infinity) + 1e-12, passMet: exploring.passRate >= bestPass - 0.02 - 1e-12 };
  return { name, fitNeeds, heldNeeds, groups: Object.fromEntries(viewNeeds.map(n => [n, groupOf(n)])), fixedOnHeldOut: fixed, bestFixed: best, bestPass: round(bestPass),
    greedy: tidy({ passRate: greedy.passRate, costPerPromoted: greedy.costPerPromoted, failedPerPromoted: greedy.failedPerPromoted, timeP50: quantile(greedy.times, 0.5), gapClosed: gap(greedy.costPerPromoted) }),
    exploring: { ...tidy(exploring), costInterval: exploring.costInterval.map(v => round(v)), passInterval: exploring.passInterval.map(v => round(v)), gapClosed: round(gap(exploring.costPerPromoted)) },
    oracle: tidy({ passRate: oracleScore.passRate, costPerPromoted: oracleScore.costPerPromoted, timeP50: quantile(oracleScore.times, 0.5) }), bar: { ...bar, met: bar.costMet && bar.passMet },
    decisions: greedyDecisions.map(d => ({ need: d.need, group: d.group, chosen: d.chosen, oracle: oracleDecisions.find(o => o.need === d.need).chosen, estimates: d.estimates })), exploringFrequency: frequency };
}

const decisionNeeds = needs.filter(need => !frozenNeeds.has(need));
const callsUsed = all.reduce((s, row) => s + row.replies.length, 0);
const analysis = {
  stage, completeNeeds: needs.length, incompleteNeeds: [...new Set(all.filter(r => !r.complete).map(r => r.need))], callsRecorded: callsUsed,
  frozenWrong: classes.filter(c => c.class === 'frozen-wrong'), failureClasses: Object.fromEntries(['frozen-wrong', 'other', 'gates-other', 'no-candidate'].map(k => [k, classes.filter(c => c.class === k).length])),
  excludedNeeds: [...frozenNeeds],
  load: { start: Math.min(...rows.map(r => r.loadStart)), max: Math.max(...rows.map(r => Math.max(r.loadStart, r.loadEnd))), loadedRuns: rows.filter(r => r.loadStart > 16 || r.loadEnd > 16).length, runs: rows.length },
  auth: [...new Set(rows.flatMap(r => r.inits.map(i => `${i.model}|${i.apiKeySource}`)))],
  views: { decision: view('decision', decisionNeeds), asIs: view('as-is', needs) },
  router: { decision: routerView('decision', decisionNeeds), asIs: routerView('as-is', needs) },
  perNeed: Object.fromEntries(needs.map(need => [need, Object.fromEntries(Object.entries(perNeed[need]).map(([s, c]) => [s, { pass: round(c.pass, 3), cost: round(c.cost), calls: round(c.calls, 2), failed: round(c.failed, 2) }]))])),
};
console.log(JSON.stringify({ completeNeeds: analysis.completeNeeds, calls: callsUsed, failureClasses: analysis.failureClasses, excluded: analysis.excludedNeeds,
  decision: analysis.views.decision.decision, named: analysis.views.decision.namedDecision, asIs: analysis.views.asIs.decision, icc: analysis.views.asIs.failureIcc,
  routerBar: analysis.router.decision.bar, routerGap: analysis.router.decision.exploring.gapClosed }, null, 1));
for (const v of Object.values(analysis.views)) { console.log(`\n${v.name} (${v.needs} needs)`); for (const row of v.table) console.log(JSON.stringify(row)); console.log('pass@k', v.passAtK.map(p => `${p.k}:${p.observed}/${p.independent}`).join(' ')); }
writeFileSync(join(output, stage, 'analysis.json'), JSON.stringify(analysis, null, 1));
if (write === 'write') { writeFileSync(here('./receipt/analysis.json'), JSON.stringify(analysis, null, 1)); writeFileSync(here('./receipt/classification.json'), JSON.stringify(classes, null, 1)); }
