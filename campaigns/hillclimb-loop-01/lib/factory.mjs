// The two factories of loop 1 as runnable stages. Incumbent = factory v2 protocol in single-shot form (one worker call for
// contract, tests, kernel, glue and outcome; coordinator freezes and gates; up to 3 repairs; blind output persona stage).
// Challenger stages: stub -> contract-stage persona (fold-in once) -> blind evaluator (S-new); blind generator width 2 with
// compile self-check and Opus escalation (G-new); G8 (Q-new) and no output persona (R-new) are applied as filters.
import fs from 'node:fs';
import path from 'node:path';
import { KIT, X1, callClaude, parseFiles, parseJsonLoose, sha, writeJson, appendJsonl, RECEIPT, now } from './runner.mjs';
import { freeze, runGates, gateSummary, gateFeedback } from './gates.mjs';
import { runGate8 } from './gate8.mjs';
import { renderSheet } from './sheet.mjs';
import { retrievedBlock } from './retrieval.mjs';

export const TEMPLATE = fs.readFileSync(path.join(X1, 'templates', 'CONTRACT.md'), 'utf8');
export const SCHEMA = fs.readFileSync(path.join(X1, 'factory', 'glue.schema.json'), 'utf8');
const briefText = (name) => fs.readFileSync(path.join(KIT, 'briefs', `${name}.md`), 'utf8');
export const PERSONAS = briefText('personas-v1').split('\n').filter((l) => l.startsWith('- **')).join('\n');
export const fill = (t, vars) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = fs.existsSync;

export function personasFor(role) {
  const r = String(role).toLowerCase();
  if (/technician|chatbot|contractor|service/.test(r)) return ['technician', 'field-service-contractor'];
  if (/author|owner|manager|admin|decision|process/.test(r)) return ['plant-manager', 'new-admin'];
  if (/operator|psm|plant/.test(r)) return ['operator', 'psm-coordinator'];
  return ['technician', 'plant-manager'];
}

export function reqVars(req) { return { ID: req.id, ROLE: req.role, REQUEST: req.text, INPUTS: req.inputs || '- none named', EXAMPLES: req.examples || '- none', TEMPLATE, SCHEMA }; }

function writeFiles(dir, files, allowed) {
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, body] of Object.entries(files)) if (allowed.includes(name)) { fs.writeFileSync(path.join(dir, name), body); written.push(name); }
  return written;
}
function validJson(p) { try { JSON.parse(read(p)); return true; } catch { return false; } }

/** Record a run (append to receipt/runs.jsonl and write run.json in the dir); request text never enters the receipt. */
export function recordRun(dir, run) {
  run.endedAt = now(); run.wall_ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  const runDir = path.basename(dir) === run.request ? path.dirname(dir) : dir;
  run.art = path.relative(KIT, path.join(runDir, run.request));
  writeJson(path.join(runDir, 'run.json'), run);
  const { feedbackTexts, ...rest } = run;
  appendJsonl(path.join(RECEIPT, 'runs.jsonl'), rest);
  return run;
}

function statusFrom(gates, outcomeClaim, persona) {
  const gated = Boolean(gates?.promotable) && (outcomeClaim == null || ['promoted', 'promoted-with-assumption'].includes(outcomeClaim));
  if (!gated) return { gated: false, status: outcomeClaim === 'rejected' ? 'rejected' : 'not-gated' };
  if (persona === undefined) return { gated: true, status: 'gated' };
  if (!persona) return { gated: true, status: 'gated-unreviewed' };
  const vs = persona.verdicts ?? [];
  if (vs.some((v) => v.verdict === 'reject')) return { gated: true, status: 'gated-rejected-by-persona' };
  if (vs.some((v) => v.verdict === 'accept-with-change')) return { gated: true, status: 'promoted-pending-change' };
  return { gated: true, status: outcomeClaim ?? 'promoted-with-assumption' };
}

/** Output persona stage (R-old): one blind call, two personas, verdict JSON -> persona.json. */
export async function personaStage(req, dir, meta, { model = 'claude-sonnet-5-5', effort = null } = {}) {
  const [a, b] = personasFor(req.role);
  const sheet = renderSheet(dir, { label: 'The capability', req: { text: req.text, role: req.role } });
  fs.writeFileSync(path.join(dir, 'sheet-persona.md'), sheet.md);
  const prompt = fill(briefText('persona-output-v1'), { PERSONA_A: a, PERSONA_B: b, PERSONAS, SHEET: sheet.md });
  const r = await callClaude(prompt, { ...meta, tag: 'persona' }, { model, effort: effort ?? undefined });
  const j = parseJsonLoose(r.text);
  const verdicts = Array.isArray(j?.verdicts) ? j.verdicts.filter((v) => v && ['accept', 'accept-with-change', 'reject'].includes(v.verdict)) : [];
  const persona = { id: req.id, at: now(), reviewer: `persona-output-v1 (${r.model}, single-shot, blind)`, method: 'two personas chosen from the requester role; sheet with frozen-test and coordinator probe calls', calls: sheet.calls.length, personas: [a, b], verdicts, callId: r.callId };
  writeJson(path.join(dir, 'persona.json'), persona);
  return persona;
}

/**
 * Incumbent run: factory v2 in single-shot form. opts: {model, effort, withPersona}. Returns run record.
 */
export const artDir = (runDir, id) => path.join(runDir, id);

export async function runIncumbent(req, runDir, meta, opts = {}) {
  const run = { runId: path.basename(runDir), ...meta, manifest: 'incumbent', model: opts.model ?? 'default', effort: opts.effort ?? 'default', startedAt: now(), calls: [], rounds: [], retrieval: null };
  const dir = artDir(runDir, req.id);
  fs.mkdirSync(dir, { recursive: true });
  const prompt = fill(briefText('incumbent-worker-v1'), reqVars(req));
  let r;
  try { r = await callClaude(prompt, { ...meta, tag: 'worker' }, { model: opts.model, effort: opts.effort }); } catch (e) { run.error = `worker: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
  run.calls.push(r.callId);
  const files = parseFiles(r.text);
  run.filesReturned = Object.keys(files);
  const spec = writeFiles(dir, files, ['CONTRACT.md', 'tests.json']);
  if (!spec.includes('CONTRACT.md') || !spec.includes('tests.json') || !validJson(path.join(dir, 'tests.json'))) { run.error = 'worker returned no valid contract/tests'; run.status = 'unfinished'; return recordRun(dir, run); }
  try { run.frozen = freeze(dir); } catch (e) { run.error = `freeze: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
  writeFiles(dir, files, ['kernel.ts', 'glue.json', 'outcome.json']);
  let outcome = null; try { outcome = JSON.parse(read(path.join(dir, 'outcome.json'))); } catch {}
  run.outcomeClaim = outcome?.outcome ?? null; run.usage = outcome?.usage ?? null; run.question = outcome?.question ?? null; run.self = outcome?.self ?? null;
  let gates = runGates(dir); run.rounds.push({ round: 1, ...gateSummary(gates) });
  for (let round = 2; round <= 4 && !gates.promotable; round++) {
    const fb = gateFeedback(gates);
    const rp = fill(briefText('incumbent-repair-v1'), { ROUND: round - 1, FEEDBACK: fb, CONTRACT: read(path.join(dir, 'CONTRACT.md')), TESTS: read(path.join(dir, 'tests.json')), KERNEL: exists(path.join(dir, 'kernel.ts')) ? read(path.join(dir, 'kernel.ts')) : '(none)', GLUE: exists(path.join(dir, 'glue.json')) ? read(path.join(dir, 'glue.json')) : '(none)', SCHEMA, ID: req.id });
    let rr; try { rr = await callClaude(rp, { ...meta, tag: `repair${round - 1}` }, { model: opts.model, effort: opts.effort }); } catch (e) { run.error = `repair: ${e.message}`; break; }
    run.calls.push(rr.callId);
    writeFiles(dir, parseFiles(rr.text), ['kernel.ts', 'glue.json']);
    gates = runGates(dir); run.rounds.push({ round, ...gateSummary(gates) });
  }
  run.gates = gateSummary(gates); run.roundsUsed = run.rounds.length;
  if (outcome) { outcome.rounds = run.roundsUsed; writeJson(path.join(dir, 'outcome.json'), outcome); }
  run.gate8 = gates.promotable ? { ok: runGate8(dir).ok } : null;
  let persona = undefined;
  if (opts.withPersona !== false && gates.promotable) { try { persona = await personaStage(req, dir, meta, { model: opts.personaModel ?? 'claude-sonnet-5-5' }); run.calls.push(persona.callId); } catch (e) { persona = null; run.personaError = e.message; } }
  run.persona = persona ? { personas: persona.personas, verdicts: persona.verdicts } : persona;
  Object.assign(run, statusFrom(gates, run.outcomeClaim, persona));
  return recordRun(dir, run);
}

/** Challenger S-new: stub -> contract persona (fold-in once) -> blind evaluator. Writes stub.json, CONTRACT.md, properties.md, tests.json, frozen. */
export async function runSpecNew(req, runDir, meta, opts = {}) {
  const run = { runId: path.basename(runDir), ...meta, manifest: 'challenger-spec', startedAt: now(), calls: [], retrieval: opts.retrieved ? { id: opts.retrieved.id, jaccard: opts.retrieved.j } : null };
  const dir = artDir(runDir, req.id);
  fs.mkdirSync(dir, { recursive: true });
  const vars = { ...reqVars(req), RETRIEVED: retrievedBlock(opts.retrieved), FEEDBACK: '' };
  const stubCall = async (feedback, tag) => { const r = await callClaude(fill(briefText('stub-v1'), { ...vars, FEEDBACK: feedback }), { ...meta, tag }, { model: 'claude-sonnet-5-5', effort: 'low' }); run.calls.push(r.callId); return parseJsonLoose(r.text); };
  let stub;
  if (opts.amend) { // D-02: fold a blind reviewer's finding on the built capability into the existing stub (one revision), no contract persona
    run.manifest = 'challenger-spec-amended'; run.amendment = opts.amend.findings;
    const fb = `\n## A reviewer in the field used the capability built from the stub below and asks for this change before it ships\n\n${opts.amend.findings}\n\n## The stub it was built from\n\n${JSON.stringify(opts.amend.stub, null, 2)}\n\nFold the change into the stub (keep everything that still fits; change export names or arguments only if the change needs it).\n`;
    try { stub = await stubCall(fb, 'stub-amend'); } catch (e) { run.error = `stub-amend: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
    if (!stub || !Array.isArray(stub.exports)) { run.error = 'amended stub unparsable'; run.status = 'unfinished'; return recordRun(dir, run); }
    stub.id = req.id;
  } else {
  try { stub = await stubCall('', 'stub'); } catch (e) { run.error = `stub: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
  if (!stub || !Array.isArray(stub.exports)) { run.error = 'stub unparsable'; run.status = 'unfinished'; return recordRun(dir, run); }
  stub.id = req.id; writeJson(path.join(dir, 'stub-v1.json'), stub);
  }
  // contract-stage persona
  const [a, b] = personasFor(req.role);
  if (!opts.amend) try {
    const pr = await callClaude(fill(briefText('persona-contract-v1'), { PERSONA_A: a, PERSONA_B: b, PERSONAS, ID: req.id, ROLE: req.role, REQUEST: req.text, STUB: JSON.stringify(stub, null, 2) }), { ...meta, tag: 'cpersona' }, { model: 'claude-sonnet-5-5' });
    run.calls.push(pr.callId);
    const pj = parseJsonLoose(pr.text);
    writeJson(path.join(dir, 'persona-contract.json'), { personas: [a, b], ...(pj ?? { verdict: null }) });
    run.contractPersona = { verdict: pj?.verdict ?? null, change: pj?.change ?? null };
    if (pj?.verdict === 'revise' && pj.change) {
      const fb = `\n## A reviewer in the field read a first draft of this stub and asks for one change before anything is built\n\n${pj.change}\n\nFold this change into the stub (keep everything else that still fits).\n`;
      try { const s2 = await stubCall(fb, 'stub2'); if (s2 && Array.isArray(s2.exports)) { s2.id = req.id; stub = s2; run.stubRevised = true; } } catch (e) { run.stubReviseError = e.message; }
    }
  } catch (e) { run.contractPersonaError = e.message; }
  writeJson(path.join(dir, 'stub.json'), stub);
  run.serviceable = stub.serviceable !== false; run.consequence = stub.consequence ?? null;
  // blind evaluator
  try {
    const er = await callClaude(fill(briefText('evaluator-v1'), { ...vars, STUB: JSON.stringify(stub, null, 2) }), { ...meta, tag: 'evaluator' }, { model: 'claude-sonnet-5-5' });
    run.calls.push(er.callId);
    const files = parseFiles(er.text);
    const w = writeFiles(dir, files, ['CONTRACT.md', 'properties.md', 'tests.json']);
    if (!w.includes('CONTRACT.md') || !w.includes('tests.json') || !validJson(path.join(dir, 'tests.json'))) throw new Error('evaluator returned no valid contract/tests');
    run.frozen = freeze(dir);
    run.testsCount = JSON.parse(read(path.join(dir, 'tests.json'))).length;
  } catch (e) { run.error = `evaluator: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
  run.status = 'spec-frozen';
  return recordRun(dir, run);
}

/** Copy a frozen spec (contract, tests, frozen.sha256, stub if any) into a generation dir. */
function seedFromSpec(specDir, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['CONTRACT.md', 'tests.json', 'frozen.sha256', 'stub.json', 'properties.md']) if (exists(path.join(specDir, f))) fs.copyFileSync(path.join(specDir, f), path.join(dir, f));
}

/** G-old as a separate call (for the S-new x G-old corner): Opus low, sees contract + tests, up to 3 repairs. */
export async function runGenSequential(req, specDir, runDir, meta, opts = {}) {
  const run = { runId: path.basename(runDir), ...meta, manifest: 'gen-sequential', model: opts.model ?? 'default', effort: opts.effort ?? 'low', startedAt: now(), calls: [], rounds: [], specFrom: path.relative(KIT, specDir) };
  const dir = artDir(runDir, req.id);
  seedFromSpec(specDir, dir);
  const vars = { ...reqVars(req), CONTRACT: read(path.join(dir, 'CONTRACT.md')), TESTS: read(path.join(dir, 'tests.json')) };
  let r; try { r = await callClaude(fill(briefText('generator-sequential-v1'), vars), { ...meta, tag: 'gen' }, { model: opts.model, effort: opts.effort ?? 'low' }); } catch (e) { run.error = `gen: ${e.message}`; run.status = 'unfinished'; return recordRun(dir, run); }
  run.calls.push(r.callId);
  writeFiles(dir, parseFiles(r.text), ['kernel.ts', 'glue.json']);
  let gates = runGates(dir); run.rounds.push({ round: 1, ...gateSummary(gates) });
  for (let round = 2; round <= 4 && !gates.promotable; round++) {
    const rp = fill(briefText('incumbent-repair-v1'), { ROUND: round - 1, FEEDBACK: gateFeedback(gates), CONTRACT: vars.CONTRACT, TESTS: vars.TESTS, KERNEL: exists(path.join(dir, 'kernel.ts')) ? read(path.join(dir, 'kernel.ts')) : '(none)', GLUE: exists(path.join(dir, 'glue.json')) ? read(path.join(dir, 'glue.json')) : '(none)', SCHEMA, ID: req.id });
    let rr; try { rr = await callClaude(rp, { ...meta, tag: `repair${round - 1}` }, { model: opts.model, effort: opts.effort ?? 'low' }); } catch (e) { run.error = `repair: ${e.message}`; break; }
    run.calls.push(rr.callId);
    writeFiles(dir, parseFiles(rr.text), ['kernel.ts', 'glue.json']);
    gates = runGates(dir); run.rounds.push({ round, ...gateSummary(gates) });
  }
  run.gates = gateSummary(gates); run.roundsUsed = run.rounds.length;
  run.gate8 = gates.promotable ? { ok: runGate8(dir).ok } : null;
  Object.assign(run, statusFrom(gates, null, undefined));
  return recordRun(dir, run);
}

/** G-new: width 2 blind candidates (Sonnet), compile self-check once each, G1-G7, Opus escalation if none passes. */
export async function runGenBlind(req, specDir, runDir, meta, opts = {}) {
  const width = opts.width ?? 2;
  const run = { runId: path.basename(runDir), ...meta, manifest: 'gen-blind', width, startedAt: now(), calls: [], candidates: [], retrieval: opts.retrieved ? { id: opts.retrieved.id, jaccard: opts.retrieved.j } : null, specFrom: path.relative(KIT, specDir) };
  const dir = artDir(runDir, req.id);
  seedFromSpec(specDir, dir);
  const stub = exists(path.join(dir, 'stub.json')) ? read(path.join(dir, 'stub.json')) : '(no stub: use the contract\'s function names, arities and codes)';
  const vars = { ...reqVars(req), STUB: stub, CONTRACT: read(path.join(dir, 'CONTRACT.md')), RETRIEVED: retrievedBlock(opts.retrieved) };
  const genOne = async (k) => {
    const cdir = path.join(runDir, `cand${k}`, req.id); seedFromSpec(specDir, cdir);
    const c = { k, calls: [], rounds: [] };
    let r; try { r = await callClaude(fill(briefText('generator-blind-v1'), vars), { ...meta, tag: `cand${k}` }, { model: 'claude-sonnet-5-5' }); } catch (e) { c.error = e.message; return c; }
    c.calls.push(r.callId); writeFiles(cdir, parseFiles(r.text), ['kernel.ts', 'glue.json']);
    let g = runGates(cdir); c.rounds.push(gateSummary(g));
    if (!g.promotable && g.gates.G2_compiles && !g.gates.G2_compiles.ok) { // compile self-check: one fix
      try { const fr = await callClaude(fill(briefText('generator-compilefix-v1'), { FEEDBACK: g.gates.G2_compiles.why, KERNEL: read(path.join(cdir, 'kernel.ts')), GLUE: exists(path.join(cdir, 'glue.json')) ? read(path.join(cdir, 'glue.json')) : '(none)' }), { ...meta, tag: `cand${k}fix` }, { model: 'claude-sonnet-5-5' }); c.calls.push(fr.callId); writeFiles(cdir, parseFiles(fr.text), ['kernel.ts', 'glue.json']); g = runGates(cdir); c.rounds.push(gateSummary(g)); } catch (e) { c.fixError = e.message; }
    }
    if (!g.promotable && g.gates.G2_compiles?.ok && g.gates.G7_glue && !g.gates.G7_glue.ok) { // schema self-check: one fix on non-test problems
      const probs = String(g.gates.G7_glue.why).split('; ').filter((p) => !/tests\.json|in the tests|returned code/.test(p));
      if (probs.length) { try { const sr = await callClaude(fill(briefText('generator-schemafix-v1'), { FEEDBACK: probs.join('\n'), KERNEL: read(path.join(cdir, 'kernel.ts')), GLUE: exists(path.join(cdir, 'glue.json')) ? read(path.join(cdir, 'glue.json')) : '(none)', SCHEMA, ID: req.id }), { ...meta, tag: `cand${k}schema` }, { model: 'claude-sonnet-5-5' }); c.calls.push(sr.callId); writeFiles(cdir, parseFiles(sr.text), ['kernel.ts', 'glue.json']); g = runGates(cdir); c.rounds.push(gateSummary(g)); } catch (e) { c.schemaFixError = e.message; } }
    }
    c.gates = gateSummary(g); c.result = g; return c;
  };
  const cands = await Promise.all(Array.from({ length: width }, (_, i) => genOne(i + 1)));
  run.candidates = cands.map(({ result, ...c }) => c);
  run.calls.push(...cands.flatMap((c) => c.calls));
  let winner = cands.find((c) => c.gates?.promotable) ?? null;
  if (!winner) {
    const best = cands.filter((c) => c.result).sort((x, y) => (Number(y.result.gates.G4_tests?.passed ?? 0) - Number(x.result.gates.G4_tests?.passed ?? 0)))[0];
    if (best) {
      const bdir = path.join(runDir, `cand${best.k}`, req.id), edir = path.join(runDir, 'esc', req.id); seedFromSpec(specDir, edir);
      try {
        const er = await callClaude(fill(briefText('generator-escalation-v1'), { ...vars, FEEDBACK: gateFeedback(best.result), KERNEL: exists(path.join(bdir, 'kernel.ts')) ? read(path.join(bdir, 'kernel.ts')) : '(none)', GLUE: exists(path.join(bdir, 'glue.json')) ? read(path.join(bdir, 'glue.json')) : '(none)' }), { ...meta, tag: 'esc' }, {});
        run.calls.push(er.callId); writeFiles(edir, parseFiles(er.text), ['kernel.ts', 'glue.json']);
        const g = runGates(edir); run.escalation = { from: best.k, ...gateSummary(g) };
        if (g.promotable) winner = { k: 'esc', gates: gateSummary(g) };
        else { const e2 = (g.gates.G4_tests?.passed ?? 0) >= (best.result.gates.G4_tests?.passed ?? 0) ? 'esc' : best.k; winner = null; run.bestFailed = e2; }
      } catch (e) { run.escalationError = e.message; run.bestFailed = best.k; }
    }
  }
  const src = winner ? path.join(runDir, winner.k === 'esc' ? 'esc' : `cand${winner.k}`, req.id) : (run.bestFailed != null ? path.join(runDir, run.bestFailed === 'esc' ? 'esc' : `cand${run.bestFailed}`, req.id) : null);
  if (src) for (const f of ['kernel.ts', 'glue.json', 'kernel.wasm', 'kernel.wat', 'result.json']) if (exists(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  run.selected = winner ? String(winner.k) : null;
  const gates = exists(path.join(dir, 'result.json')) ? JSON.parse(read(path.join(dir, 'result.json'))) : { promotable: false, gates: {} };
  run.gates = gateSummary(gates);
  run.gate8 = gates.promotable ? { ok: runGate8(dir).ok } : null;
  Object.assign(run, statusFrom(gates, null, undefined));
  return recordRun(dir, run);
}

/**
 * D-02 (arm E): one bounded repair cycle on a gated all-new artefact. base = the gen-blind run record of B (with persona
 * verdicts already recorded by the R filter). If every persona accepted, E is B (no repair). Otherwise: amended stub ->
 * blind evaluator (new frozen spec) -> one blind candidate -> gates -> one fresh blind persona review. Returns the E run.
 */
export async function runRepairD02(req, baseSpecDir, baseGenRunDir, dir, meta, opts = {}) {
  const run = { runId: path.basename(dir), ...meta, manifest: 'challenger-d02', startedAt: now(), calls: [], base: path.relative(KIT, baseGenRunDir) };
  fs.mkdirSync(dir, { recursive: true });
  const baseArt = artDir(baseGenRunDir, req.id);
  const baseRun = JSON.parse(read(path.join(baseGenRunDir, 'run.json')));
  const persona = exists(path.join(baseArt, 'persona.json')) ? JSON.parse(read(path.join(baseArt, 'persona.json'))) : null;
  const findings = (persona?.verdicts ?? []).filter((v) => v.verdict !== 'accept' && v.change).map((v) => `- ${v.persona} (${v.verdict}): ${v.change}`).join('\n');
  if (!baseRun.gated) { run.repairNeeded = false; run.status = 'not-gated (base not gated; no repair path)'; run.gated = false; return recordRun(path.join(dir, req.id), Object.assign(run, { art: path.relative(KIT, baseArt) })); }
  if (!findings) { // nothing to repair: E is B
    run.repairNeeded = false; run.gates = baseRun.gates; run.gate8 = baseRun.gate8; run.gated = baseRun.gated; run.persona = baseRun.persona ?? { personas: persona?.personas, verdicts: persona?.verdicts ?? [] };
    fs.mkdirSync(artDir(dir, req.id), { recursive: true }); for (const f of fs.readdirSync(baseArt)) fs.copyFileSync(path.join(baseArt, f), path.join(artDir(dir, req.id), f));
    Object.assign(run, statusFrom({ promotable: baseRun.gated, gates: {} }, null, persona));
    run.endedAt = now(); run.wall_ms = 0; run.art = path.relative(KIT, artDir(dir, req.id)); writeJson(path.join(dir, 'run.json'), run); appendJsonl(path.join(RECEIPT, 'runs.jsonl'), run); return run;
  }
  run.repairNeeded = true; run.findings = findings;
  const stub = exists(path.join(baseArt, 'stub.json')) ? JSON.parse(read(path.join(baseArt, 'stub.json'))) : JSON.parse(read(path.join(baseSpecDir, 'stub.json')));
  const specDir = path.join(dir, 'spec');
  const spec = await runSpecNew(req, specDir, { ...meta, tag: 'd02' }, { retrieved: opts.retrieved, amend: { findings, stub } });
  run.calls.push(...spec.calls); run.spec = { status: spec.status, tests: spec.testsCount ?? null };
  if (spec.status !== 'spec-frozen') { run.error = `amended spec: ${spec.error ?? spec.status}`; run.status = 'unfinished'; run.gated = false; return recordRun(path.join(dir, req.id), run); }
  const genDir = path.join(dir, 'gen');
  const gen = await runGenBlind(req, artDir(specDir, req.id), genDir, { ...meta, tag: 'd02gen' }, { retrieved: opts.retrieved, width: 1 });
  run.calls.push(...gen.calls); run.gen = { status: gen.status, gates: gen.gates, selected: gen.selected, escalation: gen.escalation ?? null };
  const genArt = artDir(genDir, req.id);
  fs.mkdirSync(artDir(dir, req.id), { recursive: true }); for (const f of fs.readdirSync(genArt)) fs.copyFileSync(path.join(genArt, f), path.join(artDir(dir, req.id), f));
  run.gates = gen.gates; run.gate8 = gen.gate8;
  let persona2 = undefined;
  if (gen.gated) { try { persona2 = await personaStage(req, artDir(dir, req.id), { ...meta, tag: 'd02persona' }); run.calls.push(persona2.callId); } catch (e) { persona2 = null; run.personaError = e.message; } }
  run.persona = persona2 ? { personas: persona2.personas, verdicts: persona2.verdicts } : persona2;
  run.repairResolved = Boolean(persona2 && persona2.verdicts.length && persona2.verdicts.every((v) => v.verdict === 'accept'));
  Object.assign(run, statusFrom({ promotable: gen.gated, gates: {} }, null, persona2));
  return recordRun(path.join(dir, req.id), run);
}
