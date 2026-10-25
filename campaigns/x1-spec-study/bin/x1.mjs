#!/usr/bin/env node
// X1 specification-study kit (C01, WP07). Zero dependencies.
//
//   x1 init                       create work/ and receipt/, hash the kit
//   x1 add <id> [file]            add a request to the pool (from template or a file)
//   x1 freeze --seed N            hash the pool, fix the order, pick the blind half  (once)
//   x1 next                       the next request to contract, in frozen order
//   x1 start|pause|resume|stop <id>   timer events (working time = sum of start/resume..pause/stop)
//   x1 void <id> --reason "..."  discard an id's timing so far (recorded; the id can be started again)
//   x1 classify <id> --rater 1|2 --complete y|n --composable y|n --residual N
//                    --underdetermined y|n --shape structural|parametric --cluster <label> [--notes "..."]
//   x1 blind                      export the blind half's contracts for rater 2 (no timings)
//   x1 analyze                    primary metric, bands (DP-6), secondaries, kappa -> receipt/summary.json
//   x1 verify                     pool and kit hashes, event integrity
//
// work/ holds requests and contracts (may contain customer data; git-ignored).
// receipt/ holds digests, events, classifications and the summary (committed).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clopperPearson, cohenKappa, decideX1, shuffle, quantile } from '../lib/stats.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(KIT, 'work');
const RECEIPT = path.join(KIT, 'receipt');
const POOL = path.join(WORK, 'pool');
const CONTRACTS = path.join(WORK, 'contracts');
const BLIND = path.join(WORK, 'blind');
const CLASSIFY = path.join(RECEIPT, 'classify');
const EVENTS = path.join(RECEIPT, 'events.jsonl');
const FREEZE = path.join(RECEIPT, 'freeze.json');
const PRIMARY_N = 20;
const CAP_S = 600;        // C01 §3: specifiable within 600 s of recorded working time
const HARD_CAP_S = 1800;  // C01 §3: completion times capped at 30 min

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const shaFile = (p) => sha(fs.readFileSync(p));
const now = () => new Date().toISOString();
const die = (msg) => { console.error(`x1: ${msg}`); process.exit(2); };
const ids = () => fs.existsSync(POOL) ? fs.readdirSync(POOL).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort() : [];

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true'; }
    else out._.push(a);
  }
  return out;
}

function kitHash() {
  const files = ['RUBRIC.md', 'templates/REQUEST.md', 'templates/CONTRACT.md', 'bin/x1.mjs', 'lib/stats.mjs'];
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(KIT, f))); }
  return h.digest('hex');
}

function poolDigest() {
  return ids().map(id => ({ id, sha256: shaFile(path.join(POOL, `${id}.md`)) }));
}

function loadFreeze() {
  if (!fs.existsSync(FREEZE)) die('pool is not frozen; run `x1 freeze --seed N` first');
  return JSON.parse(fs.readFileSync(FREEZE, 'utf8'));
}

function verifyPool(freeze) {
  const current = poolDigest();
  const frozen = freeze.pool;
  const problems = [];
  if (current.length !== frozen.length) problems.push(`pool has ${current.length} requests, frozen ${frozen.length}`);
  for (const f of frozen) {
    const c = current.find(x => x.id === f.id);
    if (!c) problems.push(`missing ${f.id}`);
    else if (c.sha256 !== f.sha256) problems.push(`changed ${f.id}`);
  }
  if (kitHash() !== freeze.kitSha256) problems.push('kit files changed since freeze (RUBRIC, templates, bin, lib)');
  return problems;
}

function events() {
  return fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

function appendEvent(ev) {
  fs.appendFileSync(EVENTS, JSON.stringify({ at: now(), ...ev }) + '\n');
}

/** Working seconds per id from start/pause/resume/stop events; also validity problems. */
function workingTime(evs) {
  const byId = {};
  const problems = [];
  for (const e of evs) {
    if (e.type === 'void') { byId[e.id] = { open: null, seconds: 0, started: false, stopped: false, voided: (byId[e.id]?.voided || 0) + 1 }; continue; }
    const s = byId[e.id] ??= { open: null, seconds: 0, started: false, stopped: false };
    const t = Date.parse(e.at);
    if (e.type === 'start') { if (s.started) problems.push(`${e.id}: started twice`); s.started = true; s.open = t; }
    else if (e.type === 'pause') { if (s.open == null) problems.push(`${e.id}: pause without open interval`); else { s.seconds += (t - s.open) / 1000; s.open = null; } }
    else if (e.type === 'resume') { if (s.open != null) problems.push(`${e.id}: resume while open`); s.open = t; }
    else if (e.type === 'stop') { if (s.open != null) { s.seconds += (t - s.open) / 1000; s.open = null; } if (s.stopped) problems.push(`${e.id}: stopped twice`); s.stopped = true; }
  }
  for (const [id, s] of Object.entries(byId)) if (s.open != null) problems.push(`${id}: interval still open`);
  return { byId, problems };
}

function classification(rater, id) {
  const p = path.join(CLASSIFY, `r${rater}`, `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const cmds = {
  init() {
    for (const d of [POOL, CONTRACTS, BLIND, path.join(CLASSIFY, 'r1'), path.join(CLASSIFY, 'r2')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(RECEIPT, 'kit.sha256'), `${kitHash()}  kit (RUBRIC.md templates/ bin/ lib/)\n`);
    console.log(`initialised ${WORK} and ${RECEIPT}; kit sha256 ${kitHash().slice(0, 16)}…`);
  },

  add(a) {
    const id = a._[1]; if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) die('usage: x1 add <id> [file]');
    if (fs.existsSync(FREEZE)) die('pool is frozen; adding a request now would invalidate the study (start a new kit directory for a new pool)');
    const dst = path.join(POOL, `${id}.md`);
    if (fs.existsSync(dst)) die(`${id} exists`);
    const src = a._[2] ? fs.readFileSync(a._[2], 'utf8') : fs.readFileSync(path.join(KIT, 'templates/REQUEST.md'), 'utf8').replaceAll('<id>', id);
    fs.mkdirSync(POOL, { recursive: true });
    fs.writeFileSync(dst, src);
    console.log(dst);
  },

  freeze(a) {
    if (fs.existsSync(FREEZE)) die('already frozen; a second freeze is not allowed (C01 §6)');
    const seed = Number(a.seed); if (!Number.isInteger(seed)) die('usage: x1 freeze --seed <integer>');
    const pool = poolDigest();
    if (pool.length < PRIMARY_N) die(`pool has ${pool.length} requests; C01 needs at least ${PRIMARY_N} (plus up to 40 reserve for the extension rule)`);
    const order = shuffle(pool.map(p => p.id), seed);
    const primary = order.slice(0, PRIMARY_N);
    const reserve = order.slice(PRIMARY_N);
    const blindHalf = shuffle(primary, seed + 1).slice(0, PRIMARY_N / 2).sort();
    const freeze = { at: now(), seed, n: pool.length, primaryN: PRIMARY_N, order, primary, reserve, blindHalf, pool, kitSha256: kitHash(), rubricSha256: shaFile(path.join(KIT, 'RUBRIC.md')) };
    fs.mkdirSync(RECEIPT, { recursive: true });
    fs.writeFileSync(FREEZE, JSON.stringify(freeze, null, 2) + '\n');
    fs.writeFileSync(path.join(RECEIPT, 'pool.sha256'), pool.map(p => `${p.sha256}  ${p.id}.md`).join('\n') + '\n');
    fs.writeFileSync(path.join(RECEIPT, 'freeze.sha256'), `${shaFile(FREEZE)}  freeze.json\n`);
    console.log(`frozen ${pool.length} requests (seed ${seed}); primary ${PRIMARY_N}, reserve ${reserve.length}, blind half ${blindHalf.join(', ')}`);
    console.log(`record receipt/freeze.sha256 (${shaFile(FREEZE).slice(0, 16)}…) in C01 §15 before the first start`);
  },

  next() {
    const f = loadFreeze();
    const { byId } = workingTime(events());
    const pending = f.order.filter(id => !byId[id]?.stopped);
    if (!pending.length) return console.log('all requests contracted');
    const id = pending[0];
    const stage = f.primary.includes(id) ? 'primary' : 'reserve (extension only)';
    console.log(`${id}  (${stage}; ${f.order.indexOf(id) + 1} of ${f.order.length})`);
  },

  start(a) { timer(a, 'start'); },
  pause(a) { timer(a, 'pause'); },
  resume(a) { timer(a, 'resume'); },
  stop(a) { timer(a, 'stop'); },
  void(a) {
    const f = loadFreeze();
    const id = a._[1]; if (!id || !f.pool.find(p => p.id === id)) die('usage: x1 void <id> --reason "..."');
    if (!a.reason || a.reason === 'true') die('--reason is required');
    const { byId } = workingTime(events());
    if (!byId[id]?.started) die(`${id} has no timing to void`);
    appendEvent({ id, type: 'void', reason: a.reason });
    console.log(`voided ${id}'s timing (${byId[id].seconds.toFixed(0)} s so far); it may be started again. Voids are counted in the receipt`);
  },

  blind() {
    const f = loadFreeze();
    fs.mkdirSync(BLIND, { recursive: true });
    for (const id of f.blindHalf) {
      const src = path.join(CONTRACTS, `${id}.md`);
      if (!fs.existsSync(src)) die(`${id} has no contract yet`);
      fs.copyFileSync(src, path.join(BLIND, `${id}.md`));
      fs.copyFileSync(path.join(POOL, `${id}.md`), path.join(BLIND, `${id}.request.md`));
    }
    console.log(`exported ${f.blindHalf.length} contracts to ${BLIND} for rater 2 (no timings are stored in contracts; do not show rater 2 receipt/events.jsonl)`);
  },

  classify(a) {
    const f = loadFreeze();
    const id = a._[1]; if (!id || !f.pool.find(p => p.id === id)) die('usage: x1 classify <id> --rater 1|2 ...');
    const rater = a.rater ?? '1'; if (!['1', '2'].includes(rater)) die('--rater must be 1 or 2');
    if (rater === '2' && !f.blindHalf.includes(id)) die(`${id} is not in the blind half; rater 2 classifies only ${f.blindHalf.join(', ')}`);
    const yn = (k) => { const v = a[k]; if (!['y', 'n'].includes(v)) die(`--${k} y|n is required`); return v === 'y'; };
    const rec = {
      id, rater: Number(rater), at: now(),
      complete: yn('complete'), composable: yn('composable'), underdetermined: yn('underdetermined'),
      residual: Number.isInteger(Number(a.residual)) ? Number(a.residual) : die('--residual <integer> is required'),
      shape: ['structural', 'parametric'].includes(a.shape) ? a.shape : die('--shape structural|parametric is required'),
      cluster: a.cluster || die('--cluster <label> is required'),
      notes: a.notes ?? '',
      contractSha256: fs.existsSync(path.join(CONTRACTS, `${id}.md`)) ? shaFile(path.join(CONTRACTS, `${id}.md`)) : null,
    };
    const dir = path.join(CLASSIFY, `r${rater}`); fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${id}.json`);
    if (fs.existsSync(p)) die(`${p} exists; classifications are written once (delete it deliberately to redo, and say so in the receipt)`);
    fs.writeFileSync(p, JSON.stringify(rec, null, 2) + '\n');
    console.log(p);
  },

  verify() {
    const f = loadFreeze();
    const problems = verifyPool(f);
    const wt = workingTime(events());
    problems.push(...wt.problems);
    if (shaFile(FREEZE) !== fs.readFileSync(path.join(RECEIPT, 'freeze.sha256'), 'utf8').split(' ')[0]) problems.push('freeze.json changed after freezing');
    if (problems.length) { for (const p of problems) console.log(`FAIL ${p}`); process.exit(1); }
    console.log(`ok: ${f.pool.length} requests unchanged, kit unchanged, ${events().length} events well-formed`);
  },

  analyze(a) {
    const f = loadFreeze();
    const problems = verifyPool(f);
    if (problems.length) die(`refusing to analyse: ${problems.join('; ')}`);
    const wt = workingTime(events());
    if (wt.problems.length) die(`event problems: ${wt.problems.join('; ')}`);
    const extended = a.extended === 'true';
    const set = extended ? f.order.slice(0, Math.min(60, f.order.length)) : f.primary;
    const rows = [];
    const missing = [];
    for (const id of set) {
      const t = wt.byId[id];
      const c1 = classification(1, id);
      if (!t?.stopped || !c1) { missing.push(id); continue; }
      const seconds = Math.min(t.seconds, HARD_CAP_S);
      rows.push({ id, seconds, capped: t.seconds > HARD_CAP_S, complete: c1.complete, specifiable: c1.complete && seconds <= CAP_S,
        composable: c1.composable, residual: c1.residual, underdetermined: c1.underdetermined, shape: c1.shape, cluster: c1.cluster, c2: classification(2, id) });
    }
    if (missing.length) die(`not every request in the ${extended ? 'extended' : 'primary'} set has a stop event and a rater-1 classification: ${missing.join(', ')}`);
    const n = rows.length, k = rows.filter(r => r.specifiable).length;
    const decision = decideX1(k, n);
    const times = rows.map(r => r.seconds).sort((x, y) => x - y);
    const blind = rows.filter(r => r.c2);
    const kappa = blind.length ? cohenKappa(blind.map(r => String(r.complete)), blind.map(r => String(r.c2.complete))) : null;
    const clusters = {};
    for (const r of rows) clusters[r.cluster] = (clusters[r.cluster] || 0) + 1;
    const largest = Math.max(...Object.values(clusters));
    const residuals = rows.map(r => r.residual).sort((x, y) => x - y);
    const summary = {
      at: now(), campaign: 'C01 (E3 X1)', freezeSha256: shaFile(FREEZE), set: extended ? 'extended' : 'primary', n,
      primary: { metric: 'fraction specifiable in under ten minutes', k, n, ...decision },
      secondaries: {
        composable: { k: rows.filter(r => r.composable).length, n, ...clopperPearson(rows.filter(r => r.composable).length, n) },
        underdetermined: { k: rows.filter(r => r.underdetermined).length, n },
        residualAssertions: { median: quantile(residuals, 0.5), p95: quantile(residuals, 0.95), min: residuals[0], max: residuals.at(-1) },
        workingSeconds: { median: quantile(times, 0.5), p95: quantile(times, 0.95), min: times[0], max: times.at(-1), cappedAt1800: rows.filter(r => r.capped).length },
        structuralShare: { k: rows.filter(r => r.shape === 'structural').length, n },
        clusters: { count: Object.keys(clusters).length, largestShare: largest / n, sizes: clusters },
        interRater: kappa ? { ...kappa, blindN: blind.length, expectedBlindN: f.blindHalf.filter(id => set.includes(id)).length } : { note: 'no rater-2 classifications yet' },
      },
      rows: rows.map(({ c2, ...r }) => ({ ...r, rater2Complete: c2 ? c2.complete : null })),
      labels: 'Recorded when run under a registered C01 precommit; otherwise Pilot (not a result)',
    };
    fs.writeFileSync(path.join(RECEIPT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    const pct = (x) => (100 * x).toFixed(1) + ' %';
    console.log(`X1 ${summary.set} set, n = ${n}`);
    console.log(`primary: ${k}/${n} specifiable in ≤ 600 s = ${pct(decision.point)}  CP95 [${pct(decision.lower)}, ${pct(decision.upper)}]  band "${decision.band}" → ${decision.decision}${decision.pointEstimateDecision ? ' (point-estimate decision)' : ''}`);
    console.log(`composable ${summary.secondaries.composable.k}/${n}; underdetermined ${summary.secondaries.underdetermined.k}/${n}; structural ${summary.secondaries.structuralShare.k}/${n}; clusters ${summary.secondaries.clusters.count} (largest ${pct(largest / n)})`);
    console.log(`working seconds median ${summary.secondaries.workingSeconds.median.toFixed(0)}, p95 ${summary.secondaries.workingSeconds.p95.toFixed(0)}; residual assertions median ${summary.secondaries.residualAssertions.median}`);
    console.log(kappa ? `inter-rater κ ${kappa.kappa.toFixed(3)} on ${blind.length} blind items (agreement ${pct(kappa.agreement)})` : 'inter-rater: no rater-2 classifications yet');
    console.log(`written receipt/summary.json`);
  },
};

function timer(a, type) {
  const f = loadFreeze();
  const id = a._[1]; if (!id || !f.pool.find(p => p.id === id)) die(`usage: x1 ${type} <id>`);
  const problems = verifyPool(f); if (problems.length) die(`pool integrity: ${problems.join('; ')}`);
  const { byId } = workingTime(events());
  const s = byId[id];
  if (type === 'start') {
    if (s?.started) die(`${id} already started`);
    const c = path.join(CONTRACTS, `${id}.md`);
    if (!fs.existsSync(c)) { fs.mkdirSync(CONTRACTS, { recursive: true }); fs.writeFileSync(c, fs.readFileSync(path.join(KIT, 'templates/CONTRACT.md'), 'utf8').replaceAll('<id>', id)); }
    appendEvent({ id, type });
    console.log(`started ${id}; write the contract in ${c}; the 600 s line is the primary metric, 1800 s is the hard cap`);
    return;
  }
  if (!s?.started) die(`${id} not started`);
  if (s.stopped) die(`${id} already stopped`);
  if (type === 'pause' && s.open == null) die(`${id} is not running`);
  if (type === 'resume' && s.open != null) die(`${id} is already running`);
  appendEvent({ id, type });
  const t = workingTime(events()).byId[id];
  if (type === 'stop') console.log(`stopped ${id}: ${t.seconds.toFixed(0)} s working time${t.seconds > CAP_S ? ' (over the 600 s line)' : ''}${t.seconds > HARD_CAP_S ? ' (over the 1800 s cap; recorded as capped)' : ''}`);
  else console.log(`${type}d ${id}: ${t.seconds.toFixed(0)} s so far`);
}

const a = args(process.argv.slice(2));
const cmd = cmds[a._[0]];
if (!cmd) { console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); }
cmd(a);
