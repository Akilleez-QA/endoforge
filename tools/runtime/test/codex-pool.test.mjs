// Local codex-pool launcher: PATH default for CODEX_POOL_BIN and stdin pass-through. A stub `codex` and synthetic
// accounts only; no model, no credential contents, no real ~/.codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../codex-pool.mjs');
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
  Object.assign(env, { CODEX_POOL_PRIMARY: path.join(root, 'acct-a'), CODEX_POOL_ACCOUNTS_DIR: path.join(root, 'accts'), CODEX_POOL_STATE_DIR: path.join(root, 'state'), CODEX_POOL_GUARD: 'none', CODEX_POOL_WAIT: '10' });
  return { root, env };
}
const run = (env, args, opts = {}) => spawnSync(process.execPath, [pool, ...args], { env, encoding: 'utf8', timeout: 30_000, ...opts });

try {
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
