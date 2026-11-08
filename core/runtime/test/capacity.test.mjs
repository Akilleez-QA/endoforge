import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createController, createOccupancy, createShareMeter, createTuner, fairShare, occupancyCap, P67_TUNED_POLICY, parseCpuList, plan, probeMachine, TUNED_POLICY } from '../capacity/index.mjs';
import { createCohortSet } from '../contained/cohort-set.mjs';
import { createContainedRunner } from '../contained/runner.mjs';

const range = (low, high) => Array.from({ length: high - low + 1 }, (_, index) => low + index);
const SLICE = '/sys/fs/cgroup/user.slice/heavy.slice';
function host7950({ quota = '1792000 100000', affinity = '0-31', cpuset, files = {} } = {}) {
  const table = {
    '/proc/self/status': `Name:\tnode\nCpus_allowed_list:\t${affinity}\n`,
    '/proc/self/cgroup': '0::/user.slice/heavy.slice/job.scope\n',
    [`${SLICE}/cpu.max`]: quota,
    [`${SLICE}/memory.max`]: String(64 * 1073741824),
    [`${SLICE}/memory.current`]: String(16 * 1073741824),
    '/proc/meminfo': 'MemTotal: 131072000 kB\nMemAvailable:   100000000 kB\n',
    '/sys/fs/cgroup/user.slice/heavy.slice/job.scope/cpu.max': 'max 100000',
    ...(cpuset ? { [`${SLICE}/job.scope/cpuset.cpus.effective`]: cpuset } : {}),
    ...files,
  };
  for (const cpu of range(0, 31)) {
    const domain = cpu % 16 < 8 ? '0-7,16-23' : '8-15,24-31';
    table[`/sys/devices/system/cpu/cpu${cpu}/cache/index3/level`] = '3';
    table[`/sys/devices/system/cpu/cpu${cpu}/cache/index3/shared_cpu_list`] = domain;
    table[`/sys/devices/system/cpu/cpu${cpu}/topology/thread_siblings_list`] = `${cpu % 16},${cpu % 16 + 16}`;
  }
  return {
    read: path => { if (Object.hasOwn(table, path)) return table[path]; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
    exists: path => path === '/usr/bin/taskset', parallelism: 32, freeMb: 1000, os: 'linux', table,
  };
}

test('cpu lists parse ranges and reject garbage', () => {
  assert.deepEqual(parseCpuList('0-3,8,10-11\n'), [0, 1, 2, 3, 8, 10, 11]);
  assert.equal(parseCpuList('x'), null);
  assert.equal(parseCpuList(''), null);
});

test('the probe reads the tightest quota, cache domains, SMT and memory headroom', () => {
  const found = probeMachine(host7950());
  assert.equal(found.allotment, 17.92);
  assert.equal(found.quotaCgroup, SLICE);
  assert.equal(found.ownCgroup, `${SLICE}/job.scope`);
  assert.equal(found.domains.length, 2);
  assert.deepEqual(found.domains.map(domain => domain.cores), [8, 8]);
  assert.equal(found.cores, 16);
  assert.equal(found.smt, true);
  assert.equal(found.memory.headroomMb, 48 * 1024);
  assert.deepEqual(found.notes, []);
});

test('affinity and cpuset narrow the allotment below the quota', () => {
  const pinned = probeMachine(host7950({ affinity: '0-3' }));
  assert.equal(pinned.allotment, 4);
  assert.equal(pinned.domains.length, 1);
  assert.equal(pinned.smt, false);
  assert.equal(probeMachine(host7950({ cpuset: '0-7,16-23' })).allotment, 16);
  assert.equal(probeMachine(host7950({ quota: 'max 100000' })).allotment, 32);
});

test('without sysfs or cgroups the probe degrades to availableParallelism and says so', () => {
  const found = probeMachine({ read: () => { throw new Error('absent'); }, exists: () => false, parallelism: 6, freeMb: 512, os: 'darwin' });
  assert.equal(found.allotment, 6);
  assert.equal(found.domains.length, 1);
  assert.equal(found.taskset, null);
  assert.equal(found.memory.availableMb, 512);
  assert.ok(found.notes.length >= 3);
});

test('the plan splits a multi-domain allotment into pinned cohorts and keeps one cohort when small', () => {
  const shipped = plan({ probe: probeMachine(host7950()) });
  assert.equal(shipped.tuned, false);
  assert.equal(shipped.pinned, true);
  assert.deepEqual(shipped.cohorts.map(cohort => [cohort.width, cohort.max]), [[8, 8], [8, 8]]);
  assert.deepEqual(plan({ probe: probeMachine(host7950({ affinity: '0-3' })) }).cohorts.map(cohort => [cohort.width, cohort.cpus]), [[4, null]]);
  const big = plan({ probe: probeMachine(host7950()), policy: TUNED_POLICY });
  assert.equal(big.pinned, true);
  assert.equal(big.cap, 'occupancy');
  assert.deepEqual(big.cohorts.map(cohort => [cohort.width, cohort.max]), [[8, 27], [8, 27]]);
  const p67 = plan({ probe: probeMachine(host7950()), policy: P67_TUNED_POLICY });
  assert.equal(p67.cap, 'share');
  assert.deepEqual(p67.cohorts.map(cohort => [cohort.width, cohort.max]), [[8, 12], [8, 12]]);
  assert.deepEqual(big.cohorts[0].cpus, [...range(0, 7), ...range(16, 23)]);
  assert.equal(big.width, 16);
  const four = plan({ probe: probeMachine(host7950({ affinity: '0-3' })), policy: TUNED_POLICY });
  assert.deepEqual(four.cohorts.map(cohort => [cohort.width, cohort.max, cohort.cpus]), [[4, 12, null]]);
  assert.deepEqual(plan({ probe: probeMachine(host7950({ affinity: '0-3' })), policy: P67_TUNED_POLICY }).cohorts.map(cohort => [cohort.width, cohort.max]), [[4, 4]]);
  const squeezed = plan({ probe: probeMachine(host7950()), allotment: 3, policy: TUNED_POLICY });
  assert.equal(squeezed.pinned, false);
  assert.equal(squeezed.cohorts.length, 1);
  assert.ok(squeezed.notes.some(note => /too small/.test(note)));
  const queues = plan({ probe: probeMachine(host7950()), queues: 4, policy: TUNED_POLICY });
  assert.equal(queues.cohorts.length, 4);
  assert.deepEqual(queues.cohorts.map(cohort => cohort.queue), [0, 1, 2, 3]);
  const fixed = plan({ probe: probeMachine(host7950()), policy: { mode: 'fixed', width: 4, headroom: 1.25 } });
  assert.equal(fixed.tuned, false);
  assert.deepEqual(fixed.cohorts.map(cohort => [cohort.width, cohort.max]), [[4, 4], [4, 4]]);
});

const P63 = { 1: 112, 4: 356, 8: 448, 12: 595, 16: 664, 18: 623, 20: 647, 24: 578, 32: 454 };
const curve = width => { const known = Object.keys(P63).map(Number); const low = Math.max(...known.filter(w => w <= width)), high = Math.min(...known.filter(w => w >= width)); return low === high ? P63[low] : P63[low] + (P63[high] - P63[low]) * (width - low) / (high - low); };
function drive(tuner, rate, windows, { clock, cpu = () => 10 } = {}) {
  const widths = [];
  for (let index = 0; index < windows; index++) {
    clock.t += 1000;
    const r = rate(tuner.width, index);
    tuner.observe({ completions: r, elapsedMs: 1000, cpuMs: r * cpu(tuner.width) });
    widths.push(tuner.width);
  }
  return widths;
}

test('the tuner climbs the measured width curve to its knee and then holds', () => {
  const clock = { t: 0 };
  const tuner = createTuner({ start: 8, max: 32, now: () => clock.t });
  const widths = drive(tuner, curve, 120, { clock });
  assert.equal(tuner.phase, 'settled');
  assert.ok(Math.abs(tuner.width - 16) <= 2, `settled at ${tuner.width}`);
  assert.ok(curve(tuner.width) >= 0.95 * 664);
  const settleAt = tuner.history.findIndex(change => change.why === 'settle');
  assert.ok(settleAt >= 0 && tuner.history[settleAt].at <= 30000, 'settles within 30 windows');
  assert.equal(new Set(widths.slice(40)).size, 1);
});

test('the tuner prefers the narrower of two widths that deliver the same throughput', () => {
  const clock = { t: 0 };
  const tuner = createTuner({ start: 12, max: 24, now: () => clock.t });
  drive(tuner, width => Math.min(width, 6) * 100, 60, { clock });
  assert.equal(tuner.phase, 'settled');
  assert.ok(tuner.width >= 6 && tuner.width <= 7, `settled at ${tuner.width}`);
});

test('the tuner refuses growth whose marginal gain per cell is small or whose CPU cost jumps', () => {
  const clock = { t: 0 };
  const flat = createTuner({ start: 4, max: 16, now: () => clock.t });
  drive(flat, width => 400 + width * 5, 60, { clock });
  assert.ok(flat.width <= 5, `settled at ${flat.width}`);
  const costly = createTuner({ start: 4, max: 16, now: () => clock.t });
  drive(costly, width => 400 + width * 4.5, 60, { clock, cpu: width => 10 * width });
  assert.ok(costly.width <= 5);
});

test('once settled the tuner ignores noise, re-tunes on sustained drift, and changes at most once per hold', () => {
  const clock = { t: 0 };
  const tuner = createTuner({ start: 8, max: 32, now: () => clock.t });
  drive(tuner, (width, index) => curve(width) * (index % 2 ? 1.1 : 0.9), 60, { clock });
  const settled = tuner.width, changes = tuner.history.length;
  drive(tuner, (width, index) => curve(width) * (index % 2 ? 1.15 : 0.85), 120, { clock });
  assert.equal(tuner.width, settled);
  assert.equal(tuner.history.length, changes);
  drive(tuner, width => Math.min(width, 6) * 50, 200, { clock });
  assert.ok(tuner.width < settled);
  const late = tuner.history.filter(change => change.at > 60000 + 180000);
  const minutes = new Map();
  for (const change of tuner.history.filter(item => item.phase === 'settled')) minutes.set(Math.floor(change.at / 60000), (minutes.get(Math.floor(change.at / 60000)) || 0) + 1);
  assert.ok([...minutes.values()].every(count => count <= 1), JSON.stringify(late));
});

test('a rising bound does not re-tune a settled width inside the hold', () => {
  const clock = { t: 0 };
  const tuner = createTuner({ start: 8, max: 32, now: () => clock.t });
  drive(tuner, curve, 40, { clock });
  const changes = tuner.history.length;
  for (let step = 0; step < 40; step++) { clock.t += 1000; tuner.setBound(step % 2 ? 30 : 31); tuner.observe({ completions: curve(tuner.width), elapsedMs: 1000 }); }
  assert.equal(tuner.history.length, changes, 'a rising share inside the hold changes nothing');
  for (let step = 0; step < 40; step++) { clock.t += 1000; tuner.setBound(step % 2 ? 12 : 13); tuner.observe({ completions: curve(tuner.width), elapsedMs: 1000 }); }
  const after = tuner.history.slice(changes);
  assert.ok(after.length >= 1 && after.length <= 6, JSON.stringify(after));
  assert.ok(after.every(change => change.at <= after[0].at + 20000), 'noise inside the band stops causing changes');
});

test('a lower bound from contention clamps width after it persists', () => {
  const clock = { t: 0 };
  const tuner = createTuner({ start: 16, max: 32, now: () => clock.t });
  tuner.setBound(8);
  assert.equal(tuner.width, 16);
  tuner.setBound(9);
  assert.equal(tuner.width, 9);
  tuner.setBound(8);
  assert.equal(tuner.bound, 9, 'a change smaller than the band is ignored');
});

test('the share meter divides the quota with active peers in the shared slice', () => {
  const env = host7950();
  const found = probeMachine(env);
  const usage = { [SLICE]: 0, [`${SLICE}/job.scope`]: 0, [`${SLICE}/peer.scope`]: 0 };
  const read = path => { const dir = path.replace(/\/cpu\.stat$/, ''); if (path.endsWith('/cpu.stat') && dir in usage) return `usage_usec ${usage[dir]}\nthrottled_usec 0\n`; return env.read(path); };
  let fakeNow = 0;
  const original = performance.now;
  performance.now = () => fakeNow;
  try {
    const meter = createShareMeter(found, { read, list: () => ['job.scope', 'peer.scope', 'cpu.max'], isDir: path => path.endsWith('.scope') });
    fakeNow = 1000;
    usage[`${SLICE}/job.scope`] = 6e6; usage[`${SLICE}/peer.scope`] = 12e6; usage[SLICE] = 18e6;
    const busy = meter.sample();
    assert.equal(busy.othersCpus, 12);
    assert.equal(busy.peers, 1);
    assert.equal(busy.share, 8.96);
    fakeNow = 2000;
    usage[`${SLICE}/job.scope`] += 10e6; usage[SLICE] += 10e6;
    const alone = meter.sample();
    assert.equal(alone.peers, 0);
    assert.equal(alone.share, 17.92);
  } finally { performance.now = original; }
});

test('a fair share is max-min: idle peers leave their CPU, greedy peers get an equal split', () => {
  assert.equal(fairShare(17.92, []), 17.92);
  assert.equal(fairShare(17.92, [12]), 8.96);
  assert.equal(+fairShare(17.92, [3]).toFixed(2), 14.92);
  assert.equal(+fairShare(18, [2, 10, 10]).toFixed(2), 5.33);
  assert.equal(fairShare(18, [2, 3]), 13);
});

test('the share meter takes the whole allotment alone and a fair share beside a peer at every quota level', () => {
  const scope = `${SLICE}/job.scope`;
  const env = host7950({ affinity: '8-15,24-31', files: { [`${scope}/cpu.max`]: '800000 100000' } });
  const found = probeMachine(env);
  assert.equal(found.allotment, 8);
  assert.deepEqual(found.levels.map(level => [level.quota, level.branch]), [[8, null], [17.92, scope]]);
  const usage = { [SLICE]: 0, [scope]: 0, [`${SLICE}/peer.scope`]: 0 };
  const read = path => { const dir = path.replace(/\/cpu\.stat$/, ''); if (path.endsWith('/cpu.stat') && dir in usage) return `usage_usec ${usage[dir]}\nthrottled_usec 0\n`; return env.read(path); };
  let fakeNow = 0;
  const original = performance.now;
  performance.now = () => fakeNow;
  try {
    const meter = createShareMeter(found, { read, list: dir => dir === SLICE ? ['job.scope', 'peer.scope'] : [], isDir: path => path.endsWith('.scope') });
    fakeNow = 1000;
    usage[scope] = 8e6; usage[SLICE] = 8e6;
    const lone = meter.sample();
    assert.equal(lone.mode, 'lone');
    assert.equal(lone.share, 8);
    fakeNow = 2000;
    usage[scope] += 5.92e6; usage[`${SLICE}/peer.scope`] += 12e6; usage[SLICE] += 17.92e6;
    const shared = meter.sample();
    assert.equal(shared.mode, 'shared');
    assert.equal(shared.peers, 1);
    assert.equal(shared.share, 8, 'the job quota still binds below the slice fair share of 8.96');
    const wide = probeMachine(host7950());
    const usage2 = { [SLICE]: 0, [scope]: 0, [`${SLICE}/peer.scope`]: 0 };
    const read2 = path => { const dir = path.replace(/\/cpu\.stat$/, ''); if (path.endsWith('/cpu.stat') && dir in usage2) return `usage_usec ${usage2[dir]}\nthrottled_usec 0\n`; return env.read(path); };
    fakeNow = 3000;
    const meter2 = createShareMeter(wide, { read: read2, list: dir => dir === SLICE ? ['job.scope', 'peer.scope'] : [], isDir: path => path.endsWith('.scope') });
    fakeNow = 4000;
    usage2[scope] = 14.92e6; usage2[`${SLICE}/peer.scope`] = 3e6; usage2[SLICE] = 17.92e6;
    const light = meter2.sample();
    assert.equal(light.mode, 'shared');
    assert.equal(light.share, 14.92, 'a light peer keeps only what it uses');
    fakeNow = 5000;
    usage2[scope] += 5e6; usage2[`${SLICE}/peer.scope`] += 12.92e6; usage2[SLICE] += 17.92e6;
    const greedy = meter2.sample();
    assert.equal(greedy.share, 8.96, 'a greedy peer above the equal split does not ratchet this job below it');
    assert.equal(greedy.legacyShare, 8.96);
  } finally { performance.now = original; }
});

test('a peer that is starved for CPU counts as wanting an equal split, not just what it got', () => {
  const scope = `${SLICE}/job.scope`, peer = `${SLICE}/peer.scope`;
  const env = host7950();
  const found = probeMachine(env);
  const usage = { [SLICE]: 0, [scope]: 0, [peer]: 0 }, stall = { [peer]: 0 };
  const read = path => {
    const dir = path.replace(/\/cpu\.(stat|pressure)$/, '');
    if (path.endsWith('/cpu.stat') && dir in usage) return `usage_usec ${usage[dir]}\nthrottled_usec 0\n`;
    if (path.endsWith('/cpu.pressure') && dir in stall) return `some avg10=0.00 avg60=0.00 avg300=0.00 total=${stall[dir]}\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;
    return env.read(path);
  };
  let fakeNow = 0;
  const original = performance.now;
  performance.now = () => fakeNow;
  try {
    const meter = createShareMeter(found, { read, list: dir => dir === SLICE ? ['job.scope', 'peer.scope'] : [], isDir: path => path.endsWith('.scope') });
    fakeNow = 1000;
    usage[scope] = 14.92e6; usage[peer] = 3e6; usage[SLICE] = 17.92e6; stall[peer] = 0.05e6;
    assert.equal(meter.sample().share, 14.92, 'a peer that is not stalled wants only what it used');
    fakeNow = 2000;
    usage[scope] += 14.92e6; usage[peer] += 3e6; usage[SLICE] += 17.92e6; stall[peer] += 0.6e6;
    const starved = meter.sample();
    assert.equal(starved.share, 8.96);
    assert.equal(starved.levels[0].starved, 1);
  } finally { performance.now = original; }
});

test('occupancy is the CPU a cell spends per wall second, robust to one-window spikes and contention dips', () => {
  const meter = createOccupancy();
  for (const raw of [0.5, 0.5, 0.5]) meter.observe(raw * 1000, 1000);
  assert.equal(meter.u, 0.5);
  meter.observe(3000, 1000);
  assert.equal(meter.u, 0.5, 'a single spike is not the median');
  for (let index = 0; index < 5; index++) meter.observe(250, 1000);
  assert.ok(meter.u > 0.48 && meter.u <= 0.5, 'contention lowers the raw ratio, not the estimate');
  for (let index = 0; index < 400; index++) meter.observe(250, 1000);
  assert.ok(Math.abs(meter.u - 0.25) < 0.01, 'a lasting change is followed');
  assert.equal(meter.stats().windows, 409);
  assert.equal(occupancyCap({ share: 8.96, u: 0.5, max: 27 }), 23);
  assert.equal(occupancyCap({ share: 8.96, u: 1.2, max: 27 }), 10);
  assert.equal(occupancyCap({ share: 8.96, u: 0.1, max: 27 }), 27);
  assert.equal(occupancyCap({ share: 8.96, u: 0.5, max: 27, memoryCells: 6 }), 6);
});

function simulate({ policyPlan, cells = 0.5, allotment = 4, seconds = 240, share = () => ({ share: allotment, legacyShare: allotment, mode: 'lone', peers: 0 }) }) {
  let clock = 0, width = policyPlan.cohorts[0].width, cpu = 0;
  const controller = createController({ plan: policyPlan, apply: widths => { width = widths[0]; }, cpuMs: () => cpu, rssMb: () => 100 * width, backlog: () => 5,
    meter: { sample: share }, memory: { headroomMb: () => 64000 }, now: () => clock, windowMs: 1000, minCompletions: 1 });
  const trace = [];
  let inflight = 0;
  const fill = () => { while (inflight < width) { controller.started(); inflight += 1; } };
  fill();
  for (let second = 0; second < seconds; second++) {
    const busy = Math.min(width * cells, allotment), rate = Math.round(busy / cells * 20);
    for (let index = 0; index < rate; index++) {
      clock += 1000 / rate;
      cpu += busy * 1000 / rate;
      inflight -= 1;
      controller.completed(true);
      fill();
    }
    trace.push(width);
  }
  return { controller, trace };
}

test('the occupancy cap lets width pass the CPU count when cells wait, where the share cap could not', () => {
  const tunedPlan = { tuned: true, cap: 'occupancy', headroom: 1.25, allotment: 4, width: 4, cohorts: [{ width: 4, max: 12 }] };
  const occupancy = simulate({ policyPlan: tunedPlan });
  assert.ok(occupancy.controller.width >= 8 && occupancy.controller.width <= 10, `occupancy settled at ${occupancy.controller.width}`);
  assert.ok(Math.abs(occupancy.controller.occupancy.u - 0.5) < 0.05, `u ${occupancy.controller.occupancy.u}`);
  const shareCap = simulate({ policyPlan: { ...tunedPlan, cap: 'share', cohorts: [{ width: 4, max: 5 }] } });
  assert.ok(shareCap.controller.width <= 5, 'the share cap stops at 1.25 x share');
  const busy = simulate({ policyPlan: tunedPlan, cells: 1 });
  assert.ok(busy.controller.width >= 4 && busy.controller.width <= 5, `CPU-bound cells settle near the allotment, got ${busy.controller.width}`);
  const settle = occupancy.controller.tuner.history.find(change => change.why === 'settle');
  assert.ok(settle && settle.at <= 30000, 'settles within 30 s');
  assert.ok(occupancy.controller.tuner.history.filter(change => change.at > settle.at).length <= 1);
  const last = occupancy.controller.log.at(-1);
  assert.equal(last.mode, 'lone');
  assert.ok(last.cap >= 10 && last.u > 0.45);
});

test('the controller feeds windows to the tuner and pushes width changes to cohorts', () => {
  let clock = 0;
  const applied = [];
  const two = { tuned: true, headroom: 1.25, width: 8, cohorts: [{ width: 4, max: 12 }, { width: 4, max: 12 }] };
  const controller = createController({ plan: two, apply: widths => applied.push(widths), backlog: () => 5, meter: null, now: () => clock, windowMs: 1000, minCompletions: 1 });
  for (let step = 0; step < 4000; step++) { clock += 10; controller.completed(true); }
  assert.ok(applied.length >= 1);
  assert.ok(applied.every(widths => widths.length === 2 && widths[0] === widths[1]));
  const fixed = createController({ plan: { tuned: false, width: 8, cohorts: [{ width: 8, max: 8 }] }, apply: () => assert.fail('fixed plans never change') });
  fixed.completed(true);
  assert.equal(fixed.width, 8);
});

test('a runner width can change at run time within its capacity', async t => {
  const runner = createContainedRunner({ width: 1, maxWidth: 3 });
  t.after(() => runner.close());
  const job = { modules: { '/g/main.js': 'exports.main = () => { let x = 0; for (let i = 0; i < 3e7; i++) x += i % 7; return x; };' }, entry: '/g/main.js' };
  await runner.run(job);
  assert.equal(runner.setWidth(9), 3);
  const results = await Promise.all([runner.run(job), runner.run(job), runner.run(job)]);
  assert.ok(results.every(result => result.status === 'completed'), JSON.stringify(results.map(result => result.reason)));
  assert.equal(new Set(results.map(result => result.cell)).size, 3, 'three jobs ran side by side');
  assert.throws(() => runner.setWidth(0), /positive/);
  assert.throws(() => createContainedRunner({ width: 4, maxWidth: 2 }), /positive/);
});

test('a pinned cohort runs under the CPUs it was given', { skip: process.platform !== 'linux' }, async t => {
  const runner = createContainedRunner({ width: 1, affinity: [0] });
  t.after(() => runner.close());
  await runner.ready();
  const allowed = execFileSync('grep', ['Cpus_allowed_list', `/proc/${runner.pid}/status`], { encoding: 'utf8' });
  assert.match(allowed, /:\s*0\s*$/);
});

test('a cohort set dispatches to the cohort with the most free cells and reports one result per job', async () => {
  const fake = cohort => {
    let width = cohort.width, load = 0;
    return { get width() { return width; }, get load() { return load; }, pid: null, stats: { completed: 0 }, setWidth: value => { width = value; },
      ready: async () => {}, close: async () => {}, runChecked: async job => { load += 1; await new Promise(done => setTimeout(done, 5)); load -= 1; return { status: 'checked', job, cohort: cohort.name }; } };
  };
  const set = createCohortSet({ plan: { tuned: false, width: 3, cohorts: [{ width: 1, max: 1, name: 'a' }, { width: 2, max: 2, name: 'b' }] }, make: fake });
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => set.runChecked(index)));
  assert.deepEqual(results.map(result => result.job), range(0, 29));
  const counts = results.reduce((total, result) => ({ ...total, [result.cohort]: (total[result.cohort] || 0) + 1 }), {});
  assert.ok(counts.b > counts.a);
  assert.equal(set.width, 3);
});

test('the CLI prints the probe and plan as JSON for non-Node callers', () => {
  const cli = fileURLToPath(new URL('../capacity/cli.mjs', import.meta.url));
  const printed = JSON.parse(execFileSync(process.execPath, [cli, 'plan', '--queues=2', '--allotment=4'], { encoding: 'utf8' }));
  assert.equal(printed.interface, 1);
  assert.equal(printed.plan.allotment, 4);
  assert.ok(printed.plan.cohorts.length >= 1);
  assert.ok(Array.isArray(printed.probe.domains));
  assert.throws(() => execFileSync(process.execPath, [cli, 'plan', '--queues=x'], { stdio: 'pipe' }));
});
