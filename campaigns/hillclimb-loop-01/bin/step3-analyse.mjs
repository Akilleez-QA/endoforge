#!/usr/bin/env node
// Step 3 analysis: the noise floor. Reads receipt/runs.jsonl (stage s3), receipt/scores-s3.jsonl and receipt/tokens.jsonl;
// writes receipt/noise-floor.json: per-arm clean counts under the median, strict and lenient panel rules, the A/A delta,
// gate and promotion counts, wall and token figures per run and per stage, inter-oracle agreement, and the step-4 arithmetic.
import fs from 'node:fs';
import path from 'node:path';
import { RECEIPT, json, writeJson, now } from '../lib/runner.mjs';
import { panelVerdict, ORACLES } from '../lib/oracle.mjs';
import { clopperPearson, agreement, median, quantile, bootstrapMedianCI } from '../lib/analysis.mjs';

const lines = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const runs = lines(path.join(RECEIPT, 'runs.jsonl')).filter((r) => r.stage === 's3');
const latest = {}; for (const r of runs) latest[r.runId] = r; // last record per run wins
const R = Object.values(latest);
const scores = lines(path.join(RECEIPT, 'scores-s3.jsonl')).filter((s) => s.verdict);
const tokens = lines(path.join(RECEIPT, 'tokens.jsonl'));
const tokByCall = Object.fromEntries(tokens.map((t) => [t.callId, t]));
const oracleIds = Object.keys(ORACLES);

function enrich(r) {
  const vs = Object.fromEntries(oracleIds.map((o) => [o, scores.find((s) => s.runId === r.runId && s.oracle === o)?.verdict ?? null]));
  const panel = r.gated ? panelVerdict(oracleIds.map((o) => vs[o])) : { median: null, medianClean: false, strict: false, lenient: false, n: 0 };
  const promoted = r.gated && r.status !== 'gated-rejected-by-persona';
  const calls = (r.calls ?? []).map((c) => tokByCall[c]).filter(Boolean);
  const tok = calls.reduce((s, c) => s + c.total, 0);
  const byTag = {}; for (const c of calls) byTag[c.tag] = (byTag[c.tag] || 0) + c.total;
  return { ...r, verdicts: vs, panel, promoted, clean: promoted && panel.medianClean, cleanStrict: promoted && panel.strict, cleanLenient: promoted && panel.lenient, tokens: tok, tokensByTag: byTag, wall_s: r.wall_ms / 1000 };
}
const E = R.map(enrich);
const arms = { 'inc-low-r1': E.filter((r) => r.arm === 'inc-low' && r.rep === 1), 'inc-low-r2': E.filter((r) => r.arm === 'inc-low' && r.rep === 2), 'inc-default-r1': E.filter((r) => r.arm === 'inc-default') };
const summ = (rs) => { const c = (k) => rs.filter((r) => r[k]).length; const walls = rs.map((r) => r.wall_s).sort((a, b) => a - b); const toks = rs.map((r) => r.tokens).sort((a, b) => a - b); return { n: rs.length, gated: c('gated'), promoted: c('promoted'), clean: c('clean'), cleanStrict: c('cleanStrict'), cleanLenient: c('cleanLenient'), cleanCI: rs.length ? clopperPearson(c('clean'), rs.length) : null, pendingChange: rs.filter((r) => r.status === 'promoted-pending-change').length, personaRejected: rs.filter((r) => r.status === 'gated-rejected-by-persona').length, rounds: { one: rs.filter((r) => r.roundsUsed === 1).length, more: rs.filter((r) => (r.roundsUsed ?? 1) > 1).length }, wall: { median: median(walls), p95: quantile(walls, 0.95) }, tokens: { median: median(toks), mean: toks.length ? toks.reduce((a, b) => a + b, 0) / toks.length : null, sum: toks.reduce((a, b) => a + b, 0) }, byRequest: Object.fromEntries(rs.map((r) => [r.request, { status: r.status, clean: r.clean, panel: r.panel.median, verdicts: r.verdicts, wall_s: +r.wall_s.toFixed(1), tokens: r.tokens }])) }; };
const S = Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, summ(v)]));
// A/A paired
const ids = [...new Set(E.map((r) => r.request))];
const pair = (a, b, key) => { let agree = 0, n = 0, d = 0; for (const id of ids) { const x = arms[a].find((r) => r.request === id), y = arms[b].find((r) => r.request === id); if (!x || !y) continue; n++; if (x[key] === y[key]) agree++; d += (y[key] ? 1 : 0) - (x[key] ? 1 : 0); } return { n, agree, delta: d }; };
const aa = { clean: pair('inc-low-r1', 'inc-low-r2', 'clean'), gated: pair('inc-low-r1', 'inc-low-r2', 'gated'), promoted: pair('inc-low-r1', 'inc-low-r2', 'promoted'), cleanStrict: pair('inc-low-r1', 'inc-low-r2', 'cleanStrict'), cleanLenient: pair('inc-low-r1', 'inc-low-r2', 'cleanLenient') };
const wallDiffs = ids.map((id) => { const x = arms['inc-low-r1'].find((r) => r.request === id), y = arms['inc-default-r1'].find((r) => r.request === id); return x && y ? Math.log(y.wall_s / x.wall_s) : null; }).filter((v) => v !== null);
const effort = { cleanDelta_defaultMinusLowMean: S['inc-default-r1'].clean - (S['inc-low-r1'].clean + S['inc-low-r2'].clean) / 2, pairedLogWall_defaultVsLowR1: bootstrapMedianCI(wallDiffs), tokensRatio_defaultOverLow: S['inc-default-r1'].tokens.mean / ((S['inc-low-r1'].tokens.mean + S['inc-low-r2'].tokens.mean) / 2) };
// oracle agreement over all scored gated artefacts
const rows = E.filter((r) => r.gated).map((r) => ({ item: r.runId, verdicts: r.verdicts }));
const agree = agreement(rows, oracleIds);
const perOracle = Object.fromEntries(oracleIds.map((o) => { const v = rows.map((r) => r.verdicts[o]).filter(Boolean); return [o, { n: v.length, clean: v.filter((x) => x === 'clean').length, withChange: v.filter((x) => x === 'usable-with-change').length, notUsable: v.filter((x) => x === 'not-usable').length }]; }));
// stage token breakdown per incumbent run (mean per run)
const tags = {}; for (const r of E) for (const [t, v] of Object.entries(r.tokensByTag)) { tags[t] = tags[t] || { sum: 0, runs: 0 }; tags[t].sum += v; tags[t].runs++; }
const stageTokens = Object.fromEntries(Object.entries(tags).map(([t, v]) => [t, { meanPerRunWithStage: Math.round(v.sum / v.runs), runs: v.runs, meanOverAllRuns: Math.round(v.sum / E.length) }]));
const scoringTokens = tokens.filter((t) => t.stage === 'score-s3').reduce((s, t) => s + t.total, 0);
const out = { at: now(), runs: E.length, scoredArtefacts: rows.length, arms: S, aaReplicate: aa, effortArm: effort, oracleAgreement: agree, perOracle, stageTokens, scoring: { tokens: scoringTokens, perArtefactAllOracles: rows.length ? Math.round(scoringTokens / rows.length) : null }, prediction: { F01: 'A/A |delta clean| <= 3 of 20', observed: Math.abs(aa.clean.delta), met: Math.abs(aa.clean.delta) <= 3, resize: Math.abs(aa.clean.delta) > 6 } };
writeJson(path.join(RECEIPT, 'noise-floor.json'), out);
console.log(JSON.stringify({ arms: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, { n: v.n, gated: v.gated, promoted: v.promoted, clean: v.clean, strict: v.cleanStrict, lenient: v.cleanLenient, wallMed: +v.wall.median.toFixed(0), tokMean: Math.round(v.tokens.mean) }])), aa, effort: { cleanDelta: effort.cleanDelta_defaultMinusLowMean, wall: effort.pairedLogWall_defaultVsLowR1 }, agree, perOracle, scoring: out.scoring }, null, 1));
