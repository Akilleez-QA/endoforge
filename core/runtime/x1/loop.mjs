import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ASC_PATH, WORKCELL } from '../../../tools/asc/pin.mjs';
import { IsolatePool } from '../isolate-pool.mjs';
import { applyReply, specificationFiles } from './agent.mjs';
import { applyChanges } from './oracle.mjs';
import { testProblems } from './gates.mjs';
import { generate } from './generator.mjs';
import { verifyFromMemory } from './loop-port.mjs';
import { configuration, hash } from './host.mjs';
import { receipt } from './ledger.mjs';

const loopPools = new WeakSet();
const hostPortPath = fileURLToPath(new URL('./loop-port.mjs', import.meta.url));
export const implementation = Object.freeze(['loop-port.mjs', 'agent.mjs', 'oracle.mjs']);
export const agentLimits = Object.freeze({ maxTurns: 6, maxTokens: 64000 });

const providers = new WeakMap();
const agentJobs = new Map();
let nextAgentJob = 0;
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
const readable = path => `--allow-fs-read=${realpathSync(path)}/*`;
export function cellPermissions(hostPort, ascPath) {
  return [permissionFlag, readable(repository), readable(dirname(dirname(dirname(ascPath)))), readable(dirname(hostPort)), '--allow-worker'];
}
export function createLoopPool({ size = 1, isolation = 'process', jobTimeoutMs = 60000, jobDeadlineMs = 900000, ascPath = ASC_PATH, hostPort = hostPortPath, primes, provider, cellEnv = {}, waits = 'release', rates = null, ...rest } = {}) {
  if (!['release', 'hold'].includes(waits)) throw TypeError('waits must be release or hold');
  const pool = new IsolatePool({ hostPort, size, isolation, jobTimeoutMs, jobDeadlineMs, ...WORKCELL,
    warm: { path: ascPath, ...(primes === undefined ? {} : { primes }) },
    ledgerBridge: { extension: 'tools.x1_loop', restart: true },
    cellEnv, cellFlags: isolation === 'process' ? cellPermissions(hostPort, ascPath) : [], rates, ...rest,
    ...(provider ? { hostCall: (call, job) => answerCall(pool, provider, call, job) } : {}) });
  loopPools.add(pool);
  if (rates) {
    const request = pool.ledger.request.bind(pool.ledger);
    pool.ledger.request = (...args) => {
      const slot = rates.arrive('ledger');
      const pending = request(...args);
      pending.then(() => rates.done(slot), () => rates.done(slot));
      return pending;
    };
  }
  if (provider) providers.set(pool, { provider, waits, rates });
  return pool;
}

const frozenText = (files, name) => Buffer.from(files?.[name] ?? '', 'hex').toString();
async function modelTurn(context, provider, session, messages) {
  const { limits, deadline } = context, remaining = limits.maxTokens - context.tokens;
  if (Date.now() >= deadline) throw Error('request deadline reached');
  if (context.calls >= 2 * limits.maxTurns) throw Error('model call limit reached');
  if (remaining <= 0) throw Error('model token budget reached');
  context.calls += 1;
  const begin = performance.now(), slot = context.rates?.arrive(context.admission ? 'model:impl' : 'model:spec');
  context.observe?.('model');
  try {
    const timeoutMs = Number.isFinite(deadline) ? Math.max(1, deadline - Date.now()) : undefined;
    const reply = await provider.send({ session, messages, remaining, ...(timeoutMs ? { timeoutMs } : {}) });
    if (!Number.isSafeInteger(reply?.usage) || reply.usage < 0) throw Error('invalid usage');
    context.tokens += reply.usage;
    applyReply(context.shadow, context.editable, reply.text);
    return { text: reply.text, usage: reply.usage };
  } finally {
    context.modelMs += performance.now() - begin;
    context.rates?.done(slot);
    context.observe?.('model-returned');
  }
}
async function answerCall(pool, provider, call, job) {
  const context = agentJobs.get(job.portOptions?.jobKey);
  if (!context) throw Error('no agent job');
  if (context.rates) {
    const begin = performance.now();
    try { return await answerKind(pool, provider, call, job, context); } finally { context.rates.block('cell', performance.now() - begin); }
  }
  return answerKind(pool, provider, call, job, context);
}
async function answerKind(pool, provider, call, job, context) {
  if (call.kind === 'model') return modelTurn(context, provider, job.portOptions.jobKey, call.messages);
  if (call.kind === 'admit') {
    if (context.admission) throw Error('already admitted');
    if (context.limits.oracle) { context.shadow['tests.json'] = applyChanges(context.shadow['tests.json'] ?? '', call.oracle?.changes ?? []); context.oracle = call.oracle?.report ?? null; }
    const oracle = ['CONTRACT.md', 'tests.json'];
    if (oracle.some(name => frozenText(call.files, name) !== context.shadow[name])) throw Error('frozen files differ from the model replies');
    let tests = null;
    try { tests = JSON.parse(context.shadow['tests.json']); } catch { }
    if (testProblems(tests).length) throw Error('frozen tests must each assert something a kernel can fail');
    context.observe?.('admitting');
    const begin = performance.now();
    context.admission = await admit(pool, context.reference, { need: context.need, configuration, files: call.files });
    context.freezeMs = performance.now() - begin;
    context.reference.identity = context.admission.identity;
    context.editable = ['kernel.ts', 'glue.json'];
    context.observe?.('admitted');
    return context.admission;
  }
  throw Error('unknown host call');
}

export async function attemptAgent({ need, directory, pool, observe, limits = agentLimits, resume = false, deadline = Infinity }) {
  const timings = Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null]));
  const begin = performance.now(), jobKey = `agent-${process.pid}-${++nextAgentJob}`, id = basename(directory);
  const reference = { ledger: join(directory, 'ledger.sqlite') };
  const context = { need, observe, modelMs: 0, admission: null, reference, limits: { ...limits }, deadline, calls: 0, tokens: 0, shadow: {}, editable: specificationFiles(limits) };
  const { provider, waits, rates } = providers.get(pool) ?? {};
  context.rates = rates;
  agentJobs.set(jobKey, context);
  try {
    if (!provider) throw Error('createLoopPool with a provider required');
    if (typeof need !== 'string' || !need.trim()) throw Error('nonempty need required');
    if (Date.now() >= deadline) throw Error('request deadline reached');
    await pool.ready();
    await pool.ledger.start();
    observe?.('need');
    let recovered = null;
    if (resume || existsSync(reference.ledger)) {
      const admitted = await admit(pool, reference, { resume: true, need });
      recovered = admitted.continuation ?? null;
      if (!admitted.fresh) {
        const { decision, continuation: _, ...admission } = admitted;
        if (decision) {
          timings.total = performance.now() - begin;
          return { promoted: true, resumed: true, candidate: decision.candidate, receipt: decision.receipt, decision: decision.sha256, status: 'passed',
            agent: null, testDouble: provider.testDouble, modelMs: 0, timings };
        }
        context.admission = admission;
        reference.identity = admission.identity;
        const { bundle } = await verifyFromMemory(admission)({ identity: admission.identity });
        for (const name of ['CONTRACT.md', 'tests.json']) context.shadow[name] = frozenText(bundle.files, name);
        context.editable = ['kernel.ts', 'glue.json'];
      }
    }
    let waiting = null, after = recovered?.seq ?? null, result;
    if (recovered && waits === 'release') {
      if (hash(recovered.body) !== recovered.sha256) throw Error('continuation digest differs from its record');
      const held = JSON.parse(recovered.body);
      if (!(context.admission && held.cell.stage === 'specification')) { waiting = held; Object.assign(context, held.host); }
    }
    const job = extra => pool.run({ ledger: 'caller', timing: true, reference: { identity: 'pending' }, candidates: [id],
      portOptions: { mode: 'agent', waits, jobKey, need, id, limits, ...(context.admission ? { admission: context.admission } : {}), ...extra } });
    for (;;) {
      if (waiting) {
        let reply;
        try {
          reply = await modelTurn(context, provider, jobKey, waiting.cell.messages);
          if (Date.now() >= deadline) throw Error('request deadline reached');
        } catch (error) {
          if (!context.admission) throw error;
          result = { status: 'outcome_unknown', reason: error.message, report: null };
          break;
        }
        result = await job({ continuation: waiting.cell, reply });
      } else result = await job({});
      timings.compile += result.evidence?.timings?.compile ?? 0;
      timings.gate += result.evidence?.timings?.gates ?? 0;
      if (rates && result.evidence?.timings) { rates.span('cell.compile', result.evidence.timings.compile); rates.span('cell.gates', result.evidence.timings.gates); }
      if (result.status !== 'waiting') break;
      const { shadow, calls, tokens, editable } = context;
      waiting = { cell: result.evidence.waiting, host: { shadow, calls, tokens, editable } };
      if (!context.admission || !waiting.cell.receipt.turns) continue;
      const body = JSON.stringify(waiting);
      observe?.('parking');
      ({ seq: after } = await pool.ledger.request('park', { reference }, { after, body, sha256: hash(body) }));
      observe?.('parked');
    }
    provider.endSession(jobKey);
    const { evidence, timings: _, ...observed } = result;
    const { content: returned, ...kept } = evidence ?? {};
    timings.generate = context.modelMs;
    timings.freeze = context.freezeMs ?? null;
    if (!context.admission) throw Error('no frozen evaluator');
    const content = returned ?? JSON.stringify({ id, files: {}, compiled: { error: 'attempt lost' } });
    if (observed.status === 'completed' && kept.agent?.exit_reason !== 'stop') Object.assign(observed, { status: 'rejected', reason: `agent stopped: ${kept.agent?.exit_reason ?? 'unknown'}` });
    const sources = returned ? { 'kernel.ts': hash(context.shadow['kernel.ts'] ?? ''), 'glue.json': hash(context.shadow['glue.json'] ?? '') } : null;
    observe?.('committing');
    const outcome = await commitCandidate(pool, { evaluated: { observed: { ...observed, ...(evidence ? { evidence: kept } : {}) }, content, sources },
      reference, digest: context.admission.digest, timings, continuation: after });
    observe?.('returned');
    timings.promote = 0;
    timings.total = performance.now() - begin;
    return { promoted: outcome.promoted, ...(outcome.inconclusive ? { inconclusive: true } : {}), candidate: outcome.candidate, receipt: outcome.receipt, decision: outcome.decision, problem: outcome.problem, status: outcome.status,
      agent: kept.agent ?? null, rounds: kept.rounds ?? [], content: returned ?? null, testDouble: provider.testDouble, modelMs: context.modelMs, timings, ...(context.oracle ? { oracle: context.oracle } : {}) };
  } catch (error) {
    provider?.endSession(jobKey);
    timings.total = performance.now() - begin;
    return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', ...unknownOutcome(error), testDouble: provider?.testDouble ?? false, modelMs: context.modelMs, timings, ...(context.oracle ? { oracle: context.oracle } : {}) };
  } finally {
    agentJobs.delete(jobKey);
  }
}

const unknownOutcome = error => error?.outcome === 'outcome_unknown' ? { status: 'outcome_unknown' } : {};
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

export async function commitCandidate(pool, { evaluated: { observed, content, sources }, reference, digest, decisionPath, timings = {}, receiptId, continuation = null }) {
  const identity = hash(content);
  const start = performance.now();
  const template = receipt(reference, digest, identity);
  if (receiptId) template.id = receiptId;
  const committed = await pool.ledger.request('commit', { reference, candidates: [identity], receipts: [template] },
    { content, decisionPath, result: observed, ...(receiptId ? {} : { nextReceipt: true }), ...(sources ? { sources } : {}), ...(continuation === null ? {} : { continuation }) });
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
    return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', ...unknownOutcome(error), testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1', timings, ...(scalarFilter ? { scalarFilter } : {}) };
  }
}
