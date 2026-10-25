#!/usr/bin/env node
// Step 2: (a) each oracle writes blind criteria for the 20 development and 20 working requests; (b) a fresh Opus agent
// audits five criteria sheets for executable anchoring; (c) the canary packet (3 canaries + 3 fillers) is graded by the
// panel: 3/3 recall by the >=2-of-3 rule or the loop stops here and the oracle protocol is revised (slow loop, recorded).
//   node bin/step2-criteria.mjs criteria | audit | canary
import fs from 'node:fs';
import path from 'node:path';
import { KIT, WORK, RECEIPT, requestText, json, writeJson, callClaude, parseJsonLoose, sha, now, appendJsonl } from '../lib/runner.mjs';
import { ORACLES, writeCriteria, scoreSheets, criteriaPath, hasCriteria } from '../lib/oracle.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const freeze = json(path.join(RECEIPT, 'freeze.json'));
const cmd = process.argv[2];

if (cmd === 'criteria') {
  const reqs = [...freeze.development, ...freeze.working].map(requestText);
  const res = await Promise.all(Object.keys(ORACLES).map((o) => writeCriteria(o, reqs, { batch: 5, concurrency: 2, stage: 'criteria' })));
  const summary = Object.fromEntries(Object.keys(ORACLES).map((o, i) => [o, { written: Object.keys(res[i].criteriaSha256).length, missing: reqs.map((r) => r.id).filter((id) => !hasCriteria(o, id)), batches: res[i].batches.map((b) => ({ callId: b.callId ?? null, written: b.written?.length ?? 0, missing: b.missing ?? [], error: b.error ?? null })) }]));
  writeJson(path.join(RECEIPT, 'oracle-criteria-summary.json'), { at: now(), requests: reqs.map((r) => r.id), summary, sha256: Object.fromEntries(Object.keys(ORACLES).map((o) => [o, Object.fromEntries(reqs.filter((r) => hasCriteria(o, r.id)).map((r) => [r.id, sha(fs.readFileSync(criteriaPath(o, r.id)))]))])) });
  console.log(JSON.stringify(summary, null, 1));
}

if (cmd === 'audit') {
  // five sheets: 2 sonnet, 2 opus, 1 codex, over working ids, seeded; audited by Opus (a sealed reader, not an optimiser)
  const ids = shuffle(freeze.working, freeze.seed + 5);
  const picks = [['oracle-sonnet', ids[0]], ['oracle-sonnet', ids[1]], ['oracle-opus', ids[2]], ['oracle-opus', ids[3]], ['oracle-codex', ids[4]]];
  const sheets = picks.map(([o, id], i) => `\n---\n\n## Sheet ${i + 1} (${o}, request ${id})\n\n${fs.readFileSync(criteriaPath(o, id), 'utf8')}`).join('\n');
  const brief = fs.readFileSync(path.join(KIT, 'briefs', 'criteria-audit-v1.md'), 'utf8').replace('{{SHEETS}}', sheets);
  const r = await callClaude(brief, { stage: 'audit', request: picks.map((p) => p[1]).join('+'), tag: 'criteria-audit' }, {});
  const arr = parseJsonLoose(r.text);
  writeJson(path.join(RECEIPT, 'criteria-audit.json'), { at: now(), auditor: r.model, callId: r.callId, picks: picks.map(([o, id], i) => ({ sheet: i + 1, oracle: o, id })), result: arr, raw: Array.isArray(arr) ? undefined : r.text.slice(0, 3000) });
  console.log(JSON.stringify(arr, null, 1));
}

if (cmd === 'canary') {
  const packet = path.join(WORK, 'canaries', 'packet');
  const key = json(path.join(packet, 'key.json')).key;
  const items = key.map((k) => ({ item: k.item, id: k.id, sheet: fs.readFileSync(path.join(packet, `ITEM-${String(k.item).padStart(2, '0')}.md`), 'utf8') }));
  const results = await Promise.all(Object.keys(ORACLES).map((o) => scoreSheets(o, items, { batch: 6, concurrency: 1, stage: 'canary', batchTag: 'c' })));
  const rows = key.map((k) => ({ ...k, verdicts: {}, reasons: {} }));
  Object.keys(ORACLES).forEach((o, i) => { for (const v of results[i]) { if (v.error) continue; const row = rows.find((r) => r.item === v.item); row.verdicts[o] = v.verdict; row.reasons[o] = `${v.q5 ?? ''} | ${v.q6 ?? ''}`; } });
  const rangeRe = /range|-50|fit|extrapolat|outside|guard|beyond|limit of|validity|-40/i;
  const recall = rows.filter((r) => r.canary).map((r) => {
    const hits = Object.keys(ORACLES).filter((o) => { const v = r.verdicts[o]; if (!v) return false; if (r.id === 'CC-009') return (v === 'usable-with-change' || v === 'not-usable') && rangeRe.test(r.reasons[o]); return v === 'not-usable'; });
    return { id: r.id, item: r.item, mustBe: r.mustBe, verdicts: r.verdicts, flaggedBy: hits, caught: hits.length >= 2 };
  });
  const fillers = rows.filter((r) => !r.canary).map((r) => ({ id: r.id, item: r.item, verdicts: r.verdicts, falseRejectBy: Object.keys(ORACLES).filter((o) => r.verdicts[o] === 'not-usable') }));
  const out = { at: now(), rule: freeze.canaries.recallRule, packetKeySha256: freeze.canaries.keySha256, recall, fillers, caught: recall.filter((r) => r.caught).length, verdict: recall.every((r) => r.caught) ? 'PASS 3/3' : 'FAIL: stop and revise the oracle protocol', rows };
  const n = fs.existsSync(path.join(RECEIPT, 'canary-dryrun.json')) ? json(path.join(RECEIPT, 'canary-dryrun.json')).attempt + 1 : 1;
  out.attempt = n;
  writeJson(path.join(RECEIPT, 'canary-dryrun.json'), out);
  appendJsonl(path.join(RECEIPT, 'canary-dryrun.jsonl'), out);
  console.log(JSON.stringify({ attempt: n, verdict: out.verdict, recall: recall.map((r) => [r.id, r.verdicts, r.caught]), fillers: fillers.map((f) => [f.id, f.verdicts]) }, null, 1));
}
