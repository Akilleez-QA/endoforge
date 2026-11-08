import { performance } from 'node:perf_hooks';
import { renameSync, writeFileSync } from 'node:fs';

const FIELDS = ['arrivals', 'completions', 'inSystem', 'inService', 'last', 'areaSystem', 'areaQueue', 'areaBusy', 'sojourn', 'service', 'wait', 'blocked', 'lastDone'];
const F = Object.fromEntries(FIELDS.map((name, index) => [name, index]));
const WIDTH = FIELDS.length;
export const RULE = Object.freeze({ saturated: 0.8, certain: 0.95, queue: 0.25, tie: 0.05, liveWindowMs: 5000 });

export function createStageRates({ stages, slots = 16384, recent = 2048, history = 900, tickMs = 1000, clock = () => performance.now() } = {}) {
  const names = Object.keys(stages ?? {});
  if (!names.length) throw TypeError('stages required');
  const index = new Map(names.map((name, i) => [name, i]));
  const servers = Float64Array.from(names.map(name => stages[name].servers ?? Infinity));
  const explicit = Uint8Array.from(names.map(name => stages[name].queue === 'explicit' ? 1 : 0));
  const state = new Float64Array(names.length * WIDTH);
  const slotStage = new Int32Array(slots).fill(-1), slotArrive = new Float64Array(slots), slotStart = new Float64Array(slots);
  const doneAt = new Float64Array(names.length * recent), doneService = new Float64Array(names.length * recent), doneCount = new Uint32Array(names.length);
  const origin = clock();
  let nextSlot = 0, dropped = 0;
  const stageOf = name => { const i = index.get(name); if (i === undefined) throw RangeError(`unknown stage ${name}`); return i; };
  const advance = (i, t) => {
    const o = i * WIDTH, dt = t - state[o + F.last];
    if (dt > 0) {
      const n = state[o + F.inSystem], c = servers[i], busy = explicit[i] ? state[o + F.inService] : Math.min(n, c);
      state[o + F.areaSystem] += n * dt;
      state[o + F.areaQueue] += (n - busy) * dt;
      if (c !== Infinity) state[o + F.areaBusy] += Math.min(busy, c) * dt;
      state[o + F.last] = t;
    }
    return o;
  };
  const finish = (i, o, t, arrived, began) => {
    state[o + F.inSystem] -= 1;
    state[o + F.completions] += 1;
    const start = explicit[i] ? began : servers[i] === Infinity ? arrived : Math.max(arrived, servers[i] === 1 ? state[o + F.lastDone] : arrived);
    state[o + F.sojourn] += t - arrived;
    state[o + F.service] += t - start;
    state[o + F.wait] += start - arrived;
    state[o + F.lastDone] = t;
    const k = (doneCount[i]++ % recent) + i * recent;
    doneAt[k] = t; doneService[k] = t - start;
  };
  const rates = {
    stages: names,
    arrive(name) {
      const i = stageOf(name), t = clock(), o = advance(i, t), slot = nextSlot++ % slots;
      if (slotStage[slot] !== -1) dropped += 1;
      slotStage[slot] = i; slotArrive[slot] = t; slotStart[slot] = explicit[i] ? NaN : t;
      state[o + F.arrivals] += 1;
      state[o + F.inSystem] += 1;
      return slot;
    },
    start(slot) {
      const i = slotStage[slot];
      if (i < 0 || !explicit[i] || slotStart[slot] === slotStart[slot]) return;
      const t = clock(), o = advance(i, t);
      slotStart[slot] = t;
      state[o + F.inService] += 1;
    },
    done(slot) {
      const i = slotStage[slot];
      if (i < 0) return;
      const t = clock(), o = advance(i, t), began = slotStart[slot];
      if (explicit[i]) { if (began === began) state[o + F.inService] -= 1; }
      slotStage[slot] = -1;
      finish(i, o, t, slotArrive[slot], began === began ? began : t);
    },
    span(name, ms) {
      if (!(ms >= 0)) return;
      const i = stageOf(name), t = clock(), o = i * WIDTH;
      state[o + F.arrivals] += 1;
      state[o + F.completions] += 1;
      state[o + F.sojourn] += ms; state[o + F.service] += ms;
      if (servers[i] !== Infinity) state[o + F.areaBusy] += ms;
      state[o + F.areaSystem] += ms;
      const k = (doneCount[i]++ % recent) + i * recent;
      doneAt[k] = t; doneService[k] = ms;
    },
    block(name, ms) {
      if (ms > 0) state[stageOf(name) * WIDTH + F.blocked] += ms;
    },
    snapshot() {
      const t = clock(), copy = new Float64Array(state.length);
      for (let i = 0; i < names.length; i++) advance(i, t);
      copy.set(state);
      return { t, state: copy, elu: performance.eventLoopUtilization() };
    },
    view({ windowMs = RULE.liveWindowMs, from, to } = {}) {
      const end = to ?? rates.snapshot();
      const begin = from ?? closest(end.t - windowMs);
      return summarize(begin, end);
    },
    text(options) { return format(rates.view(options)); },
    get dropped() { return dropped; },
    get origin() { return origin; },
  };
  const ring = [];
  const closest = t => {
    let best = ring[0] ?? { t: origin, state: new Float64Array(state.length), elu: null };
    for (const item of ring) if (item.t <= t) best = item; else break;
    if (best.t > t && t <= origin) return { t: origin, state: new Float64Array(state.length), elu: null };
    return best;
  };
  const scratch = new Float64Array(recent);
  const percentiles = (i, from, to) => {
    let m = 0;
    const n = Math.min(doneCount[i], recent);
    for (let j = 0; j < n; j++) { const k = i * recent + j; if (doneAt[k] > from && doneAt[k] <= to) scratch[m++] = doneService[k]; }
    if (!m) return { p50: null, p95: null, p99: null };
    const values = scratch.subarray(0, m).sort(), at = q => values[Math.min(m - 1, Math.ceil(m * q) - 1)];
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  };
  const summarize = (a, b) => {
    const seconds = (b.t - a.t) / 1000, rows = {};
    for (let i = 0; i < names.length; i++) {
      const o = i * WIDTH, d = field => b.state[o + F[field]] - (a.state[o + F[field]] ?? 0);
      const completions = d('completions'), c = servers[i], spec = stages[names[i]];
      const L = d('areaSystem') / (seconds * 1000), throughput = completions / seconds, W = completions ? d('sojourn') / completions : null;
      const busy = d('areaBusy'), utilisation = c === Infinity ? null : busy / (c * seconds * 1000), net = c === Infinity ? null : Math.max(0, busy - d('blocked')) / (c * seconds * 1000);
      rows[names[i]] = { servers: c === Infinity ? 'unbounded' : c, ...(spec.within ? { within: spec.within } : {}), ...(spec.group ? { group: spec.group } : {}),
        arrivalsPerSecond: d('arrivals') / seconds, completionsPerSecond: throughput, utilisation, netUtilisation: net,
        queue: { now: b.state[o + F.inSystem] - (explicit[i] ? b.state[o + F.inService] : Math.min(b.state[o + F.inSystem], c)), mean: spec.within ? 0 : d('areaQueue') / (seconds * 1000), growthPerSecond: (d('arrivals') - completions) / seconds },
        inSystem: { now: b.state[o + F.inSystem], mean: L },
        sojournMs: W, waitMs: completions ? d('wait') / completions : null,
        serviceMs: { mean: completions ? d('service') / completions : null, ...percentiles(i, a.t, b.t) },
        little: spec.within || !L || W === null ? null : { L, lambdaW: throughput * W / 1000, error: Math.abs(L - throughput * W / 1000) / L } };
    }
    const elu = a.elu && b.elu ? performance.eventLoopUtilization(b.elu, a.elu).utilization : b.elu?.utilization ?? null;
    return { at: (b.t - origin) / 1000, windowSeconds: seconds, supervisorEventLoop: elu, stages: rows, verdict: verdict(rows), dropped };
  };
  if (tickMs > 0) {
    const tick = () => { ring.push(rates.snapshot()); if (ring.length > history) ring.shift(); };
    tick();
    rates.timer = setInterval(tick, tickMs);
    rates.timer.unref?.();
  }
  rates.stop = () => clearInterval(rates.timer);
  rates.publish = (path, intervalMs = 1000, options = {}) => {
    const write = () => {
      try {
        const view = rates.view(options);
        writeFileSync(`${path}.tmp`, JSON.stringify({ ...view, text: format(view) }));
        renameSync(`${path}.tmp`, path);
      } catch { }
    };
    const timer = setInterval(write, intervalMs);
    timer.unref?.();
    return () => { clearInterval(timer); write(); };
  };
  return rates;
}

export function verdict(rows) {
  const top = Object.entries(rows).filter(([, row]) => !row.within);
  const finite = top.filter(([, row]) => row.netUtilisation !== null && row.completionsPerSecond + row.arrivalsPerSecond > 0);
  const saturated = finite.filter(([, row]) => row.netUtilisation >= RULE.saturated && (row.queue.mean >= RULE.queue || row.queue.growthPerSecond > 0 || row.netUtilisation >= RULE.certain));
  const inside = name => Object.entries(rows).filter(([, row]) => row.within === name).map(([child, row]) => ({ stage: child, busyShare: row.utilisation ?? null }));
  if (saturated.length) {
    saturated.sort(([, x], [, y]) => (y.netUtilisation - x.netUtilisation) || (y.queue.mean - x.queue.mean));
    let [name, row] = saturated[0];
    const close = saturated.filter(([, other]) => row.netUtilisation - other.netUtilisation <= RULE.tie);
    if (close.length > 1) [name, row] = close.sort(([, x], [, y]) => y.queue.mean - x.queue.mean)[0];
    return { bottleneck: name, kind: 'saturated', reason: `net utilisation ${row.netUtilisation.toFixed(2)} of ${row.servers} server(s), mean queue ${row.queue.mean.toFixed(1)}`, inside: inside(name) };
  }
  const families = new Map();
  for (const [name, row] of top) {
    const key = row.group ?? name, family = families.get(key) ?? { L: 0, members: [] };
    family.L += row.inSystem.mean; family.members.push(name); families.set(key, family);
  }
  const ranked = [...families].sort(([, x], [, y]) => y.L - x.L);
  if (!ranked.length || ranked[0][1].L === 0) return { bottleneck: null, kind: 'idle', reason: 'no work in the window' };
  const [name, family] = ranked[0], unbounded = family.members.every(member => rows[member].netUtilisation === null);
  return { bottleneck: name, kind: unbounded ? 'population' : 'unsaturated', reason: `${family.L.toFixed(1)} candidates in ${name} on average; no stage at ${RULE.saturated} net utilisation with a queue`, members: family.members };
}

const fixed = (value, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits);
export function format(view) {
  const lines = [`stage rates at ${fixed(view.at)} s, window ${fixed(view.windowSeconds)} s, supervisor event loop ${fixed((view.supervisorEventLoop ?? NaN) * 100, 0)}%`,
    'stage            srv   arr/s   done/s   util   net  queue(now/mean/grow)   L     svc p50/p95 ms    W ms   L~λW'];
  for (const [name, row] of Object.entries(view.stages)) {
    const label = (row.within ? `  ${name}` : name).padEnd(16);
    lines.push(`${label} ${String(row.servers === 'unbounded' ? 'inf' : row.servers).padStart(4)} ${fixed(row.arrivalsPerSecond).padStart(7)} ${fixed(row.completionsPerSecond).padStart(8)} ${fixed(row.utilisation, 2).padStart(6)} ${fixed(row.netUtilisation, 2).padStart(5)}  ${`${fixed(row.queue.now, 0)}/${fixed(row.queue.mean)}/${fixed(row.queue.growthPerSecond)}`.padEnd(20)} ${fixed(row.inSystem.mean).padStart(5)}  ${`${fixed(row.serviceMs.p50)}/${fixed(row.serviceMs.p95)}`.padStart(14)} ${fixed(row.sojournMs).padStart(7)}  ${row.little ? `${fixed(row.little.error * 100, 0)}%` : '-'}`);
  }
  const v = view.verdict;
  lines.push(`bottleneck: ${v.bottleneck ?? 'none'} (${v.kind}) ${v.reason}`);
  return lines.join('\n');
}

export function loopStages({ cells = 1, lane = 0 } = {}) {
  return {
    'model:spec': { group: 'model' },
    'model:impl': { group: 'model' },
    cell: { servers: cells, queue: 'explicit' },
    'cell.compile': { servers: cells, within: 'cell' },
    'cell.gates': { servers: cells, within: 'cell' },
    ledger: { servers: 1 },
    ...(lane ? { tscheck: { servers: lane, queue: 'explicit' }, 'tscheck.check': { servers: lane, within: 'tscheck' }, 'tscheck.run': { servers: lane, within: 'tscheck' } } : {}),
  };
}
