import fs from 'node:fs';
import path from 'node:path';
import { withLock, writeJSONAtomic } from '../../lib/lock.mjs';
import { validate } from '../../job/lib/validate.mjs';
import { cardHash } from '../../job/lib/card.mjs';
import { loadJob } from '../../job/lib/load.mjs';
import { emit } from '../../job/lib/events.mjs';
import { stateDir, updateState, loadState, reopen, reopens } from './state.mjs';

export function writePacket(job, file, esc) {
  const s = loadState(job, file), a = esc.atom ? (job.atoms ?? []).find((x) => x.id === esc.atom) : null, st = esc.atom ? s.atoms[esc.atom] : null;
  const dir = stateDir(job, file), p = path.join(dir, 'escalations', `${esc.key.replace(/[^\w.-]+/g, '_')}.json`);
  writeJSONAtomic(p, {
    key: esc.key, why: esc.why, job: { id: job.id, title: job.title, kind: job.kind, goal: job.goal?.verbatim, phase: s.phase },
    atom: a && { id: a.id, files: a.files, contract: a.contract ?? null, capabilities: a.capabilities ?? [], aspects: a.aspects ?? [],
      owes: (job.criteria ?? []).filter((c) => (c.satisfiedBy ?? []).includes(a.id)).map((c) => ({ id: c.id, statement: c.statement, requires: c.requires ?? [] })),
      status: st?.status, iter: st?.iter, history: (st?.history ?? []).slice(-3), feedback: st?.feedback ?? null,
      lastPrompt: st?.lane?.prompt ?? null, lastGate: st?.iter ? path.join(dir, 'gates', `${a.id}-i${st.iter}.gate.json`) : null,
      lastVerdict: st?.iter ? path.join(dir, 'slices', a.id, `i${st.iter}`, 'verdict.json') : null },
    budget: s.budget, evidence: esc.packet ?? null,
    reply: `endoforge job patch ${file} <patch.json> with {"key": "${esc.key}", "manifest": {…merge patch…}, "note": "…", "relaunch": [${esc.atom ? `"${esc.atom}"` : ''}], "resetIterations": true}`,
  });
  return p;
}

export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v); }
  return out;
}

export function applyPatch(file, reply, { offline = false } = {}) {
  return withLock(file, () => {
    const before = JSON.parse(fs.readFileSync(file, 'utf8')), job0 = loadJob(file);
    const next = reply.manifest ? mergePatch(before, reply.manifest) : before;
    const job1 = { ...next, proofs: job0.proofs };
    const v = validate(job1, { gate: 'decide', offline, confirmation: { ok: true } });
    if (!v.ok) return { ok: false, why: `the patch breaks the gates: ${v.errors.map((e) => `${e.gate} ${e.inv}: ${e.msg}`).join('; ')}` };
    const relaunch = reply.relaunch ?? [], s0 = loadState(job0, file);
    if (relaunch.length && s0.stopped) return { ok: false, why: `the job was stopped by ${s0.stopped.by} (${s0.stopped.why}); a relaunch does not reopen it behind the stop` };
    if (reply.manifest) writeJSONAtomic(file, next);
    const changed = cardHash(job1) !== cardHash(job0);
    let reopened = null;
    updateState(job1, file, (s) => {
      for (const e of s.escalations) if (e.key === reply.key) Object.assign(e, { resolved: true, resolvedAt: new Date().toISOString(), reply: { note: reply.note ?? null, changed } });
      for (const id of relaunch) {
        if (!s.atoms[id]) s.atoms[id] = { status: 'pending', iter: 0, history: [] };
        Object.assign(s.atoms[id], { status: 'relaunch', feedback: [reply.note, s.atoms[id].feedback].filter(Boolean).join('\n\n') });
        if (reply.resetIterations) s.atoms[id].iterBase = s.atoms[id].iter;
      }
      for (const a of job1.atoms ?? []) if (!s.atoms[a.id]) s.atoms[a.id] = { status: 'pending', iter: 0, history: [] };
      if (relaunch.length && reopens(s)) { reopened = s.phase; reopen(s, job1, `relaunch of ${relaunch.join(', ')} by the coordinator (${reply.key})`); }
      if (changed) s.awaitingGo = { since: new Date().toISOString(), cardSha256: cardHash(job1), why: `the coordinator changed the card (${reply.key})` };
    });
    if (changed) emit(job1, file, { kind: 'NEEDS-YOU', summary: `the job card changed (${reply.key}): review it and give a new go; launches are held until then`, data: { key: reply.key, cardSha256: cardHash(job1) } });
    if (reopened) emit(job1, file, { kind: 'GATE', summary: `${job1.title ?? job1.id} reopened from ${reopened} to streaming to relaunch ${relaunch.join(', ')} (${reply.key})${reopened === 'done' ? `; the conductor had ended: start it again with endoforge conduct ${file}` : ''}`, data: { gate: 'reopen', from: reopened, atoms: relaunch, key: reply.key } });
    return { ok: true, holdForGo: changed, reopened: Boolean(reopened) };
  });
}
