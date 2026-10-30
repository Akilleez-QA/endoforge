// Local codex-pool launcher: PATH default for CODEX_POOL_BIN and stdin pass-through. A stub `codex` and synthetic
// accounts only; no model, no credential contents, no real ~/.codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../agent-pool.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pool-test-'));
let failures = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); } };

// A stub codex that reports where it ran from, its account, its args and its stdin; RATE_LIMITED in an account makes
// it fail like a rate-limited codex after reading stdin.
function stub(dir, tag) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'codex');
  fs.writeFileSync(p, `#!/bin/sh
input=$(cat)
echo run >> "$CODEX_HOME/calls"
if [ -e "$CODEX_HOME/CAPPED" ]; then cat "$CODEX_HOME/CAPPED" >&2; exit 1; fi
if [ -e "$CODEX_HOME/RATE_LIMITED" ]; then echo 'ERROR: 429 Too Many Requests; try again in 120 seconds' >&2; exit 1; fi
printf 'bin=${tag} home=%s args=%s stdin=%s\\n' "\${CODEX_HOME##*/}" "$*" "$input"
`, { mode: 0o755 });
  return p;
}
function setup(name, { limited = [] } = {}) {
  const root = path.join(tmp, name);
  for (const home of ['acct-a', 'accts/acct-b']) {
    fs.mkdirSync(path.join(root, home), { recursive: true });
    fs.closeSync(fs.openSync(path.join(root, home, 'auth.json'), 'wx', 0o000));
    if (limited.includes(path.basename(home))) fs.writeFileSync(path.join(root, home, 'RATE_LIMITED'), '');
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEX_POOL_') && k !== 'CODEX_HOME'));
  Object.assign(env, { CODEX_POOL_PRIMARY: path.join(root, 'acct-a'), CODEX_POOL_ACCOUNTS_DIR: path.join(root, 'accts'), CODEX_POOL_STATE_DIR: path.join(root, 'state'), CODEX_POOL_GUARD: 'none', CODEX_POOL_WAIT: '10', WORKERS_DIR: path.join(root, 'workers') });
  delete env.WORKERS_REGISTERED;
  return { root, env };
}
const run = (env, args, opts = {}) => spawnSync(process.execPath, [pool, ...args], { env, encoding: 'utf8', timeout: 30_000, ...opts });

try {
  test('the codex child runs under the worker registry once; an old registry cannot make the pool recurse', () => {
    // registry that did not spawned 465 nested pools. This stand-in never marks anything, like that old registry.
    const { root, env } = setup('registry');
    const bin = stub(path.join(root, 'bin'), 'reg');
    const fake = path.join(root, 'fake-workers');
    fs.writeFileSync(fake, `#!/bin/sh\necho "registered $3" >> ${path.join(root, 'calls')}\nshift 4\nexec "$@"\n`, { mode: 0o755 });
    Object.assign(env, { CODEX_POOL_BIN: bin, WORKERS_BIN: fake, CODEX_POOL_BOT: 'claude-code' });
    const r = run(env, ['exec', 'once'], { input: '', timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'bin=reg home=acct-a args=exec once stdin=\n');
    assert.equal(fs.readFileSync(path.join(root, 'calls'), 'utf8'), 'registered claude-code\n');
  });
  test('unset CODEX_POOL_BIN runs the codex found on PATH', () => {
    const { root, env } = setup('path');
    stub(path.join(root, 'bin'), 'path');
    env.PATH = `${path.join(root, 'empty')}:${path.join(root, 'bin')}:${env.PATH}`;
    const r = run(env, ['exec', 'hello'], { input: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'bin=path home=acct-a args=exec hello stdin=\n');
  });
  test('an explicit CODEX_POOL_BIN still wins over PATH', () => {
    const { root, env } = setup('explicit');
    stub(path.join(root, 'bin'), 'path');
    env.CODEX_POOL_BIN = stub(path.join(root, 'pinned'), 'pinned');
    env.PATH = `${path.join(root, 'bin')}:${env.PATH}`;
    const r = run(env, ['exec', 'x'], { input: '' });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^bin=pinned /);
  });
  test('no CODEX_POOL_BIN and no codex on PATH exits 2 and says so', () => {
    const { root, env } = setup('none');
    env.PATH = path.join(root, 'empty');
    const r = run(env, ['exec', 'x'], { input: '' });
    assert.equal(r.status, 2); assert.match(r.stderr, /CODEX_POOL_BIN is not set and no codex is on PATH/);
    assert(!fs.existsSync(path.join(root, 'state', 'log')) || !fs.readFileSync(path.join(root, 'state', 'log'), 'utf8').includes('exit='));
  });
  test('a PATH codex that is this script is skipped', () => {
    const { root, env } = setup('self');
    fs.mkdirSync(path.join(root, 'loop'), { recursive: true });
    fs.symlinkSync(pool, path.join(root, 'loop', 'codex'));
    stub(path.join(root, 'bin'), 'real');
    env.PATH = `${path.join(root, 'loop')}:${path.join(root, 'bin')}:${env.PATH}`;
    const r = run(env, ['exec', 'x'], { input: '' });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^bin=real /);
  });
  test('a piped prompt reaches codex on stdin', () => {
    const { root, env } = setup('pipe');
    env.CODEX_POOL_BIN = stub(path.join(root, 'bin'), 'stub');
    const r = run(env, ['exec', '-', '-i', 'a.png', '-i', 'b.png'], { input: 'fix beat b3' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'bin=stub home=acct-a args=exec - -i a.png -i b.png stdin=fix beat b3\n');
  });
  test('a multi-day usage cap cools every account until its reset and is not re-probed', () => {
    // for five days. The cap now holds each account until the time it names, and the pool exits 75 at once.
    const { root, env } = setup('capped');
    env.CODEX_POOL_BIN = stub(path.join(root, 'bin'), 'stub');
    const reset = new Date(Date.now() + 3 * 86400e3); reset.setSeconds(0, 0);
    const mon = reset.toLocaleString('en-US', { month: 'short' });
    const hh = reset.getHours() % 12 || 12, ampm = reset.getHours() < 12 ? 'AM' : 'PM';
    const msg = `ERROR: You\u2019ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at ${mon} ${reset.getDate()}th, ${reset.getFullYear()} ${hh}:${String(reset.getMinutes()).padStart(2, '0')} ${ampm}.`;
    for (const a of ['acct-a', 'accts/acct-b']) fs.writeFileSync(path.join(root, a, 'CAPPED'), msg);
    let r = run(env, ['exec', 'x'], { input: '' });
    assert.equal(r.status, 75, r.stderr);
    assert.match(r.stderr, /all accounts capped until .*\(3\.0 days\); not retrying before then/);
    for (const [a, name] of [['acct-a', 'default'], ['accts/acct-b', 'acct-b']]) {
      assert.equal(Number(fs.readFileSync(path.join(root, 'state', 'cooldown', name), 'utf8')), reset.getTime());
      assert.equal(fs.readFileSync(path.join(root, a, 'calls'), 'utf8'), 'run\n');
    }
    r = run(env, ['exec', 'again'], { input: '' });       // a second launch is refused without touching codex
    assert.equal(r.status, 75, r.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'acct-a', 'calls'), 'utf8'), 'run\n');
  });
  test('a file prompt survives a rate-limit failover', () => {
    const { root, env } = setup('failover', { limited: ['acct-a'] });
    env.CODEX_POOL_BIN = stub(path.join(root, 'bin'), 'stub');
    const prompt = path.join(root, 'prompt.txt'); fs.writeFileSync(prompt, 'the whole brief');
    const fd = fs.openSync(prompt, 'r');
    try {
      const r = run(env, ['exec', '-'], { stdio: [fd, 'pipe', 'pipe'] });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'bin=stub home=acct-b args=exec - stdin=the whole brief\n');
      assert.match(fs.readFileSync(path.join(root, 'state', 'log'), 'utf8'), /account=default .*class=rate failover=yes/);
    } finally { fs.closeSync(fd); }
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
process.exitCode = failures ? 1 : 0;
