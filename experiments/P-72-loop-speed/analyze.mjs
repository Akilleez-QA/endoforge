import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { quantile as weightedQuantile, rng } from '../P-66-best-of-n/strategies.mjs';
import { armNames, comparisonOf, loadLimit, resamples as defaultResamples, seedOf, verifiedPrecommit } from './design.mjs';

const total = values => values.reduce((sum, value) => sum + value, 0);
const mean = values => values.length ? total(values) / values.length : null;
const per = (sum, count) => count ? sum / count : null;
const epsilon = 1e-12;

export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

export function expectedTime(runs) {
  if (!runs.length) return null;
  const promoted = runs.filter(run => run.promoted).length;
  return promoted ? mean(runs.map(run => run.wallMs / 1000)) / (promoted / runs.length) : Infinity;
}

export function bootstrap(values, seed, count = defaultResamples) {
  if (!values.length) return null;
  const next = rng(seed), means = new Float64Array(count), n = values.length;
  for (let r = 0; r < count; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(next() * n)];
    means[r] = sum / n;
  }
  means.sort();
  return [means[Math.floor(0.025 * count)], means[Math.ceil(0.975 * count) - 1]];
}

export function cellsOf(rows) {
  const cells = {};
  for (const row of rows) ((cells[row.need] ??= {})[row.arm] ??= []).push(row);
  return cells;
}

export function completeNeeds(rows) {
  const needs = [...new Set(rows.map(row => row.need))];
  return needs.filter(need => rows.filter(row => row.need === need).every(row => row.complete === true));
}

export function checkCorrection(need, correction) {
  const entry = hNeeds.find(h => h.id === need), frozen = correction.frozen;
  if (!entry || !frozen || !entry.reference[frozen.fn]) return { status: 'unchecked', reason: entry ? 'frozen test not recorded' : 'no reference for an R need' };
  let reference;
  try { reference = { trap: false, value: entry.reference[frozen.fn](...frozen.args) }; } catch { reference = { trap: true }; }
  const frozenTrap = frozen.expectError === true;
  if (reference.trap || frozenTrap) return { status: reference.trap === frozenTrap ? 'agrees' : 'contradicted', reference, frozen };
  const allowed = Math.max(Number.isFinite(frozen.tol) ? frozen.tol : 0, 1e-6 * Math.max(1, Math.abs(reference.value)));
  const agrees = typeof frozen.expect === 'number' ? Math.abs(frozen.expect - reference.value) <= allowed : frozen.expect === reference.value;
  return { status: agrees ? 'agrees' : 'contradicted', reference, frozen };
}

const oracleRefused = row => Boolean(row.limits?.oracle) && !row.promoted && !row.rounds.length && row.oracle === null && row.extraTurns.oracleFlag > 0;
const causes = ['g8', 'afterPass', 'repeated', 'oracleFlag', 'failedCheck', 'invalidReply'];

export function armSummary(cells, needs, arm) {
  const runs = needs.flatMap(need => cells[need]?.[arm] ?? []);
  const armNeeds = needs.filter(need => cells[need]?.[arm]?.length);
  const expected = Object.fromEntries(armNeeds.map(need => [need, expectedTime(cells[need][arm])]));
  const finite = Object.values(expected).filter(Number.isFinite);
  const promoted = runs.filter(run => run.promoted), walls = promoted.map(run => run.wallMs / 1000);
  const checked = runs.filter(run => run.firstCheck);
  const corrections = runs.flatMap(run => run.corrections.map(correction => ({ need: run.need, sample: run.sample, ...checkCorrection(run.need, correction) })));
  return {
    arm, needs: armNeeds.length, runs: runs.length, promoted: promoted.length, passRate: per(promoted.length, runs.length),
    expectedTime: { perNeed: expected, mean: mean(finite), infiniteNeeds: armNeeds.filter(need => !Number.isFinite(expected[need])) },
    promotedWall: { p50: quantile(walls, 0.5), p90: quantile(walls, 0.9) },
    perPromoted: { calls: per(total(runs.map(run => run.calls)), promoted.length), outputTokens: per(total(runs.map(run => run.outputTokens)), promoted.length), leu: per(total(runs.map(run => run.leu)), promoted.length) },
    escapes: runs.filter(run => run.escaped).length, escaped: runs.filter(run => run.escaped).map(run => ({ need: run.need, sample: run.sample, failed: run.heldOut?.failed ?? null })),
    firstCheck: { runs: checked.length, withoutCheck: runs.length - checked.length, passRate: per(checked.filter(run => run.firstCheck.pass).length, checked.length),
      g4: per(checked.filter(run => run.firstCheck.g4).length, checked.length), g7: per(checked.filter(run => run.firstCheck.g7).length, checked.length) },
    extraTurns: Object.fromEntries(causes.map(cause => [cause, { total: total(runs.map(run => run.extraTurns[cause] ?? 0)), perRun: per(total(runs.map(run => run.extraTurns[cause] ?? 0)), runs.length) }])),
    g8FirstCheck: runs.filter(run => run.firstCheck?.gates.includes('G8_nonfinite')).length,
    oracle: { flagTurns: total(runs.map(run => run.extraTurns.oracleFlag)), flaggedAtFreeze: total(runs.map(run => run.oracle?.flagged ?? 0)), corrected: total(runs.map(run => run.oracle?.corrected ?? 0)),
      abstained: total(runs.map(run => run.oracle?.abstained ?? 0)), refusals: runs.filter(oracleRefused).length, corrections,
      contradicted: corrections.filter(c => c.status === 'contradicted').length, unchecked: corrections.filter(c => c.status === 'unchecked').length },
    texts: { g8: runs.flatMap(run => run.g8Failures.map(text => ({ need: run.need, sample: run.sample, text }))), oracleFlags: runs.flatMap(run => run.oracleFlags.map(text => ({ need: run.need, sample: run.sample, text }))) },
    loadedRuns: runs.filter(run => run.loaded || run.loadStart > loadLimit || run.loadEnd > loadLimit).length,
  };
}

export function paired(cells, needs, arm, base, seed, count = defaultResamples) {
  const usable = needs.filter(need => cells[need]?.[arm]?.length && cells[need]?.[base]?.length);
  const differences = [], infinite = [];
  for (const need of usable) {
    const a = expectedTime(cells[need][arm]), b = expectedTime(cells[need][base]);
    if (Number.isFinite(a) && Number.isFinite(b)) differences.push({ need, difference: a - b });
    else infinite.push({ need, arm: Number.isFinite(a) ? a : null, base: Number.isFinite(b) ? b : null });
  }
  const values = differences.map(d => d.difference);
  const runsOf = name => usable.flatMap(need => cells[need][name]);
  const rate = name => per(runsOf(name).filter(run => run.promoted).length, runsOf(name).length);
  const escapes = name => runsOf(name).filter(run => run.escaped).length;
  const armRate = rate(arm), baseRate = rate(base);
  return { arm, base, needs: usable.length, differences, infiniteNeeds: infinite, mean: mean(values), interval: bootstrap(values, seed, count),
    pass: { arm: armRate, base: baseRate, difference: armRate === null || baseRate === null ? null : armRate - baseRate }, escapes: { arm: escapes(arm), base: escapes(base) } };
}

export const ruleText = {
  fixed: '`fixed` against `main`: the three fixes stay recommended for merge if `fixed` is not worse on pass and has no more escapes. Its change in expected time is reported, not judged.',
  oracle: '`oracle` against `fixed`: `limits.oracle` defaults to on if the mean paired change in expected time is below zero with an upper bound under +0.5 s, `oracle` is not worse on pass, has no more escapes, and no correction froze a value its reference contradicts.',
  overlap: '`overlap` against `fixed`: implementation overlap is adopted as the default only if the mean paired change in expected time is at most −2 s with an upper bound below zero, `overlap` is not worse on pass and has no more escapes, and the freeze rule in candidate-loop.md is amended to say that code may be written before the freeze but is never shown the tests and never checked before it. Otherwise it stays behind its flag.',
  compact: '`compact` against `fixed`: the compact form defaults to on if the mean paired change in expected time is below zero with an upper bound below zero, and it is not worse on pass.',
  combination: 'Arms that pass are combined only in a later experiment; this one does not decide the combination.',
};

export function verdict(arm, comparison, summary) {
  if (!comparison || !comparison.needs) return { arm, rule: ruleText[arm], decided: false, outcome: 'not decided: no complete need ran both arms' };
  if (comparison.mean === null) return { arm, rule: ruleText[arm], decided: false, outcome: 'not decided: no need has a finite expected time in both arms', comparison };
  const notWorse = comparison.pass.difference >= -0.02 - epsilon, noMoreEscapes = comparison.escapes.arm <= comparison.escapes.base;
  const [, upper] = comparison.interval, change = comparison.mean;
  const checks = { notWorseOnPass: notWorse, noMoreEscapes };
  let met, outcome;
  if (arm === 'fixed') {
    met = notWorse && noMoreEscapes;
    outcome = met ? 'the three fixes stay recommended for merge' : 'the three fixes are not recommended for merge by this rule';
  } else if (arm === 'oracle') {
    Object.assign(checks, { meanBelowZero: change < 0, upperUnderHalfSecond: upper < 0.5, noContradictedCorrection: summary.oracle.contradicted === 0 });
    met = Object.values(checks).every(Boolean);
    outcome = met ? '`limits.oracle` defaults to on' : '`limits.oracle` stays off by default';
  } else if (arm === 'overlap') {
    Object.assign(checks, { meanAtMostMinusTwo: change <= -2 + epsilon, upperBelowZero: upper < 0 });
    met = Object.values(checks).every(Boolean);
    outcome = met ? 'implementation overlap is adopted as the default once the freeze rule in candidate-loop.md is amended as the rule states' : 'implementation overlap stays behind its flag';
  } else {
    delete checks.noMoreEscapes;
    Object.assign(checks, { meanBelowZero: change < 0, upperBelowZero: upper < 0 });
    met = Object.values(checks).every(Boolean);
    outcome = met ? 'the compact form defaults to on' : 'the compact form stays off by default';
  }
  return { arm, base: comparison.base, rule: ruleText[arm], decided: true, met, outcome, checks, changeSeconds: change, interval: comparison.interval, pass: comparison.pass, escapes: comparison.escapes,
    needs: comparison.needs, needsWithoutFiniteTime: comparison.infiniteNeeds.map(entry => entry.need) };
}

const begun = (row, offset, cut) => row.replies.filter(reply => offset + reply.beginMs < cut).length;
export function race(entries) {
  const finishes = entries.filter(entry => entry.row.promoted).map(entry => ({ entry, at: entry.offset + entry.row.wallMs })).sort((a, b) => a.at - b.at);
  const cut = finishes.length ? finishes[0].at : Infinity, pass = finishes.length > 0;
  const end = pass ? cut : Math.max(...entries.map(entry => entry.offset + entry.row.wallMs));
  return { pass, time: pass ? cut / 1000 : null, end: end / 1000, calls: total(entries.map(entry => (entry.offset < cut ? begun(entry.row, entry.offset, cut) : 0))),
    started: entries.filter(entry => entry.offset < cut).length, escaped: pass ? Boolean(finishes[0].entry.row.escaped) : false };
}

export function hedge(first, second, thresholdMs) {
  if (first.promoted && first.wallMs <= thresholdMs) return race([{ row: first, offset: 0 }]);
  return race([{ row: first, offset: 0 }, { row: second, offset: thresholdMs }]);
}

function strategy(name, perNeed) {
  const needs = Object.keys(perNeed).filter(need => perNeed[need].length);
  const times = needs.flatMap(need => perNeed[need].filter(o => o.pass).map(o => ({ t: o.time, w: 1 / perNeed[need].length })));
  const expected = needs.map(need => { const p = mean(perNeed[need].map(o => (o.pass ? 1 : 0))); return p ? mean(perNeed[need].map(o => o.end)) / p : Infinity; });
  return { strategy: name, label: name === 'single' ? 'recorded' : 'replay', needs: needs.length, passRate: mean(needs.map(need => mean(perNeed[need].map(o => (o.pass ? 1 : 0))))),
    expectedTime: mean(expected.filter(Number.isFinite)), needsWithoutFiniteTime: expected.filter(value => !Number.isFinite(value)).length,
    p50: weightedQuantile(times, 0.5), p90: weightedQuantile(times, 0.9), callsPerAttempt: mean(needs.map(need => mean(perNeed[need].map(o => o.calls)))),
    secondStarts: mean(needs.map(need => mean(perNeed[need].map(o => o.started - 1)))), escapes: mean(needs.map(need => mean(perNeed[need].map(o => (o.escaped ? 1 : 0))))) };
}

export function replays(cells, needs, arm = 'fixed') {
  const groups = Object.fromEntries(needs.filter(need => cells[need]?.[arm]?.length).map(need => [need, cells[need][arm]]));
  const walls = Object.values(groups).flat().filter(row => row.promoted).map(row => row.wallMs);
  const threshold = quantile(walls, 0.9);
  if (threshold === null) return { arm, label: 'replay', thresholdSeconds: null, strategies: [], note: 'no promoted run in the arm' };
  const map = make => Object.fromEntries(Object.entries(groups).map(([need, rows]) => [need, make(rows)]));
  const single = strategy('single', map(rows => rows.map(row => race([{ row, offset: 0 }]))));
  const hedged = strategy('hedge-at-p90', map(rows => rows.flatMap((first, i) => rows.filter((_, j) => j !== i).map(second => hedge(first, second, threshold)))));
  const bestOf2 = strategy('best-of-2-cancel', map(rows => rows.flatMap((a, i) => rows.slice(i + 1).map(b => race([{ row: a, offset: 0 }, { row: b, offset: 0 }])))));
  for (const row of [hedged, bestOf2]) row.extraCalls = row.callsPerAttempt - single.callsPerAttempt;
  const prediction = { text: 'Hedging replay: p90 time lower than `fixed` at under half the extra calls of best of 2.',
    met: hedged.p90 !== null && single.p90 !== null && hedged.p90 < single.p90 && hedged.extraCalls < 0.5 * bestOf2.extraCalls };
  return { arm, label: 'replay', thresholdSeconds: threshold / 1000, strategies: [single, hedged, bestOf2], prediction };
}

export function analyze(rows, { precommit, resamples = defaultResamples } = {}) {
  const seed = seedOf(precommit), needs = completeNeeds(rows), kept = rows.filter(row => needs.includes(row.need)), cells = cellsOf(kept);
  const arms = armNames.filter(arm => kept.some(row => row.arm === arm));
  const summaries = Object.fromEntries(arms.map(arm => [arm, armSummary(cells, needs, arm)]));
  const comparisons = Object.fromEntries(Object.entries(comparisonOf).filter(([arm, base]) => arms.includes(arm) && arms.includes(base)).map(([arm, base]) => [arm, paired(cells, needs, arm, base, seed, resamples)]));
  const verdicts = Object.keys(comparisonOf).map(arm => verdict(arm, comparisons[arm] ?? null, summaries[arm] ?? null));
  return { precommit, seed, resamples, testDouble: rows.some(row => row.testDouble), completeNeeds: needs, incompleteNeeds: [...new Set(rows.filter(row => !needs.includes(row.need)).map(row => row.need))],
    runs: kept.length, callsRecorded: total(rows.map(row => row.calls)), arms: summaries, comparisons, verdicts, combination: ruleText.combination,
    replays: arms.includes('fixed') ? replays(cells, needs, 'fixed') : null };
}

const f = (value, digits = 2) => value === null || value === undefined ? '–' : Number.isFinite(value) ? value.toFixed(digits) : String(value);
const pct = value => value === null || value === undefined ? '–' : `${(100 * value).toFixed(1)}%`;
export function report(analysis) {
  const lines = [`P-72 analysis${analysis.testDouble ? ' (test double rows: no model)' : ''}: ${analysis.completeNeeds.length} complete needs, ${analysis.runs} runs, ${analysis.callsRecorded} transport calls recorded; incomplete: ${analysis.incompleteNeeds.join(', ') || 'none'}`, ''];
  lines.push('| Arm | Needs | Runs | Pass | E[time] s (mean over needs) | Needs never promoted | p50 / p90 promoted s | Calls / tokens / LEU per promoted | Escapes | First check G4+G7 | Extra turns g8 / after pass / repeated / oracle flag | Loaded |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of Object.values(analysis.arms)) lines.push(`| \`${s.arm}\` | ${s.needs} | ${s.runs} | ${pct(s.passRate)} | ${f(s.expectedTime.mean)} | ${s.expectedTime.infiniteNeeds.length} | ${f(s.promotedWall.p50, 1)} / ${f(s.promotedWall.p90, 1)} | ${f(s.perPromoted.calls)} / ${f(s.perPromoted.outputTokens, 0)} / ${f(s.perPromoted.leu, 4)} | ${s.escapes} | ${pct(s.firstCheck.passRate)} of ${s.firstCheck.runs} | ${s.extraTurns.g8.total} / ${s.extraTurns.afterPass.total} / ${s.extraTurns.repeated.total} / ${s.extraTurns.oracleFlag.total} | ${s.loadedRuns} |`);
  const oracle = analysis.arms.oracle?.oracle;
  if (oracle) lines.push('', `oracle: ${oracle.flagTurns} flag turns, ${oracle.flaggedAtFreeze} flagged at the freeze, ${oracle.corrected} corrections (${oracle.contradicted} contradicted by the reference, ${oracle.unchecked} unchecked), ${oracle.refusals} refusals, ${oracle.abstained} abstentions`);
  lines.push('', 'Decision rules (paired by need, bootstrap 95% interval clustered by need):');
  for (const v of analysis.verdicts) {
    lines.push('', `- ${v.rule}`);
    lines.push(v.decided ? `  change ${f(v.changeSeconds)} s [${v.interval.map(x => f(x)).join(', ')}] over ${v.needs} needs${v.needsWithoutFiniteTime.length ? ` (${v.needsWithoutFiniteTime.length} without a finite time in one arm: ${v.needsWithoutFiniteTime.join(', ')})` : ''}; pass ${pct(v.pass.arm)} against ${pct(v.pass.base)}; escapes ${v.escapes.arm} against ${v.escapes.base}; ${JSON.stringify(v.checks)}`
      : `  ${v.outcome}`);
    if (v.decided) lines.push(`  Verdict: ${v.outcome}.`);
  }
  lines.push('', `- ${analysis.combination}`);
  if (analysis.replays?.strategies.length) {
    lines.push('', `Replays from the \`fixed\` runs (replays, not live runs), hedge threshold ${f(analysis.replays.thresholdSeconds, 1)} s:`, '', '| Strategy | Label | Pass | E[time] s | p50 / p90 s | Calls per attempt | Extra calls | Second starts |', '|---|---|---|---|---|---|---|---|');
    for (const s of analysis.replays.strategies) lines.push(`| ${s.strategy} | ${s.label} | ${pct(s.passRate)} | ${f(s.expectedTime)} | ${f(s.p50, 1)} / ${f(s.p90, 1)} | ${f(s.callsPerAttempt)} | ${f(s.extraCalls)} | ${f(s.secondStarts)} |`);
    lines.push('', `Prediction 5 (${analysis.replays.prediction.text}): ${analysis.replays.prediction.met ? 'met' : 'missed'}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, stage = 'main', write] = process.argv.slice(2);
  if (!output) throw Error('usage: node analyze.mjs <output> [stage] [write]');
  const precommit = verifiedPrecommit();
  const rows = readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage);
  if (stage === 'main' && rows.some(row => row.testDouble)) throw Error('main-stage rows from a test double');
  const analysis = analyze(rows, { precommit });
  console.log(report(analysis));
  mkdirSync(join(output, stage), { recursive: true });
  writeFileSync(join(output, stage, 'analysis.json'), JSON.stringify(analysis, null, 1));
  if (write === 'write') writeFileSync(new URL('./receipt/analysis.json', import.meta.url), JSON.stringify(analysis, null, 1));
}
