// Phase handlers: the mechanism the daemon runs: go (the gates to Orchestrate), smoke, fired (compiled prompts on
// every login, under the dial and the budget) and streaming. Streaming has no barrier: each landed atom runs its own
// collect gate → slice render → checks → freeze or relaunch as a task, several at once (conductor.checkConcurrency),
// while the daemon keeps launching and collecting the others. A daemon restart resumes atoms mid-check.
import { spawnSync } from 'node:child_process';
import { validate } from '../../job/lib/validate.mjs';
import { health } from '../../job/lib/load.mjs';
import { compileAtom } from '../../job/lib/compile.mjs';
import { retrieveLessons } from '../../job/lib/lessons.mjs';
import { emit, firedEvent } from '../../job/lib/events.mjs';
import { allSettled } from './state.mjs';
import { assignLogins, slotsFree, launchAtom, laneExit, stopLanes } from './launch.mjs';
import { collectAtom, gateFeedback } from './collect.mjs';
import { escalate } from './daemon.mjs';
import { checkAtom as sliceCheck } from './checks.mjs';

const promptFor = (job, id, st, note) => compileAtom(job, id, { lessons: retrieveLessons(job), round: st.iter + 1, note: note ?? st.feedback ?? '' });

/** The images an atom's worker is given: the thumbnails of the references that govern it. */
const imagesFor = (job, id) => { const a = job.atoms.find((x) => x.id === id); return (job.references ?? []).filter((r) => (a.references ?? []).includes(r.id)).flatMap((r) => r.thumbnails ?? []); };

/** Start pending and relaunch-ready atoms while slots and budget allow. The plan is made under the state lock; the
 *  slow part (worktree, spawn) runs outside it, and each launch is recorded under the lock as it happens. */
function launchPending(ctx) {
  const { job, file } = ctx, started = [];
  const plan = ctx.update((s) => assignLogins(job, s));
  const ids = Object.entries(plan.atoms).filter(([, st]) => ['pending', 'relaunch'].includes(st.status)).map(([id]) => id).slice(0, slotsFree(job, plan));
  for (const id of ids) {
    const cur = ctx.update(() => {});
    const scratch = { atoms: { [id]: structuredClone(cur.atoms[id]) }, budget: { ...cur.budget } };
    const r = launchAtom(job, file, scratch, id, { prompt: promptFor(job, id, scratch.atoms[id]), images: imagesFor(job, id) });
    if (r.refused) { escalate(job, file, { to: 'you', key: 'budget', why: `the launch budget (${cur.budget.maxLaunches}) is spent; raise it with endoforge job budget` }); break; }
    ctx.update((s) => { s.atoms[id] = scratch.atoms[id]; s.budget.launches++; });
    started.push({ id, engine: scratch.atoms[id].lane.engine, account: scratch.atoms[id].lane.account });
  }
  return started;
}

/** One atom has landed: run the collect gate, then its checks (stage 3), then freeze it or relaunch it. */
export async function settleAtom(ctx, id, checkAtom = sliceCheck) {
  const { job, file } = ctx, st = ctx.update(() => {}).atoms[id], exit = laneExit(st);
  if (exit !== 0) return relaunchOrEscalate(ctx, id, `the worker exited ${exit}; see ${st.lane.log}`, { stage: 'worker', exit });
  const g = collectAtom(job, file, st, id);
  spawnSync('git', ['-C', job.repo, 'worktree', 'remove', '--force', st.lane.worktree], { stdio: 'ignore' });   // collected: the lane's copy goes
  if (g.status === 'reverted') return relaunchOrEscalate(ctx, id, gateFeedback(g), { stage: g.stage, error: g.error });
  ctx.update((s) => { s.atoms[id].status = 'checking'; s.atoms[id].sha = g.sha ?? null; });
  return judge(ctx, id, checkAtom);
}

/** Run the atom's checks and act on the verdict. Also resumes an atom that was mid-check when the daemon stopped. */
export async function judge(ctx, id, checkAtom = sliceCheck) {
  const { job, file } = ctx, st = ctx.update(() => {}).atoms[id], g = { sha: st.sha };
  const verdict = await checkAtom(ctx, id);
  if (verdict.unscored) {
    const s = ctx.update((x) => { const a = x.atoms[id]; a.status = 'landed'; a.unscored = (a.unscored ?? 0) + 1; a.last = `not scored: ${verdict.why}`; });
    if (s.atoms[id].unscored >= (job.conductor?.maxUnscored ?? 3)) escalate(job, file, { to: 'coordinator', key: `unscored:${id}:i${st.iter}`, atom: id, why: `its checks could not run ${s.atoms[id].unscored} times: ${verdict.why}`, packet: { atom: id, why: verdict.why } });
    return;
  }
  if (verdict.pass) {
    ctx.update((s) => { Object.assign(s.atoms[id], { status: 'frozen', last: verdict.why, feedback: null }); s.atoms[id].history.push({ iter: st.iter, pass: true, sha: g.sha ?? null }); });
    emit(job, file, { kind: 'GATE', summary: `${id} frozen at iteration ${st.iter}: ${verdict.why}`, data: { atom: id, iter: st.iter, pass: true } });
    return;
  }
  return relaunchOrEscalate(ctx, id, verdict.feedback, { stage: 'check', findings: verdict.findings });
}

function relaunchOrEscalate(ctx, id, feedback, evidence) {
  const { job, file } = ctx;
  const s = ctx.update((st) => { const a = st.atoms[id]; a.history.push({ iter: a.iter, pass: false, ...evidence }); a.feedback = feedback; a.last = String(feedback).split('\n')[0].slice(0, 160);
    a.status = a.iter >= st.budget.maxIterations ? 'needs-coordinator' : 'relaunch'; });
  const a = s.atoms[id];
  if (a.status === 'needs-coordinator')
    escalate(job, file, { to: 'coordinator', key: `atom:${id}:i${a.iter}`, atom: id, why: `still failing after ${a.iter} iterations: ${a.last}`, packet: { atom: id, iter: a.iter, history: a.history, feedback } });
}

/** Atoms being collected or checked by this daemon process (in memory; a restart resumes them from their status). */
const inFlight = new Map();
function start(ctx, id, task) {
  inFlight.set(id, task().catch((e) => {
    if (e.name === 'StopError') ctx.update((s) => { s.stopped = { by: 'conductor', why: e.message, at: new Date().toISOString() }; });
    else escalate(ctx.job, ctx.file, { to: 'coordinator', key: `error:${id}:${e.message.slice(0, 60)}`, atom: id, why: `the conductor failed on it: ${e.message}` });
  }).finally(() => inFlight.delete(id)));
}
export const idle = () => Promise.all(inFlight.values());

export const handlers = {
  go: (ctx) => {
    const v = validate(ctx.job, { gate: 'orchestrate', health: health(ctx.job) });
    if (v.ok) return { advance: true, why: 'every gate to Orchestrate passed' };
    const blocking = v.errors.filter((e) => !(e.inv === 'I8' && /health refuses/.test(e.msg)));
    if (blocking.length) escalate(ctx.job, ctx.file, { to: 'coordinator', key: `gates:${blocking.map((e) => e.inv).join(',')}`, why: `the job does not pass its gates: ${blocking.map((e) => `${e.gate} ${e.inv}: ${e.msg}`).join('; ')}`, packet: { errors: blocking } });
    return null;                                                 // machine health is transient: wait
  },
  smoke: (ctx) => {
    const sm = ctx.job.proofs?.smoke;
    emit(ctx.job, ctx.file, { kind: 'SMOKE', summary: Object.entries(sm?.engines ?? {}).map(([e, x]) => `${e} ${x ? 'ok' : 'FAILED'}`).join(', '), data: sm });
    return { advance: true, why: `smoke receipt ${sm?.receipt}` };
  },
  fired: (ctx) => {
    const started = launchPending(ctx);
    emit(ctx.job, ctx.file, firedEvent(ctx.job, started, 'compiled per launch; see conductor/prompts'));
    return { advance: true, why: `${started.length} atoms launched` };
  },
  streaming: (ctx) => {
    const limit = ctx.job.conductor?.checkConcurrency ?? 4;
    for (const [id, st] of Object.entries(ctx.state.atoms)) {
      if (inFlight.has(id) || inFlight.size >= limit) continue;
      if (st.status === 'launched' && laneExit(st) != null) start(ctx, id, () => settleAtom(ctx, id));
      else if (st.status === 'checking' || (st.status === 'landed' && (st.unscored ?? 0) < (ctx.job.conductor?.maxUnscored ?? 3))) start(ctx, id, () => judge(ctx, id));
    }
    launchPending(ctx);
    return allSettled(ctx.update(() => {})) && !inFlight.size ? { advance: true, why: 'every atom frozen or locked' } : null;
  },
  onStop: (ctx) => ctx.update ? ctx.update((s) => stopLanes(s)) : null,
};
