// Per-arm table and the precommitted decision rule. Usage:
//   node analyze.mjs <output> <stage> [sizing]
// With `sizing`, also prints the main-run size from this stage's variance (PRECOMMIT, Sizing).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [output, stage, mode] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
const rows = readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage);
const nearest = (values, q) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
const sum = values => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const mean = values => values.length ? sum(values) / values.length : null;
const sd = values => { const m = mean(values); return values.length > 1 ? Math.sqrt(sum(values.map(v => (v - m) ** 2)) / (values.length - 1)) : null; };
const runCost = row => { const costs = row.replies.map(reply => reply.costUsd).filter(Number.isFinite); return costs.length ? Math.max(...costs) : null; };
export const accepted = row => row.promoted && (row.need.startsWith('H') ? row.heldOut?.clean === true : true);

const arms = [...new Set(rows.map(row => row.arm))].sort((a, b) => Object.keys(plan.arms).indexOf(a) - Object.keys(plan.arms).indexOf(b));
const table = arms.map(arm => {
  const runs = rows.filter(row => row.arm === arm), ok = runs.filter(accepted), h = runs.filter(row => row.need.startsWith('H'));
  const hPromoted = h.filter(row => row.promoted), escapes = hPromoted.filter(row => row.heldOut?.clean !== true);
  const failed = sum(runs.map(row => row.rounds.filter(round => round.failed).length));
  const walls = runs.map(row => row.wallMs ?? 0);
  return {
    arm, runs: runs.length, promoted: runs.filter(row => row.promoted).length, accepted: ok.length, acceptedRate: ok.length / runs.length,
    firstPassAccepted: ok.filter(row => row.rounds.length > 0 && !row.rounds[0].failed).length / runs.length,
    failedCandidates: failed, failedPerAccepted: ok.length ? failed / ok.length : null,
    repairRoundsMean: mean(runs.map(row => Math.max(0, row.rounds.length - 1))),
    hPromoted: hPromoted.length, escapes: escapes.length, escapeRate: hPromoted.length ? escapes.length / hPromoted.length : null,
    escapedNeeds: escapes.map(row => row.need),
    secondsPerAccepted: ok.length ? sum(walls) / 1000 / ok.length : null,
    wallP50: nearest(walls, 0.5) / 1000, wallP95: nearest(walls, 0.95) / 1000, wallMean: mean(walls) / 1000, wallSd: sd(walls) / 1000,
    modelP50: nearest(runs.map(row => row.modelMs), 0.5) / 1000, nonModelP50: nearest(runs.map(row => row.nonModelMs), 0.5) / 1000, nonModelP95: nearest(runs.map(row => row.nonModelMs), 0.95) / 1000,
    turnsP50: nearest(runs.map(row => row.replies.length), 0.5), callsTotal: sum(runs.map(row => row.replies.length)),
    tokensP50: nearest(runs.map(row => row.agent?.tokens ?? sum(row.replies.map(reply => reply.usage))), 0.5),
    outputTokensP50: nearest(runs.map(row => sum(row.replies.map(reply => reply.detail?.output ?? 0))), 0.5),
    listCostUsd: sum(runs.map(runCost)),
    exits: Object.fromEntries([...new Set(runs.map(row => row.agent?.exit_reason ?? row.error ?? 'none'))].map(reason => [reason, runs.filter(row => (row.agent?.exit_reason ?? row.error ?? 'none') === reason).length])),
    loadedRuns: runs.filter(row => row.loadStart > 16 || row.loadEnd > 16).length,
    apiKeySources: [...new Set(runs.flatMap(row => row.inits.map(init => init.apiKeySource)))],
    models: [...new Set(runs.flatMap(row => row.inits.map(init => init.model)))],
  };
});

// Decision rule, fixed in PRECOMMIT.md.
const best = Math.max(...table.map(row => row.acceptedRate));
const escapeRates = table.map(row => row.escapeRate).filter(Number.isFinite);
const minEscape = escapeRates.length ? Math.min(...escapeRates) : 0;
const failedRates = table.map(row => row.failedPerAccepted).filter(Number.isFinite);
const minFailed = failedRates.length ? Math.min(...failedRates) : 0;
for (const row of table) {
  row.gates = {
    quality: row.acceptedRate >= best - 0.10,
    escapes: (row.escapeRate ?? 1) <= minEscape + 0.05,
    failedCandidates: row.failedPerAccepted !== null && row.failedPerAccepted <= minFailed + 0.5,
  };
  row.goodEnough = Object.values(row.gates).every(Boolean);
}
const qualifying = table.filter(row => row.goodEnough).sort((a, b) => a.secondsPerAccepted - b.secondsPerAccepted);
let recommended = qualifying[0] ?? null;
if (recommended) {
  const close = qualifying.filter(row => row.secondsPerAccepted <= recommended.secondsPerAccepted * 1.10).sort((a, b) => a.listCostUsd / a.accepted - b.listCostUsd / b.accepted);
  recommended = close[0];
}
const decision = { stage, best, minEscape, minFailed, qualifying: qualifying.map(row => row.arm), recommended: recommended?.arm ?? null };

let sizing = null;
if (mode === 'sizing') {
  const kept = table.filter(row => row.acceptedRate >= best - 0.30);
  const needed = kept.map(row => ({ arm: row.arm, cv: row.wallSd / row.wallMean, runsForSe10: Math.ceil((row.wallSd / row.wallMean / 0.10) ** 2), callsPerRun: row.callsTotal / row.runs }));
  const used = JSON.parse(readFileSync(join(output, 'calls.json'), 'utf8')).model, remaining = plan.budget.modelCalls - used;
  const needs = 30, callsPerRep = needs * sum(needed.map(arm => arm.callsPerRun)) * 1.25;
  const varianceReps = Math.max(1, Math.ceil(Math.max(...needed.map(arm => arm.runsForSe10)) / needs));
  const budgetReps = Math.floor(remaining / callsPerRep);
  sizing = { keptArms: kept.map(row => row.arm), dropped: table.filter(row => !kept.includes(row)).map(row => row.arm), perArm: needed, remainingCalls: remaining, callsPerRep: Math.round(callsPerRep), varianceReps, budgetReps,
    reps: Math.min(3, varianceReps, budgetReps) };
}
console.log(JSON.stringify({ table, decision, sizing }, null, 1));
