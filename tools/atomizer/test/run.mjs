// Tests for the atomizer scheduler: parallel speedup, enforced input boundary, rejected cycles and forbidden edges.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { toolchainFor } from '../lib/workers.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8'));
const fx = (n) => path.join(HERE, 'fixtures', n);
let fails = 0; const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!cond) fails++; };
const node = process.execPath, sched = path.join(HERE, '..', 'bin', 'schedule.mjs'), verify = path.join(HERE, '..', 'bin', 'verify.mjs');
const routing = spawnSync(node, [path.join(HERE, 'routing.test.mjs')], { encoding: 'utf8' });
check('routing unit tests', !routing.error && routing.status === 0, routing.error?.message ?? (routing.stdout + routing.stderr).trim());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomizer-test-'));
process.env.ATOMIZER_LEDGER_DIR = path.join(tmp, 'ledger');
process.env.ENDOFORGE_CLAUDE_ACCOUNTS = path.join(tmp, 'no-claude-accts');  // hermetic: never mount the host's real logins
// Toolchain overrides are independent of the host's installed versions.
const repoRoot = path.resolve(HERE, '../../..');
const savedCodex = process.env.ENDOFORGE_TOOLCHAIN_CODEX;
const restoreCodex = () => {
  if (savedCodex === undefined) delete process.env.ENDOFORGE_TOOLCHAIN_CODEX;
  else process.env.ENDOFORGE_TOOLCHAIN_CODEX = savedCodex;
};
try {
  const host = path.join(tmp, 'codex');
  fs.mkdirSync(path.join(host, 'bin'), { recursive: true });
  process.env.ENDOFORGE_TOOLCHAIN_CODEX = host;
  const [tc] = toolchainFor(['codex'], policy, repoRoot);
  check('codex override supplies host and bin', tc.host === host && tc.bin === path.join(host, 'bin'));
} finally { restoreCodex(); }
try {
  const missing = path.join(tmp, 'missing-codex');
  process.env.ENDOFORGE_TOOLCHAIN_CODEX = missing;
  let message = '';
  try { toolchainFor(['codex'], policy, repoRoot); } catch (e) { message = e.message; }
  check('missing codex reports toolchain, path and override', message.includes('codex') && message.includes(missing) && message.includes('ENDOFORGE_TOOLCHAIN_CODEX'));
} finally { restoreCodex(); }
// Force gzip in a fresh process, even on hosts with zstd installed.
const archivePath = fs.mkdtempSync(path.join(tmp, 'archive-path-'));
for (const tool of ['tar', 'gzip']) {
  const resolved = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
  fs.symlinkSync(resolved, path.join(archivePath, tool));
}
const fallback = spawnSync(node, ['--input-type=module', '-e', `
  import { archiveRun } from ${JSON.stringify(new URL('../lib/ledger.mjs', import.meta.url).href)};
  console.log(JSON.stringify(archiveRun(process.argv[1], 'fallback')));
`, fx('')], { encoding: 'utf8', env: { ...process.env, PATH: archivePath, ATOMIZER_LEDGER_DIR: path.join(tmp, 'fallback-ledger') } });
const gz = JSON.parse(fallback.stdout.trim() || '{}');
check('archive falls back to gzip without zstd', fallback.status === 0 && gz.format === 'gzip' && /^[0-9a-f]{64}$/.test(gz.sha256) && fs.existsSync(path.join(tmp, 'fallback-ledger', 'archive', path.basename(gz.path))), fallback.error?.message || fallback.stderr || JSON.stringify(gz));
// 1. validation
const vc = validate(JSON.parse(fs.readFileSync(fx('synthetic-cycle.json'), 'utf8')), policy);
check('cycle rejected', !vc.ok && vc.errors.some((e) => /cycle/.test(e)), vc.errors.join('; '));
const vf = validate(JSON.parse(fs.readFileSync(fx('synthetic-forbidden.json'), 'utf8')), policy);
check('forbidden edge tests->kernel rejected', !vf.ok && vf.errors.some((e) => /forbidden/.test(e)), vf.errors.join('; '));
const vg = validate(JSON.parse(fs.readFileSync(fx('synthetic-fanout.json'), 'utf8')), policy);
check('fan-out fixture valid', vg.ok, vg.errors.join('; '));
// 2. parallel run: 10 atoms of ~1 s each; critical path 3 atoms
const r1 = spawnSync(node, [sched, 'run', fx('synthetic-fanout.json'), '--run-dir', path.join(tmp, 'fanout'), '--concurrency', '9'], { encoding: 'utf8' });
const s1 = JSON.parse(r1.stdout.trim().split('\n').at(-1));
check('fan-out all done', s1.allDone, r1.stderr.slice(-300));
check('wall below 6 s for ~10 s of atom work', s1.wallMs < 6000, `wall ${s1.wallMs} ms, sequential-equivalent ${s1.sumAtomWallMs} ms`);
check('realized speedup above 2x', s1.realizedSpeedup > 2, `realized ${s1.realizedSpeedup}x, bound ${s1.speedupBound}x`);
const v1 = spawnSync(node, [verify, path.join(tmp, 'fanout')], { encoding: 'utf8' });
check('fan-out verify passes acceptance A1 and A2', v1.status === 0, v1.stdout.trim().slice(0, 300));
// 3. undeclared read fails inside the isolate and blocks compose
const r2 = spawnSync(node, [sched, 'run', fx('synthetic-undeclared.json'), '--run-dir', path.join(tmp, 'undeclared'), '--concurrency', '4', '--retries', '0'], { encoding: 'utf8' });
const s2 = JSON.parse(r2.stdout.trim().split('\n').at(-1));
check('undeclared input: w9 failed', s2.statuses.w9 === 'failed', JSON.stringify(s2.statuses));
check('undeclared input: compose blocked', s2.statuses.compose === 'blocked');
const v2 = spawnSync(node, [verify, path.join(tmp, 'undeclared')], { encoding: 'utf8' });
check('undeclared run fails verification', v2.status !== 0);
// 4. ledger
const ev = fs.readFileSync(path.join(tmp, 'ledger', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const kinds = new Set(ev.map((e) => e.event));
check('ledger has run, atom, attempt, verify and archive events', ['run.start', 'atom.start', 'attempt.end', 'atom.end', 'run.end', 'verify.end', 'run.archived', 'atom.blocked'].every((k) => kinds.has(k)), [...kinds].join(','));
const att = ev.filter((e) => e.event === 'attempt.end');
check('every attempt event carries wall, stage time, output hashes and load', att.length >= 20 && att.every((e) => typeof e.wallMs === 'number' && typeof e.stageMs === 'number' && Array.isArray(e.outputs) && e.load), `${att.length} attempts`);
const arch = ev.find((e) => e.event === 'run.archived');
check('run archive written and hashed', arch && /\.tar\.(zst|gz)$/.test(arch.path) && fs.existsSync(path.join(tmp, 'ledger', 'archive', path.basename(arch.path))) && /^[0-9a-f]{64}$/.test(arch.sha256));
// 5. receipts
const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'fanout', 'receipt', 'atoms', 'compose.json'), 'utf8'));
check('compose receipt lists 8 inputs and a hashed output', rec.inputs.length === 8 && /^[0-9a-f]{64}$/.test(rec.outputs['all.txt']));
// 6. asset atoms: binds and timeouts
{
  const { validate } = await import('../lib/validate.mjs');
  const { atomBinds, atomTimeoutMs } = await import('../lib/binds.mjs');
  const pol = JSON.parse(fs.readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-root-'));
  const P = { ...pol, bindRoots: [root], maxAtomTimeoutSec: 60 };
  const mk = (binds, extra = {}) => ({ id: 'a1', kind: 'asset', contract: 'build one asset from the bound tree', outputs: [{ name: 'o', path: 'o.json' }], verify: 'o.json parses', worker: { model: 'script', command: ['true'], binds, ...extra }, size: { work: 1, interface: 1 } });
  check('bind under a root is accepted, read-only', (() => { const r = atomBinds(mk([{ host: root, guest: '/assets/x' }]), P); return !r.errors.length && r.mounts[0].mode === 'ro'; })());
  check('bind outside bindRoots is rejected', atomBinds(mk([{ host: os.tmpdir(), guest: '/assets/x' }]), P).errors.some((e) => /outside policy.bindRoots/.test(e)));
  check('bind may not shadow /out or /usr', ['/out', '/usr/lib'].every((g) => atomBinds(mk([{ host: root, guest: g }]), P).errors.length === 1));
  check('missing bind host is rejected', atomBinds(mk([{ host: path.join(root, 'nope'), guest: '/assets/x' }]), P).errors.length === 1);
  check('timeoutSec is capped by policy', atomTimeoutMs(mk([], { timeoutSec: 600 }), P, 900000) === 60000 && atomTimeoutMs(mk([]), P, 900000) === 900000);
  const doc = { schema: 'endoforge/atoms/1', need: { id: 'T', text: 't' }, acceptance: [{ id: 'A1', statement: 's', check: { kind: 'manual' } }], atoms: [mk([{ host: os.tmpdir(), guest: '/assets/x' }]), { ...mk([]), id: 'compose', kind: 'compose', inputs: [{ from: 'a1' }] }] };
  check('validate surfaces bind errors and accepts kind asset', (() => { const v = validate(doc, P); return !v.ok && v.errors.some((e) => /bindRoots/.test(e)) && !v.errors.some((e) => /kind must be/.test(e)); })());
  fs.rmSync(root, { recursive: true, force: true });
}
// 7. native Claude launches take pool logins in turn, mounted read-write as CLAUDE_CONFIG_DIR (no credential copies)
{
  const { makeHomeTemplate, runIsolated } = await import('../lib/isolate.mjs');
  const root = fs.mkdtempSync(path.join(HERE, 'claude-accts-'));  // outside /tmp: the isolate overlays /tmp
  const saved = process.env.ENDOFORGE_CLAUDE_ACCOUNTS;
  try {
    for (const n of ['a', 'b']) {
      fs.mkdirSync(path.join(root, 'accts', n), { recursive: true });
      fs.closeSync(fs.openSync(path.join(root, 'accts', n, '.credentials.json'), 'wx', 0o000));  // unreadable: never opened
    }
    fs.mkdirSync(path.join(root, 'accts', 'no-login'));
    const stub = path.join(root, 'claude'); fs.mkdirSync(stub);
    fs.writeFileSync(path.join(stub, 'claude'), '#!/bin/sh\ntouch "$CLAUDE_CONFIG_DIR/seen" && echo "$CLAUDE_CONFIG_DIR"\n', { mode: 0o755 });
    process.env.ENDOFORGE_CLAUDE_ACCOUNTS = path.join(root, 'accts');
    const home = makeHomeTemplate(fs.mkdtempSync(path.join(root, 'home-')));
    check('pool logins: the home template copies no credentials', fs.readdirSync(home).length === 0);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      const r = await runIsolated({ homeTemplate: home, toolchain: [{ host: stub, guest: stub, bin: stub }], cmd: ['claude'], cwd: '/', mounts: [] });
      seen.push(r.exit === 0 ? `${r.claudeAccount}:${r.stdout.trim()}` : `exit ${r.exit}: ${r.stderr.trim()}`);
    }
    const a = path.join(root, 'accts', 'a'), b = path.join(root, 'accts', 'b');
    check('pool logins: launches alternate a, b, a and see CLAUDE_CONFIG_DIR', seen.join('|') === `a:${a}|b:${b}|a:${a}`, seen.join(' | '));
    check('pool logins: the folder is mounted read-write, so refreshed tokens persist', fs.existsSync(path.join(a, 'seen')) && fs.existsSync(path.join(b, 'seen')));
    const s = await runIsolated({ homeTemplate: home, toolchain: [{ host: stub, guest: stub, bin: stub }], cmd: ['sh', '-c', 'echo "${CLAUDE_CONFIG_DIR:-unset}"'], cwd: '/', mounts: [] });
    check('pool logins: non-claude commands get no login', s.stdout.trim() === 'unset' && !s.claudeAccount);
  } finally {
    if (saved === undefined) delete process.env.ENDOFORGE_CLAUDE_ACCOUNTS; else process.env.ENDOFORGE_CLAUDE_ACCOUNTS = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all atomizer tests passed');
process.exit(fails ? 1 : 0);
