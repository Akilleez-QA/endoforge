#!/usr/bin/env node
// Brier-score the forecast ledger from the receipts. Each forecast's outcome rule is written here, in code, so the
// scoring is reproducible; forecasts marked unobservable this loop get outcome null and are excluded from the mean.
import fs from 'node:fs';
import path from 'node:path';
import { RECEIPT, json, writeJson, now } from '../lib/runner.mjs';
import { brier } from '../lib/analysis.mjs';

const F = json(path.join(RECEIPT, 'forecasts.json'));
const nf = json(path.join(RECEIPT, 'noise-floor.json'));
const an = fs.existsSync(path.join(RECEIPT, 'analysis.json')) ? json(path.join(RECEIPT, 'analysis.json')) : {};
const sc = an.screen, se = an.sealed;
const canaryAttempts = fs.readFileSync(path.join(RECEIPT, 'canary-dryrun.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const audit = json(path.join(RECEIPT, 'criteria-audit.json'));
const tok = json(path.join(RECEIPT, 'tokens-summary.json'));
const dev = json(path.join(RECEIPT, 'deviations-critic.json'));
const r1 = nf.arms['inc-low-r1'], r2 = nf.arms['inc-low-r2'];
const c = sc?.contrasts;
const gain = (k, rule = 'median') => (c ? c[k][rule].b - c[k][rule].a : null);
const personaRejectNotClean = () => { const rows = []; for (const st of [sc, se]) if (st) for (const id of Object.keys(st.per)) for (const k of ['A', 'B', 'E']) { const a = st.per[id][k]; if (a && a.personaReject) rows.push(a.panel !== 'clean' ? 1 : 0); } for (const arm of ['inc-low-r1', 'inc-low-r2']) for (const [, x] of Object.entries(nf.arms[arm].byRequest)) if (x.status === 'gated-rejected-by-persona') rows.push(x.panel !== 'clean' ? 1 : 0); return rows.length ? rows.reduce((s, v) => s + v, 0) / rows.length : null; };
const rules = {
  F01: () => Math.abs(nf.aaReplicate.clean.delta) <= 3,
  F02: () => (r1.clean + r2.clean) / 2 <= 5,
  F03: () => (c ? gain('E_vs_A_primary') >= 6 : null),
  F09: () => canaryAttempts[0]?.verdict?.startsWith('PASS') ?? null,
  F10: () => (sc ? sc.within1AllPairs80 : null),
  F12: () => r1.gated >= 17 && r2.gated >= 17,
  F13: () => (sc ? sc.armStats.E.gated >= sc.armStats.A.gated - 3 : null),
  F14: () => (sc ? sc.guardrails.tokens.challengerMean <= 3 * sc.guardrails.tokens.incumbentMean : null),
  F15: () => tok.total <= 8_000_000,
  F16: () => tok.total <= 12_000_000,
  F17: () => (se ? se.armStats.E.clean >= se.armStats.A.clean + 2 : null),
  F18: () => { const p = personaRejectNotClean(); return p === null ? null : p >= 0.8; },
  F19: () => true, // D-02 (a seed) was the critic's first choice (receipt/deviations.md)
  F20: () => (sc ? Object.values(sc.per).some((p) => ['A', 'B', 'E'].some((k) => p[k] && p[k].clean && p[k].g8 === false)) : null),
  F21: () => (sc ? sc.guardrails.wall.challengerCriticalMedian <= 1.5 * sc.guardrails.wall.incumbentMedian : null),
  F23: () => (c ? gain('E_vs_B_secondary') >= 3 : null),
  F24: () => (sc && sc.repair.eligible ? sc.repair.triggered / sc.repair.eligible >= 0.6 : null),
  F25: () => (sc && sc.repair.triggered ? sc.repair.resolved / sc.repair.triggered >= 0.5 : null),
  F26: () => (c ? gain('B_vs_A_exploratory') >= 4 : null),
  F27: () => { const s = (audit.result ?? []).map((x) => Number(x.score)).filter((v) => Number.isFinite(v)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length >= 1.5 : null; },
};
const rows = F.forecasts.map((f) => { let outcome = null; if (f.observable !== false && rules[f.id]) { const v = rules[f.id](); outcome = v === null || v === undefined ? null : (v ? 1 : 0); } return { ...f, outcome }; });
const b = brier(rows);
const out = { at: now(), scoredAt: 'step 7', n: b.n, meanBrier: b.mean, rows: rows.map((r) => ({ id: r.id, p: r.p, outcome: r.outcome, brier: r.outcome === null ? null : +((r.p - r.outcome) ** 2).toFixed(4), event: r.event })) };
writeJson(path.join(RECEIPT, 'forecasts-scored.json'), out);
console.log(JSON.stringify({ n: b.n, meanBrier: b.mean?.toFixed(3), rows: out.rows.map((r) => `${r.id}:${r.outcome === null ? 'na' : r.outcome}(${r.p})`).join(' ') }));
