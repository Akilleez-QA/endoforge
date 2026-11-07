import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dumpListEnabled, registerHolder } from '../dump-list.mjs';

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha256 = text => createHash('sha256').update(text).digest('hex');
export const LANE = 'compatibility';
export const DUMP_DEFAULTS = Object.freeze({ name: 'endoforge-cohort', priority: 40, floor: 1, holdMs: 30000, intervalMs: 2000, settleMs: 1500 });
const compareRuns = async (runner, job) => {
  const first = await runner.run(job), second = await runner.run(job);
  if (first.status !== second.status || first.output !== second.output || first.reason !== second.reason) return { ...first, status: 'refused', reason: 'nondeterministic', second: { status: second.status, reason: second.reason, outputSha256: second.outputSha256 } };
  return { ...first, comparedRuns: 2 };
};

// `readPaths` are the only files the cohort may read: the pinned modules a preparer compiles once.
export function cohortArguments({ cohortSource = source('./cohort.cjs'), readPaths = [] } = {}) {
  return ['--permission', '--allow-worker', ...readPaths.map(path => `--allow-fs-read=${path}`), '--no-addons', '--disallow-code-generation-from-strings', '--no-warnings', '--no-experimental-websocket', '--max-old-space-size=64', '-e', cohortSource];
}

export function validateContract(contract = {}) {
  const { grants = {}, ports = {}, ...other } = contract;
  if (Object.keys(other).length) throw new TypeError(`unknown contract field ${Object.keys(other)[0]}`);
  const { clock, random, ...unknownGrants } = grants;
  if (Object.keys(unknownGrants).length) throw new TypeError(`unknown grant ${Object.keys(unknownGrants)[0]}`);
  if (clock !== undefined && !Number.isSafeInteger(clock?.fixedMs)) throw new TypeError('clock grant needs fixedMs');
  if (random !== undefined && !Number.isSafeInteger(random?.seed)) throw new TypeError('random grant needs seed');
  for (const [name, limit] of Object.entries(ports)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || !positive(limit?.maxCalls) || !positive(limit?.maxBytes)) throw new TypeError(`invalid port ${name}`);
  }
  return { grants: { ...(clock ? { clock } : {}), ...(random ? { random } : {}) }, ports: Object.keys(ports), limits: ports };
}

export function createContainedRunner({ width = 1, spare = width, heapMb = 64, youngMb = 8, stackMb = 2, deadlineMs = 1000, outputMaxBytes = 1048576,
  stuckMs = 1500, bootAllowanceMs = 5000, rssMaxMb, reuse = true, harden = true, execPath = process.execPath, cohortArgs, onCohort, sources = {}, prepare, dumpList } = {}) {
  if (![width, spare, heapMb, youngMb, stackMb, deadlineMs, outputMaxBytes, stuckMs].every(positive)) throw new TypeError('positive integer limits required');
  const preparer = prepare ? preparerConfig(prepare, width) : null;
  const rssLimit = rssMaxMb ?? (heapMb + youngMb * 3 + 48) * (width + spare) + 256 + (preparer ? preparer.memoryMb * width + (preparer.layout === 'sibling' ? 48 * preparer.count : 0) : 0);
  const bootstrap = sources.guest || source('./guest.js'), cellSource = sources.cell || source('./cell.cjs');
  const dump = dumpOptions(dumpList);
  const config = { width, spare, reuse, harden, stuckMs, bootstrap, resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: youngMb, stackSizeMb: stackMb },
    ...(preparer ? { prepare: preparer } : {}), ...(dump ? { dump: { floor: dump.floor, holdMs: dump.holdMs, intervalMs: dump.intervalMs, settleMs: dump.settleMs } } : {}) };
  const args = cohortArgs || cohortArguments({ readPaths: preparer ? preparer.wasm.map(item => item.path) : [] });
  const inflight = new Map(), queue = [];
  let cohort, starting, nextId = 1, closed = false;
  const stats = { cohortStarts: 0, cohortLosses: 0, completed: 0, refused: 0, unknown: 0, messages: 0, dispatched: 0 };
  const settle = (entry, result) => {
    clearTimeout(entry.watchdog);
    inflight.delete(entry.id);
    const body = { lane: LANE, node: process.versions.node, cohort: entry.cohort, contract: sha256(JSON.stringify(entry.job.contract)), ...result };
    stats[body.status === 'completed' || body.status === 'checked' ? 'completed' : body.status === 'refused' ? 'refused' : 'unknown'] += 1;
    entry.resolve(body);
    pump();
  };
  const lose = (target, reason) => {
    if (target.lost) return;
    target.lost = true;
    stats.cohortLosses += 1;
    clearInterval(target.rssTimer);
    target.holder?.close();
    try { target.child.kill('SIGKILL'); } catch {}
    if (cohort === target) { cohort = null; starting = null; }
    const fatal = target.tail.split('\n').find(line => /FATAL|Fatal/.test(line))?.slice(0, 160);
    const attributed = width === 1 ? { status: 'refused', reason: fatal && /memory/i.test(fatal) ? 'heap' : reason === 'cohort_rss' ? 'memory' : reason === 'deadline_stuck' || reason === 'watchdog' ? 'deadline' : 'process_exit' } : { status: 'outcome_unknown', reason };
    // A checked attempt may have been checking rather than running when the cohort died, so it is never attributed.
    for (const entry of [...inflight.values()]) if (entry.owner === target) settle(entry, { ...(entry.attempt ? { status: 'outcome_unknown', reason } : attributed), detail: fatal || `cohort lost: ${reason}` });
    if (!closed) { start().catch(() => {}); pump(); }
  };
  const start = () => starting ||= new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'sh', execPath, ...args], { env: { TZ: 'UTC', LC_ALL: 'C' }, cwd: '/', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json' });
    const target = { child, tail: '' };
    stats.cohortStarts += 1;
    child.stderr.on('data', chunk => { target.tail = (target.tail + chunk).slice(-4096); });
    child.on('error', error => { reject(error); lose(target, 'cohort_error'); });
    child.on('close', () => { reject(new Error(`cohort exited before ready: ${target.tail.slice(-400)}`)); if (!closed || inflight.size) lose(target, 'cohort_exit'); });
    child.on('message', message => {
      stats.messages += 1;
      if (message.type === 'started') { stats.messages += 1; return child.send({ type: 'configure', config, cellSource }); }
      if (message.type === 'configured') {
        target.pid = message.pid;
        if (dump && message.dump && !target.lost) target.holder = registerHolder({ name: dump.name, priority: dump.priority, pid: message.pid, listen: false, measure: () => target.sheddable || 0, directory: dump.directory, env: dump.env, refreshMs: dump.intervalMs, enabled: true });
        cohort = target;
        onCohort?.(child.pid);
        return resolve(target);
      }
      if (message.type === 'dump') {
        target.sheddable = message.bytes;
        target.dumpState = { live: message.live, idle: message.idle, holding: message.holding, ratio: message.ratio };
        target.holder?.refresh(message.shed);
        return;
      }
      if (message.type === 'result') {
        const entry = inflight.get(message.id);
        if (entry) settle(entry, entry.attempt ? decodeAttempt(message.result, outputMaxBytes) : decode(message.result, outputMaxBytes));
      } else if (message.type === 'port') {
        handlePort(target, message);
      } else if (message.type === 'stuck') {
        lose(target, 'deadline_stuck');
      }
    });
    target.rssTimer = setInterval(() => {
      if (!inflight.size) return;
      let pages;
      try { pages = Number(readFileSync(`/proc/${child.pid}/statm`, 'utf8').split(' ')[1]); } catch { return; }
      if (pages * 4096 > rssLimit * 1048576) lose(target, 'cohort_rss');
    }, 25);
    target.rssTimer.unref();
  });
  const handlePort = async (target, { id, name, text }) => {
    const entry = inflight.get(id);
    let reply;
    try {
      if (!entry) return;
      const limits = entry.job.contract.limits, handler = entry.ports && Object.hasOwn(entry.ports, name) ? entry.ports[name] : undefined;
      const limit = Object.hasOwn(limits, name) ? limits[name] : undefined;
      if (!limit || typeof handler !== 'function') reply = { refused: 'not granted' };
      else if ((entry.portCalls.set(name, (entry.portCalls.get(name) || 0) + 1), entry.portCalls.get(name)) > limit.maxCalls) reply = { refused: 'call budget' };
      else if (text.length > limit.maxBytes) reply = { refused: 'byte budget' };
      else {
        const value = await handler(JSON.parse(text));
        const encoded = JSON.stringify({ value: value === undefined ? null : value });
        reply = encoded.length > limit.maxBytes ? { refused: 'byte budget' } : JSON.parse(encoded);
      }
    } catch { reply = { refused: 'handler failed' }; }
    if (target.lost || !inflight.has(id)) return;
    stats.messages += 1;
    try { target.child.send({ type: 'port-reply', id, text: JSON.stringify(reply) }); } catch {}
  };
  const decode = ({ text, cell }, bound) => {
    let outcome;
    try { outcome = JSON.parse(text); } catch { return { status: 'refused', reason: 'host_error', cell }; }
    if (outcome.state === 'completed' && typeof outcome.output === 'string' && outcome.output.length <= bound) return { status: 'completed', output: outcome.output, outputSha256: sha256(outcome.output), cell };
    return { status: 'refused', reason: typeof outcome.reason === 'string' ? outcome.reason : outcome.state === 'never_settled' ? 'never_settled' : 'output_too_large', ...(typeof outcome.detail === 'string' ? { detail: outcome.detail.slice(0, 512) } : {}), cell };
  };
  const decodeAttempt = ({ prepared, checkMs, runMs, texts, failure, cell }, bound) => {
    if (failure) return { status: 'outcome_unknown', reason: typeof failure.reason === 'string' ? failure.reason : 'checker_error', ...(typeof failure.detail === 'string' ? { detail: failure.detail.slice(0, 512) } : {}), prepared, checkMs, cell };
    return { status: 'checked', prepared, checkMs, runMs, runs: (texts || []).map(text => decode({ text, cell }, bound)), cell };
  };
  const pump = () => {
    if (!queue.length || closed && !queue.length) return;
    if (!cohort) { start().then(pump, error => { for (const entry of queue.splice(0)) entry.resolve({ lane: LANE, status: 'outcome_unknown', reason: 'cohort_start_failed', detail: error.message }); }); return; }
    while (queue.length && inflight.size < width) {
      const entry = queue.shift();
      entry.id = nextId++;
      entry.owner = cohort;
      entry.cohort = cohort.child.pid;
      inflight.set(entry.id, entry);
      entry.watchdog = setTimeout(() => lose(entry.owner, 'watchdog'), entry.deadline + bootAllowanceMs + stuckMs);
      stats.messages += 1;
      stats.dispatched += 1;
      cohort.child.send({ type: 'run', job: { id: entry.id, deadlineMs: entry.deadline, ...entry.wire } });
    }
  };
  return {
    stats,
    ready: () => start().then(() => undefined),
    get pid() { return cohort?.child.pid; },
    get dump() { return cohort?.holder ? { path: cohort.holder.path, bytes: cohort.holder.bytes, writes: cohort.holder.writes, ...cohort.dumpState } : null; },
    shed() { try { cohort?.child.send({ type: 'shed' }); } catch {} },
    run({ modules, entry, exportName = 'main', input = null, contract, deadlineMs: jobDeadline = deadlineMs, ports }) {
      if (closed) return Promise.reject(new Error('runner closed'));
      if (!positive(jobDeadline)) return Promise.reject(new TypeError('deadlineMs must be a positive integer'));
      let checked;
      try {
        checked = validateContract(contract);
        if (modules === null || typeof modules !== 'object' || typeof modules[entry] !== 'string' || !Object.values(modules).every(value => typeof value === 'string')) throw new TypeError('modules must map paths to sources and contain entry');
      } catch (error) { return Promise.reject(error); }
      return new Promise(resolve => {
        queue.push({ job: { contract: checked }, deadline: jobDeadline, ports, portCalls: new Map(), resolve,
          wire: { modules, entry, exportName, input: JSON.stringify(input === undefined ? null : input), contract: { grants: checked.grants, ports: checked.ports }, outputMaxBytes } });
        pump();
      });
    },
    runTwice(job) { return compareRuns(this, job); },
    // One attempt, one handoff in and one result out: the cohort's preparer checks and emits from `prepare`, then
    // the emitted modules plus `modules` run `runs` times in fresh guest contexts. Resolves to status `checked` with
    // the preparer's report and each run's result, or `outcome_unknown` when the check itself failed or was lost.
    runChecked({ prepare: payload, modules = {}, entry, exportName = 'main', input = null, contract, deadlineMs: jobDeadline = deadlineMs, runs = 2, ports }) {
      if (closed) return Promise.reject(new Error('runner closed'));
      if (!preparer) return Promise.reject(new Error('runner has no preparer'));
      if (!positive(jobDeadline) || !positive(runs)) return Promise.reject(new TypeError('deadlineMs and runs must be positive integers'));
      let checked;
      try {
        checked = validateContract(contract);
        if (modules === null || typeof modules !== 'object' || typeof entry !== 'string' || !Object.values(modules).every(value => typeof value === 'string')) throw new TypeError('modules must map paths to sources');
      } catch (error) { return Promise.reject(error); }
      return new Promise(resolve => {
        queue.push({ attempt: true, job: { contract: checked }, deadline: preparer.checkDeadlineMs + runs * jobDeadline, ports, portCalls: new Map(), resolve,
          wire: { attempt: true, prepare: payload, repeat: runs, checkDeadlineMs: preparer.checkDeadlineMs, deadlineMs: jobDeadline, modules, entry, exportName,
            input: JSON.stringify(input === undefined ? null : input), contract: { grants: checked.grants, ports: checked.ports }, outputMaxBytes } });
        pump();
      });
    },
    async close() {
      closed = true;
      try { await starting; } catch {}
      const target = cohort;
      cohort = null;
      if (!target) return;
      clearInterval(target.rssTimer);
      target.lost = true;
      target.holder?.close();
      await new Promise(resolve => {
        const force = setTimeout(() => target.child.kill('SIGKILL'), 1000);
        target.child.once('close', () => { clearTimeout(force); resolve(); });
        try { target.child.send({ type: 'stop' }); } catch { target.child.kill('SIGKILL'); }
      });
    },
  };
}
function dumpOptions(options) {
  if (options === false) return null;
  const { enabled, directory, env = process.env, ...rest } = options && typeof options === 'object' ? options : {};
  if (!(enabled ?? (options === true || directory !== undefined || dumpListEnabled(env)))) return null;
  const merged = { ...DUMP_DEFAULTS, ...rest, directory, env };
  if (![merged.floor + 1, merged.holdMs, merged.intervalMs, merged.settleMs].every(positive)) throw new TypeError('dump list floor, holdMs, intervalMs and settleMs must be non-negative and positive integers');
  return merged;
}
// A preparer runs in the cohort before the guest: `fused` in the guest's own Worker, `sibling` in `count` checker
// Workers of the same process. `memoryMb` is what one preparation may hold outside the V8 heap.
function preparerConfig({ layout = 'sibling', count, resourceLimits, checkDeadlineMs = 10000, memoryMb = 1024, sources, entry, wasm = [], config = {} }, width) {
  if (!['fused', 'sibling'].includes(layout)) throw new TypeError(`unknown preparer layout ${layout}`);
  if (!Array.isArray(sources) || !sources.every(item => typeof item?.name === 'string' && typeof item.text === 'string') || !sources.some(item => item.name === entry)) throw new TypeError('preparer needs sources including its entry');
  if (!wasm.every(item => typeof item?.path === 'string' && item.path.startsWith('/') && /^[0-9a-f]{64}$/.test(item.sha256))) throw new TypeError('preparer modules need an absolute path and a digest');
  const checkers = count ?? width;
  if (![checkers, checkDeadlineMs, memoryMb].every(positive)) throw new TypeError('positive integer preparer limits required');
  return { layout, count: checkers, checkDeadlineMs, memoryMb, sources, entry, wasm, config,
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8, stackSizeMb: 4, ...resourceLimits } };
}
export function createContainedPool({ width = 1, ...options } = {}) {
  if (!positive(width)) throw new TypeError('positive integer width required');
  const cells = Array.from({ length: width }, () => createContainedRunner({ ...options, width: 1, spare: 1 }));
  const idle = [...cells], queue = [];
  const pump = () => {
    while (idle.length && queue.length) {
      const cell = idle.shift(), { job, resolve, reject } = queue.shift();
      cell.run(job).then(resolve, reject).finally(() => { idle.push(cell); pump(); });
    }
  };
  return {
    get stats() { return cells.reduce((total, { stats }) => { for (const key of Object.keys(stats)) total[key] = (total[key] || 0) + stats[key]; return total; }, {}); },
    get pids() { return cells.map(cell => cell.pid).filter(Boolean); },
    ready: () => Promise.all(cells.map(cell => cell.ready())).then(() => undefined),
    run: job => new Promise((resolve, reject) => { queue.push({ job, resolve, reject }); pump(); }),
    runTwice(job) { return compareRuns(this, job); },
    close: () => Promise.all(cells.map(cell => cell.close())).then(() => undefined),
  };
}
