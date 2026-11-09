import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNNER = fileURLToPath(new URL('../bin/run-atoms.mjs', import.meta.url));
export const TOOL_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const defaultRunner = () => [process.execPath, RUNNER];

export function campaignPolicy(policy, c) {
  const roots = [...(policy.bindRoots ?? []), path.resolve(c.workdir), TOOL_DIR, ...(c.repo ? [path.resolve(c.repo)] : [])];
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
