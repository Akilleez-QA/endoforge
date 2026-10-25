#!/usr/bin/env node
// Grade every gated artefact of one stage blind with the three-oracle panel: anonymised sheets (request + what it does +
// example, further and probe calls + assumption + question), shuffled with a seed, batches of up to six distinct requests,
// each oracle scoring against its own criteria. Writes receipt/scores-<stage>.jsonl (one row per artefact per oracle).
//   node bin/score.mjs <stage> [--only runId,runId]
import fs from 'node:fs';
import path from 'node:path';
import { WORK, RECEIPT, requestText, json, writeJson, now, appendJsonl } from '../lib/runner.mjs';
import { artDir } from '../lib/factory.mjs';
import { renderSheet } from '../lib/sheet.mjs';
import { ORACLES, scoreSheets } from '../lib/oracle.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const stage = process.argv[2]; if (!stage) { console.error('usage: score.mjs <stage>'); process.exit(2); }
const freeze = json(path.join(RECEIPT, 'freeze.json'));
const BASE = path.join(WORK, 'runs', stage);
const onlyIdx = process.argv.indexOf('--only'); const only = onlyIdx >= 0 ? new Set(process.argv[onlyIdx + 1].split(',')) : null;
const scoredFile = path.join(RECEIPT, `scores-${stage}.jsonl`);
const already = new Set(fs.existsSync(scoredFile) ? fs.readFileSync(scoredFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => `${r.runId}|${r.oracle}`) : []);
const runs = fs.readdirSync(BASE).filter((d) => fs.existsSync(path.join(BASE, d, 'run.json'))).map((d) => json(path.join(BASE, d, 'run.json'))).filter((r) => r.gated && r.manifest !== 'challenger-spec' && (!only || only.has(r.runId)));
const items = shuffle(runs, freeze.seed + 300 + stage.length).map((r, i) => { const req = requestText(r.request); const { md, calls } = renderSheet(artDir(path.join(BASE, r.runId), r.request), { itemNo: i + 1, req }); fs.writeFileSync(path.join(BASE, r.runId, 'sheet-oracle.md'), md); writeJson(path.join(BASE, r.runId, 'sheet-oracle.calls.json'), calls); return { item: i + 1, id: r.request, sheet: md, runId: r.runId, arm: r.arm, rep: r.rep }; });
writeJson(path.join(WORK, 'oracle', 'keys', `${stage}-items.json`), items.map(({ sheet, ...x }) => x));
const results = await Promise.all(Object.keys(ORACLES).map((o) => scoreSheets(o, items.filter((it) => !already.has(`${it.runId}|${o}`)), { batch: 6, concurrency: 3, stage: `score-${stage}`, batchTag: stage })));
let n = 0;
Object.keys(ORACLES).forEach((o, i) => { for (const v of results[i]) { if (v.error) { appendJsonl(scoredFile, { at: now(), oracle: o, error: v.error }); continue; } const it = items.find((x) => x.item === v.item); appendJsonl(scoredFile, { at: now(), stage, runId: it.runId, id: it.id, arm: it.arm, rep: it.rep, oracle: o, verdict: v.verdict, q1: v.q1, q2: v.q2, q3: v.q3, q5: v.q5, q6: v.q6, callId: v.callId }); n++; } });
console.log(JSON.stringify({ stage, gated: runs.length, newRows: n, unparsed: results.flat().filter((v) => !v.error && !v.verdict).length }));
