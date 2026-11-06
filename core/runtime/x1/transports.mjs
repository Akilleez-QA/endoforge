import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { replySchema, transportSystem } from './agent.mjs';

const allowedTools = new Set(['StructuredOutput']);
const passedEnvironment = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'USER', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'];
function claudeEnvironment(configDir, base = process.env, extra = {}) {
  const env = Object.fromEntries(passedEnvironment.filter(name => base[name] !== undefined).map(name => [name, base[name]]));
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return { ...env, ...extra };
}
const sharedArguments = ({ model, system = transportSystem, effort }) => ['-p', '--json-schema', JSON.stringify(replySchema), '--tools', '', '--no-session-persistence', '--strict-mcp-config',
  '--setting-sources', '', '--permission-mode', 'dontAsk', '--safe-mode', '--model', model, ...(effort ? ['--effort', effort] : []), '--system-prompt', system];
export const warmArguments = options => [...sharedArguments(options), '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
export const spawnArguments = options => [...sharedArguments(options), '--disable-slash-commands', '--output-format', 'json'];
const usageOf = result => ['input_tokens', 'output_tokens', 'cache_creation_input_tokens'].reduce((total, key) => total + (Number.isSafeInteger(result.usage?.[key]) ? result.usage[key] : 0), 0);
const replyOf = (result, wallMs) => ({ text: result.structured_output ? JSON.stringify(result.structured_output) : result.result, usage: usageOf(result), wallMs, apiMs: result.duration_api_ms ?? null });
const requireDirectory = configDir => {
  if (configDir && !statSync(configDir, { throwIfNoEntry: false })?.isDirectory()) throw Error('config directory must already exist');
};
const flatten = messages => messages.map(message => `${message.role}: ${message.content}`).join('\n\n');

export function scriptedProvider(script) {
  const seen = new Map();
  return {
    name: 'scripted', testDouble: true,
    async start() { return { startupMs: 0, lanes: 0 }; },
    async send({ session, messages }) {
      const turn = seen.get(session) ?? 0;
      seen.set(session, turn + 1);
      return script({ session, messages, turn });
    },
    endSession(session) { seen.delete(session); },
    async close() {},
  };
}

export class SpawnClaudeTransport {
  name = 'claude-spawn';
  testDouble = false;
  constructor({ configDir, model, system, effort, cwd, command = 'claude', timeoutMs = 300000, base, environment } = {}) {
    requireDirectory(configDir);
    Object.assign(this, { configDir, cwd, command, timeoutMs, base, environment });
    this.arguments = spawnArguments({ model, system, effort });
    this.spawns = 0;
  }
  async start() { return { startupMs: 0, lanes: 0 }; }
  send({ messages }) {
    const begin = performance.now();
    this.spawns += 1;
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.arguments, { cwd: this.cwd, env: claudeEnvironment(this.configDir, this.base, this.environment), stdio: ['pipe', 'pipe', 'ignore'], timeout: this.timeoutMs });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.stdin.end(flatten(messages));
      child.on('close', code => {
        try {
          const result = JSON.parse(output);
          if (code || result.is_error) throw Error('transport refused the turn');
          resolve(replyOf(result, performance.now() - begin));
        } catch { reject(Error('transport refused the turn')); }
      });
    });
  }
  endSession() {}
  async close() {}
}

class Lane {
  constructor(transport, instance) {
    Object.assign(this, { transport, instance, child: null, session: null, sent: 0, dirty: false, pending: null, generation: 0, startups: [] });
  }
  open() {
    if (this.child) return;
    const begin = performance.now(), { command, cwd, base, environment, arguments: args } = this.transport;
    const child = spawn(command, args, { cwd, env: claudeEnvironment(this.instance.configDir, base, environment), stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    this.dirty = false;
    this.sent = 0;
    this.generation += 1;
    this.startups.push({ at: new Date().toISOString(), spawnMs: performance.now() - begin });
    const generation = this.generation;
    const fail = why => {
      if (generation !== this.generation) return;
      this.shut(why);
    };
    child.on('error', () => fail('transport failed'));
    child.on('close', () => fail('transport closed'));
    child.stdin.on('error', () => fail('transport failed'));
    createInterface({ input: child.stdout }).on('line', line => {
      if (generation !== this.generation) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'system' && event.subtype === 'init') {
        if (event.tools?.some(tool => !allowedTools.has(tool)) || event.apiKeySource !== 'none' || event.mcp_servers?.length) fail('transport is not a text-only subscription session');
        return;
      }
      if (event.type === 'rate_limit_event' && event.rate_limit_info?.status === 'rejected') {
        this.instance.limitedUntil = (event.rate_limit_info.resetsAt ?? 0) * 1000;
        return;
      }
      if (event.type !== 'result' || !this.pending) return;
      const { resolve, reject, begin: sent, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      if (event.is_error) reject(Error('transport refused the turn'));
      else resolve(replyOf(event, performance.now() - sent));
    });
  }
  shut(why) {
    const child = this.child, pending = this.pending;
    this.child = null;
    this.pending = null;
    this.generation += 1;
    this.sent = 0;
    this.dirty = false;
    if (pending) { clearTimeout(pending.timer); pending.reject(Error(why)); }
    if (child) child.kill('SIGKILL');
  }
  write(text, timeoutMs) {
    this.open();
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
  constructor({ instances = [{ name: 'default' }], model, system, effort, cwd, command = 'claude', timeoutMs = 300000, idleMs = 300000, base, environment } = {}) {
    Object.assign(this, { cwd, command, timeoutMs, idleMs, base, environment });
    this.arguments = warmArguments({ model, system, effort });
    for (const instance of instances) {
      requireDirectory(instance.configDir);
      const shared = { ...instance, limitedUntil: 0 };
      for (let i = 0; i < (instance.lanes ?? 1); i++) this.#lanes.push(new Lane(this, shared));
    }
  }
  async start() {
    const begin = performance.now();
    for (const lane of this.#lanes) lane.open();
    return { startupMs: performance.now() - begin, lanes: this.#lanes.length };
  }
  get startups() { return this.#lanes.flatMap(lane => lane.startups); }
  #assign() {
    while (this.#waiting.length) {
      const lane = this.#lanes.find(candidate => !candidate.session && candidate.instance.limitedUntil <= Date.now());
      if (!lane) return;
      const { session, resolve } = this.#waiting.shift();
      lane.session = session;
      this.#sessions.set(session, lane);
      clearTimeout(lane.idle);
      resolve(lane);
    }
  }
  #acquire(session) {
    const lane = this.#sessions.get(session);
    if (lane) return Promise.resolve(lane);
    if (this.#closed) return Promise.reject(Error('transport closed'));
    return new Promise((resolve, reject) => { this.#waiting.push({ session, resolve, reject }); this.#assign(); });
  }
  async send({ session, messages, timeoutMs = this.timeoutMs }) {
    const lane = await this.#acquire(session);
    if (lane.dirty && lane.child) { await lane.write('/clear', timeoutMs); lane.dirty = false; lane.sent = 0; }
    const reply = await lane.write(flatten(messages.slice(lane.child ? lane.sent : 0)), timeoutMs);
    lane.sent = messages.length + 1;
    return reply;
  }
  endSession(session) {
    const lane = this.#sessions.get(session);
    if (!lane) return;
    this.#sessions.delete(session);
    lane.session = null;
    lane.dirty = Boolean(lane.child);
    const generation = lane.generation;
    clearTimeout(lane.idle);
    lane.idle = setTimeout(() => { if (!lane.session && !lane.pending && lane.generation === generation) lane.shut('transport idle'); }, this.idleMs);
    lane.idle.unref?.();
    this.#assign();
  }
  async close() {
    this.#closed = true;
    for (const waiter of this.#waiting.splice(0)) waiter.reject(Error('transport closed'));
    for (const lane of this.#lanes) { clearTimeout(lane.idle); lane.shut('transport closed'); }
  }
}
