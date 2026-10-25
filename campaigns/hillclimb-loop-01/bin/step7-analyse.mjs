#!/usr/bin/env node
// Step 7 analysis for the design as run: per request A (incumbent), B (all-new), E (all-new + D-02), with S (the spec run).
// Primary contrast E vs A, registered secondary E vs B, exploratory B vs A; G8 as a secondary filter; repair statistics;
// guardrails; inter-oracle agreement; the same for the sealed set (stage s6). Writes receipt/analysis.json.
import fs from 'node:fs';
import path from 'node:path';
import { RECEIPT, json, writeJson, now } from '../lib/runner.mjs';
import { panelVerdict, ORACLES } from '../lib/oracle.mjs';
import { clopperPearson, agreement, median, quantile, bootstrapMedianCI, pairedBinary, signTest } from '../lib/analysis.mjs';

const lines = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const allRuns = lines(path.join(RECEIPT, 'runs.jsonl'));
const tokens = lines(path.join(RECEIPT, 'tokens.jsonl')); const tokByCall = Object.fromEntries(tokens.map((t) => [t.callId, t]));
const oracleIds = Object.keys(ORACLES);
// nested D-02 records (runId 'spec'/'gen', written inside the E run) are excluded: E's own record carries their calls
const latestBy = (stage) => { const m = {}; for (const r of allRuns.filter((x) => x.stage === stage && !['spec', 'gen'].includes(x.runId))) m[r.runId] = r; return Object.values(m); };

function enrich(r, scores) {
  const vs = Object.fromEntries(oracleIds.map((o) => [o, scores.find((s) => s.runId === r.runId && s.oracle === o)?.verdict ?? null]));
  const panel = r.gated ? panelVerdict(oracleIds.map((o) => vs[o])) : { median: null, medianClean: false, strict: false, lenient: false, n: 0 };
  const personaReject = Boolean(r.persona?.verdicts?.some((v) => v.verdict === 'reject'));
  const personaChange = Boolean(r.persona?.verdicts?.some((v) => v.verdict === 'accept-with-change'));
  const calls = (r.calls ?? []).map((c) => tokByCall[c]).filter(Boolean);
  const promoted = Boolean(r.gated) && !personaReject;
  return { ...r, verdicts: vs, panel, personaReject, personaChange, promoted, g8: r.gate8?.ok ?? null, tokens: calls.reduce((s, c) => s + c.total, 0), wall_s: (r.wall_ms ?? 0) / 1000, g56fail: (r.gates?.failed ?? []).some((f) => /G5|G6/.test(f)),
    clean: promoted && panel.medianClean ? 1 : 0, cleanStrict: promoted && panel.strict ? 1 : 0, cleanLenient: promoted && panel.lenient ? 1 : 0, cleanQ8: promoted && panel.medianClean && r.gate8?.ok ? 1 : 0 };
}

function analyseStage(stage) {
  const scores = lines(path.join(RECEIPT, `scores-${stage}.jsonl`)).filter((s) => s.verdict);
  const runs = latestBy(stage).map((r) => enrich(r, scores));
  const ids = [...new Set(runs.map((r) => r.request))].sort();
  const PREFIX = { 'S-old.G-old': 'A-', 'S-new': 'S-', 'S-new.G-new': 'B-', 'S-new.G-new.D02': 'E-' };
  const get = (id, arm) => runs.find((r) => r.request === id && r.arm === arm && r.runId.startsWith(PREFIX[arm])) ?? null;
  const per = {};
  for (const id of ids) {
    const A = get(id, 'S-old.G-old'), S = get(id, 'S-new'), B = get(id, 'S-new.G-new'), E = get(id, 'S-new.G-new.D02');
    const row = (a) => a ? { status: a.status, gated: Boolean(a.gated), g8: a.g8, personaReject: a.personaReject, personaChange: a.personaChange, panel: a.panel.median, verdicts: a.verdicts, clean: a.clean, strict: a.cleanStrict, lenient: a.cleanLenient, cleanQ8: a.cleanQ8, tokens: a.tokens, wall_s: +a.wall_s.toFixed(1), rounds: a.roundsUsed ?? null, selected: a.selected ?? null } : null;
    per[id] = { A: row(A), B: row(B), E: E ? { ...row(E), repairNeeded: E.repairNeeded ?? null, repairResolved: E.repairResolved ?? null } : null, S: S ? { status: S.status, revised: S.stubRevised ?? false, cpersona: S.contractPersona?.verdict ?? null, tests: S.testsCount ?? null, tokens: S.tokens, wall_s: +S.wall_s.toFixed(1), retrieval: S.retrieval, consequence: S.consequence ?? null } : null };
    per[id].wallE = S && B ? +(S.wall_s + B.wall_s + (E?.repairNeeded ? E.wall_s : 0)).toFixed(1) : null;
    per[id].tokensE = S && B ? S.tokens + B.tokens + (E?.repairNeeded ? E.tokens : 0) : null;
    per[id].tokensA = A ? A.tokens : null;
  }
  const contrast = (x, y, key = 'clean') => { const c = ids.filter((id) => per[id][x] && per[id][y]); return { ...pairedBinary(c.map((id) => per[id][x][key]), c.map((id) => per[id][y][key])), requests: c.length, improvedIds: c.filter((id) => per[id][y][key] && !per[id][x][key]), worsenedIds: c.filter((id) => per[id][x][key] && !per[id][y][key]) }; };
  const contrasts = {};
  for (const [name, x, y] of [['E_vs_A_primary', 'A', 'E'], ['E_vs_B_secondary', 'B', 'E'], ['B_vs_A_exploratory', 'A', 'B']]) contrasts[name] = { median: contrast(x, y, 'clean'), strict: contrast(x, y, 'strict'), lenient: contrast(x, y, 'lenient'), withG8: contrast(x, y, 'cleanQ8') };
  const armStats = {}; for (const k of ['A', 'B', 'E']) { const as = ids.map((id) => per[id][k]).filter(Boolean); armStats[k] = { n: as.length, gated: as.filter((a) => a.gated).length, promoted: as.filter((a) => a.gated && !a.personaReject).length, personaReject: as.filter((a) => a.personaReject).length, personaChange: as.filter((a) => a.personaChange).length, g8ok: as.filter((a) => a.gated && a.g8).length, clean: as.filter((a) => a.clean).length, cleanCI: as.length ? clopperPearson(as.filter((a) => a.clean).length, as.length) : null, strict: as.filter((a) => a.strict).length, lenient: as.filter((a) => a.lenient).length, cleanQ8: as.filter((a) => a.cleanQ8).length, tokensMean: as.length ? Math.round(as.reduce((s, a) => s + a.tokens, 0) / as.length) : null, wallMedian: median(as.map((a) => a.wall_s).sort((x, y) => x - y)), perOracleClean: Object.fromEntries(oracleIds.map((o) => [o, as.filter((a) => a.verdicts[o] === 'clean').length])) }; }
  const Es = ids.map((id) => per[id].E).filter(Boolean);
  const repair = { eligible: Es.length, triggered: Es.filter((e) => e.repairNeeded).length, resolved: Es.filter((e) => e.repairNeeded && e.repairResolved).length, gatedAfterRepair: Es.filter((e) => e.repairNeeded && e.gated).length, cleanAfterRepair: Es.filter((e) => e.repairNeeded && e.clean).length, cleanBeforeRepairOnTriggered: ids.filter((id) => per[id].E?.repairNeeded && per[id].B?.clean).length };
  const Ss = ids.map((id) => per[id].S).filter(Boolean);
  const spec = { n: Ss.length, frozen: Ss.filter((s) => s.status === 'spec-frozen').length, stubRevised: Ss.filter((s) => s.revised).length, retrievalHits: Ss.filter((s) => s.retrieval).length, testsMedian: median(Ss.map((s) => s.tests).filter((v) => v != null).sort((a, b) => a - b)), consequencePhysical: Ss.filter((s) => s.consequence === 'physical').length };
  const wallA = ids.map((id) => per[id].A?.wall_s).filter((v) => v != null).sort((a, b) => a - b), wallE = ids.map((id) => per[id].wallE).filter((v) => v != null).sort((a, b) => a - b);
  const tokA = ids.map((id) => per[id].tokensA).filter((v) => v != null), tokE = ids.map((id) => per[id].tokensE).filter((v) => v != null);
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const guard = { gatePass: { incumbent: armStats.A?.gated, challenger: armStats.E?.gated, bound: 'E >= A - 3', holds: (armStats.E?.gated ?? 0) >= (armStats.A?.gated ?? 0) - 3 }, g56: { incumbentFails: runs.filter((r) => r.arm === 'S-old.G-old' && r.g56fail).length, challengerFails: runs.filter((r) => /S-new\.G-new/.test(r.arm) && r.g56fail).length }, wall: { incumbentMedian: median(wallA), challengerCriticalMedian: median(wallE), bound: 'E <= 2.0 x A', holds: median(wallE) <= 2 * median(wallA) }, tokens: { incumbentMean: Math.round(mean(tokA) ?? 0), challengerMean: Math.round(mean(tokE) ?? 0), bound: 'E <= 3.0 x A', holds: (mean(tokE) ?? 0) <= 3 * (mean(tokA) ?? 1) } };
  guard.g56.holds = guard.g56.challengerFails === 0;
  const wallDiffs = ids.map((id) => per[id].wallE && per[id].A ? Math.log(per[id].wallE / per[id].A.wall_s) : null).filter((v) => v !== null);
  const rows = runs.filter((r) => r.gated && r.arm !== 'S-new').map((r) => ({ item: r.runId, verdicts: r.verdicts }));
  const agree = agreement(rows, oracleIds);
  const within1ok = Object.values(agree).every((a) => a.n === 0 || a.within1 / a.n >= 0.8);
  // ordinal reading: the panel's median level (0 clean, 1 with-change, 2 not-usable; not gated or not promoted = 3), paired by request
  const LV = { clean: 0, 'usable-with-change': 1, 'not-usable': 2 };
  const level = (a) => (!a || !a.gated || a.personaReject) ? 3 : (a.panel in LV ? LV[a.panel] : 3);
  const ordinal = {};
  for (const [name, x, y] of [['E_vs_A', 'A', 'E'], ['E_vs_B', 'B', 'E'], ['B_vs_A', 'A', 'B']]) { const c = ids.filter((id) => per[id][x] && per[id][y]); const imp = c.filter((id) => level(per[id][y]) < level(per[id][x])), wor = c.filter((id) => level(per[id][y]) > level(per[id][x])); ordinal[name] = { n: c.length, improved: imp.length, worsened: wor.length, improvedIds: imp, worsenedIds: wor, sign: signTest(imp.length, wor.length), meanLevelX: +(c.reduce((s, id) => s + level(per[id][x]), 0) / c.length).toFixed(2), meanLevelY: +(c.reduce((s, id) => s + level(per[id][y]), 0) / c.length).toFixed(2) }; }
  const verdictDist = {}; for (const k of ['A', 'B', 'E']) { const as = ids.map((id) => per[id][k]).filter((a) => a && a.gated); verdictDist[k] = Object.fromEntries(oracleIds.map((o) => [o, { clean: as.filter((a) => a.verdicts[o] === 'clean').length, withChange: as.filter((a) => a.verdicts[o] === 'usable-with-change').length, notUsable: as.filter((a) => a.verdicts[o] === 'not-usable').length }])); verdictDist[k].panelMedian = { clean: as.filter((a) => a.panel === 'clean').length, withChange: as.filter((a) => a.panel === 'usable-with-change').length, notUsable: as.filter((a) => a.panel === 'not-usable').length }; }
  const reasons = {}; for (const id of ids) { reasons[id] = {}; for (const k of ['A', 'B', 'E']) { const r = runs.find((x) => x.request === id && x.arm === { A: 'S-old.G-old', B: 'S-new.G-new', E: 'S-new.G-new.D02' }[k]); if (!r) continue; reasons[id][k] = Object.fromEntries(oracleIds.map((o) => { const sc = scores.find((x) => x.runId === r.runId && x.oracle === o); return [o, sc ? `${sc.verdict}: ${(sc.q5 || '').slice(0, 220)}` : null]; })); } }
  const efficiency = { tokensPerCleanA: armStats.A?.clean ? Math.round(tokA.reduce((s, v) => s + v, 0) / armStats.A.clean) : null, tokensPerCleanE: armStats.E?.clean ? Math.round(tokE.reduce((s, v) => s + v, 0) / armStats.E.clean) : null };
  return { requests: ids.length, armStats, contrasts, ordinal, verdictDist, repair, spec, guardrails: guard, pairedLogWall_EoverA: bootstrapMedianCI(wallDiffs, { seed: 9 }), oracleAgreement: agree, within1AllPairs80: within1ok, efficiency, scoredArtefacts: rows.length, per, reasons };
}

const out = { at: now(), screen: fs.existsSync(path.join(RECEIPT, 'scores-s5.jsonl')) ? analyseStage('s5') : null, sealed: fs.existsSync(path.join(RECEIPT, 'scores-s6.jsonl')) ? analyseStage('s6') : null };
writeJson(path.join(RECEIPT, 'analysis.json'), out);
for (const [k, v] of Object.entries(out)) if (v && k !== 'at') { const c = v.contrasts; console.log(k, JSON.stringify({ requests: v.requests, arms: Object.fromEntries(Object.entries(v.armStats).map(([a, s]) => [a, { gated: s.gated, promoted: s.promoted, clean: s.clean, strict: s.strict, lenient: s.lenient, cleanQ8: s.cleanQ8, tok: s.tokensMean, wall: s.wallMedian }])), EvsA: { imp: c.E_vs_A_primary.median.improved, wor: c.E_vs_A_primary.median.worsened, diff: c.E_vs_A_primary.median.diff, ci: c.E_vs_A_primary.median.ci, p: c.E_vs_A_primary.median.sign.p }, EvsB: { imp: c.E_vs_B_secondary.median.improved, wor: c.E_vs_B_secondary.median.worsened }, BvsA: { imp: c.B_vs_A_exploratory.median.improved, wor: c.B_vs_A_exploratory.median.worsened }, repair: v.repair, spec: v.spec, guard: v.guardrails, within1: v.within1AllPairs80, agree: Object.fromEntries(Object.entries(v.oracleAgreement).map(([p, a]) => [p, `${a.exact}/${a.within1}/${a.n} k=${a.kappaClean?.toFixed(2)}`])) }, null, 1)); }
