import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const EX_TEMPFAIL = 75;
export const DEFAULT_CEILING = 0.85;
export const DEFAULT_PER_CALL = 0.001;
export const WATCHDOG_RECHECK_MS = 300000;
const stopStatuses = new Set(['allowed_warning', 'rejected']);
const keepMs = 8 * 86400000;

export class UsageParked extends Error {
  constructor({ reason, window = null, resumeAt, utilization = null }) {
    super(`claude -p parked (exit 75): ${reason}; park until ${new Date(resumeAt).toISOString()}. This is a usage stop, not a failed candidate.`);
    Object.assign(this, { name: 'UsageParked', code: 'USAGE_PARKED', exitCode: EX_TEMPFAIL, outcome: 'outcome_unknown', parked: true, reason, window, resumeAt, utilization });
  }
}
export const isParked = error => error?.code === 'USAGE_PARKED';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const toMs = seconds => (finite(seconds) && seconds > 0 ? Math.round(seconds < 1e12 ? seconds * 1000 : seconds) : null);
const fraction = value => (finite(value) && value >= 0 ? value : null);

export function readRateLimit(event) {
  const info = event?.type === 'rate_limit_event' ? event.rate_limit_info : null;
  if (!info || typeof info !== 'object') return null;
  const windows = {};
  for (const [name, window] of Object.entries(info.unifiedWindows ?? {})) {
    if (window && typeof window === 'object') windows[name] = { utilization: fraction(window.utilization), resetsAt: toMs(window.resetsAt), status: window.status ?? null };
  }
  const type = info.rateLimitType ?? 'unspecified';
  if (!windows[type] && (fraction(info.utilization) !== null || toMs(info.resetsAt))) windows[type] = { utilization: fraction(info.utilization), resetsAt: toMs(info.resetsAt), status: info.status ?? null };
  return {
    status: info.status ?? null, type, resetsAt: toMs(info.resetsAt), windows,
    overage: { status: info.overageStatus ?? null, reason: info.overageDisabledReason ?? null, using: info.isUsingOverage === true },
    errorCode: info.errorCode ?? null,
  };
}

export const defaultStatePath = (env = process.env) => env.ENDOFORGE_USAGE_STATE || join(env.XDG_RUNTIME_DIR || tmpdir(), 'endoforge', 'usage-governor.json');
const scopeOf = configDir => (configDir ? resolve(configDir) : 'default');

function readState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && value.scopes && typeof value.scopes === 'object' ? value : { version: 1, scopes: {} };
  } catch { return { version: 1, scopes: {} }; }
}
function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(temporary, JSON.stringify(state));
  renameSync(temporary, path);
}
const newer = (a, b) => ((b?.observedAt ?? -1) > (a?.observedAt ?? -1) ? b : a);
const sum = counts => Object.values(counts ?? {}).reduce((total, n) => total + (finite(n) ? n : 0), 0);

function merge(into, from, self) {
  const out = { ...into, windows: { ...into.windows }, baseline: { ...into.baseline }, calls: { ...into.calls }, accepted: { ...into.accepted } };
  for (const [name, window] of Object.entries(from?.windows ?? {})) out.windows[name] = newer(out.windows[name], window);
  for (const [name, base] of Object.entries(from?.baseline ?? {})) {
    const mine = out.baseline[name];
    out.baseline[name] = !mine || (base.resetsAt ?? 0) > (mine.resetsAt ?? 0) || ((base.resetsAt ?? 0) === (mine.resetsAt ?? 0) && base.observedAt < mine.observedAt) ? base : mine;
  }
  for (const key of ['calls', 'accepted']) for (const [id, n] of Object.entries(from?.[key] ?? {})) if (id !== self) out[key][id] = n;
  const last = newer(into.last, from?.last);
  if (last) out.last = last;
  return out;
}
const emptyScope = () => ({ windows: {}, baseline: {}, calls: {}, accepted: {}, last: null });

export class UsageGovernor {
  #memory = emptyScope();
  #id = `${process.pid}-${randomUUID()}`;
  #calls = 0;
  #accepted = 0;
  inFlight = 0;
  constructor({ scope = 'default', ceiling, statePath, perCallPrior = DEFAULT_PER_CALL, now = Date.now, env = process.env } = {}) {
    const configured = ceiling ?? (env.ENDOFORGE_USAGE_CEILING === undefined ? DEFAULT_CEILING : Number(env.ENDOFORGE_USAGE_CEILING));
    if (!(finite(configured) && configured > 0 && configured <= 1)) throw Error('usage ceiling must be a fraction in (0, 1]');
    if (!(finite(perCallPrior) && perCallPrior >= 0)) throw Error('per-call usage prior must be a non-negative number');
    Object.assign(this, { scope, ceiling: configured, statePath: statePath ?? defaultStatePath(env), perCallPrior, now });
  }
  #sync(write) {
    const state = readState(this.statePath);
    this.#memory = merge(this.#memory, state.scopes[this.scope], this.#id);
    if (!write) return;
    this.#memory.calls[this.#id] = this.#calls;
    this.#memory.accepted[this.#id] = this.#accepted;
    const now = this.now();
    for (const [scope, entry] of Object.entries(state.scopes)) {
      const fresh = Object.values(entry?.windows ?? {}).some(window => (window?.resetsAt ?? 0) > now || now - (window?.observedAt ?? 0) < keepMs);
      if (!fresh) delete state.scopes[scope];
    }
    state.scopes[this.scope] = this.#memory;
    try { writeState(this.statePath, state); } catch {}
  }
  observe(event) {
    const reading = readRateLimit(event);
    if (!reading) return null;
    const observedAt = this.now();
    this.#sync(false);
    const calls = this.#totalCalls();
    for (const [name, window] of Object.entries(reading.windows)) {
      this.#memory.windows[name] = { ...window, observedAt };
      const base = this.#memory.baseline[name];
      if (window.utilization !== null && (!base || (window.resetsAt ?? 0) > (base.resetsAt ?? 0))) this.#memory.baseline[name] = { utilization: window.utilization, resetsAt: window.resetsAt, calls, accepted: this.#totalAccepted(), observedAt };
    }
    this.#memory.last = { status: reading.status, type: reading.type, resetsAt: reading.resetsAt, overage: reading.overage, errorCode: reading.errorCode, observedAt };
    this.#sync(true);
    return reading;
  }
  #totalCalls() { return sum(this.#memory.calls) - (this.#memory.calls[this.#id] ?? 0) + this.#calls; }
  #totalAccepted() { return sum(this.#memory.accepted) - (this.#memory.accepted[this.#id] ?? 0) + this.#accepted; }
  perCall(name) {
    const window = this.#memory.windows[name], base = this.#memory.baseline[name];
    if (!window || !base || window.resetsAt !== base.resetsAt || window.utilization === null) return this.perCallPrior;
    const calls = this.#totalCalls() - base.calls, spent = window.utilization - base.utilization;
    return calls > 0 && spent > 0 ? Math.max(this.perCallPrior, spent / calls) : this.perCallPrior;
  }
  check() {
    this.#sync(false);
    const now = this.now(), { windows, last } = this.#memory;
    const live = Object.entries(windows).filter(([, window]) => (window.resetsAt ?? 0) > now);
    const latest = live.length ? Math.max(...live.map(([, window]) => window.resetsAt)) : null;
    if (last && (last.resetsAt ?? latest ?? 0) > now) {
      if (stopStatuses.has(last.status)) return { reason: `rate limit status is ${last.status}`, window: last.type, resumeAt: last.resetsAt ?? latest };
      if (last.overage?.using && latest) return { reason: 'the login is drawing on usage credits', window: last.type, resumeAt: latest };
    }
    for (const [name, window] of live) {
      if (stopStatuses.has(window.status)) return { reason: `${name} status is ${window.status}`, window: name, resumeAt: window.resetsAt, utilization: window.utilization };
      if (window.utilization === null) continue;
      const projected = window.utilization + (this.inFlight + 1) * this.perCall(name);
      if (projected >= this.ceiling) return { reason: `${name} utilization ${window.utilization.toFixed(3)} projects to ${projected.toFixed(3)}, at or over the ${this.ceiling} ceiling`, window: name, resumeAt: window.resetsAt, utilization: window.utilization };
    }
    return null;
  }
  admit() {
    const stop = this.check();
    if (stop) throw new UsageParked(stop);
    this.inFlight += 1;
    let open = true;
    return {
      release: ({ completed = true } = {}) => {
        if (!open) return;
        open = false;
        this.inFlight -= 1;
        if (completed) { this.#calls += 1; this.#sync(true); }
      },
    };
  }
  recordAccepted(count = 1) {
    this.#accepted += count;
    this.#sync(true);
  }
  snapshot() {
    return { scope: this.scope, ceiling: this.ceiling, inFlight: this.inFlight, windows: structuredClone(this.#memory.windows), last: structuredClone(this.#memory.last) };
  }
  metric({ window = 'seven_day', accepted } = {}) {
    this.#sync(false);
    const now = this.#memory.windows[window], base = this.#memory.baseline[window];
    const spent = now && base && now.resetsAt === base.resetsAt && now.utilization !== null ? now.utilization - base.utilization : null;
    const count = accepted ?? (base ? this.#totalAccepted() - base.accepted : this.#totalAccepted());
    const calls = base ? this.#totalCalls() - base.calls : this.#totalCalls();
    return { window, spent, calls, accepted: count, perCall: spent !== null && calls > 0 ? spent / calls : null, perAccepted: spent !== null && count > 0 ? spent / count : null, resetsAt: now?.resetsAt ?? null };
  }
}

const governors = new Map();
export function governorFor(configDir, options = {}) {
  const env = options.env ?? process.env;
  const statePath = options.statePath ?? defaultStatePath(env), scope = scopeOf(configDir);
  const key = `${statePath}\0${scope}`;
  if (!governors.has(key)) governors.set(key, new UsageGovernor({ ...options, scope, statePath }));
  return governors.get(key);
}

export function watchdogEnvironment(watchdog, { base = process.env, timeoutMs } = {}) {
  const enabled = watchdog === undefined ? base.CLAUDE_CODE_RETRY_WATCHDOG === '1' : Boolean(watchdog);
  if (!enabled) return {};
  const options = typeof watchdog === 'object' && watchdog ? watchdog : {};
  const fromBase = name => (base[name] === undefined ? undefined : Number(base[name]));
  const maxWaitMs = options.maxWaitMs ?? fromBase('CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS') ?? (finite(timeoutMs) ? Math.floor(timeoutMs / 2) : 900000);
  const recheckMs = options.recheckMs ?? fromBase('CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS') ?? WATCHDOG_RECHECK_MS;
  if (!(Number.isSafeInteger(maxWaitMs) && maxWaitMs > 0)) throw Error('watchdog maxWaitMs must be a positive integer');
  if (finite(timeoutMs) && maxWaitMs >= timeoutMs) throw Error('watchdog maxWaitMs must end before the transport timeout');
  if (!(Number.isSafeInteger(recheckMs) && recheckMs >= 60000 && recheckMs <= 10800000)) throw Error('watchdog recheckMs must be 60000 to 10800000');
  return { CLAUDE_CODE_RETRY_WATCHDOG: '1', CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: String(maxWaitMs), CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: String(recheckMs) };
}
