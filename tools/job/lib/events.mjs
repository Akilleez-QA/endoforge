// event to the user").
//   STAGED     the card is ready; the user confirms it with one go
//   FIRED      atoms launched: who runs what, the compiled-prompt hash, predictions, gates, ETA, how to stop
//   SMOKE      the one-atom-per-engine smoke result
//   SCORED     a round's score deltas
//   GATE       a gate passed or failed
//   NEEDS-YOU  a decision blocks the critical path (authority only: card go, taste locks, spend, outward actions)
//   NEEDS-COORDINATOR  judgment the Conductor cannot make (an atom still failing after its iterations, a contract that
//              cannot express a criterion, a check at odds with its calibration, a new failure); goes to the model
//   DONE       the job finished
// Channels: the durable log (events.jsonl + EVENTS.md beside the manifest, or job.events.dir), a desktop
// notification (notify-send; ENDOFORGE_NOTIFY=none turns it off), hooks that get every event (job.events.hooks,
// ENDOFORGE_EVENT_HOOKS) and push hooks that get only FIRED, GATE, NEEDS-YOU and DONE (job.events.push,
// ENDOFORGE_PUSH_HOOKS): phones never buzz for routine progress. NEEDS-COORDINATOR goes only to coordinator hooks
// (job.events.coordinator, ENDOFORGE_COORDINATOR_HOOKS), which wake the model. Each hook gets the event as JSON on stdin.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cardHash } from './card.mjs';

export const EVENT_KINDS = ['STAGED', 'FIRED', 'SMOKE', 'SCORED', 'GATE', 'NEEDS-YOU', 'NEEDS-COORDINATOR', 'DONE'];
export const PUSH_KINDS = ['FIRED', 'GATE', 'NEEDS-YOU', 'DONE'];
export const eventsDir = (job, file) => job.events?.dir ?? path.dirname(path.resolve(file));
export function readEvents(job, file) {
  try { return fs.readFileSync(path.join(eventsDir(job, file), 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
const hooksFrom = (list, env) => [...(list ?? []).map((h) => (Array.isArray(h) ? h : [h])), ...(env ? env.split(':').filter(Boolean).map((h) => [h]) : [])];

/** Append the event to the durable log first, then deliver it. A failed delivery is logged, never fatal. */
export function emit(job, file, { kind, summary, detail = '', data = {} }, { env = process.env } = {}) {
  if (!EVENT_KINDS.includes(kind)) throw new Error(`unknown event kind ${kind} (${EVENT_KINDS.join(', ')})`);
  const dir = eventsDir(job, file); fs.mkdirSync(dir, { recursive: true });
  const ev = { ts: new Date().toISOString(), job: job.id, kind, summary, detail, data, push: PUSH_KINDS.includes(kind) };
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(ev) + '\n');
  const md = path.join(dir, 'EVENTS.md');
  if (!fs.existsSync(md)) fs.writeFileSync(md, `# ${job.title ?? job.id}: job events\n`);
  fs.appendFileSync(md, `\n### ${ev.ts.slice(11, 19)} · ${kind} · ${summary}\n${detail}\n`);
  const failed = [];
  if (env.ENDOFORGE_NOTIFY !== 'none') {
    const r = spawnSync('notify-send', ['-u', kind === 'NEEDS-YOU' ? 'critical' : 'normal', '-a', 'Endoforge', `Endoforge ${kind}`, summary], { stdio: 'ignore', timeout: 5000 });
    if (r.status !== 0) failed.push('desktop');
  }
  const hooks = [...hooksFrom(job.events?.hooks, env.ENDOFORGE_EVENT_HOOKS), ...(ev.push ? hooksFrom(job.events?.push, env.ENDOFORGE_PUSH_HOOKS) : []),
    ...(kind === 'NEEDS-COORDINATOR' ? hooksFrom(job.events?.coordinator, env.ENDOFORGE_COORDINATOR_HOOKS) : [])];
  for (const h of hooks) {
    const r = spawnSync(h[0], h.slice(1), { input: JSON.stringify(ev), stdio: ['pipe', 'ignore', 'ignore'], timeout: 10_000, env: { ...env, ENDOFORGE_EVENT_KIND: kind, ENDOFORGE_EVENT_PUSH: ev.push ? '1' : '0' } });
    if (r.status !== 0) failed.push(h[0]);
  }
  if (failed.length) fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), job: job.id, kind: 'DELIVERY-FAILED', of: kind, channels: failed }) + '\n');
  return ev;
}

/** May this job fire? Only after a STAGED event for the current card, and the user's own go on that card after it was
 *  staged (I1, I11). Returns { ok } or { ok: false, why }. */
export function canFire(job, file) {
  const sha = cardHash(job), staged = readEvents(job, file).filter((e) => e.kind === 'STAGED').at(-1);
  if (!staged) return { ok: false, why: 'the card was never staged (job.mjs stage): the user has not seen it' };
  if (staged.data?.cardSha256 !== sha) return { ok: false, why: 'the job changed after its card was staged; stage it again' };
  const c = job.proofs?.confirmed ?? job.confirmed;
  if (!c || c.via !== 'direct' || c.cardSha256 !== sha) return { ok: false, why: 'no direct go from the user on the staged card' };
  if (!c.at || Date.parse(c.at) < Date.parse(staged.ts)) return { ok: false, why: 'the go predates the staged card; the user must confirm the card they were shown' };
  return { ok: true };
}

/** The FIRED event: who runs what, the prompt-set hash, predictions, gates, ETA and how to stop. */
export function firedEvent(job, lanes, promptManifest) {
  const by = {}; for (const l of lanes) (by[l.engine] ??= []).push(l);
  const logins = [...new Set(lanes.map((l) => `${l.engine}:${l.account}`))];
  const stop = job.events?.stop ?? 'worker drain (or stop the lane units)';
  const gates = [...(job.criteria ?? []).map((c) => `${c.id} ${c.check?.kind ?? '?'}`), ...(job.gates ?? []).map((g) => `${g.id} (${g.who})`)];
  return { kind: 'FIRED', summary: `${job.title ?? job.id} fired: ${lanes.length} atoms; ${Object.entries(by).map(([e, l]) => `${l.length} ${e}`).join(', ')} across ${logins.length} logins`,
    detail: [`- **Atoms:** ${lanes.map((l) => `${l.id} (${l.engine}:${l.account})`).join(', ')}; critical path ${job.criticalPath}`,
      `- **Prompts:** compiled, manifest ${promptManifest.slice(0, 12)}`, `- **Predictions:** ${(job.predictions ?? []).join('; ') || 'none recorded'}`,
      `- **Gates:** ${gates.join(', ')}`, `- **ETA:** ${job.eta ?? 'not estimated'}`, `- **Stop:** ${stop}`].join('\n'),
    data: { atoms: lanes, logins, promptManifest, predictions: job.predictions ?? [], gates, eta: job.eta ?? null, stop, cardSha256: cardHash(job) } };
}

/** The live timeline for `endoforge job status`. */
export function renderStatus(job, events) {
  const real = events.filter((e) => EVENT_KINDS.includes(e.kind));
  const L = [`${job.title ?? job.id} (${job.kind}): ${real.length} events`];
  for (const e of real) L.push(`${e.ts.slice(11, 19)}  ${e.push ? '*' : ' '} ${e.kind.padEnd(9)} ${e.summary}`);
  const last = real.at(-1), fired = real.filter((e) => e.kind === 'FIRED').at(-1), scored = real.filter((e) => e.kind === 'SCORED').at(-1);
  const blocking = real.findLastIndex((e) => e.kind === 'NEEDS-YOU') > real.findLastIndex((e) => ['GATE', 'DONE', 'FIRED'].includes(e.kind));
  L.push('', `state: ${last ? last.kind : 'not staged'}${fired ? `; ${fired.data?.atoms?.length ?? '?'} atoms fired at ${fired.ts.slice(11, 19)}` : ''}${scored ? `; last score ${scored.summary}` : ''}`);
  if (blocking) L.push(`NEEDS YOU: ${real.filter((e) => e.kind === 'NEEDS-YOU').at(-1).summary}`);
  const failed = events.filter((e) => e.kind === 'DELIVERY-FAILED');
  if (failed.length) L.push(`${failed.length} deliveries failed (${[...new Set(failed.flatMap((f) => f.channels))].join(', ')})`);
  L.push('(* = pushed to phone hooks)');
  return L.join('\n') + '\n';
}
