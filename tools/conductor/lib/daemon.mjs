import fs from 'node:fs';
import { loadState, updateState, transition, nextPhase, stateFile, allSettled } from './state.mjs';
import { emit } from '../../job/lib/events.mjs';
import { writePacket } from './escalate.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function escalate(job, file, { to, key, atom = null, why, packet = null }) {
  let fresh = false;
  updateState(job, file, (s) => {
    if (s.escalations.some((e) => e.key === key && !e.resolved)) return;
    s.escalations.push({ key, to, atom, why, packet, at: new Date().toISOString(), resolved: false }); fresh = true;
    if (atom && to === 'coordinator' && s.atoms[atom]) s.atoms[atom].status = 'needs-coordinator';
  });
  if (!fresh) return false;
  const packetFile = to === 'coordinator' ? writePacket(job, file, { key, atom, why, packet }) : null;
  emit(job, file, { kind: to === 'coordinator' ? 'NEEDS-COORDINATOR' : 'NEEDS-YOU', summary: `${atom ? `${atom}: ` : ''}${why}`, detail: packetFile ? `Packet: ${packetFile}` : '', data: { key, atom, packet: packetFile ?? packet } });
  return fresh;
}

export const BASE_HANDLERS = {
  staged: () => null,
  gates: (ctx) => (allSettled(ctx.state) ? { advance: true, why: 'every atom frozen or locked' } : null),
  locks: (ctx) => {
    const need = (ctx.job.conductor?.locks ?? []).filter((a) => ctx.state.atoms[a]?.status !== 'locked');
    if (!need.length) return { advance: true, why: 'taste locks in place' };
    escalate(ctx.job, ctx.file, { to: 'you', key: `locks:${need.join(',')}`, why: `taste lock needed for ${need.join(', ')} (endoforge job lock <job> <atom>)` });
    return null;
  },
};

export async function conduct(file, { load, handlers = {}, tickMs = 5000, maxTicks = Infinity, wait = sleep } = {}) {
  const table = { ...BASE_HANDLERS, ...handlers };
  for (let tick = 0; tick < maxTicks;) {
    const job = load(file);
    if (!fs.existsSync(stateFile(job, file))) updateState(job, file, () => {});
    let s = loadState(job, file);
    if (s.phase === 'done') return s;
    if (s.stopped) {
      await table.onStop?.({ job, file, state: s, update: (fn) => updateState(job, file, fn) });
      s = updateState(job, file, (st) => transition(st, job, 'done', `stopped by ${st.stopped.by}`));
      emit(job, file, { kind: 'DONE', summary: `stopped by ${s.stopped.by}: ${s.stopped.why}`, data: { stopped: s.stopped } });
      return s;
    }
    if (!s.paused) {
      const h = table[s.phase];
      if (!h) escalate(job, file, { to: 'coordinator', key: `no-handler:${s.phase}`, why: `the conductor has no handler for phase ${s.phase}` });
      else {
        const r = await h({ job, file, state: s, update: (fn) => updateState(job, file, fn) });
        if (r?.advance) {
          s = updateState(job, file, (st) => transition(st, job, nextPhase(st.phase, job), r.why));
          if (s.phase === 'done') { emit(job, file, { kind: 'DONE', summary: `${job.title ?? job.id} done`, data: { atoms: s.atoms } }); return s; }
          continue;
        }
      }
    }
    if (++tick < maxTicks) await wait(tickMs);
  }
  return loadState(load(file), file);
}
