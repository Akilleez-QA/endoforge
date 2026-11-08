import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { implementation, reply, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';

export const here = path => fileURLToPath(new URL(path, import.meta.url));
export const repository = here('../../');
export const nearest = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
export const stat = values => ({ n: values.length, p50: nearest(values, 0.5), p95: nearest(values, 0.95), max: values.length ? Math.max(...values) : null });
export const random = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const env = { ENDOFORGE_LOOP: 'agent' };

export function syncShim(output) {
  const library = join(output, 'synccount.so');
  if (!existsSync(library)) execFileSync('gcc', ['-O2', '-shared', '-fPIC', '-o', library, here('./synccount.c'), '-ldl']);
  return library;
}

export function pythonStats(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => /^python-\d+\.json$/.test(name)).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}

export function instrument(output, name) {
  const directory = join(output, 'stats', name);
  mkdirSync(directory, { recursive: true });
  Object.assign(process.env, { LD_PRELOAD: syncShim(output), PYTHONPATH: here('./site'), EF_P59_STATS: directory, ENDOFORGE_LEDGER_STATS: join(directory, 'writer.json') });
  return directory;
}

export function scriptFor(known, pool, low, high, next, observe = {}) {
  return async ({ messages }) => {
    observe.send?.(pool);
    const ms = low + (high - low) * next();
    if (ms) await sleep(ms);
    observe.returned?.();
    const input = known.get(JSON.parse(messages[0].content).need.split(': ')[1]);
    return reply(stageOf(messages) === 'specification' ? specification(input) : implementation(input, JSON.parse(messages[0].content).id));
  };
}

export async function capture(output) {
  const corpus = await buildCorpus(), known = new Map(corpus.map(entry => [entry.name, entry]));
  let pool;
  pool = createLoopPool({ size: 1, isolation: 'process', waits: 'release', provider: scriptedProvider(scriptFor(known, null, 0, 0, () => 0)) });
  await pool.ready();
  const streams = [];
  let current, models = 0;
  const request = pool.ledger.request.bind(pool.ledger);
  pool.ledger.request = async (action, job, result) => {
    current.requests.push({ action, models, job: JSON.parse(JSON.stringify(job)), result: JSON.parse(JSON.stringify(result ?? null)) });
    models = 0;
    const answer = await request(action, job, result);
    current.answers.push(answer);
    return answer;
  };
  for (const input of corpus) {
    current = { name: input.name, expected: input.expectPromoted, requests: [], answers: [] };
    models = 0;
    const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(output, 'capture', input.name), pool, env,
      observe: stage => { if (stage === 'model') models += 1; }, limits: { maxTurns: 2, maxTokens: 64000 } });
    if (answer.promoted !== input.expectPromoted || answer.error) throw Error(`capture ${input.name}: ${JSON.stringify(answer)}`);
    streams.push({ name: current.name, expected: current.expected, requests: current.requests.map(({ action, models, job, result }) => ({ action, models, job, result })),
      decision: current.answers.at(-1).decision.decision });
  }
  await pool.close();
  return { corpus, known, streams, digest: hash(JSON.stringify(streams.map(stream => ({ ...stream, requests: stream.requests.map(r => ({ ...r, job: { ...r.job, reference: { ...r.job.reference, ledger: '<ledger>' } } })) })))) };
}

export function prepared(stream, ledger, state) {
  return stream.requests.map(request => () => {
    const job = { ...request.job, reference: { ...request.job.reference, ledger } };
    const result = { ...request.result };
    if (request.action === 'park') result.after = state.after;
    if (request.action === 'commit' && 'continuation' in result) result.continuation = state.after;
    return [request.action, job, result];
  });
}
