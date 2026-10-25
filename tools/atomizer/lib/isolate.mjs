// Run one command inside a bubblewrap isolate with a private home and only the declared mounts (P-07).
import fs from 'node:fs';
import { nowEpoch } from './trace.mjs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HOME = os.homedir();
export const expand = (p) => (p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);
const SYSTEM_RO = ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc/ssl', '/etc/ca-certificates', '/etc/resolv.conf', '/etc/hosts', '/etc/passwd', '/etc/group', '/etc/localtime', '/etc/nsswitch.conf', '/etc/fonts', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d'];
const CREDENTIAL_FILES = ['.claude/.credentials.json', '.claude.json'];
/** A template home with only the user's own subscription credentials; private (0700); caller deletes it. */
export function makeHomeTemplate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const rel of CREDENTIAL_FILES) {
    const src = path.join(HOME, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel); fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o600);
  }
  return dir;
}
export function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
export function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath ?? e.path, e.name)));
  return out.sort();
}
/**
 * spec: { homeTemplate, mounts: [{host, guest, mode:'ro'|'rw'}], toolchain: [{host, guest}], cmd: [...], stdin, cwd, env, timeoutMs, pool?: {bin, env} }
 * Returns { exit, signal, wallMs, stdout, stderr, timedOut, bwrapArgs, poolPid? }.
 */
export async function runIsolated(spec) {
  const homeStart = nowEpoch();
  const runHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-home-'));
  fs.chmodSync(runHome, 0o700);
  fs.cpSync(spec.homeTemplate, runHome, { recursive: true });
  const homeMs = nowEpoch() - homeStart;
  const args = [];
  for (const p of SYSTEM_RO) if (fs.existsSync(p)) args.push('--ro-bind', p, p);
  args.push('--bind', runHome, HOME);
  // System paths are already bound read-only; re-binding a toolchain inside them (e.g. /usr/bin/python3, often a symlink) fails.
  const inSystem = (p) => SYSTEM_RO.some((r) => p === r || p.startsWith(r + '/'));
  for (const t of spec.toolchain ?? []) if (fs.existsSync(t.host) && !inSystem(t.guest ?? t.host)) args.push('--ro-bind', t.host, t.guest ?? t.host);
  for (const m of spec.mounts ?? []) args.push(m.mode === 'rw' ? '--bind' : '--ro-bind', m.host, m.guest);
  args.push('--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--unshare-pid', '--unshare-uts', '--unshare-ipc', '--unshare-cgroup-try', '--die-with-parent', '--new-session', '--clearenv',
    '--setenv', 'HOME', HOME, '--setenv', 'USER', os.userInfo().username, '--setenv', 'TERM', 'dumb', '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'PATH', [...(spec.toolchain ?? []).map((t) => t.bin).filter(Boolean), '/usr/bin', '/bin'].join(':'));
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push('--setenv', k, String(v));
  args.push('--chdir', spec.cwd ?? '/work');
  // Keep the launch spec outside the writable guest home across pool failovers.
  const specDir = spec.pool ? fs.mkdtempSync(path.join(os.tmpdir(), 'atom-isolate-')) : null;
  let env;
  if (spec.pool) {
    const specFile = path.join(specDir, 'spec.json');
    fs.writeFileSync(specFile, JSON.stringify({ bwrapArgs: args, cmdHead: spec.cmd[0] }), { mode: 0o600 });
    env = { ...process.env, ...spec.pool.env, CODEX_POOL_BIN: fileURLToPath(new URL('../bin/isolate-exec.mjs', import.meta.url)), ENDOFORGE_ISOLATE_SPEC: specFile, ENDOFORGE_ISOLATE_TRACE: path.join(specDir, 'tries') };
  } else args.push('--', ...spec.cmd);
  const t0 = process.hrtime.bigint();
  let result, spawnEpoch, endEpoch, firstStdoutEpoch; const tries = [];
  try { result = await new Promise((resolve) => {
    spawnEpoch = nowEpoch();
    const child = spawn(spec.pool?.bin ?? 'bwrap', spec.pool ? spec.cmd.slice(1) : args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (d) => { firstStdoutEpoch ??= nowEpoch(); stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = spec.timeoutMs ? setTimeout(() => { timedOut = true; child.kill(spec.pool ? 'SIGTERM' : 'SIGKILL'); }, spec.timeoutMs) : null;
    child.on('error', (error) => { stderr += error.message; });
    child.on('close', (code, signal) => { endEpoch = nowEpoch(); if (timer) clearTimeout(timer); resolve({ exit: code, signal, stdout, stderr, timedOut, ...(spec.pool ? { poolPid: child.pid } : {}) }); });
    if (!spec.pool && spec.stdin != null) child.stdin.write(spec.stdin);
    child.stdin.end();
  }); } finally {
    fs.rmSync(runHome, { recursive: true, force: true });
    if (specDir) {
      try { for (const line of fs.readFileSync(path.join(specDir, 'tries'), 'utf8').trim().split('\n')) { const [tag, t, code] = line.split(' '); if (tag === 'start') tries.push({ start: Number(t) }); else if (tag === 'end' && tries.length) Object.assign(tries.at(-1), { end: Number(t), exit: Number(code) }); } } catch {}
      fs.rmSync(specDir, { recursive: true, force: true });
    }
  }
  return { ...result, homeMs, spawnEpoch, endEpoch, firstStdoutEpoch, tries, wallMs: Number(process.hrtime.bigint() - t0) / 1e6, bwrapArgs: args.filter((a) => !a.startsWith(runHome)) };
}
