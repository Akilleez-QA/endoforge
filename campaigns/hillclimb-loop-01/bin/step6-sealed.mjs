#!/usr/bin/env node
// Step 6 (durability baseline): the 20 sealed requests once under each manifest: incumbent (inc-low) and the full
// challenger E (S-new -> G-new -> output persona -> D-02 repair); B's artefact is kept and scored too. Then criteria + scoring.
//   node bin/step6-sealed.mjs run [--limit N] | criteria
import fs from 'node:fs';
import path from 'node:path';
import { WORK, RECEIPT, requestText, json, writeJson, pool, now, appendJsonl, totalsSoFar } from '../lib/runner.mjs';
import { runIncumbent, runSpecNew, runGenBlind, runRepairD02, personaStage, artDir, recordRun } from '../lib/factory.mjs';
import { buildIndex, retrieve } from '../lib/retrieval.mjs';
import { ORACLES, writeCriteria } from '../lib/oracle.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const freeze = json(path.join(RECEIPT, 'freeze.json'));
const BASE = path.join(WORK, 'runs', 's6');
const cmd = process.argv[2];
if (cmd === 'criteria') {
  const reqs = freeze.sealed.map(requestText);
  const res = await Promise.all(Object.keys(ORACLES).map((o) => writeCriteria(o, reqs, { batch: 5, concurrency: 2, stage: 'criteria-sealed' })));
  console.log(JSON.stringify(res.map((r) => ({ oracle: r.oracle, written: Object.keys(r.criteriaSha256).length }))));
}
if (cmd === 'run') {
  const limit = Number((process.argv.indexOf('--limit') >= 0 && process.argv[process.argv.indexOf('--limit') + 1]) || 20);
  const index = buildIndex(freeze.development);
  const order = shuffle(freeze.sealed, freeze.seed + 600).slice(0, limit);
  writeJson(path.join(RECEIPT, 'sealed-plan.json'), { at: now(), seed: freeze.seed + 600, order, concurrency: 3 });
  const done = (d) => fs.existsSync(path.join(d, 'run.json')) && json(path.join(d, 'run.json')).status !== 'unfinished';
  const load = (d) => json(path.join(d, 'run.json'));
  await pool(order, 3, async (id) => {
    const req = requestText(id); const hit = retrieve(index, req.text);
    const meta = (arm) => ({ stage: 's6', arm, request: id, rep: 1 });
    const dA = path.join(BASE, `A-inc-low-${id}`), dS = path.join(BASE, `S-new-${id}`), dB = path.join(BASE, `B-Snew-Gnew-${id}`), dE = path.join(BASE, `E-Snew-Gnew-D02-${id}`);
    const [A, S] = await Promise.all([done(dA) ? load(dA) : runIncumbent(req, dA, meta('S-old.G-old'), { effort: 'low' }), done(dS) ? load(dS) : runSpecNew(req, dS, meta('S-new'), { retrieved: hit })]);
    const B = S?.status === 'spec-frozen' ? (done(dB) ? load(dB) : await runGenBlind(req, artDir(dS, id), dB, meta('S-new.G-new'), { retrieved: hit })) : null;
    if (B?.gated && !fs.existsSync(path.join(dB, id, 'persona.json'))) { try { const p = await personaStage(req, path.join(dB, id), meta('S-new.G-new')); B.persona = { personas: p.personas, verdicts: p.verdicts }; B.calls.push(p.callId); recordRun(path.join(dB, id), B); } catch (e) { B.personaError = e.message; } }
    const E = B ? (done(dE) ? load(dE) : await runRepairD02(req, artDir(dS, id), dB, dE, meta('S-new.G-new.D02'), { retrieved: hit })) : null;
    const line = { at: now(), id, retrieval: hit ? { id: hit.id, j: hit.j } : null, A: { status: A.status, gates: A.gates?.tests, persona: A.persona?.verdicts?.map((v) => v.verdict) }, S: { status: S.status, revised: S.stubRevised ?? false, cpersona: S.contractPersona?.verdict }, B: B ? { status: B.status, gates: B.gates?.tests, g8: B.gate8?.ok ?? null, selected: B.selected, persona: B.persona?.verdicts?.map((v) => v.verdict) ?? null } : null, E: E ? { status: E.status, repair: E.repairNeeded, resolved: E.repairResolved ?? null, gates: E.gates?.tests } : null, tokensSoFar: totalsSoFar().total };
    appendJsonl(path.join(RECEIPT, 'sealed-blocks.jsonl'), line); console.log(JSON.stringify(line));
  });
  console.log(JSON.stringify(totalsSoFar()));
}
