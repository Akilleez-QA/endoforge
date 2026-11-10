import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate } from '../../job/lib/validate.mjs';
import { health } from '../../job/lib/load.mjs';
import { compileAtom } from '../../job/lib/compile.mjs';
import { retrieveLessons } from '../../job/lib/lessons.mjs';
import { emit, firedEvent } from '../../job/lib/events.mjs';
import { allSettled } from './state.mjs';
import { assignLogins, slotsFree, launchAtom, laneExit, stopLanes, LOST } from './launch.mjs';
import { collectAtom, gateFeedback, collectLock } from './collect.mjs';
import { withLock } from '../../lib/lock.mjs';
import { escalate } from './daemon.mjs';
import { checkAtom as sliceCheck } from './checks.mjs';

const promptFor = (job, id, st, note) => compileAtom(job, id, { lessons: retrieveLessons(job), round: st.iter + 1, note: note ?? st.feedback ?? '' });

const imagesFor = (job, id) => { const a = job.atoms.find((x) => x.id === id); return (job.references ?? []).filter((r) => (a.references ?? []).includes(r.id)).flatMap((r) => r.thumbnails ?? []); };

function launchPending(ctx) {
  const { job, file } = ctx, started = [];
  const plan = ctx.update((s) => assignLogins(job, s));
  if (plan.awaitingGo) return started;
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

export async function settleAtom(ctx, id, checkAtom = sliceCheck) {
  const { job, file } = ctx, st = ctx.update(() => {}).atoms[id], exit = laneExit(st);
  if (exit !== 0) return relaunchOrEscalate(ctx, id, exit === LOST ? `the worker ended with no recorded exit code; see ${st.lane.log}` : `the worker exited ${exit}; see ${st.lane.log}`, { stage: 'worker', exit });
  const g = collectAtom(job, file, st, id);
  if (!st.lane.adopted) spawnSync('git', ['-C', job.repo, 'worktree', 'remove', '--force', st.lane.worktree], { stdio: 'ignore' });
  if (g.status === 'reverted') return relaunchOrEscalate(ctx, id, gateFeedback(g), { stage: g.stage, error: g.error });
  ctx.update((s) => { const a = s.atoms[id]; a.status = 'checking'; a.sha = g.sha ?? null; if (g.added?.length) a.added = [...new Set([...(a.added ?? []), ...g.added])]; });
  return judge(ctx, id, checkAtom);
}

const upstream = (job, s, id) => Object.fromEntries(((job.atoms ?? []).find((a) => a.id === id)?.dependsOn ?? []).map((d) => [d, s.atoms[d]?.sha ?? null]));

export async function judge(ctx, id, checkAtom = sliceCheck) {
  const { job, file } = ctx, st = ctx.update(() => {}).atoms[id], g = { sha: st.sha };
  const verdict = await checkAtom(ctx, id);
  if (verdict.unstable) escalate(job, file, { to: 'coordinator', key: `unstable:${verdict.unstable.join(',')}`, why: `check ${verdict.unstable.join(', ')} is unstable (${verdict.why}); fix or recalibrate it`, packet: { checks: verdict.unstable, why: verdict.why, atom: id } });
  if (verdict.unscored) {
    const s = ctx.update((x) => { const a = x.atoms[id]; a.status = 'landed'; a.unscored = (a.unscored ?? 0) + 1; a.last = `not scored: ${verdict.why}`; });
    if (!verdict.unstable && s.atoms[id].unscored >= (job.conductor?.maxUnscored ?? 3)) escalate(job, file, { to: 'coordinator', key: `unscored:${id}:i${st.iter}`, atom: id, why: `its checks could not run ${s.atoms[id].unscored} times: ${verdict.why}`, packet: { atom: id, why: verdict.why } });
    return;
  }
  const record = (x) => { const a = x.atoms[id]; a.items = { ...a.items, ...(verdict.items ?? {}) }; a.checkedAgainst = upstream(job, x, id); a.unscored = 0; };
  if (verdict.pass) {
    ctx.update((s) => { record(s); Object.assign(s.atoms[id], { status: 'frozen', last: verdict.why, feedback: null }); s.atoms[id].history.push({ iter: st.iter, pass: true, sha: g.sha ?? null }); });
    emit(job, file, { kind: 'GATE', summary: `${id} frozen at iteration ${st.iter}: ${verdict.why}`, data: { atom: id, iter: st.iter, pass: true } });
    traceNeeded(ctx, id);
    return;
  }
  let feedback = verdict.feedback;
  if (verdict.regressed?.length && !verdict.improved?.length && g.sha) {
    const r = withLock(collectLock(job), () => spawnSync('git', ['-C', job.repo, 'revert', '--no-edit', g.sha], { encoding: 'utf8' }));
    if (r.status === 0) feedback = `Your change was REVERTED: it regressed ${verdict.regressed.join('; ')} and improved nothing.\n${feedback}`;
    else { spawnSync('git', ['-C', job.repo, 'revert', '--abort'], { stdio: 'ignore' }); feedback = `Your change regressed ${verdict.regressed.join('; ')} (it could not be reverted cleanly; restore them).\n${feedback}`; }
  } else ctx.update(record);
  return relaunchOrEscalate(ctx, id, feedback, { stage: 'check', findings: verdict.findings, failing: failingSignature(verdict) });
}

export const isTestFile = (p) => { const b = path.posix.basename(p); return /^test_.+\.(py|mjs|cjs|js|ts|sh)$/.test(b) || /.+_test\.py$/.test(b) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(b); };

function traceNeeded(ctx, id) {
  const { job, file } = ctx, a = ctx.update(() => {}).atoms[id], told = new Set(a.traceNotified ?? []);
  const tests = (a.added ?? []).filter((p) => isTestFile(p) && !told.has(p) && spawnSync('git', ['-C', job.repo, 'cat-file', '-e', `HEAD:${p}`], { stdio: 'ignore' }).status === 0).sort();
  if (!tests.length) return;
  ctx.update((s) => { s.atoms[id].traceNotified = [...told, ...tests]; });
  emit(job, file, { kind: 'NEEDS-COORDINATOR', summary: `TRACE-NEEDED ${id}: new test files ${tests.join(', ')}`,
    detail: `${id} froze with new test files. Add their trace rows (verification matrix or a supporting entry, and Makefile reach) before other atoms' checks run them:\n${tests.map((t) => `- ${t}`).join('\n')}`,
    data: { event: 'TRACE-NEEDED', atom: id, iter: a.iter, sha: a.sha ?? null, tests } });
}

const failingSignature = (v) => (v.findings ?? []).map((f) => `${f.id}:${Object.entries(f.items ?? {}).filter(([, p]) => !p).map(([n]) => n).sort().join('|')}`).sort().join(';');

function relaunchOrEscalate(ctx, id, feedback, evidence) {
  const { job, file } = ctx;
  const sig = evidence.failing ?? `${evidence.stage}:${String(evidence.error ?? evidence.exit ?? '').split('\n').filter(Boolean).at(-1) ?? ''}`;
  const s = ctx.update((st) => { const a = st.atoms[id]; const prev = a.history.filter((h) => !h.pass).at(-1);
    a.history.push({ iter: a.iter, pass: false, ...evidence, signature: sig }); a.feedback = feedback; a.last = String(feedback).split('\n')[0].slice(0, 160);
    a.repeated = Boolean(prev && prev.signature === sig && sig);
    a.status = a.repeated || a.iter - (a.iterBase ?? 0) >= st.budget.maxIterations ? 'needs-coordinator' : 'relaunch'; });
  const a = s.atoms[id];
  if (a.status === 'needs-coordinator')
    escalate(job, file, { to: 'coordinator', key: `atom:${id}:i${a.iter}`, atom: id, why: a.repeated ? `failed the same way twice (${sig}): ${a.last}` : `still failing after ${a.iter} iterations: ${a.last}`, packet: { atom: id, iter: a.iter, history: a.history, feedback } });
}

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
    return null;
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
      else if (st.status === 'frozen' && st.checkedAgainst && JSON.stringify(upstream(ctx.job, ctx.state, id)) !== JSON.stringify(st.checkedAgainst)) {
        ctx.update((s) => { s.atoms[id].status = 'checking'; s.atoms[id].last = `re-check: upstream changed (${Object.keys(st.checkedAgainst).join(', ')})`; });
        start(ctx, id, () => judge(ctx, id));
      }
    }
    launchPending(ctx);
    return allSettled(ctx.update(() => {})) && !inFlight.size ? { advance: true, why: 'every atom frozen or locked' } : null;
  },
  onStop: (ctx) => ctx.update ? ctx.update((s) => stopLanes(s)) : null,
};
