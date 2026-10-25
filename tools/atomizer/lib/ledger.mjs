// Append-only ledger for every atomizer process: one JSON object per line in tools/atomizer/ledger/events.jsonl.
// Never rewritten; corrections are new events that reference the old one. Schema: LEDGER.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveToolchainPath } from './workers.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ATOMIZER = path.resolve(HERE, '..');
export const REPO = path.resolve(ATOMIZER, '../..');
export const LEDGER_DIR = process.env.ATOMIZER_LEDGER_DIR ? path.resolve(process.env.ATOMIZER_LEDGER_DIR) : path.join(ATOMIZER, 'ledger');
export const EVENTS = path.join(LEDGER_DIR, 'events.jsonl');
export const SCHEMA = 'endoforge/atomizer-ledger/1';
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const shaFile = (p) => { try { return sha(fs.readFileSync(p)); } catch { return null; } };
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return null; } };
let CTX = null;
/** Process context, captured once: code, rules and machine state the measurement depends on. */
export function context() {
  if (CTX) return CTX;
  const policyPath = path.join(ATOMIZER, 'policy.json');
  const policy = (() => { try { return JSON.parse(fs.readFileSync(policyPath, 'utf8')); } catch { return {}; } })();
  const codeFiles = ['bin/schedule.mjs', 'bin/atomize.mjs', 'bin/verify.mjs', 'bin/fanout.mjs', 'bin/compose-kernel.mjs', 'lib/isolate.mjs', 'lib/workers.mjs', 'lib/augment.mjs', 'lib/validate.mjs', 'lib/dag.mjs', 'lib/ledger.mjs'];
  const code = Object.fromEntries(codeFiles.map((f) => [f, shaFile(path.join(ATOMIZER, f))?.slice(0, 16) ?? null]));
  const version = (name) => { try { return path.basename(resolveToolchainPath(name, policy, REPO)); } catch { return ''; } };
  CTX = {
    schema: SCHEMA,
    pid: process.pid,
    git: { head: sh('git', ['-C', REPO, 'rev-parse', 'HEAD']), dirty: (sh('git', ['-C', REPO, 'status', '--porcelain', '--', 'tools/atomizer']) ?? '').length > 0 },
    policySha256: shaFile(policyPath),
    gateSha256: shaFile(path.join(REPO, policy.toolchain?.gate ?? 'campaigns/x1-spec-study/factory', 'gate.mjs')),
    codeSha16: code,
    versions: { node: process.version, claude: version('claude'), codex: version('codex'), bwrap: sh('bwrap', ['--version']) },
    models: policy.models ?? null,
    host: { hostname: os.hostname(), cpus: os.cpus().length, memTotalGiB: +(os.totalmem() / 2 ** 30).toFixed(1), kernel: os.release() },
  };
  return CTX;
}
/** Machine load right now (the desktop is shared; speed numbers need it next to them). */
export function load() { const [l1, l5, l15] = os.loadavg(); return { load1: +l1.toFixed(2), load5: +l5.toFixed(2), load15: +l15.toFixed(2), memFreeGiB: +(os.freemem() / 2 ** 30).toFixed(1) }; }
export function newId(prefix) { const t = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); return `${prefix}-${t}-${crypto.randomBytes(3).toString('hex')}`; }
/** Append one event. O_APPEND writes of one line are atomic for lines well under the pipe buffer on Linux; long lines are written whole by appendFileSync. */
export function emit(event, fields = {}) {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  const rec = { v: 1, ts: new Date().toISOString(), event, ...fields };
  fs.appendFileSync(EVENTS, JSON.stringify(rec) + '\n');
  return rec;
}
const SECRET = /refresh_token|access_token|sk-ant-|"apiKey"|Bearer [A-Za-z0-9._-]{20,}/;
/** Compress a run directory into ledger/archive/<runId>.tar.zst after a credential scan; returns {path, bytes, sha256} or {refused}. */
export function archiveRun(runDir, runId) {
  const files = []; for (const e of fs.readdirSync(runDir, { withFileTypes: true, recursive: true })) if (e.isFile()) files.push(path.join(e.parentPath ?? e.path, e.name));
  for (const f of files) { let t; try { t = fs.readFileSync(f, 'latin1'); } catch { continue; } if (SECRET.test(t)) return { refused: `credential-like string in ${path.relative(runDir, f)}` }; }
  const out = path.join(LEDGER_DIR, 'archive', `${runId}.tar.zst`); fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('/bin/sh', ['-c', `tar -C "$1" -cf - "$2" | zstd -19 -q -f -o "$3"`, 'sh', path.dirname(runDir), path.basename(runDir), out]);
  return { path: path.relative(REPO, out), bytes: fs.statSync(out).size, sha256: shaFile(out), files: files.length };
}
