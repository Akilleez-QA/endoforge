// Fan-out mode, host side: the stages of a round as commands (bin/hillclimb.mjs dispatches here).
//   atomize | prove-split --before A --after B | logins | smoke | evals [--phase pre|post] | status | collect | round
// One round (barrier version): evals first → re-atomize → smoke one atom per engine → launch every piece under the
// capacity dial → collect owned diffs, one commit per piece → render + evals → ratchet (revert a regressed piece).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCampaign, roundDir, lastRound, vars, expand } from './campaign.mjs';
import { fanoutLessons } from './lessons.mjs';
import { loadJob, health } from '../../job/lib/load.mjs';
import { validate as validateJob } from '../../job/lib/validate.mjs';
import { compileAtom } from '../../job/lib/compile.mjs';
import { retrieveLessons } from '../../job/lib/lessons.mjs';
import { emit, canFire, firedEvent } from '../../job/lib/events.mjs';
import crypto from 'node:crypto';
import { runTyped, StopError, unscored } from '../../lib/errors.mjs';
import { ownershipMap, discoverLogins, assignLanes, laneId, workerCommand, piecePrompt, pieceStills, attribute, totals, ratchet,
  reatomize, wallClock, workerCapacity, waveSize } from './fanout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (d !== undefined) return d; throw e; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const log = (...a) => console.error('hillclimb fanout:', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr.trim()}`); return r.stdout.trim(); };
const sec = (t0) => Math.round((Date.now() - t0) / 100) / 10;
const codexOnPath = () => (process.env.PATH || '').split(':').map((d) => path.join(d, 'codex')).find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });

/** Render the campaign's jobs and run its evals into <phase>/; returns the evals and the seconds each took.
 *  Errors are typed (tools/lib/errors.mjs): a busy guard or queue (75) waits and retries with backoff; 78 stops the
 *  job loudly; evals that could not run return { unscored } instead of a number. */
export function renderAndEval(c, n, phase, repo = c.repo) {
  const wait = { maxWaitMs: (c.fanout?.busyWaitSec ?? 900) * 1000, baseMs: (c.fanout?.busyBaseSec ?? 2) * 1000, log };
  const t0 = Date.now(), stills = path.join(phase, 'stills');
  for (const job of c.render.filter((j) => (j.profile ?? 'fast') === 'fast')) {
    const o = path.join(stills, job.id); fs.mkdirSync(o, { recursive: true });
    const argv = expand(job.command, { ...vars(c, n, { out: o }), repo, stills });
    const r = runTyped(argv, { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], ...wait });
    if (r.kind === 'stop') throw new StopError(`render ${job.id} exited 78 (stop)`);
    if (r.kind !== 'ok') return { ...unscored(`render ${job.id} ${r.kind === 'transient' ? `still busy after ${Math.round(r.waitedMs / 1000)} s` : `exited ${r.status}`}`), renderSec: sec(t0), evalsSec: 0 };
  }
  const t1 = Date.now(), file = path.join(phase, c.evals.file ?? 'evals.json');
  fs.rmSync(file, { force: true });
  const argv = expand(c.evals.command, { ...vars(c, n, { out: phase }), stills, repo });
  const r = runTyped(argv, { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], ...wait });
  if (r.kind === 'stop') throw new StopError('evals exited 78 (stop)');
  if (!fs.existsSync(file)) return { ...unscored(`evals ${r.kind === 'transient' ? 'still busy' : `exited ${r.status}`} without writing ${file}`), renderSec: Math.round((t1 - t0) / 100) / 10, evalsSec: sec(t1) };   // a HARD-fail exit with a file is fine
  const evals = readJSON(file), renderSec = Math.round((t1 - t0) / 100) / 10, evalsSec = sec(t1);
  writeJSON(path.join(phase, 'meta.json'), { commit: git(repo, 'rev-parse', 'HEAD'), renderSec, evalsSec, ...totals(evals, c.evals.key) });
  return { evals, renderSec, evalsSec };
}

/** Launch one lane detached: a systemd user unit in heavy.slice (default), or a plain child (fanout.launcher "local").
 *  The wrapper writes <lane>.exit when the worker ends, so status never depends on unit garbage collection. */
function startLane(c, n, dir, lane, argv, env) {
  const id = laneId(lane), prompt = path.join(dir, 'prompts', `${id}.prompt`), logf = path.join(dir, 'logs', `${id}.log`), exitf = path.join(dir, 'logs', `${id}.exit`);
  fs.mkdirSync(path.dirname(logf), { recursive: true }); fs.rmSync(exitf, { force: true });
  const wrapped = ['sh', '-c', `"$@"; code=$?; echo $code > '${exitf}'; exit $code`, 'lane', ...argv];
  if ((c.fanout?.launcher ?? 'systemd') === 'local') {
    const child = spawn(wrapped[0], wrapped.slice(1), { cwd: lane.worktree, env: { ...process.env, ...env }, detached: true,
      stdio: [fs.openSync(prompt, 'r'), fs.openSync(logf, 'a'), fs.openSync(logf, 'a')] });
    child.unref(); return `pid:${child.pid}`;
  }
  const unit = `hc-${c.id}-r${n}-${id}`;
  spawnSync('systemctl', ['--user', 'reset-failed', unit], { stdio: 'ignore' });
  const r = spawnSync('systemd-run', ['--user', `--unit=${unit}`, '--slice=heavy.slice', `--working-directory=${lane.worktree}`, `--setenv=PATH=${process.env.PATH}`,
    ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), `--property=RuntimeMaxSec=${c.fanout?.laneTimeoutSec ?? 2400}`,
    `--property=StandardInput=file:${prompt}`, `--property=StandardOutput=append:${logf}`, `--property=StandardError=append:${logf}`, '--', ...wrapped], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`systemd-run ${unit}: ${r.stderr.trim()}`);
  return unit;
}

function laneEnv(c, lane, extra) {
  const env = { ...extra };
  if (lane.engine === 'codex') {
    const bin = process.env.CODEX_POOL_BIN || codexOnPath();
    if (bin) env.CODEX_POOL_BIN = bin;                      // older installed pools refuse without it (NOTES #6)
    if (c.fanout?.perAccount) env.CODEX_POOL_PER_ACCOUNT = String(c.fanout.perAccount);
  }
  return env;
}

/** One tiny atom per engine before the wide launch: a broken login, pool or flag fails here, once, not N times. */
export function smoke(c, lanes, dir) {
  const results = {};
  for (const engine of [...new Set(lanes.map((l) => l.engine))]) {
    const lane = lanes.find((l) => l.engine === engine), cwd = path.join(dir, 'smoke', engine); fs.mkdirSync(cwd, { recursive: true });
    const { argv, env } = workerCommand(c, lane, { worktree: cwd, prompt: 'Reply with the single word READY and nothing else. Do not edit any file.' });
    const t0 = Date.now();
    const r = runTyped(argv, { cwd, env: { ...process.env, ...laneEnv(c, lane, env) }, input: '', timeout: (c.fanout?.smokeTimeoutSec ?? 180) * 1000, maxWaitMs: (c.fanout?.busyWaitSec ?? 900) * 1000, baseMs: (c.fanout?.busyBaseSec ?? 2) * 1000, log });
    if (r.kind === 'stop') throw new StopError(`smoke ${engine} exited 78 (stop)`);
    results[engine] = { ok: r.status === 0 && /READY/i.test(r.stdout), exit: r.status, account: lane.account, sec: sec(t0), tail: (r.stderr || r.error?.message || '').slice(-400) };
    log(`smoke ${engine} (${lane.account}): ${results[engine].ok ? 'ok' : `FAILED exit ${r.status}`} in ${results[engine].sec} s`);
  }
  return results;
}

const loadSample = () => {
  const mem = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))?.[1];
  return { t: new Date().toISOString(), load1: os.loadavg()[0], memAvailGB: mem ? Math.round(Number(mem) / 1048576) : null };
};

/** Make each lane's worktree from the integration HEAD, write its prompt, and start it, in waves sized by the dial. */
export async function launchAll(c, n, dir, lanes, { notes = {}, pre, wait = true, beforeStart = null } = {}) {
  const base = git(c.repo, 'rev-parse', 'HEAD'), found = attribute(c, pre.evals).byPiece, stills = path.join(pre.dir, 'stills');
  const wtRoot = expand(c.apply?.worktrees ?? path.join(c.workdir, 'worktrees'), vars(c, n));
  for (const lane of lanes) {
    lane.worktree = path.join(wtRoot, `${c.id}-r${n}-${laneId(lane)}`); lane.branch = `hillclimb/${c.id}-r${n}-${laneId(lane)}`;
    if (fs.existsSync(lane.worktree)) git(c.repo, 'worktree', 'remove', '--force', lane.worktree);
    git(c.repo, 'worktree', 'add', '-q', '-B', lane.branch, lane.worktree, base);
    for (const l of c.fanout?.links ?? []) fs.symlinkSync(l.target, path.join(lane.worktree, l.path));   // e.g. node_modules (NOTES #3)
    const p = c.pieces[lane.piece], images = pieceStills(p, stills);
    // A campaign backed by a JOB manifest gets compiled prompts (goal verbatim, governing inputs first, checks,
    // lessons); hand-written briefs are the fallback for campaigns without one.
    const prompt = c.jobDoc ? compileAtom(c.jobDoc, lane.piece, { lessons: c.jobLessons, outputs: images, found: found[lane.piece], note: notes[lane.piece] ?? '', round: n })
      : piecePrompt(c, lane.piece, { stills: images, found: found[lane.piece], note: notes[lane.piece] ?? '', round: n });
    fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true }); fs.writeFileSync(path.join(dir, 'prompts', `${laneId(lane)}.prompt`), prompt);
    Object.assign(lane, { argv: workerCommand(c, lane, { worktree: lane.worktree, prompt, images }) });
  }
  beforeStart?.(lanes);                                  // a job-backed round emits FIRED here, before any lane starts
  const meta = { base, lanes, load: [], capacity: [] };
  const exitOf = (l) => { try { return Number(fs.readFileSync(path.join(dir, 'logs', `${laneId(l)}.exit`), 'utf8')); } catch { return null; } };
  const poll = (c.fanout?.pollSec ?? 5) * 1000, deadline = Date.now() + (c.fanout?.laneTimeoutSec ?? 2400) * 1000 + 60_000;
  for (;;) {
    for (const l of lanes.filter((x) => x.started && x.exit == null)) { const e = exitOf(l); if (e != null) Object.assign(l, { exit: e, sec: sec(Date.parse(l.started)) }); }
    const pct = workerCapacity(), running = lanes.filter((l) => l.started && l.exit == null).length;
    meta.load.push(loadSample()); meta.capacity.push(pct);
    for (const l of lanes.filter((x) => !x.started).slice(0, Math.max(0, waveSize(lanes.length, pct) - running))) {
      l.unit = startLane(c, n, dir, l, l.argv.argv, laneEnv(c, l, l.argv.env)); l.started = new Date().toISOString();
      log(`launched ${laneId(l)} on ${l.engine}:${l.account}`);
    }
    writeJSON(path.join(dir, 'lanes.json'), meta);
    if (!wait || lanes.every((l) => l.exit != null)) break;
    if (pct === 0 && !running) { log('capacity dial at 0 % (drain): not launching the rest'); break; }
    if (Date.now() > deadline) { log('lane timeout passed; collecting what landed'); break; }
    await sleep(poll);
  }
  for (const l of lanes) delete l.argv;
  writeJSON(path.join(dir, 'lanes.json'), meta);
  return meta;
}

/** Recombine: each piece's diff restricted to its own files, applied to the integration repo, one commit per piece.
 *  Of a speculating piece's variants, the first to land cleanly (and pass the piece's check) wins. */
export function collect(c, n, dir, meta) {
  if (spawnSync('git', ['-C', c.repo, 'diff', '--cached', '--quiet']).status !== 0) throw new Error(`${c.repo} has staged changes; commit or unstage them before collecting`);
  const done = [], report = [];
  const landed = meta.lanes.filter((l) => l.exit === 0).sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0));
  for (const piece of Object.keys(c.pieces)) {
    const files = c.pieces[piece].files;
    for (const l of landed.filter((x) => x.piece === piece)) {
      const untracked = git(l.worktree, 'ls-files', '--others', '--exclude-standard', '--', ...files).split('\n').filter(Boolean);
      if (untracked.length) git(l.worktree, 'add', '-N', '--', ...untracked);
      const diff = spawnSync('git', ['-C', l.worktree, 'diff', '--binary', meta.base, '--', ...files], { encoding: 'utf8' }).stdout;
      const links = (c.fanout?.links ?? []).map((x) => x.path);
      const stray = git(l.worktree, 'status', '--porcelain').split('\n').filter(Boolean).map((x) => x.slice(3)).filter((p) => !files.some((f) => p === f || p.startsWith(f.replace(/\/$/, '') + '/')) && !links.includes(p.replace(/\/$/, '')));
      if (!diff) { report.push({ lane: laneId(l), status: 'no change', stray }); continue; }
      if (c.pieces[piece].check && spawnSync(c.pieces[piece].check[0], c.pieces[piece].check.slice(1), { cwd: l.worktree, stdio: 'ignore' }).status !== 0) { report.push({ lane: laneId(l), status: 'check failed', stray }); continue; }
      const r = spawnSync('git', ['-C', c.repo, 'apply', '--3way', '--index', '-'], { input: diff, encoding: 'utf8' });
      if (r.status !== 0) { report.push({ lane: laneId(l), status: 'apply failed', error: r.stderr.slice(-300), stray }); continue; }
      git(c.repo, 'commit', '-q', '-m', `${c.id} fan-out r${n} ${piece} (${l.engine}:${l.account})`, ...(c.apply?.trailer ? ['-m', c.apply.trailer] : []));
      const sha = git(c.repo, 'rev-parse', 'HEAD');
      report.push({ lane: laneId(l), status: 'applied', sha, stray }); done.push({ piece, sha });
      break;                                   // one variant per piece
    }
  }
  for (const l of meta.lanes.filter((x) => x.exit !== 0)) report.push({ lane: laneId(l), status: l.exit == null ? 'did not finish' : `exit ${l.exit}` });
  writeJSON(path.join(dir, 'collect.json'), report);
  for (const x of report) log(`${x.lane}: ${x.status}${x.stray?.length ? ` (ignored edits outside its files: ${x.stray.join(', ')})` : ''}`);
  return { done, report };
}

/** The previous round's post-evals if the integration HEAD has not moved since; else render and evaluate now. */
function preEvals(c, n, dir) {
  const prev = path.join(roundDir(c, n - 1), 'post');
  const head = git(c.repo, 'rev-parse', 'HEAD');
  if (n > 1 && readJSON(path.join(prev, 'meta.json'), {}).commit === head) return { dir: prev, evals: readJSON(path.join(prev, c.evals.file ?? 'evals.json')), renderSec: 0, evalsSec: 0 };
  return { dir: path.join(dir, 'pre'), ...renderAndEval(c, n, path.join(dir, 'pre')) };
}

export async function round(c, n, { notes = {}, smokeOnly = false, noSmoke = false } = {}) {
  const dir = roundDir(c, n), T = {};
  let t = Date.now();
  const own = ownershipMap(c); if (own.errors.length) throw new Error(`atomize: ${own.errors.join('; ')}`);
  if (c.job) {
    // The job's POODO gates up to Orchestrate (a confirmed card, calibrated checks, the smoke receipt, machine health)
    // must pass before anything launches; nothing fires on an unconfirmed card (I1, I11).
    c.jobDoc = loadJob(c.job);
    const v = validateJob(c.jobDoc, { gate: 'orchestrate', health: health(c.jobDoc) });
    const may = canFire(c.jobDoc, c.job);
    if (!may.ok) throw new Error(`job ${c.jobDoc.id} cannot fire (I1, I11): ${may.why}`);
    if (!v.ok) throw new Error(`job ${c.jobDoc.id} refused at ${v.errors.map((e) => `${e.gate} ${e.inv}: ${e.msg}`).join('; ')}`);
    const atoms = Object.fromEntries((c.jobDoc.atoms ?? []).map((a) => [a.id, a]));
    for (const [k, p] of Object.entries(c.pieces)) if (!atoms[k] || JSON.stringify([...atoms[k].files].sort()) !== JSON.stringify([...p.files].sort())) throw new Error(`piece ${k} does not match a job atom with the same files`);
    c.jobLessons = retrieveLessons(c.jobDoc);
  }
  fs.mkdirSync(dir, { recursive: true });                // a refused round leaves no round directory behind
  const histFile = path.join(c.workdir, 'fanout-history.json'), history = readJSON(histFile, []);
  const { frozen, split } = reatomize(c, history);
  T.atomize = sec(t); t = Date.now();
  const pre = preEvals(c, n, dir); T.preRender = pre.renderSec; T.preEvals = pre.evalsSec;
  if (pre.scored === false) throw new Error(`evals come first, and they did not score: ${pre.why}`);
  const baseFile = path.join(c.workdir, 'baseline.json');
  if (!fs.existsSync(baseFile)) writeJSON(baseFile, { score: totals(pre.evals, c.evals.key).score, hard: totals(pre.evals, c.evals.key).hard });
  const logins = discoverLogins(), lanes = assignLanes(c, logins, { skip: frozen });
  t = Date.now();
  const smokes = noSmoke ? {} : smoke(c, lanes, dir); T.smoke = sec(t);
  writeJSON(path.join(dir, 'round.json'), { round: n, frozen, split, smokes, stages: T });
  const tell = (ev) => { if (c.jobDoc) emit(c.jobDoc, c.job, ev); };
  if (!noSmoke) tell({ kind: 'SMOKE', summary: Object.entries(smokes).map(([e, x]) => `${e} ${x.ok ? 'ok' : `FAILED (exit ${x.exit})`}`).join(', ') || 'no engines', data: smokes });
  if (Object.values(smokes).some((s) => !s.ok)) throw new Error(`smoke launch failed: ${JSON.stringify(smokes)}; fix the engine before the wide launch`);
  if (smokeOnly) return { smokes };
  t = Date.now();
  const beforeStart = (ls) => {
    const hash = crypto.createHash('sha256').update(ls.map((l) => fs.readFileSync(path.join(dir, 'prompts', `${laneId(l)}.prompt`), 'utf8')).join('\0')).digest('hex');
    tell(firedEvent(c.jobDoc ?? {}, ls.map((l) => ({ id: laneId(l), engine: l.engine, account: l.account })), hash));
  };
  const meta = await launchAll(c, n, dir, lanes, { notes, pre, beforeStart }); T.parallel = sec(t); t = Date.now();
  const { done, report } = collect(c, n, dir, meta); T.collect = sec(t); t = Date.now();
  let post = renderAndEval(c, n, path.join(dir, 'post'));
  // Unscored post-evals are reported as "not scored": no pass, no number, no revert and no baseline change.
  let r = post.scored === false ? { pass: false, scored: false, why: post.why, score: null, hard: null, scoreDelta: null, hardDelta: null, perPiece: {}, regressed: [], baseline: readJSON(baseFile) }
    : ratchet(c, readJSON(baseFile), pre.evals, post.evals);
  const reverted = [];
  for (const piece of r.regressed) { const d = done.find((x) => x.piece === piece); if (d) { git(c.repo, 'revert', '--no-edit', d.sha); reverted.push(piece); } }
  if (reverted.length) { log(`reverted ${reverted.join(', ')}: their own HARD count rose`); post = renderAndEval(c, n, path.join(dir, 'post')); r = post.scored === false ? { ...r, pass: false, scored: false, why: post.why, baseline: readJSON(baseFile) } : ratchet(c, readJSON(baseFile), pre.evals, post.evals); }
  T.postRender = post.renderSec; T.postEvals = post.evalsSec; T.ratchet = sec(t);
  writeJSON(baseFile, r.baseline);
  const atoms = Object.fromEntries(meta.lanes.filter((l) => l.sec != null).map((l) => [laneId(l), l.sec]));
  const clock = wallClock({ atomize: T.atomize, pre: T.preRender + T.preEvals, smoke: T.smoke, collect: T.collect, post: T.postRender + T.postEvals }, atoms);
  const summary = { round: n, frozen, split, smokes, stages: T, wallClock: clock, ratchet: { ...r, reverted }, unattributed: attribute(c, post.evals).unattributed.length,
    logins: [...logins.claude.map((a) => `claude:${a.name}`), ...logins.codex.map((x) => `codex:${x}`)],
    lanes: meta.lanes.map((l) => ({ lane: laneId(l), piece: l.piece, engine: l.engine, account: l.account, exit: l.exit ?? null, sec: l.sec ?? null })), collect: report,
    load: { maxLoad1: Math.max(...meta.load.map((x) => x.load1)), minMemAvailGB: Math.min(...meta.load.map((x) => x.memAvailGB ?? Infinity)), capacity: [...new Set(meta.capacity)] } };
  summary.openLessons = fanoutLessons(c, dir, summary).map((l) => l.key);
  if (r.scored === false) tell({ kind: 'GATE', summary: `round ${n} NOT SCORED: ${r.why}`, data: { gate: 'ratchet', scored: false, why: r.why } });
  else tell({ kind: 'SCORED', summary: `round ${n}: score ${r.score} (${r.scoreDelta >= 0 ? '+' : ''}${r.scoreDelta}), HARD ${r.hard} (${r.hardDelta >= 0 ? '+' : ''}${r.hardDelta})`, data: { round: n, score: r.score, scoreDelta: r.scoreDelta, hard: r.hard, hardDelta: r.hardDelta, perPiece: r.perPiece } });
  if (r.scored !== false) tell({ kind: 'GATE', summary: `round ${n} ratchet ${r.pass ? 'passed' : 'FAILED'}${reverted.length ? `; reverted ${reverted.join(', ')}` : ''}`, data: { gate: 'ratchet', pass: r.pass, reverted } });
  const cp = c.jobDoc?.criticalPath, cpLane = meta.lanes.find((l) => l.piece === cp);
  if (cp && (reverted.includes(cp) || (cpLane && cpLane.exit !== 0))) tell({ kind: 'NEEDS-YOU', summary: `the critical-path atom ${cp} ${reverted.includes(cp) ? 'regressed and was reverted' : 'did not land'}; decide how to proceed`, data: { atom: cp } });   // rNN/LESSONS.md + <workdir>/lessons.json
  writeJSON(path.join(dir, 'round.json'), summary);
  if (summary.openLessons.length) log(`open lessons with no tool change yet (${dir}/LESSONS.md): ${summary.openLessons.join(', ')}`);
  writeJSON(histFile, [...history.filter((h) => h.round !== n), { round: n, score: r.score, hard: r.hard, pass: r.pass, perPiece: r.perPiece }]);
  return summary;
}

export async function main(cmd, rest) {
  const flag = (k) => { const i = rest.indexOf(k); return i < 0 ? null : rest[i + 1]; };
  const c = loadCampaign(path.resolve(rest[0]));
  if (c.mode !== 'fanout') throw new Error(`${rest[0]} is not a fan-out campaign (mode: "fanout")`);
  const n = Number(flag('--round')) || (cmd === 'round' || cmd === 'smoke' ? lastRound(c) + 1 : lastRound(c));
  const notes = flag('--notes') ? readJSON(flag('--notes')) : {};
  const out = (v) => process.stdout.write(JSON.stringify(v, null, 1) + '\n');
  if (cmd === 'atomize') { const o = ownershipMap(c); out(o); return o.errors.length ? 1 : 0; }
  if (cmd === 'prove-split') {
    const r = spawnSync('python3', ['-I', path.join(HERE, '../scripts/pixel-diff.py'), flag('--before'), flag('--after'), ...(flag('--tolerance') ? ['--tolerance', flag('--tolerance')] : [])], { stdio: 'inherit' });
    return r.status;
  }
  if (cmd === 'logins') { const L = discoverLogins(); out({ codex: L.codex, claude: L.claude.map((a) => a.name), lanes: assignLanes(c, L).map((l) => `${laneId(l)} ${l.engine}:${l.account}`) }); return 0; }
  if (cmd === 'smoke') { const s = smoke(c, assignLanes(c, discoverLogins()), roundDir(c, n)); out(s); return Object.values(s).every((x) => x.ok) ? 0 : 1; }
  if (cmd === 'evals') { const p = path.join(roundDir(c, n || 1), flag('--phase') ?? 'pre'); const r = renderAndEval(c, n || 1, p); out({ ...totals(r.evals, c.evals.key), renderSec: r.renderSec, evalsSec: r.evalsSec }); return 0; }
  if (cmd === 'status') { const m = readJSON(path.join(roundDir(c, n), 'lanes.json')); for (const l of m.lanes) out(`${laneId(l)}\t${l.engine}:${l.account}\t${l.exit ?? (l.started ? 'running' : 'waiting')}`); return 0; }
  if (cmd === 'collect') { const dir = roundDir(c, n), m = readJSON(path.join(dir, 'lanes.json')); collect(c, n, dir, m); return 0; }
  if (cmd === 'round') { const s = await round(c, n, { notes, noSmoke: rest.includes('--no-smoke') }); out(s); return s.ratchet.pass ? 0 : 1; }   // StopError → 78 in bin/hillclimb.mjs
  throw new Error(`unknown fan-out command ${cmd}`);
}
