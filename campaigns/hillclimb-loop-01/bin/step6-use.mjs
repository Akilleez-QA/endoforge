#!/usr/bin/env node
// Agent-corroborated use (step 6): five challenger (E) promotions from the screen, chosen with a seed among the gated E
// artefacts, each copied to work/use/<id>/ with only kernel.wasm and glue.json (the consumer sees the capability, never
// the contract, tests, code or any verdict). `prepare` writes the five briefs; the coordinator runs each in a fresh
// technician-frame agent; `collect` gathers the reports into receipt/consumer-use.json.
//   node bin/step6-use.mjs prepare | collect
import fs from 'node:fs';
import path from 'node:path';
import { KIT, WORK, RECEIPT, requestText, json, writeJson, now, sha } from '../lib/runner.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const freeze = json(path.join(RECEIPT, 'freeze.json'));
const cmd = process.argv[2];
const USE = path.join(WORK, 'use');
if (cmd === 'prepare') {
  const runs = fs.readdirSync(path.join(WORK, 'runs', 's5')).filter((d) => d.startsWith('E-') && fs.existsSync(path.join(WORK, 'runs', 's5', d, 'run.json'))).map((d) => json(path.join(WORK, 'runs', 's5', d, 'run.json'))).filter((r) => r.gated && r.status !== 'gated-rejected-by-persona');
  const picks = shuffle(runs.map((r) => r.request), freeze.seed + 700).slice(0, 5);
  const briefs = [];
  for (const id of picks) {
    const r = runs.find((x) => x.request === id); const art = path.join(KIT, r.art); const dst = path.join(USE, id);
    fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
    for (const f of ['kernel.wasm', 'glue.json']) fs.copyFileSync(path.join(art, f), path.join(dst, f));
    const req = requestText(id);
    const brief = fs.readFileSync(path.join(KIT, 'briefs', 'consumer-use-v1.md'), 'utf8').replace('{{REQUEST}}', req.text).replace('{{KIT}}', KIT).replace('{{TRY}}', 'bin/try.mjs').replace('{{DIR}}', path.relative(KIT, dst));
    fs.writeFileSync(path.join(dst, 'BRIEF.md'), brief);
    briefs.push({ id, run: r.runId, status: r.status, dir: path.relative(KIT, dst), briefSha256: sha(brief), wasmSha256: sha(fs.readFileSync(path.join(dst, 'kernel.wasm'))) });
  }
  writeJson(path.join(RECEIPT, 'consumer-use-plan.json'), { at: now(), seed: freeze.seed + 700, eligible: runs.length, picks: briefs });
  console.log(JSON.stringify(briefs, null, 1));
}
if (cmd === 'collect') {
  const plan = json(path.join(RECEIPT, 'consumer-use-plan.json'));
  const reports = plan.picks.map((p) => { const f = path.join(KIT, p.dir, 'REPORT.json'); return { ...p, report: fs.existsSync(f) ? json(f) : null }; });
  const out = { at: now(), n: reports.length, reported: reports.filter((r) => r.report).length, answered: reports.filter((r) => r.report?.answered_my_question === 'yes').length, partly: reports.filter((r) => r.report?.answered_my_question === 'partly').length, wouldUse: reports.filter((r) => r.report?.would_use_on_the_job === 'yes').length, assumptionAcceptable: reports.filter((r) => r.report?.assumption_acceptable === 'yes').length, calls: reports.reduce((s, r) => s + (r.report?.calls?.length ?? 0), 0), reports };
  writeJson(path.join(RECEIPT, 'consumer-use.json'), out);
  console.log(JSON.stringify({ n: out.n, reported: out.reported, answered: out.answered, partly: out.partly, wouldUse: out.wouldUse, calls: out.calls }));
}
