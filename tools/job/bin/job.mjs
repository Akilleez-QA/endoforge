#!/usr/bin/env node
// Endoforge job intake: POODO executed as code (Pontificate → Observe → Orient → Decide → Orchestrate → Loop).
//
//   job.mjs validate <job.json> [--gate pontificate|observe|orient|decide|orchestrate|loop] [--offline] [--json]
//        every rule up to the gate, each citing its invariant (I1–I14); exit 1 when the gate refuses.
//        At orchestrate it runs the machine health check (resources.health, default ~/.local/bin/system-safety-status).
//   job.mjs calibrate <job.json> [--criterion ID]
//        run each proxy check on its known-good and known-bad case (${input}); good must pass, bad must fail.
//   job.mjs card <job.json> [--out card.md]      retrieve open lessons of earlier jobs of this kind, render the job card
//        (verbatim goal, brief, what governs what with thumbnails, atoms, checks, gates, invariants) and its sha256
//   job.mjs confirm <job.json> --sha <card sha> --by <user> --words "<their words>" [--via direct|relayed]
//        record the user's own confirmation of exactly that card; a relayed one is recorded and refused at Decide
//   job.mjs lessons <job.json>                       the open lessons, and which atoms each reaches
//   job.mjs compile <job.json> [--out dir] [--offline]   every atom's prompt from the manifest, plus manifest.json (hashes)
//   job.mjs stage <job.json>                         Decide minus the go must pass; renders JOB-<id>.md, emits STAGED
//   job.mjs fire <job.json> [-- <launch command>]    only after the user's go on the staged card: Orchestrate gates,
//        compiled prompts, FIRED (atoms by engine and login, prompt hash, predictions, gates, ETA, stop), then launch
//   job.mjs event <job.json> <SMOKE|SCORED|GATE|NEEDS-YOU|DONE> <summary> [--detail md] [--data json]
//   job.mjs status <job.json>                        the live timeline (with the Conductor's phase and atoms when it runs)
//   job.mjs go|lock|pause|resume|budget|stop <job.json> …   the Conductor's commands (tools/conductor/bin/conduct.mjs)
//   job.mjs smoke <job.json>                         one tiny atom per engine on a discovered login; records proofs.smoke
//   job.mjs prove-split <job.json> --from <path> (--before A --after B [--noise C] | --tests "<cmd>")
//        writes the split's proof file: a pixel diff within the noise floor measured as A vs C (a second baseline
//        render), or the tests passing after a code split
//   job.mjs knowledge <job.json> add --text "<fact>" --source "<where>" [--tags a,b]   a fact found during the run
//   job.mjs gates | invariants                       the POODO gates and the invariants they hold
// Proofs the tool makes (calibration, smoke, split) go in <job>.proofs.json beside the manifest, merged on load.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, PROXY_KINDS } from '../lib/validate.mjs';
import { loadJob, health, proofsFile } from '../lib/load.mjs';
export { loadJob, health };
import { INVARIANTS, GATES } from '../lib/invariants.mjs';
import { renderCard, cardHash } from '../lib/card.mjs';
import { retrieveLessons, lessonsForAtom } from '../lib/lessons.mjs';
import { compileAll } from '../lib/compile.mjs';
import { emit, canFire, firedEvent, readEvents, renderStatus, EVENT_KINDS } from '../lib/events.mjs';
import { discoverLogins, assignLanes, workerCommand } from '../../hillclimb/lib/fanout.mjs';

const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (k) => { const i = rest.indexOf(k); return i < 0 ? null : rest[i + 1]; };
const has = (k) => rest.includes(k);
const out = (s) => process.stdout.write(s + '\n');

function saveProof(f, key, value) {
  const pf = proofsFile(f), p = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  p[key] = key === 'calibration' ? { ...p.calibration, ...value } : value;
  if (key === 'confirmed') delete p.confirmedRefused;
  fs.writeFileSync(pf, JSON.stringify(p, null, 1) + '\n');
}

/** FMEA: a miscalibrated check (detection): the known-good case must pass and the known-bad case must fail. */
export function calibrate(job, only = null) {
  const res = {};
  for (const c of job.criteria ?? []) {
    if (!PROXY_KINDS.includes(c.check?.kind) || (only && c.id !== only) || !c.check.calibration) continue;
    const run = (input) => spawnSync('sh', ['-c', c.check.run.replaceAll('${input}', input)], { cwd: job.repo, stdio: 'ignore', timeout: 1_800_000 }).status ?? 124;
    res[c.id] = { good: run(c.check.calibration.good), bad: run(c.check.calibration.bad), at: new Date().toISOString() };
  }
  return res;
}

function report(v) {
  for (const g of GATES) out(`${g.name.padEnd(12)} ${v.gates[g.id]}  (${g.invariants.join(', ')})`);
  for (const e of v.errors) out(`REFUSED ${e.gate} ${e.inv}: ${e.msg}`);
  for (const w of v.warnings) out(`warning ${w.gate} ${w.inv}: ${w.msg}`);
  out(INVARIANTS.map((i) => `${i.id} ${v.status[i.id]}`).join('  '));
}

async function main() {
  if (cmd === 'gates') { for (const g of GATES) out(`${g.name}\t${g.invariants.join(',')}\t${g.what}`); return 0; }
  if (cmd === 'invariants') { for (const i of INVARIANTS) out(`${i.id}\t${i.name}\t${i.rule}`); return 0; }
  if (!file) { console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 31).join('\n')); return 2; }
  const job = loadJob(path.resolve(file));
  if (cmd === 'validate') {
    const gate = flag('--gate') ?? 'orchestrate', offline = has('--offline');
    const atOrchestrate = GATES.findIndex((g) => g.id === gate) >= GATES.findIndex((g) => g.id === 'orchestrate');
    const v = validate(job, { gate, offline, health: atOrchestrate ? health(job) : null });
    if (has('--json')) out(JSON.stringify(v, null, 1)); else report(v);
    return v.ok ? 0 : 1;
  }
  if (cmd === 'calibrate') {
    const r = calibrate(job, flag('--criterion'));
    saveProof(path.resolve(file), 'calibration', r);
    for (const [id, x] of Object.entries(r)) out(`${id}\tgood exit ${x.good}\tbad exit ${x.bad}\t${x.good === 0 && x.bad > 0 ? 'calibrated' : 'MISCALIBRATED'}`);
    return Object.values(r).every((x) => x.good === 0 && x.bad > 0) ? 0 : 1;
  }
  if (cmd === 'card') {
    const lessons = retrieveLessons(job);
    saveProof(path.resolve(file), 'lessons', { retrieved: new Date().toISOString(), count: lessons.length, keys: lessons.map((l) => l.key) });
    const fresh = loadJob(path.resolve(file)), card = renderCard(fresh, validate(fresh, { gate: 'decide', offline: has('--offline') }), lessons);
    if (flag('--out')) fs.writeFileSync(flag('--out'), card); else process.stdout.write(card);
    console.error(`card sha256 ${cardHash(fresh)}`);
    return 0;
  }
  if (cmd === 'confirm') {
    const sha = flag('--sha') ?? '', full = cardHash(job);
    if (sha.length < 8 || !full.startsWith(sha)) { console.error(`confirm: --sha ${sha || '(none)'} is not this card (${full.slice(0, 12)}); show the current card first`); return 1; }
    if (readEvents(job, file).filter((e) => e.kind === 'STAGED').at(-1)?.data?.cardSha256 !== full) { console.error('confirm: this card was never staged (job.mjs stage); the user confirms the card they were shown'); return 1; }
    if (!flag('--by') || !flag('--words')) { console.error('confirm: --by and --words (the user\'s own words) are required'); return 2; }
    saveProof(path.resolve(file), 'confirmed', { by: flag('--by'), via: flag('--via') ?? 'direct', words: flag('--words'), at: new Date().toISOString(), cardSha256: full });
    out(`confirmed card ${full.slice(0, 12)} by ${flag('--by')}`); return 0;
  }
  if (cmd === 'stage') {
    const lessons = retrieveLessons(job);
    saveProof(path.resolve(file), 'lessons', { retrieved: new Date().toISOString(), count: lessons.length, keys: lessons.map((l) => l.key) });
    const fresh = loadJob(path.resolve(file)), v = validate(fresh, { gate: 'decide', offline: has('--offline'), confirmation: { ok: true } });
    if (!v.ok) { report(v); console.error('stage: refused; fix these before showing the card'); return 1; }
    const cardFile = path.join(path.dirname(path.resolve(file)), `JOB-${fresh.id}.md`), sha = cardHash(fresh);
    fs.writeFileSync(cardFile, renderCard(fresh, v, lessons));
    emit(fresh, file, { kind: 'STAGED', summary: `${fresh.title ?? fresh.id}: card ready for your go (${sha.slice(0, 12)})`, detail: `Card: ${cardFile}`, data: { cardSha256: sha, card: cardFile } });
    process.stdout.write(fs.readFileSync(cardFile, 'utf8')); return 0;
  }
  if (cmd === 'fire') {
    const may = canFire(job, file);
    if (!may.ok) { console.error(`fire: refused (I1, I11): ${may.why}`); return 1; }
    const v = validate(job, { gate: 'orchestrate', offline: has('--offline'), health: health(job) });
    if (!v.ok) { report(v); emit(job, file, { kind: 'GATE', summary: `refused at ${v.errors[0].gate}: ${v.errors[0].inv} ${v.errors[0].msg}`, data: { errors: v.errors } }); return 1; }
    const compiled = compileAll(job, { lessons: retrieveLessons(job), offline: has('--offline') }), dir = path.join(path.dirname(path.resolve(file)), 'compiled');
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, p] of Object.entries(compiled.prompts)) fs.writeFileSync(path.join(dir, `${id}.prompt`), p);
    const pieces = Object.fromEntries((job.atoms ?? []).map((a) => [a.id, { files: a.files, engine: ['codex', 'claude'].includes(a.engine) ? a.engine : undefined, account: a.account, speculate: a.speculate }]));
    let lanes; try { lanes = assignLanes({ pieces }, discoverLogins()).map((l) => ({ id: l.variant ? `${l.piece}-v${l.variant}` : l.piece, engine: l.engine, account: l.account })); }
    catch { lanes = (job.atoms ?? []).map((a) => ({ id: a.id, engine: a.engine, account: a.account ?? 'default' })); }
    emit(job, file, firedEvent(job, lanes, compiled.manifestHash));
    const at = process.argv.indexOf('--');
    if (at < 0) return 0;
    const r = spawnSync(process.argv[at + 1], process.argv.slice(at + 2), { stdio: 'inherit', env: { ...process.env, ENDOFORGE_JOB: path.resolve(file), ENDOFORGE_PROMPTS: dir } });
    return r.status ?? 1;
  }
  if (cmd === 'event') {
    const kind = rest[0];
    if (kind === 'FIRED' || kind === 'STAGED') { console.error(`event: ${kind} comes only from job.mjs ${kind === 'FIRED' ? 'fire' : 'stage'}`); return 2; }
    if (!EVENT_KINDS.includes(kind) || !rest[1]) { console.error(`event: <${EVENT_KINDS.filter((k) => !['FIRED', 'STAGED'].includes(k)).join('|')}> <summary>`); return 2; }
    const e = emit(job, file, { kind, summary: rest[1], detail: flag('--detail') ?? '', data: flag('--data') ? JSON.parse(flag('--data')) : {} });
    out(`${e.ts} ${kind} ${e.summary}`); return 0;
  }
  const { stateFile } = await import('../../conductor/lib/state.mjs');
  if (['go', 'lock', 'pause', 'resume', 'budget', 'stop', 'patch'].includes(cmd) || (cmd === 'status' && fs.existsSync(stateFile(job, file)))) {
    const { main: conductor } = await import('../../conductor/bin/conduct.mjs');   // the job's Conductor owns these
    return conductor([cmd, file, ...rest]);
  }
  if (cmd === 'status') { process.stdout.write(renderStatus(job, readEvents(job, file))); return 0; }
  if (cmd === 'knowledge') {
    // Knowledge discovered during a run goes back into the manifest with its source, so later atoms get it (P-A).
    if (rest[0] !== 'add' || !flag('--text') || !flag('--source')) { console.error('usage: job.mjs knowledge <job.json> add --text "<fact>" --source "<where it was established>" [--tags a,b]'); return 2; }
    const { withLock, writeJSONAtomic } = await import('../../lib/lock.mjs');
    const f = path.resolve(file);
    const n = withLock(f, () => {
      const m = JSON.parse(fs.readFileSync(f, 'utf8')); m.knowledge = m.knowledge ?? [];
      m.knowledge.push({ id: `k${m.knowledge.length + 1}`, text: flag('--text'), source: flag('--source'), tags: (flag('--tags') ?? '*').split(',').map((t) => t.trim()).filter(Boolean), at: new Date().toISOString() });
      writeJSONAtomic(f, m); return m.knowledge.length;
    });
    out(`knowledge k${n} added`); return 0;
  }
  if (cmd === 'smoke') {
    const engines = {}, results = {}, dir = path.join(path.dirname(path.resolve(file)), 'smoke');
    const pieces = Object.fromEntries((job.atoms ?? []).filter((a) => ['codex', 'claude'].includes(a.engine)).map((a) => [a.id, { files: a.files, engine: a.engine }]));
    const lanes = Object.keys(pieces).length ? assignLanes({ pieces }, discoverLogins()) : [];
    for (const e of [...new Set((job.atoms ?? []).map((a) => a.engine).filter(Boolean))]) {
      const lane = lanes.find((l) => l.engine === e);
      if (!lane) { engines[e] = !['codex', 'claude'].includes(e); results[e] = { note: engines[e] ? 'no model launch for this engine' : 'no login found' }; continue; }
      const cwd = path.join(dir, e); fs.mkdirSync(cwd, { recursive: true });
      const { argv, env } = workerCommand({ fanout: job.fanout ?? {} }, lane, { worktree: cwd, prompt: 'Reply with the single word READY and nothing else. Do not edit any file.' });
      const r = spawnSync(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, encoding: 'utf8', input: '', timeout: 180_000 });
      engines[e] = r.status === 0 && /READY/i.test(r.stdout ?? '');
      results[e] = { account: lane.account, exit: r.status, ok: engines[e], tail: (r.stderr || r.error?.message || '').slice(-300) };
    }
    const receipt = path.join(path.dirname(path.resolve(file)), 'smoke-receipt.json');
    fs.writeFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), results }, null, 1) + '\n');
    saveProof(path.resolve(file), 'smoke', { engines, receipt });
    emit(job, file, { kind: 'SMOKE', summary: Object.entries(engines).map(([e, ok]) => `${e} ${ok ? 'ok' : 'FAILED'}`).join(', '), data: results });
    for (const [e, ok] of Object.entries(engines)) out(`${e}\t${ok ? 'ok' : 'FAILED'}`);
    return Object.values(engines).every(Boolean) ? 0 : 1;
  }
  if (cmd === 'prove-split') {
    const s = (job.splits ?? []).find((x) => x.from === flag('--from'));
    if (!s?.proof) { console.error(`prove-split: no split from ${flag('--from')} with a proof path in the manifest`); return 2; }
    let proof;
    if (flag('--tests')) { const r = spawnSync('sh', ['-c', flag('--tests')], { cwd: job.repo, stdio: 'inherit' }); proof = { kind: 'tests', ok: r.status === 0, command: flag('--tests') }; }
    else {
      const diff = (a, b, tol) => JSON.parse(spawnSync('python3', ['-I', path.join(path.dirname(fileURLToPath(import.meta.url)), '../../hillclimb/scripts/pixel-diff.py'), a, b, '--tolerance', String(tol)], { encoding: 'utf8' }).stdout);
      const noise = flag('--noise') ? Math.max(0, ...diff(flag('--before'), flag('--noise'), 0).differ.map((d) => d.maxDiff ?? 255)) : 0;
      const d = diff(flag('--before'), flag('--after'), noise);
      proof = { kind: 'pixels', ok: d.ok, noiseFloor: noise, noiseMeasured: Boolean(flag('--noise')), compared: d.compared, differ: d.differ, missing: d.missing };
    }
    fs.mkdirSync(path.dirname(s.proof), { recursive: true });
    fs.writeFileSync(s.proof, JSON.stringify({ ...proof, from: s.from, at: new Date().toISOString() }, null, 1) + '\n');
    out(`split of ${s.from}: ${proof.ok ? 'no-op' : 'NOT a no-op'}${proof.kind === 'pixels' ? ` (noise floor ${proof.noiseFloor}${proof.noiseMeasured ? '' : ', not measured'})` : ''}`);
    return proof.ok ? 0 : 1;
  }
  if (cmd === 'compile') {
    const r = compileAll(job, { lessons: retrieveLessons(job), offline: has('--offline') });
    const dir = flag('--out') ?? path.join(path.dirname(path.resolve(file)), 'compiled');
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, p] of Object.entries(r.prompts)) fs.writeFileSync(path.join(dir, `${id}.prompt`), p);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ job: job.id, cardSha256: cardHash(job), manifestHash: r.manifestHash, atoms: r.atoms }, null, 1) + '\n');
    out(`${Object.keys(r.prompts).length} prompts in ${dir}; manifest ${r.manifestHash.slice(0, 12)}`); return 0;
  }
  if (cmd === 'lessons') {
    const lessons = retrieveLessons(job);
    for (const l of lessons) out(`${l.key}\t${l.text}${l.fix ? ` -> ${l.fix}` : ''}`);
    for (const a of job.atoms ?? []) { const m = lessonsForAtom(a, lessons); if (m.length) out(`atom ${a.id}: ${m.map((l) => l.key).join(', ')}`); }
    return 0;
  }
  console.error(`unknown command ${cmd}`); return 2;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
