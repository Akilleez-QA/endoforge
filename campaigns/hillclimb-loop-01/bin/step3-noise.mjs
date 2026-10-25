#!/usr/bin/env node
// Step 3: the noise floor. Incumbent (v2 + low effort) twice and incumbent at default effort once on the 20 development
// requests: 60 runs, request-complete blocks, arms shuffled within each block, blocks shuffled, four runs in flight at a
// time so arms interleave across time. Then every gated artefact is graded blind by the panel.
//   node bin/step3-noise.mjs run [--limit N]     node bin/step3-noise.mjs score
import fs from 'node:fs';
import path from 'node:path';
import { WORK, RECEIPT, requestText, json, writeJson, pool, now, appendJsonl, totalsSoFar } from '../lib/runner.mjs';
import { runIncumbent, artDir } from '../lib/factory.mjs';
import { renderSheet } from '../lib/sheet.mjs';
import { ORACLES, scoreSheets } from '../lib/oracle.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const freeze = json(path.join(RECEIPT, 'freeze.json'));
const cmd = process.argv[2];
// The default-effort third arm is carried forward by the budget decision (receipt/deviations.md); run it with --three-arms.
const THREE = process.argv.includes('--three-arms');
const ARMS = [{ arm: 'inc-low', rep: 1, effort: 'low' }, { arm: 'inc-low', rep: 2, effort: 'low' }, ...(THREE ? [{ arm: 'inc-default', rep: 1, effort: undefined }] : [])];
const BASE = path.join(WORK, 'runs', 's3');

function plan() {
  const order = shuffle(freeze.development, freeze.seed + 100);
  const runs = [];
  order.forEach((id, i) => { for (const a of shuffle(ARMS, freeze.seed + 200 + i)) runs.push({ id, ...a, runDir: path.join(BASE, `${a.arm}-r${a.rep}-${id}`) }); });
  return runs;
}

if (cmd === 'run') {
  const limit = Number((process.argv.indexOf('--limit') >= 0 && process.argv[process.argv.indexOf('--limit') + 1]) || 60);
  const runs = plan().slice(0, limit);
  writeJson(path.join(RECEIPT, 'noise-plan.json'), { at: now(), seed: freeze.seed, order: runs.map((r) => `${r.arm}-r${r.rep}-${r.id}`), concurrency: 4 });
  const t0 = Date.now();
  const res = await pool(runs, 4, async (r) => {
    if (fs.existsSync(path.join(r.runDir, 'run.json'))) { const prev = json(path.join(r.runDir, 'run.json')); if (prev.status && prev.status !== 'unfinished') return { skipped: true, status: prev.status }; }
    const run = await runIncumbent(requestText(r.id), r.runDir, { stage: 's3', arm: r.arm, request: r.id, rep: r.rep }, { effort: r.effort });
    console.log(`${new Date().toISOString()} ${r.arm}-r${r.rep}-${r.id}: ${run.status} ${run.gates?.tests ?? ''} rounds=${run.roundsUsed ?? '?'} wall=${Math.round(run.wall_ms / 1000)}s`);
    return { status: run.status };
  });
  console.log(JSON.stringify({ done: res.length, statuses: res.map((x) => x.status ?? x.error), wall_min: (Date.now() - t0) / 60000, tokens: totalsSoFar() }));
}

if (cmd === 'score') {
  const runs = fs.readdirSync(BASE).filter((d) => fs.existsSync(path.join(BASE, d, 'run.json'))).map((d) => json(path.join(BASE, d, 'run.json')));
  const gated = runs.filter((r) => r.gated);
  const items = shuffle(gated, freeze.seed + 300).map((r, i) => { const req = requestText(r.request); const { md, calls } = renderSheet(artDir(path.join(BASE, r.runId), r.request), { itemNo: i + 1, req }); fs.writeFileSync(path.join(BASE, r.runId, 'sheet-oracle.md'), md); writeJson(path.join(BASE, r.runId, 'sheet-oracle.calls.json'), calls); return { item: i + 1, id: r.request, sheet: md, runId: r.runId }; });
  writeJson(path.join(WORK, 'oracle', 'keys', 's3-items.json'), items.map(({ sheet, ...x }) => x));
  const results = await Promise.all(Object.keys(ORACLES).map((o) => scoreSheets(o, items, { batch: 6, concurrency: 3, stage: 'score-s3', batchTag: 's3' })));
  Object.keys(ORACLES).forEach((o, i) => { for (const v of results[i]) { if (v.error) { appendJsonl(path.join(RECEIPT, 'scores-s3.jsonl'), { oracle: o, error: v.error }); continue; } const it = items.find((x) => x.item === v.item); const run = gated.find((r) => r.runId === it.runId); appendJsonl(path.join(RECEIPT, 'scores-s3.jsonl'), { at: now(), runId: it.runId, id: it.id, arm: run.arm, rep: run.rep, oracle: o, verdict: v.verdict, q1: v.q1, q2: v.q2, q3: v.q3, q5: v.q5, q6: v.q6, callId: v.callId }); } });
  console.log(JSON.stringify({ gated: gated.length, scored: results.map((r) => r.filter((x) => x.verdict).length) }));
}
