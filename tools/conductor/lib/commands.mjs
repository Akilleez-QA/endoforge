// The user's and the coordinator's handles on a running job: status | go | lock | pause | resume | budget | stop.
// Each command changes the durable state under its lock; the daemon reads it every tick. Authority commands (go,
// lock, a budget raise) need the user's own words, directly; a relayed one is refused (I1, I11).
import fs from 'node:fs';
import { loadState, updateState, transition, PHASES } from './state.mjs';
import { emit, canFire, readEvents, renderStatus } from '../../job/lib/events.mjs';
import { cardHash } from '../../job/lib/card.mjs';
import { writeJSONAtomic } from '../../lib/lock.mjs';

const proofsFile = (f) => f.replace(/\.json$/, '') + '.proofs.json';
function direct(o) {
  if (!o.by || !o.words) throw new Error('needs --by and --words (the user\'s own words)');
  if ((o.via ?? 'direct') !== 'direct') throw new Error('a relayed approval never counts (I11); the user gives it directly');
}

export function status(job, file) {
  const s = loadState(job, file), counts = {};
  for (const a of Object.values(s.atoms)) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const L = [`conductor: ${job.title ?? job.id} — phase ${s.phase}${s.paused ? ' (PAUSED)' : ''}${s.stopped ? ` (stopped by ${s.stopped.by})` : ''}`,
    `budget: ${s.budget.launches}/${s.budget.maxLaunches} launches, ${s.budget.maxIterations} iterations per atom`,
    `atoms: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`];
  for (const [id, a] of Object.entries(s.atoms)) L.push(`  ${id.padEnd(10)} ${a.status.padEnd(17)} iter ${a.iter}${a.lockedBy ? ` locked by ${a.lockedBy}` : ''}${a.last ? `  ${a.last}` : ''}`);
  const open = s.escalations.filter((e) => !e.resolved);
  if (open.length) L.push(`open escalations: ${open.map((e) => `${e.to} ${e.atom ?? ''} ${e.why}`).join('; ')}`);
  return L.join('\n') + '\n\n' + renderStatus(job, readEvents(job, file));
}

/** The user's go on the staged card: records the confirmation, then moves staged → go. */
export function go(job, file, o) {
  direct(o);
  const full = cardHash(job);
  if (!o.sha || o.sha.length < 8 || !full.startsWith(o.sha)) throw new Error(`--sha is not this card (${full.slice(0, 12)})`);
  const pf = proofsFile(file), p = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  p.confirmed = { by: o.by, via: 'direct', words: o.words, at: new Date().toISOString(), cardSha256: full };
  writeJSONAtomic(pf, p);
  const may = canFire({ ...job, proofs: { ...job.proofs, ...p } }, file);
  if (!may.ok) throw new Error(`cannot go: ${may.why}`);
  return updateState(job, file, (s) => { s.awaitingGo = null; if (s.phase === 'staged') transition(s, job, 'go', `go from ${o.by}: ${o.words}`); });
}

/** A human taste lock on one atom: it is settled and never relaunched. */
export function lock(job, file, atom, o) {
  direct(o);
  const s = updateState(job, file, (st) => {
    if (!st.atoms[atom]) throw new Error(`no atom ${atom}`);
    Object.assign(st.atoms[atom], { status: 'locked', lockedBy: o.by, lockWords: o.words, lockedAt: new Date().toISOString() });
  });
  emit(job, file, { kind: 'GATE', summary: `${atom} locked by ${o.by}: ${o.words}`, data: { gate: 'lock', atom } });
  return s;
}

export const pause = (job, file, why = 'paused') => updateState(job, file, (s) => { s.paused = { at: new Date().toISOString(), why }; });
export const resume = (job, file) => updateState(job, file, (s) => { s.paused = false; });

/** View or change the budget. Raising it is spend, so it needs the user's words; lowering it does not. */
export function budget(job, file, o = {}) {
  return updateState(job, file, (s) => {
    for (const [k, key] of [['launches', 'maxLaunches'], ['iterations', 'maxIterations']]) {
      if (o[k] == null) continue;
      const n = Number(o[k]);
      if (!(n >= 0)) throw new Error(`--${k} must be a number`);
      if (n > s.budget[key]) direct(o);
      s.budget[key] = n;
    }
  });
}

/** Stop the job: the daemon stops its lanes and ends in done. */
export function stop(job, file, o = {}) {
  const s = updateState(job, file, (st) => { st.stopped = { by: o.by ?? 'unknown', why: o.why ?? 'stopped', at: new Date().toISOString() }; });
  return s;
}

export { PHASES };
