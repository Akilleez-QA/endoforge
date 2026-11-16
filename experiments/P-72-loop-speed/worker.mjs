import { loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { budgetRefusal } from './design.mjs';

const load = () => Number(loadavg()[0].toFixed(2));
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const flagPattern = /make CONTRACT\.md, .+ and this test agree/;
const ignoredKeys = new Set(['then', 'toJSON', 'constructor']);
const asks = new Map();
let nextAsk = 0, transports = null, pipeline = null, pool = null, transport = null, limits = null, startError = null;
const record = { replies: [], errors: [], cancelled: [], endSessions: [], unknown: new Set(), memory: new Map(), inflight: new Map(), ended: new Set(), t0: 0 };
const overlapSession = session => typeof session === 'string' && session.endsWith(':overlap');

const ask = message => new Promise(resolve => {
  const id = ++nextAsk;
  asks.set(id, resolve);
  process.send({ ...message, id });
});

export function turnOf(messages, memory, session) {
  const stageAt = messages.findLastIndex(message => message?.role === 'user' && typeof message.content === 'string' && message.content.startsWith('{"stage":"'));
  const stage = stageAt >= 0 ? parse(messages[stageAt].content)?.stage ?? null : null;
  if (stageAt === messages.length - 1) return { stage, causes: [] };
  const last = messages.at(-1), body = last?.role === 'user' ? parse(last.content) : null;
  if (!body) return { stage, causes: ['unknown'] };
  const causes = [], texts = {};
  if (body.error) causes.push('invalid-reply');
  const final = (body.results ?? []).filter(result => result && typeof result === 'object' && 'check' in result).map(result => result.check).at(-1);
  if (final === 'passed') causes.push('after-pass');
  else if (final && typeof final === 'object') {
    const key = `${session}:${stage}`, shown = JSON.stringify(final, (name, value) => (name === 'ms' ? undefined : value));
    if (memory.get(key) === shown) causes.push('repeated');
    memory.set(key, shown);
    if (final.gates?.G8_nonfinite) { causes.push('g8'); texts.g8 = final.gates.G8_nonfinite.why ?? null; }
    const flags = (final.problems ?? []).filter(problem => typeof problem === 'string' && flagPattern.test(problem));
    if (flags.length) { causes.push('oracle-flag'); texts.oracleFlags = flags; }
    if (!causes.length) causes.push('failed-check');
  } else if (!causes.length) causes.push('other');
  return { stage, causes, ...texts };
}

const counted = {
  name: 'claude-warm',
  get testDouble() { return transport?.testDouble ?? false; },
  async start() { return { startupMs: 0, lanes: 0 }; },
  async send(request) {
    const overlap = overlapSession(request.session), permit = await ask({ type: 'permit', overlap });
    if (!permit.ok) { record.errors.push(budgetRefusal); throw Error(budgetRefusal); }
    const turn = turnOf(request.messages ?? [], record.memory, request.session);
    const begin = performance.now() - record.t0, hooks = { startedMs: null, partials: 0, firstPartialMs: null };
    const passed = { ...request };
    if (typeof request.onStart === 'function') passed.onStart = (...args) => { hooks.startedMs ??= performance.now() - record.t0; return request.onStart(...args); };
    if (typeof request.onPartial === 'function') passed.onPartial = (...args) => { hooks.partials += 1; hooks.firstPartialMs ??= performance.now() - record.t0; return request.onPartial(...args); };
    const shape = { session: overlap ? 'overlap' : 'main', overlap, hooks: { onStart: 'onStart' in request, onPartial: 'onPartial' in request } };
    record.inflight.set(request.session, (record.inflight.get(request.session) ?? 0) + 1);
    try {
      const reply = await transport.send(passed), detail = reply.usageDetail ?? {};
      record.replies.push({ beginMs: begin, endMs: performance.now() - record.t0, wallMs: reply.wallMs ?? null, apiMs: reply.apiMs ?? null, usage: reply.usage, costUsd: reply.costUsd ?? null,
        detail: { input: detail.input_tokens ?? null, output: detail.output_tokens ?? null, cacheCreation: detail.cache_creation_input_tokens ?? null, cacheRead: detail.cache_read_input_tokens ?? null }, ...shape, ...hooks, ...turn });
      return reply;
    } catch (error) {
      const message = String(error?.message ?? error), cancelled = record.ended.has(request.session);
      record.replies.push({ beginMs: begin, endMs: performance.now() - record.t0, failed: true, error: message, cancelled, ...shape, ...hooks, ...turn });
      (cancelled ? record.cancelled : record.errors).push(message);
      throw error;
    } finally {
      record.inflight.set(request.session, record.inflight.get(request.session) - 1);
    }
  },
  endSession(session) {
    record.ended.add(session);
    record.endSessions.push({ atMs: performance.now() - record.t0, session: overlapSession(session) ? 'overlap' : 'main', pending: (record.inflight.get(session) ?? 0) > 0 });
    transport?.endSession(session);
  },
  async close() {},
};

const provider = new Proxy(counted, {
  get(target, key, receiver) {
    if (typeof key === 'string' && !(key in target) && !ignoredKeys.has(key)) record.unknown.add(key);
    return Reflect.get(target, key, receiver);
  },
});

const kept = answer => {
  const { content, rounds, ...rest } = answer;
  return { ...rest, content: typeof content === 'string' ? content : null, rounds: (rounds ?? []).map(({ source: _, ...round }) => round) };
};

const handlers = {
  async init({ tree, ascPath, armLimits }) {
    const from = path => import(pathToFileURL(join(tree, path)).href);
    const loop = await from('core/runtime/x1/loop.mjs');
    pipeline = await from('core/runtime/x1/pipeline.mjs');
    transports = await from('core/runtime/x1/transports.mjs');
    limits = { ...loop.agentLimits, ...armLimits };
    pool = loop.createLoopPool({ provider, waits: 'hold', ascPath });
    await pool.ready();
    return { limits };
  },
  async start({ configDir, model, effort, cwd, command, lanes = 1, partial = false }) {
    transport = new transports.WarmClaudeTransport({ instances: [{ name: 'account', configDir, lanes }], model, effort, cwd, ...(partial ? { partial: true } : {}), ...(command ? { command } : {}) });
    if (partial && !transport.arguments.includes('--include-partial-messages')) throw Error('this commit\'s warm transport does not support partial: true');
    const begin = performance.now();
    startError = null;
    try {
      const started = await transport.start();
      if (started.lanes !== lanes) throw Error(`warm transport opened ${started.lanes} lanes, not ${lanes}`);
      return { startupMs: performance.now() - begin, lanes: started.lanes, partial: transport.arguments.includes('--include-partial-messages') };
    } catch (error) {
      startError = `transport start failed: ${error?.message ?? error}`;
      return { startupMs: null, error: startError };
    }
  },
  async run({ id, need, text, directory }) {
    Object.assign(record, { replies: [], errors: startError ? [startError] : [], cancelled: [], endSessions: [], unknown: new Set(), memory: new Map(), inflight: new Map(), ended: new Set() });
    const loadStart = load();
    record.t0 = performance.now();
    const startedAt = performance.timeOrigin + record.t0;
    process.send({ type: 'started', id, startedAt });
    let answer;
    try { answer = await pipeline.runNeed({ need: text, directory, pool, env: { ENDOFORGE_LOOP: 'agent' }, limits }); } catch (error) { answer = { promoted: false, error: String(error?.message ?? error) }; }
    const wallMs = performance.now() - record.t0;
    return { need, answer: kept(answer), wallMs, startedAt, loadStart, loadEnd: load(), replies: record.replies, sendErrors: record.errors, cancelledSends: record.cancelled, endSessions: record.endSessions,
      unknownProviderAccess: [...record.unknown],
      inits: [...new Map((transport?.inits ?? []).map(init => [JSON.stringify(init), init])).values()] };
  },
  async stop() { await transport?.close(); transport = null; return true; },
  async exit() { await pool?.close(); setImmediate(() => process.exit(0)); return true; },
};

if (process.send) process.on('message', async message => {
  if (message.type === 'permit') { const resolve = asks.get(message.id); asks.delete(message.id); return resolve?.(message); }
  try { process.send({ type: 'reply', id: message.id, value: await handlers[message.type](message) }); } catch (error) { process.send({ type: 'reply', id: message.id, error: String(error?.stack ?? error) }); }
});
