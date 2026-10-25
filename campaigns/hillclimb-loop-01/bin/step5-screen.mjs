#!/usr/bin/env node
// Step 5: the screen on the 20 working requests. Per request (request-complete blocks, three requests in flight):
//   A = incumbent run (S-old,G-old)          B = S-new -> G-new (all-new generation)      E = B + D-02 (one bounded repair)
//   optional corners (carried forward by the budget decision): C = S-new -> G-old, D = S-old -> G-new
// then the output persona stage (R-old filter) on every gated artefact; G8 (Q-new filter) is computed by the stages.
//   node bin/step5-screen.mjs [--limit N] [--artefacts A,B,E]
import fs from 'node:fs';
import path from 'node:path';
import { WORK, RECEIPT, requestText, json, writeJson, pool, now, appendJsonl, totalsSoFar } from '../lib/runner.mjs';
import { runIncumbent, runSpecNew, runGenBlind, runGenSequential, runRepairD02, personaStage, artDir, recordRun } from '../lib/factory.mjs';
import { buildIndex, retrieve } from '../lib/retrieval.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';

const freeze = json(path.join(RECEIPT, 'freeze.json'));
const BASE = path.join(WORK, 'runs', 's5');
const limit = Number((process.argv.indexOf('--limit') >= 0 && process.argv[process.argv.indexOf('--limit') + 1]) || 20);
const want = new Set(((process.argv.indexOf('--artefacts') >= 0 && process.argv[process.argv.indexOf('--artefacts') + 1]) || 'A,B,E').split(','));
const index = buildIndex(freeze.development);
const order = shuffle(freeze.working, freeze.seed + 500).slice(0, limit);
writeJson(path.join(RECEIPT, 'screen-plan.json'), { at: now(), seed: freeze.seed + 500, order, artefacts: [...want], concurrency: 3 });
const done = (d) => fs.existsSync(path.join(d, 'run.json')) && !['unfinished'].includes(json(path.join(d, 'run.json')).status);
const load = (d) => json(path.join(d, 'run.json'));

const t0 = Date.now();
await pool(order, 3, async (id) => {
  const req = requestText(id); const hit = retrieve(index, req.text);
  const meta = (arm) => ({ stage: 's5', arm, request: id, rep: 1 });
  const dA = path.join(BASE, `A-inc-low-${id}`), dS = path.join(BASE, `S-new-${id}`), dB = path.join(BASE, `B-Snew-Gnew-${id}`), dC = path.join(BASE, `C-Snew-Gold-${id}`), dD = path.join(BASE, `D-Sold-Gnew-${id}`), dE = path.join(BASE, `E-Snew-Gnew-D02-${id}`);
  const [A, S] = await Promise.all([
    want.has('A') || want.has('D') ? (done(dA) ? load(dA) : runIncumbent(req, dA, meta('S-old.G-old'), { effort: 'low' })) : null,
    want.has('B') || want.has('C') || want.has('E') ? (done(dS) ? load(dS) : runSpecNew(req, dS, meta('S-new'), { retrieved: hit })) : null,
  ]);
  const jobs = [];
  if (S?.status === 'spec-frozen') {
    if (want.has('B') || want.has('E')) jobs.push(done(dB) ? Promise.resolve(load(dB)) : runGenBlind(req, artDir(dS, id), dB, meta('S-new.G-new'), { retrieved: hit }));
    if (want.has('C')) jobs.push(done(dC) ? Promise.resolve(load(dC)) : runGenSequential(req, artDir(dS, id), dC, meta('S-new.G-old'), { effort: 'low' }));
  }
  if (want.has('D') && A?.frozen) jobs.push(done(dD) ? Promise.resolve(load(dD)) : runGenBlind(req, artDir(dA, id), dD, meta('S-old.G-new'), { retrieved: hit }));
  const gens = await Promise.all(jobs);
  // R-old filter: output persona stage on every gated artefact that lacks one
  for (const g of gens) { if (g?.gated && !fs.existsSync(path.join(BASE, g.runId, id, 'persona.json'))) { try { const p = await personaStage(req, path.join(BASE, g.runId, id), { stage: 's5', arm: g.arm, request: id, rep: 1 }); g.persona = { personas: p.personas, verdicts: p.verdicts }; g.calls.push(p.callId); g.personaStatus = p.verdicts.some((v) => v.verdict === 'reject') ? 'gated-rejected-by-persona' : p.verdicts.some((v) => v.verdict === 'accept-with-change') ? 'promoted-pending-change' : 'promoted-with-assumption'; recordRun(path.join(BASE, g.runId, id), g); } catch (e) { g.personaError = e.message; } } }
  // E = B + D-02: needs B's persona verdicts (just recorded); one bounded repair cycle
  let E = null;
  if (want.has('E')) { const B = gens.find((g) => g?.arm === 'S-new.G-new'); if (B) { E = done(dE) ? load(dE) : await runRepairD02(req, artDir(dS, id), dB, dE, meta('S-new.G-new.D02'), { retrieved: hit }); gens.push(E); } }
  const line = { at: now(), id, retrieval: hit ? { id: hit.id, j: hit.j } : null, A: A ? { status: A.status, gates: A.gates?.tests, g8: A.gate8?.ok ?? null, persona: A.persona?.verdicts?.map((v) => v.verdict) } : null, S: S ? { status: S.status, revised: S.stubRevised ?? false, tests: S.testsCount, cpersona: S.contractPersona?.verdict } : null, gens: gens.map((g) => ({ arm: g.arm, status: g.status, gates: g.gates?.tests, g8: g.gate8?.ok ?? null, selected: g.selected ?? null, persona: g.persona?.verdicts?.map((v) => v.verdict) ?? null, repair: g.repairNeeded ?? undefined, resolved: g.repairResolved ?? undefined })), tokensSoFar: totalsSoFar().total };
  appendJsonl(path.join(RECEIPT, 'screen-blocks.jsonl'), line);
  console.log(JSON.stringify(line));
});
console.log(JSON.stringify({ wall_min: (Date.now() - t0) / 60000, tokens: totalsSoFar() }));
