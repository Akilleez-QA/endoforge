// Load a JOB manifest with the proofs the tools made (<job>.proofs.json beside it) merged in, and run the machine
// health check. Kept out of bin/job.mjs so other tools (the Conductor, fan-out) can import it without importing a CLI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const proofsFile = (f) => f.replace(/\.json$/, '') + '.proofs.json';
export function loadJob(f) {
  const job = JSON.parse(fs.readFileSync(f, 'utf8'));
  const pf = proofsFile(f);
  if (fs.existsSync(pf)) {
    const p = JSON.parse(fs.readFileSync(pf, 'utf8'));
    job.proofs = { ...job.proofs, ...p, calibration: { ...job.proofs?.calibration, ...p.calibration } };
  }
  return job;
}
/** Machine health before the wide launch (FMEA: machine overload, detection). Exit 0 means healthy. */
export function health(job) {
  const argv = job.resources?.health ?? [path.join(os.homedir(), '.local/bin/system-safety-status')];
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 ? { ok: true } : { ok: false, why: `${argv.join(' ')} exited ${r.status ?? r.error?.code} ${(r.stderr || r.stdout || '').trim().split('\n').at(-1) ?? ''}`.trim() };
}
