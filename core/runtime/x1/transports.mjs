import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { replySchema, transportSystem } from './agent.mjs';
import { UsageParked, governorFor, readRateLimit, watchdogEnvironment } from '../usage-governor.mjs';

const allowedTools = new Set(['StructuredOutput']);
const passedEnvironment = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'USER', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'];
const credentialVariable = /^ANTHROPIC_|API_KEY|AUTH_TOKEN|OAUTH_TOKEN|^CLAUDE_CODE_USE_|^AWS_|^GOOGLE_|^VERTEX_/i;
const notSubscription = 'transport is not a text-only subscription session';
const refuseCredentials = environment => {
  if (Object.keys(environment ?? {}).some(name => credentialVariable.test(name))) throw Error('credential variables are not allowed in the transport environment');
};
function claudeEnvironment(configDir, base = process.env, extra = {}) {
  const env = Object.fromEntries(passedEnvironment.filter(name => base[name] !== undefined).map(name => [name, base[name]]));
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return { ...env, ...extra };
}
const sharedArguments = ({ model, system = transportSystem, effort }) => ['-p', '--json-schema', JSON.stringify(replySchema), '--tools', '', '--no-session-persistence', '--strict-mcp-config',
  '--setting-sources', '', '--permission-mode', 'dontAsk', '--safe-mode', '--model', model, ...(effort ? ['--effort', effort] : []), '--system-prompt', system];
export const warmArguments = options => [...sharedArguments(options), '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
export const spawnArguments = options => [...sharedArguments(options), '--disable-slash-commands', '--output-format', 'stream-json', '--verbose'];
export const usageOf = result => ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((total, key) => total + (Number.isSafeInteger(result.usage?.[key]) ? result.usage[key] : 0), 0);
const loginOf = (configDir, base = process.env) => configDir ?? join(base.HOME || homedir(), '.claude');
const governed = (governor, configDir, usageState, base) => (governor === undefined ? governorFor(loginOf(configDir, base), { statePath: usageState }) : governor);
const replyOf = (result, wallMs) => ({ text: result.structured_output ? JSON.stringify(result.structured_output) : result.result, usage: usageOf(result), wallMs, apiMs: result.duration_api_ms ?? null, usageDetail: result.usage ?? null,
  costUsd: Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : null });
const requireDirectory = configDir => {
  if (configDir && !statSync(configDir, { throwIfNoEntry: false })?.isDirectory()) throw Error('config directory must already exist');
};
const initIsAcceptable = event => !event.tools?.some(tool => !allowedTools.has(tool)) && event.apiKeySource === 'none' && !event.mcp_servers?.length;
const flatten = messages => messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
const withinBudget = (remaining, usage) => {
  if (remaining !== undefined && usage > remaining) throw Error('model token budget exceeded');
};
const beforeBudget = remaining => {
  if (remaining !== undefined && remaining <= 0) throw Error('model token budget reached');
};
class WorkingDirectory {
  #path;
  constructor(path) { this.fixed = path; }
  get path() { return this.fixed ?? (this.#path ||= mkdtempSync(join(tmpdir(), 'ef-transport-'))); }
  remove() { if (this.#path) rmSync(this.#path, { recursive: true, force: true }); this.#path = null; }
}

export function scriptedProvider(script) {
  const seen = new Map();
  return {
    name: 'scripted', testDouble: true,
    async start() { return { startupMs: 0, lanes: 0 }; },
    async send({ session, messages, remaining }) {
      beforeBudget(remaining);
      const turn = seen.get(session) ?? 0;
      seen.set(session, turn + 1);
      const reply = await script({ session, messages, turn, remaining });
      withinBudget(remaining, reply?.usage);
      return reply;
    },
    endSession(session) { seen.delete(session); },
    async close() {},
  };
}

export class SpawnClaudeTransport {
  name = 'claude-spawn';
  testDouble = false;
  #directory;
  constructor({ configDir, model, system, effort, cwd, command = 'claude', timeoutMs = 300000, base, environment, governor, usageState, watchdog } = {}) {
    requireDirectory(configDir);
    refuseCredentials(environment);
    this.#directory = new WorkingDirectory(cwd);
    const watched = watchdogEnvironment(watchdog, { base: base ?? process.env, timeoutMs });
    Object.assign(this, { configDir, command, timeoutMs, base, environment: { ...environment, ...watched }, governor: governed(governor, configDir, usageState, base) });
    this.arguments = spawnArguments({ model, system, effort });
    this.spawns = 0;
  }
  async start() { return { startupMs: 0, lanes: 0 }; }
  send({ messages, remaining, timeoutMs = this.timeoutMs }) {
    const begin = performance.now();
    this.spawns += 1;
    return new Promise((resolve, reject) => {
      beforeBudget(remaining);
      const ticket = this.governor?.admit();
      const child = spawn(this.command, this.arguments, { cwd: this.#directory.path, env: claudeEnvironment(this.configDir, this.base, this.environment), stdio: ['pipe', 'pipe', 'ignore'], timeout: timeoutMs });
      let acceptable = false, refused = false, result = null, rateLimit = null;
      createInterface({ input: child.stdout }).on('line', line => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === 'system' && event.subtype === 'init') {
          acceptable = initIsAcceptable(event);
          refused ||= !acceptable;
        }
        if (event.type === 'rate_limit_event') rateLimit = this.governor?.observe(event) ?? readRateLimit(event);
        if (event.type === 'result') result = event;
      });
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.stdin.end(flatten(messages));
      child.on('close', code => {
        ticket?.release({ completed: Boolean(result) });
        try {
          if (!acceptable || refused) throw Error(notSubscription);
          if (code || !result || result.is_error) throw Error('transport refused the turn');
          const reply = { ...replyOf(result, performance.now() - begin), rateLimit };
          withinBudget(remaining, reply.usage);
          resolve(reply);
        } catch (error) { reject(error); }
      });
    });
  }
  endSession() {}
  async close() { this.#directory.remove(); }
}

class Lane {
  constructor(transport, instance) {
    Object.assign(this, { transport, instance, child: null, session: null, sent: 0, dirty: false, pending: null, generation: 0, startups: [], inits: [], opened: null, idle: null, initSeen: false });
  }
  open(timeoutMs) {
    if (this.opened) return this.opened;
    const begin = performance.now(), { command, base, environment, arguments: args } = this.transport;
    const child = spawn(command, args, { cwd: this.transport.workingDirectory, env: claudeEnvironment(this.instance.configDir, base, environment), stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    this.dirty = false;
    this.sent = 0;
    this.generation += 1;
    const generation = this.generation;
    const fail = why => { if (generation === this.generation) this.shut(why); };
    child.on('error', () => fail('transport failed'));
    child.on('close', () => fail('transport closed'));
    child.stdin.on('error', () => fail('transport failed'));
    createInterface({ input: child.stdout }).on('line', line => {
      if (generation !== this.generation) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'system' && event.subtype === 'init') {
        if (!initIsAcceptable(event)) return fail(notSubscription);
        this.initSeen = true;
        this.inits.push({ model: event.model ?? null, apiKeySource: event.apiKeySource ?? null });
        return undefined;
      }
      if (event.type === 'rate_limit_event') {
        this.rateLimit = this.instance.governor?.observe(event) ?? readRateLimit(event);
        if (event.rate_limit_info?.status === 'rejected') this.instance.limitedUntil = (event.rate_limit_info.resetsAt ?? 0) * 1000;
        return undefined;
      }
      if (event.type !== 'result' || !this.pending) return undefined;
      if (!this.initSeen) return fail(notSubscription);
      const { resolve, reject, begin: sent, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      if (event.is_error) reject(Error('transport refused the turn'));
      else resolve({ ...replyOf(event, performance.now() - sent), rateLimit: this.rateLimit });
      return undefined;
    });
    this.opened = this.write('/clear', timeoutMs).then(() => {
      this.startups.push({ at: new Date().toISOString(), readyMs: performance.now() - begin });
    });
    return this.opened;
  }
  shut(why) {
    const child = this.child, pending = this.pending;
    this.child = null;
    this.pending = null;
    this.opened = null;
    this.generation += 1;
    this.sent = 0;
    this.dirty = false;
    clearTimeout(this.idle);
    if (pending) { clearTimeout(pending.timer); pending.reject(Error(why)); }
    if (child) child.kill('SIGKILL');
  }
  write(text, timeoutMs) {
    if (!this.child) return Promise.reject(Error('transport closed'));
    if (this.pending) return Promise.reject(Error('transport turn already pending'));
    this.initSeen = false;
    this.rateLimit = null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.shut('transport timed out'), timeoutMs);
      this.pending = { resolve, reject, begin: performance.now(), timer };
      this.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
    });
  }
}

export class WarmClaudeTransport {
  name = 'claude-warm';
  testDouble = false;
  #lanes = [];
  #waiting = [];
  #sessions = new Map();
  #closed = false;
  #directory;
  #recheck;
  constructor({ instances = [{ name: 'default' }], model, system, effort, cwd, command = 'claude', timeoutMs = 300000, queueTimeoutMs = timeoutMs, idleMs = 300000, base, environment, governor, usageState, watchdog } = {}) {
    refuseCredentials(environment);
    this.#directory = new WorkingDirectory(cwd);
    const watched = watchdogEnvironment(watchdog, { base: base ?? process.env, timeoutMs });
    Object.assign(this, { command, timeoutMs, queueTimeoutMs, idleMs, base, environment: { ...environment, ...watched } });
    this.arguments = warmArguments({ model, system, effort });
    for (const instance of instances) {
      requireDirectory(instance.configDir);
      const shared = { ...instance, limitedUntil: 0, governor: governed(governor === null ? null : undefined, instance.configDir, usageState, base) };
      for (let i = 0; i < (instance.lanes ?? 1); i++) this.#lanes.push(new Lane(this, shared));
    }
  }
  get workingDirectory() { return this.#directory.path; }
  async start() {
    const begin = performance.now();
    await Promise.all(this.#lanes.map(lane => lane.open(this.timeoutMs)));
    return { startupMs: performance.now() - begin, lanes: this.#lanes.length };
  }
  get startups() { return this.#lanes.flatMap(lane => lane.startups); }
  get inits() { return this.#lanes.flatMap(lane => lane.inits); }
  #assign() {
    clearTimeout(this.#recheck);
    while (this.#waiting.length) {
      const lane = this.#lanes.find(candidate => !candidate.session && candidate.instance.limitedUntil <= Date.now());
      if (!lane) break;
      const { session, resolve, timer } = this.#waiting.shift();
      clearTimeout(timer);
      lane.session = session;
      this.#sessions.set(session, lane);
      clearTimeout(lane.idle);
      resolve(lane);
    }
    if (!this.#waiting.length) return;
    const free = this.#lanes.filter(lane => !lane.session);
    if (!free.length) return;
    this.#recheck = setTimeout(() => this.#assign(), Math.max(1, Math.min(...free.map(lane => lane.instance.limitedUntil)) - Date.now()));
    this.#recheck.unref?.();
  }
  #parked() {
    const stops = [...new Set(this.#lanes.map(lane => lane.instance))].map(instance => {
      const stop = instance.governor?.check() ?? null;
      if (stop) instance.limitedUntil = Math.max(instance.limitedUntil, stop.resumeAt);
      return stop;
    });
    return stops.every(Boolean) ? stops.reduce((first, stop) => (stop.resumeAt < first.resumeAt ? stop : first)) : null;
  }
  #acquire(session) {
    const lane = this.#sessions.get(session);
    if (lane) return Promise.resolve(lane);
    if (this.#closed) return Promise.reject(Error('transport closed'));
    const parked = this.#parked();
    if (parked && parked.resumeAt - Date.now() > this.queueTimeoutMs) return Promise.reject(new UsageParked(parked));
    return new Promise((resolve, reject) => {
      const waiter = { session, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
        reject(Error('transport queue timed out'));
      }, this.queueTimeoutMs);
      this.#waiting.push(waiter);
      this.#assign();
    });
  }
  async send({ session, messages, remaining, timeoutMs = this.timeoutMs }) {
    beforeBudget(remaining);
    const lane = await this.#acquire(session);
    const wasOpen = Boolean(lane.child);
    await lane.open(timeoutMs);
    if (lane.dirty) { await lane.write('/clear', timeoutMs); lane.dirty = false; lane.sent = 0; }
    let ticket;
    try { ticket = lane.instance.governor?.admit(); } catch (error) {
      if (error instanceof UsageParked) lane.instance.limitedUntil = Math.max(lane.instance.limitedUntil, error.resumeAt);
      throw error;
    }
    let reply;
    try { reply = await lane.write(flatten(messages.slice(wasOpen ? lane.sent : 0)), timeoutMs); } catch (error) {
      ticket?.release({ completed: false });
      throw error;
    }
    ticket?.release();
    lane.sent = messages.length + 1;
    withinBudget(remaining, reply.usage);
    return reply;
  }
  endSession(session) {
    const waiting = this.#waiting.find(waiter => waiter.session === session);
    if (waiting) {
      this.#waiting.splice(this.#waiting.indexOf(waiting), 1);
      clearTimeout(waiting.timer);
      waiting.reject(Error('session ended'));
    }
    const lane = this.#sessions.get(session);
    if (!lane) return;
    this.#sessions.delete(session);
    lane.session = null;
    if (lane.pending) lane.shut('session ended with a turn pending');
    else {
      lane.dirty = Boolean(lane.child);
      const generation = lane.generation;
      clearTimeout(lane.idle);
      lane.idle = setTimeout(() => { if (!lane.session && !lane.pending && lane.generation === generation) lane.shut('transport idle'); }, this.idleMs);
      lane.idle.unref?.();
    }
    this.#assign();
  }
  async close() {
    this.#closed = true;
    clearTimeout(this.#recheck);
    for (const waiter of this.#waiting.splice(0)) { clearTimeout(waiter.timer); waiter.reject(Error('transport closed')); }
    for (const lane of this.#lanes) lane.shut('transport closed');
    this.#directory.remove();
  }
}
