// The sealed oracle panel: three raters on two model families, each writing its own criteria blind from the raw request
// before any artefact exists, then grading anonymised artefact sheets against those criteria. Criteria and verdicts live
// under work/oracle/ (git-ignored, request text); receipts carry hashes and verdict counts. No optimiser agent reads here.
import fs from 'node:fs';
import path from 'node:path';
import { KIT, WORK, callClaude, callCodex, parseJsonLoose, sha, pool, writeJson, appendJsonl, RECEIPT, CODEX_NO_TOOLS } from './runner.mjs';

export const ORACLES = {
  'oracle-sonnet': { provider: 'claude', model: 'claude-sonnet-5-5', effort: null, frame: 'technician', criteriaBrief: 'oracle-criteria-technician-v1', scoreBrief: 'oracle-score-technician-v2' },
  'oracle-opus': { provider: 'claude', model: null, effort: null, frame: 'reviewer', criteriaBrief: 'oracle-criteria-reviewer-v1', scoreBrief: 'oracle-score-reviewer-v2' },
  'oracle-codex': { provider: 'codex', model: null, reasoning: 'high', frame: 'technician', criteriaBrief: 'oracle-criteria-technician-v1', scoreBrief: 'oracle-score-technician-v2' },
};
export const ORACLE_DIR = path.join(WORK, 'oracle');
const brief = (name) => fs.readFileSync(path.join(KIT, 'briefs', `${name}.md`), 'utf8');
const fill = (t, vars) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));

async function call(oracleId, prompt, meta) {
  const o = ORACLES[oracleId];
  const m = { ...meta, arm: oracleId };
  if (o.provider === 'codex') return callCodex(prompt + CODEX_NO_TOOLS, m, { reasoning: o.reasoning, cwd: path.join(WORK, 'codex-sealed-empty') });
  return callClaude(prompt, m, { model: o.model ?? undefined, effort: o.effort ?? undefined });
}

export function criteriaPath(oracleId, id) { return path.join(ORACLE_DIR, oracleId, 'criteria', `${id}.md`); }
export function hasCriteria(oracleId, id) { return fs.existsSync(criteriaPath(oracleId, id)); }

/** Write criteria for the given requests (objects from requestText), in batches, for one oracle. Idempotent per request. */
export async function writeCriteria(oracleId, reqs, { batch = 5, concurrency = 3, stage = 'criteria' } = {}) {
  const todo = reqs.filter((r) => !hasCriteria(oracleId, r.id));
  const batches = []; for (let i = 0; i < todo.length; i += batch) batches.push(todo.slice(i, i + batch));
  const results = await pool(batches, concurrency, async (b, k) => {
    const list = b.map((r) => `### ${r.id}\nAsked by: ${r.role}\n\n> ${r.text}\n${r.inputs ? `\nAuthoritative inputs the requester named:\n${r.inputs}\n` : ''}`).join('\n');
    const prompt = fill(brief(ORACLES[oracleId].criteriaBrief), { REQUESTS: list });
    const res = await call(oracleId, prompt, { stage, request: b.map((r) => r.id).join('+'), tag: `b${k}` });
    const blocks = {}; const re = /^###\s+([A-Za-z0-9_-]+)\s*$/gm; let m; const marks = [];
    while ((m = re.exec(res.text))) marks.push({ id: m[1], at: m.index, end: m.index + m[0].length });
    marks.forEach((mk, i) => { blocks[mk.id] = res.text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : undefined).trim() + '\n'; });
    const written = [];
    for (const r of b) { if (blocks[r.id] && blocks[r.id].length > 80) { fs.mkdirSync(path.dirname(criteriaPath(oracleId, r.id)), { recursive: true }); fs.writeFileSync(criteriaPath(oracleId, r.id), `### ${r.id}\n${blocks[r.id]}`); written.push(r.id); } }
    const missing = b.map((r) => r.id).filter((id) => !written.includes(id));
    return { callId: res.callId, written, missing };
  });
  const rec = { at: new Date().toISOString(), oracle: oracleId, requested: todo.map((r) => r.id), batches: results, criteriaSha256: Object.fromEntries(reqs.filter((r) => hasCriteria(oracleId, r.id)).map((r) => [r.id, sha(fs.readFileSync(criteriaPath(oracleId, r.id)))])) };
  appendJsonl(path.join(RECEIPT, 'oracle-criteria.jsonl'), rec);
  return rec;
}

/**
 * Score anonymised sheets with one oracle. items: [{item, id, sheet}] (item numbers unique within the call; one request per batch).
 * Returns [{item, id, verdict, q1..q6, raw}] and records the key hash. Batches never contain two items of the same request.
 */
export async function scoreSheets(oracleId, items, { batch = 6, concurrency = 3, stage = 'score', batchTag = 'x' } = {}) {
  // group into batches with distinct request ids
  const batches = []; const remaining = items.slice();
  while (remaining.length) { const b = []; const used = new Set(); for (let i = 0; i < remaining.length && b.length < batch; ) { if (!used.has(remaining[i].id)) { used.add(remaining[i].id); b.push(remaining.splice(i, 1)[0]); } else i++; } batches.push(b); }
  const out = [];
  const res = await pool(batches, concurrency, async (b, k) => {
    const itemsText = b.map((it, j) => `\n---\n\n## Your criteria for item ${j + 1}\n\n${fs.existsSync(criteriaPath(oracleId, it.id)) ? fs.readFileSync(criteriaPath(oracleId, it.id), 'utf8').replace(/^###\s+\S+\s*\n/, '') : '(no criteria were written for this request)'}\n\n## Sheet for item ${j + 1}\n\n${it.sheet.replace(/^# .*\n/, '')}`).join('\n');
    const prompt = fill(brief(ORACLES[oracleId].scoreBrief), { ITEMS: itemsText });
    const r = await call(oracleId, prompt, { stage, request: b.map((x) => x.id).join('+'), tag: `${batchTag}${k}` });
    const arr = parseJsonLoose(r.text);
    const key = b.map((it, j) => ({ item: j + 1, ref: it.item, id: it.id }));
    writeJson(path.join(ORACLE_DIR, oracleId, 'keys', `${stage}-${batchTag}${k}-${r.callId}.json`), { key, callId: r.callId });
    const rows = b.map((it, j) => { const a = Array.isArray(arr) ? arr.find((x) => Number(x.item) === j + 1) : null; const v = String(a?.q4 ?? '').toLowerCase().trim(); const stated = ['clean', 'usable-with-change', 'not-usable'].includes(v) ? v : (v === 'with-change' ? 'usable-with-change' : null); const derived = deriveVerdict(a); const verdict = stated && derived ? (LEVEL[stated] >= LEVEL[derived] ? stated : derived) : (stated ?? derived); return { item: it.item, id: it.id, oracle: oracleId, verdict, verdictStated: stated, verdictDerived: derived, q1: a?.q1 ?? null, q2: a?.q2 ?? null, q3: a?.q3 ?? null, q5: a?.q5 ?? null, q6: a?.q6 ?? null, callId: r.callId, parsed: Boolean(a) }; });
    return rows;
  });
  for (const r of res) { if (r?.error) { out.push({ error: r.error }); continue; } out.push(...r); }
  return out;
}

export const LEVEL = { clean: 0, 'usable-with-change': 1, 'not-usable': 2 };
/** Panel rule v2 (slow-loop revision, 2026-10-18): the verdict follows from Q1-Q3; the oracle's stated Q4 can only make it
 *  more severe (a disqualifier Q1-Q3 do not capture: an unenforced range, unusable units). */
export function deriveVerdict(a) {
  if (!a) return null;
  const q1 = String(a.q1 ?? '').toLowerCase().trim(), q2 = String(a.q2 ?? '').toLowerCase().trim(), q3 = String(a.q3 ?? '').toLowerCase().trim();
  if (q1 === 'no' || q2 === 'no' || q3 === 'no') return 'not-usable';
  if (q1 === 'yes' && q2 === 'yes' && q3 === 'yes') return String(a.q5 ?? '').trim().length > 3 ? 'usable-with-change' : 'clean';
  return 'usable-with-change';
}
export function panelVerdict(verdicts) {
  const v = verdicts.filter(Boolean);
  if (v.length < 2) return { median: null, strict: null, lenient: null, n: v.length };
  const lv = v.map((x) => LEVEL[x]).sort((a, b) => a - b);
  const med = lv.length === 3 ? lv[1] : (lv[0] + lv[1]) / 2; // with 2 verdicts, the mean (0.5 counts as not clean)
  return { median: med === 0 ? 'clean' : med <= 1 ? 'usable-with-change' : 'not-usable', medianClean: med === 0, strict: lv.every((x) => x === 0), lenient: lv.every((x) => x < 2), n: v.length };
}
