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
export function health(job) {
  const argv = job.resources?.health ?? [path.join(os.homedir(), '.local/bin/system-safety-status')];
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 ? { ok: true } : { ok: false, why: `${argv.join(' ')} exited ${r.status ?? r.error?.code} ${(r.stderr || r.stdout || '').trim().split('\n').at(-1) ?? ''}`.trim() };
}
