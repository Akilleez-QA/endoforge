#!/usr/bin/env node
// Local codex-pool for hosts without the fleet pool (main-rig). It implements the host launcher contract in
// tools/atomizer/CODEX.md and is checked by tools/atomizer/test/codex-swarm.test.mjs:
//   pick an account -> run the guard -> exec $CODEX_POOL_BIN with CODEX_HOME=<account> -> fail over on rate limits.
// An account is a directory holding auth.json: CODEX_POOL_PRIMARY (~/.codex, logged as "default"), then each
// subdirectory of CODEX_POOL_ACCOUNTS_DIR (~/.codex-accounts). Credentials are never opened; only auth.json's
// presence is checked. At most CODEX_POOL_PER_ACCOUNT (2) launches per account at once, tracked by host-PID slot
// directories in CODEX_POOL_STATE_DIR (~/.codex-pool); the least-loaded account goes first. A rate-limited account
// cools down for the time its error names (default 300 s). Every try is one line in <state>/log.
// Exits: the child's code; 75 when every account is cooling down or no slot frees within CODEX_POOL_WAIT (600 s);
// the guard's code when CODEX_POOL_GUARD (a path, or "none") refuses the launch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const E = process.env, HOME = os.homedir();
const STATE = E.CODEX_POOL_STATE_DIR || path.join(HOME, '.codex-pool');
const PRIMARY = E.CODEX_POOL_PRIMARY || path.join(HOME, '.codex');
const ACCOUNTS = E.CODEX_POOL_ACCOUNTS_DIR || path.join(HOME, '.codex-accounts');
const PER = Number(E.CODEX_POOL_PER_ACCOUNT) || 2, WAIT_MS = (Number(E.CODEX_POOL_WAIT) || 600) * 1000;
const GUARD = E.CODEX_POOL_GUARD || 'none';
const RATE = /\b429\b|too many requests|rate[ _-]?limit|usage limit|quota exceeded/i;
const SLOTS = path.join(STATE, 'slots'), COOL = path.join(STATE, 'cooldown');
for (const d of [SLOTS, COOL]) fs.mkdirSync(d, { recursive: true });

const log = (f) => fs.appendFileSync(path.join(STATE, 'log'),
  `ts=${new Date().toISOString()} ${Object.entries(f).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function accounts() {
  const out = [];
  if (fs.existsSync(path.join(PRIMARY, 'auth.json'))) out.push({ name: 'default', home: PRIMARY });
  let names = [];
  try { names = fs.readdirSync(ACCOUNTS).sort(); } catch {}
  for (const n of names) if (fs.existsSync(path.join(ACCOUNTS, n, 'auth.json'))) out.push({ name: n, home: path.join(ACCOUNTS, n) });
  return out;
}

// A slot is <slots>/<account>.<i> holding its owner's host PID; a dead owner's slot is reclaimed by rename, so only
// one reclaimer wins.
function held(name) {
  let n = 0;
  for (let i = 1; i <= PER; i++) {
    const p = path.join(SLOTS, `${name}.${i}`);
    let pid;
    try { pid = Number(fs.readFileSync(path.join(p, 'pid'), 'utf8')); } catch { if (fs.existsSync(p)) n++; continue; }
    if (alive(pid)) { n++; continue; }
    try { const t = `${p}.stale-${process.pid}`; fs.renameSync(p, t); fs.rmSync(t, { recursive: true, force: true }); } catch {}
  }
  return n;
}
function take(name) {
  for (let i = 1; i <= PER; i++) {
    const p = path.join(SLOTS, `${name}.${i}`);
    try { fs.mkdirSync(p); } catch { continue; }
    fs.writeFileSync(path.join(p, 'pid'), String(process.pid));
    return () => fs.rmSync(p, { recursive: true, force: true });
  }
  return null;
}
const coolUntil = (name) => { try { return Number(fs.readFileSync(path.join(COOL, name), 'utf8')) || 0; } catch { return 0; } };

let child = null;
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { if (child) child.kill(s); else process.exit(128 + os.constants.signals[s]); });

function launch(acct) {
  return new Promise((resolve) => {
    let tail = '';
    child = spawn(E.CODEX_POOL_BIN, process.argv.slice(2), { env: { ...E, CODEX_HOME: acct.home }, stdio: ['ignore', 'inherit', 'pipe'] });
    child.stderr.on('data', (d) => { process.stderr.write(d); tail = (tail + d).slice(-65536); });
    child.on('error', (e) => { tail += e.message; });
    child.on('close', (code, signal) => { const pid = child.pid; child = null; resolve({ code: code ?? 128 + (os.constants.signals[signal] || 0), tail, pid }); });
  });
}

async function main() {
  if (!E.CODEX_POOL_BIN) { console.error('codex-pool: CODEX_POOL_BIN is not set (Endoforge sets it)'); return 2; }
  const all = accounts();
  if (!all.length) { console.error(`codex-pool: no account (need ${PRIMARY}/auth.json or ${ACCOUNTS}/<name>/auth.json)`); return 75; }
  const deadline = Date.now() + WAIT_MS, tried = new Set();
  for (;;) {
    const now = Date.now();
    const ready = all.filter((a) => !tried.has(a.name) && coolUntil(a.name) <= now);
    if (!ready.length) {
      const next = Math.min(...all.filter((a) => !tried.has(a.name)).map((a) => coolUntil(a.name)), Infinity);
      if (next === Infinity || next > deadline) { console.error('codex-pool: all accounts exhausted (rate-limited or cooling down)'); return 75; }
      await sleep(Math.min(next - now, 5000)); continue;
    }
    const pick = ready.map((a) => ({ a, n: held(a.name) })).filter((x) => x.n < PER).sort((x, y) => x.n - y.n)[0];
    const release = pick && take(pick.a.name);
    if (!release) {
      if (Date.now() > deadline) { console.error(`codex-pool: all accounts exhausted (no free slot in ${WAIT_MS / 1000} s)`); return 75; }
      await sleep(500); continue;
    }
    const acct = pick.a;
    try {
      if (GUARD !== 'none') {
        const g = spawnSync(GUARD, [], { env: { ...E, CODEX_POOL_ACCOUNT: acct.name }, stdio: ['ignore', 'ignore', 'inherit'] });
        const gcode = g.status ?? 1;
        if (gcode !== 0) { log({ account: acct.name, pid: process.pid, child: 0, exit: gcode, class: 'guard' }); return gcode; }
      }
      const r = await launch(acct);
      const rate = r.code !== 0 && RATE.test(r.tail);
      if (rate) {
        const secs = Number(r.tail.match(/try again in (\d+)\s*s/i)?.[1]) || 300;
        fs.writeFileSync(path.join(COOL, acct.name), String(Date.now() + secs * 1000));
        log({ account: acct.name, pid: process.pid, child: r.pid, exit: r.code, class: 'rate', failover: 'yes' });
        tried.add(acct.name); continue;
      }
      log({ account: acct.name, pid: process.pid, child: r.pid, exit: r.code, class: r.code === 0 ? 'ok' : 'error' });
      return r.code;
    } finally { release(); }
  }
}

process.exitCode = await main().catch((e) => { console.error(`codex-pool: ${e.message}`); return 1; });
