// Read-only binds of large trees (an asset checkout, a reference pack) into an atom's isolate.
// An atom may only bind paths under policy.bindRoots; binds are always read-only and never shadow /in, /out, /work or system paths.
import fs from 'node:fs';
import path from 'node:path';
import { expand } from './isolate.mjs';
const RESERVED = ['/in', '/out', '/work', '/tmp', '/proc', '/dev', '/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc'];
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const under = (p, root) => p === root || p.startsWith(root.endsWith('/') ? root : root + '/');
/** Returns { mounts: [{host, guest, mode:'ro'}], errors: [] } for atom.worker.binds. */
export function atomBinds(atom, policy) {
  const mounts = [], errors = [];
  const binds = atom.worker?.binds ?? [];
  if (!Array.isArray(binds)) return { mounts, errors: [`${atom.id}: worker.binds must be a list`] };
  const roots = (policy.bindRoots ?? []).map((r) => real(expand(r))).filter(Boolean);
  for (const [i, b] of binds.entries()) {
    const host = b?.host ? real(expand(b.host)) : null;
    const guest = b?.guest ?? (b?.host ? expand(b.host) : null);
    if (!host) { errors.push(`${atom.id}: binds[${i}] host missing or does not exist: ${JSON.stringify(b?.host)}`); continue; }
    if (!roots.some((r) => under(host, r))) { errors.push(`${atom.id}: binds[${i}] ${host} is outside policy.bindRoots`); continue; }
    if (!path.isAbsolute(guest) || guest.includes('..') || RESERVED.some((r) => under(guest, r))) { errors.push(`${atom.id}: binds[${i}] guest path not allowed: ${guest}`); continue; }
    mounts.push({ host, guest, mode: 'ro' });
  }
  return { mounts, errors };
}
/** Per-atom timeout: worker.timeoutSec, capped by policy.maxAtomTimeoutSec; otherwise the run default. */
export function atomTimeoutMs(atom, policy, fallbackMs) {
  const s = Number(atom.worker?.timeoutSec);
  if (!(s > 0)) return fallbackMs;
  return Math.min(s, Number(policy.maxAtomTimeoutSec) || s) * 1000;
}
