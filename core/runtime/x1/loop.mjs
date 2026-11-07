import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ASC_PATH, WORKCELL } from '../../../tools/asc/pin.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { generate } from './generator.mjs';
import { configuration, hash } from './host.mjs';
import { receipt } from './ledger.mjs';

const loopPools = new WeakSet();
const hostPortPath = fileURLToPath(new URL('./loop-port.mjs', import.meta.url));
export const implementation = Object.freeze(['loop-port.mjs', 'agent.mjs']);
export const agentLimits = Object.freeze({ maxTurns: 6, maxTokens: 64000 });

const providers = new WeakMap();
const agentJobs = new Map();
let nextAgentJob = 0;
export function createLoopPool({ size = 1, isolation = 'thread', jobTimeoutMs = 60000, ascPath = ASC_PATH, hostPort = hostPortPath, primes, provider, ...rest } = {}) {
  const pool = new IsolatePool({ hostPort, size, isolation, jobTimeoutMs, ...WORKCELL,
    warm: { path: ascPath, ...(primes === undefined ? {} : { primes }) }, ...rest,
    ...(provider ? { hostCall: (call, job) => answerCall(pool, provider, call, job) } : {}) });
  loopPools.add(pool);
  if (provider) providers.set(pool, provider);
  return pool;
}

async function answerCall(pool, provider, call, job) {
  const context = agentJobs.get(job.portOptions?.jobKey);
  if (!context) throw Error('no agent job');
  if (call.kind === 'model') {
    const begin = performance.now();
    context.observe?.('model');
    try {
      const reply = await provider.send({ session: job.portOptions.jobKey, messages: call.messages, remaining: call.remaining });
      return { text: reply.text, usage: reply.usage };
    } finally {
      context.modelMs += performance.now() - begin;
      context.observe?.('model-returned');
    }
  }
  if (call.kind === 'admit') {
    if (context.admission) throw Error('already admitted');
    context.observe?.('admitting');
    const begin = performance.now();
    context.admission = await admit(pool, context.reference, { need: context.need, configuration, files: call.files });
    context.freezeMs = performance.now() - begin;
    context.reference.identity = context.admission.identity;
    context.observe?.('admitted');
    return context.admission;
  }
  throw Error('unknown host call');
}

export async function attemptAgent({ need, directory, pool, observe, limits = agentLimits, resume = false }) {
  const timings = Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null]));
  const begin = performance.now(), jobKey = `agent-${process.pid}-${++nextAgentJob}`, id = basename(directory);
  const context = { need, observe, modelMs: 0, admission: null, reference: { ledger: join(directory, 'ledger.sqlite') } };
  const provider = providers.get(pool);
  agentJobs.set(jobKey, context);
  try {
    if (!provider) throw Error('createLoopPool with a provider required');
    await pool.ready();
    observe?.('need');
    if (resume) {
      context.admission = await admit(pool, context.reference, { resume: true });
      context.reference.identity = context.admission.identity;
    }
    const result = await pool.run({ ledger: 'caller', timing: true, reference: { identity: 'pending' }, candidates: [id],
      portOptions: { mode: 'agent', jobKey, need, id, limits, ...(resume ? { admission: context.admission } : {}) } });
    provider.endSession(jobKey);
    const { evidence, timings: _, ...observed } = result;
    const { content: returned, ...kept } = evidence ?? {};
    timings.compile = kept.timings?.compile ?? null;
    timings.gate = kept.timings?.gates ?? null;
    timings.generate = context.modelMs;
    timings.freeze = context.freezeMs ?? null;
    if (!context.admission) throw Error('no frozen evaluator');
    const content = returned ?? JSON.stringify({ id, files: {}, compiled: { error: 'attempt lost' } });
    observe?.('committing');
    const outcome = await commitCandidate(pool, { evaluated: { observed: { ...observed, ...(evidence ? { evidence: kept } : {}) }, content, sources: null },
      reference: context.reference, digest: context.admission.digest, timings });
    observe?.('returned');
    timings.promote = 0;
    timings.total = performance.now() - begin;
    return { promoted: outcome.promoted, ...(outcome.inconclusive ? { inconclusive: true } : {}), candidate: outcome.candidate, receipt: outcome.receipt, decision: outcome.decision, problem: outcome.problem, status: outcome.status,
      agent: kept.agent ?? null, testDouble: provider.testDouble, modelMs: context.modelMs, timings };
  } catch {
    provider?.endSession(jobKey);
    timings.total = performance.now() - begin;
    return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', testDouble: provider?.testDouble ?? false, modelMs: context.modelMs, timings };
  } finally {
    agentJobs.delete(jobKey);
  }
}

export function admit(pool, reference, input = {}) {
  return pool.ledger.request('admit', { reference }, input);
}

export async function checkCandidate(pool, admission, candidate) {
  const result = await pool.run({ ledger: 'caller', reference: { identity: admission.identity }, candidates: [candidate.id],
    portOptions: { mode: 'check', candidate, admission } });
  if (result.status !== 'completed' || result.report?.stage !== 'checked') throw Error('check round did not return an outcome');
  return result.report.failures;
}

export async function evaluateInCell(pool, { candidate, admission, repair, timings = {} }) {
  const begin = performance.now();
  const result = await pool.run({ ledger: 'caller', timing: true, reference: { identity: admission.identity }, candidates: [candidate.id],
    portOptions: { candidate, admission, ...(repair ? { repair } : {}) } });
  const { evidence, timings: _, ...observed } = result;
  const { content: returned, ...kept } = evidence ?? {};
  timings.compile = kept.timings?.compile ?? null;
  timings.gate = performance.now() - begin - (timings.compile ?? 0);
  return { observed: { ...observed, ...(evidence ? { evidence: kept } : {}) },
    content: returned ?? JSON.stringify({ ...candidate, compiled: { source: hash(candidate.files['kernel.ts']), error: 'attempt lost' } }),
    sources: repair ? null : { 'kernel.ts': hash(candidate.files['kernel.ts']), 'glue.json': hash(candidate.files['glue.json']) } };
}

export async function commitCandidate(pool, { evaluated: { observed, content, sources }, reference, digest, decisionPath, timings = {}, receiptId = 'receipt' }) {
  const identity = hash(content);
  const start = performance.now();
  const template = receipt(reference, digest, identity);
  template.id = receiptId;
  const committed = await pool.ledger.request('commit', { reference, candidates: [identity], receipts: [template] },
    { content, decisionPath, result: observed, ...(sources ? { sources } : {}) });
  timings.ledger = performance.now() - start;
  return { promoted: committed.decision.decision === 'promote', ...(committed.decision.decision === 'inconclusive' ? { inconclusive: true } : {}), candidate: identity, receipt: committed.decision.receipt,
    decision: committed.decision.sha256, problem: committed.problem, status: committed.receipts[0].record.data.outcome_state,
    report: observed.report, rounds: observed.evidence?.rounds ?? [] };
}

export async function evaluateAndCommit(pool, { candidate, reference, admission, digest = admission.digest, decisionPath, repair, observe, timings = {}, receiptId }) {
  const evaluated = await evaluateInCell(pool, { candidate, admission, repair, timings });
  observe?.('committing');
  const outcome = await commitCandidate(pool, { evaluated, reference, digest, decisionPath, timings, receiptId });
  observe?.('returned');
  return outcome;
}

export async function attemptInIsolate({ need, directory, pool, env = process.env, deadline = Infinity, observe, repair }) {
  const timings = Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null]));
  const begin = performance.now();
  let scalarFilter;
  try {
    if (!loopPools.has(pool)) throw Error('createLoopPool required');
    await pool.ready();
    let admission;
    const generated = await generate({ need, directory, env, deadline, implementation,
      freeze: async ({ reference, need: frozenNeed, configuration }) => (admission = await admit(pool, reference, { need: frozenNeed, configuration })),
      check: candidate => checkCandidate(pool, admission, candidate) });
    scalarFilter = generated.scalarFilter;
    Object.assign(timings, generated.timings);
    observe?.('generated');
    const outcome = await evaluateAndCommit(pool, { candidate: generated.candidate, reference: { ...generated.reference, identity: admission.identity },
      admission, decisionPath: join(directory, 'promotion.json'), observe, timings, repair });
    timings.promote = 0;
    timings.total = performance.now() - begin;
    return { promoted: outcome.promoted, ...(outcome.inconclusive ? { inconclusive: true } : {}), candidate: outcome.candidate, receipt: outcome.receipt, decision: outcome.decision, problem: outcome.problem, rounds: outcome.rounds,
      testDouble: generated.testDouble, modelMs: generated.modelMs, timings, ...(scalarFilter ? { scalarFilter } : {}) };
  } catch (error) {
    scalarFilter ??= error?.scalarFilter;
    timings.total = performance.now() - begin;
    return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1', timings, ...(scalarFilter ? { scalarFilter } : {}) };
  }
}
