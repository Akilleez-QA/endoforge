#!/usr/bin/env node
//   pick an account -> run the guard -> exec $CODEX_POOL_BIN with CODEX_HOME=<account> -> fail over on rate limits.
// An account is a directory holding auth.json: CODEX_POOL_PRIMARY (~/.codex, logged as "default"), then each
// subdirectory of CODEX_POOL_ACCOUNTS_DIR (~/.codex-accounts). Credentials are never opened; only auth.json's
// presence is checked. At most CODEX_POOL_PER_ACCOUNT (2) launches per account at once, tracked by host-PID slot
// directories in CODEX_POOL_STATE_DIR (~/.codex-pool); the least-loaded account goes first. A rate-limited account
// cools down for the time its error names (default 300 s). Every try is one line in <state>/log.
// The child is CODEX_POOL_BIN, or the first `codex` on PATH when it is unset (Endoforge sets it to its isolate). The
// child inherits stdin, so a prompt can come on stdin (`codex exec -`); a regular-file stdin (`< prompt.txt`, systemd
// StandardInput=file:) is reopened from its start for every try, so a failover retry sees the whole prompt.
// Exits: the child's code; 75 when every account is cooling down or no slot frees within CODEX_POOL_WAIT (600 s);
// the guard's code when CODEX_POOL_GUARD (a path, or "none") refuses the launch; 2 when no codex binary is found.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const E = process.env, HOME = os.homedir();
const STATE = E.CODEX_POOL_STATE_DIR || path.join(HOME, '.codex-pool');
const PRIMARY = E.CODEX_POOL_PRIMARY || path.join(HOME, '.codex');
const ACCOUNTS = E.CODEX_POOL_ACCOUNTS_DIR || path.join(HOME, '.codex-accounts');
const PER = Number(E.CODEX_POOL_PER_ACCOUNT) || 2, WAIT_MS = (Number(E.CODEX_POOL_WAIT) || 600) * 1000;
const GUARD = E.CODEX_POOL_GUARD || 'none';
const RATE = /\b429\b|too many requests|rate[ _-]?limit|usage limit|quota exceeded/i;
// When a limit lifts, in epoch ms, from the message (adapters/provider_policy.py parse_reset is the same rule): relative
// saving applies; a missing year or date is the next such moment). null when the message names none.
const UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600,
  hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function resetAt(text, now = Date.now()) {
  const rel = text.match(/(?:try again|resets?|available again)\s+in\s+((?:\d+(?:\.\d+)?\s*[a-z]+[\s,]*(?:and\s+)?)+)/i);
  if (rel) {
    let s = 0, found = false;
    for (const [, n, u] of rel[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) if (UNITS[u.toLowerCase()]) { s += Number(n) * UNITS[u.toLowerCase()]; found = true; }
    if (found) return now + s * 1000;
  }
  const m = text.match(/(?:try again|resets?|available again)\s+(?:at|on)\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:(\d{4}),?\s+)?)?(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[4]); const min = Number(m[5]);
  if (m[6]) { if (h < 1 || h > 12) return null; h = (h % 12) + (/^p/i.test(m[6]) ? 12 : 0); }
  if (h > 23 || min > 59) return null;
  const cur = new Date(now);
  let when;
  if (m[1]) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon < 0) return null;
    when = new Date(Number(m[3] || cur.getFullYear()), mon, Number(m[2]), h, min);
    if (!m[3] && when.getTime() < now - 86400e3) when = new Date(when.getFullYear() + 1, mon, Number(m[2]), h, min);
  } else {
    when = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), h, min);
    if (when.getTime() < now) when = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, h, min);
  }
  return Math.max(now, when.getTime());
}
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

// The first executable `codex` on PATH that is not this script (a `codex` shim pointing back here would recurse).
function codexOnPath() {
  let self = null;
  try { self = fs.realpathSync(fileURLToPath(import.meta.url)); } catch {}
  for (const dir of (E.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'codex');
    try { fs.accessSync(p, fs.constants.X_OK); if (!fs.statSync(p).isFile() || fs.realpathSync(p) === self) continue; return p; } catch {}
  }
  return null;
}
// A regular file on fd 0 is reopened per try (fresh offset); anything else (a TTY, a pipe, /dev/null) is inherited.
function stdinFor() {
  try { if (fs.fstatSync(0).isFile()) return fs.openSync('/proc/self/fd/0', 'r'); } catch {}
  return 'inherit';
}

let child = null;
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { if (child) child.kill(s); else process.exit(128 + os.constants.signals[s]); });

const WORKERS = E.WORKERS_BIN && fs.existsSync(E.WORKERS_BIN) ? E.WORKERS_BIN : null;

function launch(bin, acct) {
  return new Promise((resolve) => {
    let tail = '';
    const stdin = stdinFor();
    const [cmd, args] = WORKERS && E.WORKERS_REGISTERED !== '1'
      ? [WORKERS, ['run', '--bot', E.CODEX_POOL_BOT || E.WORKER_BOT || '', '--', bin, ...process.argv.slice(2)]]
      : [bin, process.argv.slice(2)];
    child = spawn(cmd, args, { env: { ...E, CODEX_HOME: acct.home, WORKERS_ALLOW_UNREGISTERED: '1' }, stdio: [stdin, 'inherit', 'pipe'] });
    if (typeof stdin === 'number') fs.closeSync(stdin);
    child.stderr.on('data', (d) => { process.stderr.write(d); tail = (tail + d).slice(-65536); });
    child.on('error', (e) => { tail += e.message; });
    child.on('close', (code, signal) => { const pid = child.pid; child = null; resolve({ code: code ?? 128 + (os.constants.signals[signal] || 0), tail, pid }); });
  });
}

async function main() {
  const bin = E.CODEX_POOL_BIN || codexOnPath();
  if (!bin) { console.error('codex-pool: CODEX_POOL_BIN is not set and no codex is on PATH'); return 2; }
  const all = accounts();
  if (!all.length) { console.error(`codex-pool: no account (need ${PRIMARY}/auth.json or ${ACCOUNTS}/<name>/auth.json)`); return 75; }
  const deadline = Date.now() + WAIT_MS, tried = new Set();
  for (;;) {
    const now = Date.now();
    const ready = all.filter((a) => !tried.has(a.name) && coolUntil(a.name) <= now);
    if (!ready.length) {
      const next = Math.min(...all.filter((a) => !tried.has(a.name)).map((a) => coolUntil(a.name)), Infinity);
      if (next === Infinity || next > deadline) {
        // the earliest moment any account (tried this run or not) is usable again
        const lift = Math.min(...all.map((a) => coolUntil(a.name)));
        const hrs = (lift - now) / 3600e3;
        console.error(lift <= now + WAIT_MS ? 'codex-pool: all accounts exhausted (rate-limited or cooling down)'
          : `codex-pool: all accounts capped until ${new Date(lift).toString()} (${hrs >= 24 ? (hrs / 24).toFixed(1) + ' days' : hrs.toFixed(1) + ' h'}); not retrying before then`);
        return 75;
      }
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
      const r = await launch(bin, acct);
      const rate = r.code !== 0 && RATE.test(r.tail);
      if (rate) {
        // cool down until the limit really lifts; 300 s only when the message names no reset (a five-day cap re-probed
        const until = resetAt(r.tail) ?? Date.now() + 300e3;
        fs.writeFileSync(path.join(COOL, acct.name), String(until));
        log({ account: acct.name, pid: process.pid, child: r.pid, exit: r.code, class: 'rate', failover: 'yes', until: new Date(until).toISOString() });
        tried.add(acct.name); continue;
      }
      log({ account: acct.name, pid: process.pid, child: r.pid, exit: r.code, class: r.code === 0 ? 'ok' : 'error' });
      return r.code;
    } finally { release(); }
  }
}

process.exitCode = await main().catch((e) => { console.error(`codex-pool: ${e.message}`); return 1; });
