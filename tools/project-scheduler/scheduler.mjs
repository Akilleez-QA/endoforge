// Cross-project fan-out: one bounded batch, disjoint pieces, then a project-local join.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ownershipMap, fleetCapacity, waveSize } from '../hillclimb/lib/fanout.mjs';
import { headroom } from '../throttle/throttle.mjs';

export const PROJECTS = { abi: 1, reta: 5, campus: 5, 'service-forward': 5 };
const queue = fileURLToPath(new URL('../throttle/gpu-queue.py', import.meta.url));
const key = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const argv = (a) => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s.length > 0);

export function validate(batch) {
  if (batch.schema !== 'endoforge/project-scheduler/1') throw Error('unknown scheduler schema');
  if (!integer(batch.concurrency) || batch.concurrency < 1) throw Error('concurrency must be positive');
  if (!Array.isArray(batch.jobs) || !batch.jobs.length) throw Error('jobs required');
  const ids = new Set(), pieces = {}, reservations = {};
  for (const [project, policy] of Object.entries(batch.projects ?? {})) {
    if (!Object.hasOwn(PROJECTS, project) || !integer(policy.tokenBudget) ||
        !integer(policy.gpuPriority ?? PROJECTS[project])) throw Error(`invalid project policy: ${project}`);
  }
  for (const job of batch.jobs) {
    if (!key(job.id) || ids.has(job.id)) throw Error(`invalid or duplicate job: ${job.id}`);
    ids.add(job.id);
    if (!Object.hasOwn(PROJECTS, job.project) || !Object.hasOwn(batch.projects ?? {}, job.project)) throw Error(`unknown project: ${job.project}`);
    if (!Array.isArray(job.pieces) || job.pieces.length < 2 || !argv(job.recombine?.command)) throw Error(`${job.id}: pieces and recombine.command required`);
    const names = new Set();
    for (const piece of job.pieces) {
      if (!key(piece.id) || names.has(piece.id) || !argv(piece.command) || !integer(piece.maxTokens)) throw Error(`${job.id}: invalid piece`);
      names.add(piece.id);
      if (!Array.isArray(piece.files) || !piece.files.length || piece.files.some((f) =>
        typeof f !== 'string' || !f.length || path.isAbsolute(f) || f.includes('\\') || f.split('/').some((s) => !s || s === '.' || s === '..'))) throw Error(`${job.id}: invalid files`);
      if (piece.gpu != null && typeof piece.gpu !== 'boolean') throw Error(`${job.id}: gpu must be boolean`);
      pieces[`${job.id}:${piece.id}`] = piece;
      reservations[job.project] = (reservations[job.project] ?? 0) + piece.maxTokens;
    }
    if (job.recombine.gpu != null && typeof job.recombine.gpu !== 'boolean') throw Error(`${job.id}: gpu must be boolean`);
    if (!integer(job.recombine.maxTokens)) throw Error(`${job.id}: recombine.maxTokens required`);
    reservations[job.project] += job.recombine.maxTokens;
  }
  const errors = ownershipMap({ pieces, contracts: batch.contracts ?? [] }).errors;
  if (errors.length) throw Error(errors.join('; '));
  for (const [project, tokens] of Object.entries(reservations)) {
    if (!integer(tokens) || tokens > batch.projects[project].tokenBudget) throw Error(`${project}: token budget exceeded (${tokens})`);
  }
  return reservations;
}

export function commandFor(batch, job, piece) {
  if (!piece.gpu) return piece.command;
  const priority = batch.projects[job.project].gpuPriority ?? PROJECTS[job.project];
  return ['python3', queue, '--name', `${job.project}-${job.id}-${piece.id}`, '--priority', String(priority), '--', ...piece.command];
}

// Commands receive their reservation. Model runners must enforce maxTokens; this scheduler
// reserves worst-case usage up front and never refunds failures or silently retries a billable atom.
export function execute(command, context) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 2, 2], env: {
      ...process.env, ENDOFORGE_PROJECT: context.project, ENDOFORGE_JOB: context.job,
      ENDOFORGE_PIECE: context.piece, ENDOFORGE_TOKEN_BUDGET: String(context.maxTokens),
      ENDOFORGE_RESULTS: JSON.stringify(context.results ?? []),
    } });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve({ code }) : reject(Error(`command failed: ${signal ?? code}`)));
  });
}

export async function schedule(batch, {
  run = execute, capacity = fleetCapacity, room = () => headroom().ok,
  pause = () => new Promise((resolve) => setTimeout(resolve, 250)),
} = {}) {
  const reserved = validate(batch); // Complete preflight before any command can spend tokens.
  const jobs = batch.jobs.map((job) => ({ ...job, state: 'pending', results: [], next: 0, active: 0 }));
  const running = new Set();
  let cursor = 0;
  function launch(job, piece, joining = false) {
    job.active++;
    const task = Promise.resolve().then(() => run(commandFor(batch, job, piece), {
      project: job.project, job: job.id, piece: piece.id, maxTokens: piece.maxTokens,
      results: joining ? job.results : undefined,
    })).then((result) => {
      if (joining) { job.state = 'succeeded'; job.output = result; }
      else job.results.push({ piece: piece.id, result });
    }).catch((error) => { job.state = 'failed'; job.error = error.message; })
      .finally(() => { job.active--; running.delete(task); });
    running.add(task);
  }
  while (jobs.some((j) => !['succeeded', 'failed'].includes(j.state)) || running.size) {
    const slots = waveSize(batch.concurrency, capacity());
    let launched = false;
    if (running.size < slots && room()) {
      // Rotate across jobs so a job's pending pieces cannot monopolize slots.
      for (let i = 0; i < jobs.length; i++) {
        const at = (cursor + i) % jobs.length, job = jobs[at];
        if (['failed', 'succeeded', 'joining'].includes(job.state)) continue;
        if (job.next < job.pieces.length) {
          job.state = 'running'; launch(job, job.pieces[job.next++]);
        } else if (!job.active) {
          job.state = 'joining';
          job.results.sort((a, b) => job.pieces.findIndex((p) => p.id === a.piece) - job.pieces.findIndex((p) => p.id === b.piece));
          launch(job, { ...job.recombine, id: 'recombine' }, true);
        } else continue;
        cursor = (at + 1) % jobs.length; launched = true; break;
      }
    }
    if (!launched) await (running.size ? Promise.race([...running, pause()]) : pause());
  }
  return { reserved, jobs: jobs.map(({ id, project, state, results, output, error }) => ({ id, project, state, results, output, error })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const batch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const report = process.argv.includes('--check') ? { reserved: validate(batch) } : await schedule(batch);
    console.log(JSON.stringify(report, null, 2));
    if (report.jobs?.some((j) => j.state === 'failed')) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
