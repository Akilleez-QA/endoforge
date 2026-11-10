import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNNER = fileURLToPath(new URL('../bin/run-atoms.mjs', import.meta.url));
export const TOOL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SOURCE_ROOT = path.resolve(TOOL_DIR, '../..');
export const SOURCE_GUEST = '/hc-src';
export const ENTRY = path.join(TOOL_DIR, 'bin/hillclimb.mjs');

const under = (p, root) => p === root || p.startsWith(root + path.sep);
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+|[^'"`;]*?from\s*)?['"](\.{1,2}\/[^'"]+)['"]/gm;

export function importClosure(entry = ENTRY) {
  const seen = new Set(), queue = [path.resolve(entry)];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    if (!under(f, SOURCE_ROOT)) throw new Error(`${entry} imports ${f}, outside ${SOURCE_ROOT}`);
    seen.add(f);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(STATIC_IMPORT)) queue.push(path.resolve(path.dirname(f), m[1]));
  }
  return [...seen].sort();
}

export const sourceGuest = (host) => path.posix.join(SOURCE_GUEST, path.relative(SOURCE_ROOT, host).split(path.sep).join('/'));
export const SCRIPT_TOOL = sourceGuest(TOOL_DIR);

export function sourceBinds(entry = ENTRY) {
  const outside = importClosure(entry).filter((f) => !under(f, TOOL_DIR));
  return [TOOL_DIR, ...outside].map((host) => ({ host, guest: sourceGuest(host) }));
}

export const defaultRunner = () => [process.execPath, RUNNER];

export function campaignPolicy(policy, c) {
  const roots = [...(policy.bindRoots ?? []), path.resolve(c.workdir), ...sourceBinds().map((b) => b.host), ...(c.repo ? [path.resolve(c.repo)] : [])];
  return { ...policy, bindRoots: [...new Set(roots)] };
}

export function runnerArgv(c, atomsFile, outDir, policyFile) {
  const tail = [atomsFile, '--out', outDir, '--concurrency', String(c.concurrency ?? 3), '--timeout', String(c.runTimeoutSec ?? 14400)];
  return [...(c.runner ?? defaultRunner()), ...tail, '--policy', policyFile];
}

export function scheduleArgv(argv, scheduler) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) a[x.slice(2)] = argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(x);
  }
  if (a._.length !== 1 || typeof a.out !== 'string') return null;
  const out = [process.execPath, scheduler, 'run', path.resolve(a._[0]), '--run-dir', path.join(path.resolve(a.out), 'run')];
  if (a.concurrency != null) out.push('--concurrency', String(a.concurrency));
  if (a.timeout != null) out.push('--timeout-ms', String(Number(a.timeout) * 1000));
  if (typeof a.policy === 'string') out.push('--policy', path.resolve(a.policy));
  return out;
}
