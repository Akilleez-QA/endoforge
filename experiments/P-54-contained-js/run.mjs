import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ARMS } from './arms.mjs';
import { ASSUME_BREACH, ATTACKS, BENIGN, BREACHES, DEPTH, FATAL_KINDS } from './attacks.mjs';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.split('=')[1] : fallback; };
const scratch = resolve(flag('scratch', '.scratch/p54'));
mkdirSync(scratch, { recursive: true });
mkdirSync(output, { recursive: true });
const nodeVersion = process.versions.node;
const ivmPath = resolve(`.scratch/ivm-${nodeVersion}`);
const armOptions = (name, extra = {}) => ({ ...(name === 'isolated-vm' ? { modulePath: ivmPath } : {}), ...extra });
const CANARY = 'p54-canary-secret';
const canaryPath = join(scratch, 'canary.txt');
writeFileSync(canaryPath, CANARY);
process.env.EF_CANARY = `${CANARY}-env`;

const gate = async () => { while (Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]) > 26) await new Promise(done => setTimeout(done, 15000)); };
async function withListener(fn) {
  let connections = 0;
  const server = createServer(socket => { connections += 1; socket.destroy(); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try { return await fn(server.address().port, () => connections); } finally { server.close(); }
}
const decoyStart = () => spawn('sleep', ['600'], { stdio: 'ignore' });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const modulesOf = source => ({ '/guest/main.js': source });
const portHandlers = { echo: value => value, boom: () => { throw new TypeError('host-handler-boom'); } };

async function runAttack(arm, attack, port, connections, runner) {
  const marker = join(scratch, `${arm}-${attack.name}`);
  for (const suffix of ['.write', '.spawn']) rmSync(marker + suffix, { force: true });
  const decoy = decoyStart();
  await new Promise(done => decoy.once('spawn', done));
  const before = connections(), started = performance.now();
  const input = { canary: canaryPath, marker, port, decoy: decoy.pid };
  if (attack.input) Object.assign(input, JSON.parse('{"__proto__":{"polluted":"input"},"constructor":{"prototype":{"polluted":"input"}}}'));
  const result = await runner.run({ modules: modulesOf(attack.source), entry: '/guest/main.js', input, deadlineMs: attack.deadlineMs ?? 1500,
    ...(attack.ports ? { contract: { ports: attack.ports }, ports: portHandlers } : {}) });
  const elapsedMs = performance.now() - started;
  await new Promise(done => setTimeout(done, 120));
  const decoyAlive = alive(decoy.pid);
  decoy.kill('SIGKILL');
  const text = result.output ?? '';
  let guest = null;
  try { guest = JSON.parse(text); } catch {}
  const outside = { canaryInOutput: text.includes(CANARY), wrote: existsSync(`${marker}.write`), spawned: existsSync(`${marker}.spawn`), network: connections() > before, decoyKilled: !decoyAlive };
  const polluted = ({}).polluted !== undefined;
  const authority = Object.entries(outside).filter(([, value]) => value).map(([key]) => key);
  return { attack: attack.name, status: result.status, reason: result.reason ?? null, detail: result.detail?.slice(0, 160) ?? null, elapsedMs: Math.round(elapsedMs),
    authority, polluted, foreign: guest?.foreign ?? [], reached: guest?.reached ?? [], notes: guest?.notes ?? null,
    expectedReason: attack.expectReason ?? null, reasonOk: attack.expectReason ? attack.expectReason.includes(result.reason) : null };
}

async function control() {
  const rows = [];
  for (const attack of ATTACKS) {
    if (attack.ports) { rows.push({ attack: attack.name, skipped: 'arm has no port' }); continue; }
    const file = join(scratch, `control-${attack.name}`);
    const result = spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$@"', 'sh', process.execPath, new URL(import.meta.url).pathname, 'attacks', file, '--arms=vm-thread', `--only=${attack.name}`], { encoding: 'utf8', timeout: 60000 });
    const parsed = result.status === 0 ? JSON.parse(readFileSync(join(file, `attacks-${nodeVersion}.json`), 'utf8')).arms['vm-thread'].rows[0] : { attack: attack.name, status: 'supervisor_lost', reason: `exit ${result.status ?? result.signal}`, authority: [], foreign: [], detail: (result.stderr.split('\n').find(line => /FATAL/.test(line)) || '').slice(0, 160) };
    rows.push(parsed);
    console.log(JSON.stringify({ attack: parsed.attack, status: parsed.status, reason: parsed.reason, authority: parsed.authority }));
  }
  writeFileSync(join(output, `control-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, arm: 'vm-thread', rows }, null, 1));
}

async function attacks() {
  const arms = (flag('arms') || 'cohort-oneshot,cohort-reuse,cohort-cell,process-cell,isolated-vm').split(',');
  const only = flag('only')?.split(',');
  const summary = { node: nodeVersion, started: new Date().toISOString(), arms: {} };
  await withListener(async (port, connections) => {
    for (const arm of arms) {
      const runner = ARMS[arm](armOptions(arm, { width: 1 }));
      const rows = [];
      try {
        await runner.ready();
        for (const attack of ATTACKS) {
          if (only && !only.includes(attack.name)) continue;
          if (attack.ports && ['vm-thread', 'process-cell', 'isolated-vm'].includes(arm)) { rows.push({ attack: attack.name, skipped: 'arm has no port' }); continue; }
          const row = await runAttack(arm, attack, port, connections, runner);
          rows.push(row);
          if (flag('verbose')) console.log(arm, row.attack, row.status, row.reason, row.elapsedMs, row.authority.join() || '-', row.foreign.join() || '-');
        }
        const probe = await runner.run({ modules: modulesOf('exports.main = () => ({ polluted: ({}).polluted ?? null });'), entry: '/guest/main.js' });
        summary.arms[arm] = { rows, stats: runner.stats, residualProbe: probe.output ?? probe.reason };
      } catch (error) { summary.arms[arm] = { rows, error: error.message, stats: runner.stats }; }
      await runner.close();
      writeFileSync(join(output, `attacks-${nodeVersion}.json`), JSON.stringify(summary, null, 1));
    }
  });
  for (const [arm, data] of Object.entries(summary.arms)) {
    const rows = data.rows.filter(row => !row.skipped);
    console.log(arm, 'attacks', rows.length, 'authority', rows.filter(row => row.authority.length).map(row => `${row.attack}:${row.authority}`).join(' ') || 0, 'foreign', rows.filter(row => row.foreign.length).map(row => row.attack).join(' ') || 0, 'losses', data.stats?.cohortLosses ?? '-', data.error || '');
  }
}

async function breach() {
  const widths = (flag('widths') || '8,16').split(',').map(Number), reps = Number(flag('reps', 3));
  const arms = (flag('arms') || 'cohort-oneshot,cohort-cell,process-cell,isolated-vm').split(',');
  const kinds = Object.keys(BREACHES).concat(flag('fatal', '1') === '1' ? FATAL_KINDS : []);
  const spinRate = (() => { let total = 0; const started = performance.now(); for (let i = 0; i < 5e7; i++) total = (total + i * 31) % 1000003; return total >= 0 ? 5e7 / (performance.now() - started) : 0; })();
  const resume = join(output, `breach-${nodeVersion}.json`);
  const rows = existsSync(resume) ? JSON.parse(readFileSync(resume, 'utf8')).rows : [];
  for (const arm of arms) for (const width of widths) for (const kind of kinds) for (let rep = 0; rep < reps; rep++) {
    if (rows.some(row => row.arm === arm && row.width === width && row.kind === kind && row.rep === rep)) continue;
    await gate();
    const runner = ARMS[arm](armOptions(arm, { width, spare: width }));
    await runner.ready();
    const siblings = width - 1, spin = Math.round(spinRate * (FATAL_KINDS.includes(kind) ? 1500 : 400)), deadline = 300000;
    const started = performance.now();
    const breaches = BREACHES[kind] ?? ATTACKS.find(attack => attack.name === kind).source;
    const healthy = Array.from({ length: siblings }, () => runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin }, deadlineMs: deadline }));
    await new Promise(done => setTimeout(done, 100));
    let breachSettled;
    const breachResult = runner.run({ modules: modulesOf(breaches), entry: '/guest/main.js', deadlineMs: kind === 'loop' ? 300 : 20000, input: { canary: '', marker: join(scratch, 'x'), port: 1, decoy: 0 } }).then(result => { breachSettled = performance.now(); return result; });
    const finished = healthy.map(promise => promise.then(result => performance.now()));
    const results = await Promise.all([breachResult, ...healthy]);
    const overlapped = (await Promise.all(finished)).filter(at => at > breachSettled).length;
    const after = await runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 }, deadlineMs: 5000 });
    const lost = results.slice(1).filter(result => result.status !== 'completed' || !result.output.includes('"benign"')).length;
    rows.push({ arm, width, kind, rep, breacher: results[0].status, reason: results[0].reason, siblings, lost, overlapped, wholeMs: Math.round(performance.now() - started), replacementOk: after.status === 'completed', cohortLosses: runner.stats.cohortLosses, spawns: runner.stats.spawns ?? null });
    console.log(JSON.stringify(rows.at(-1)));
    await runner.close();
    writeFileSync(join(output, `breach-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, rows }, null, 1));
  }
}

async function assumeBreach() {
  const rows = [];
  await withListener(async (port, connections) => {
    for (const arm of ['breach-permission-only', 'breach-hardened-realm']) {
      const runner = ARMS[arm]({ width: 1 });
      await runner.ready();
      rows.push({ arm, ...await runAttack(arm, ASSUME_BREACH, port, connections, runner) });
      await runner.close();
    }
  });
  writeFileSync(join(output, `assume-breach-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, rows }, null, 1));
  for (const row of rows) console.log(row.arm, row.status, row.reason, row.detail, 'authority', row.authority.join() || 0, JSON.stringify(row.reached), JSON.stringify(row.notes));
}

async function deadlines() {
  const kinds = ['loop', 'loop-swallow', 'async-microtask-loop', 'async-thenable-chain', 'regex-catastrophe', 'bigint-big', 'sort-big', 'string-join', 'deep-json-stringify'];
  const arms = (flag('arms') || 'cohort-cell,process-cell,isolated-vm').split(','), reps = Number(flag('reps', 10)), deadline = 200, rows = [];
  for (const arm of arms) {
    const runner = ARMS[arm](armOptions(arm, { width: 1 }));
    await runner.ready();
    for (const kind of kinds) {
      await gate();
      const attack = ATTACKS.find(item => item.name === kind), overruns = [], reasons = {};
      for (let rep = 0; rep < reps; rep++) {
        const started = performance.now();
        const result = await runner.run({ modules: modulesOf(attack.source), entry: '/guest/main.js', deadlineMs: deadline });
        overruns.push(performance.now() - started - deadline);
        const key = result.reason || result.status;
        reasons[key] = (reasons[key] || 0) + 1;
      }
      rows.push({ arm, kind, reasons, overrunP50: +percentile(overruns, 0.5).toFixed(1), overrunP95: +percentile(overruns, 0.95).toFixed(1), overrunMax: +Math.max(...overruns).toFixed(1) });
      console.log(JSON.stringify(rows.at(-1)));
    }
    await runner.close();
    writeFileSync(join(output, `deadline-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, deadline, rows }, null, 1));
  }
}

async function determinism() {
  const arm = flag('arm', 'cohort-cell'), runner = ARMS[arm](armOptions(arm, { width: 2 }));
  await runner.ready();
  const rows = [];
  const guests = [['benign', BENIGN, { spin: 1e5 }], ['depth', DEPTH, null], ...['clock-random', 'globals-walk', 'codegen', 'prepare-stack', 'poison-tojson-output', 'ctor-function'].map(name => [name, ATTACKS.find(item => item.name === name).source, { canary: '/nonexistent', marker: '/nonexistent/m', port: 1, decoy: 999999 }])];
  guests.push(['math', 'exports.main = () => { const out = []; for (let i = 1; i < 300; i++) out.push(Math.sin(i), Math.exp(i / 50), Math.log(i), Math.pow(i, 1.7), Math.cbrt(i), Math.atan2(i, 3)); return { sorted: out.sort((a, b) => a - b).map(String), keys: Object.keys({ b: 1, a: 2, 10: 3, 2: 4 }), date: new Date(1e12).toISOString(), json: JSON.stringify({ a: [1, 2, { b: null }] }), split: "a,b".split(","), sym: String(Symbol("x")) }; };', null]);
  for (const [name, source, input] of guests) {
    const outputs = new Set();
    for (let rep = 0; rep < 5; rep++) { const result = await runner.run({ modules: modulesOf(source), entry: '/guest/main.js', input, deadlineMs: 5000 }); outputs.add(result.output ?? `refused:${result.reason}`); }
    rows.push({ name, distinct: outputs.size, sample: [...outputs][0].slice(0, 2000), sampleHash: createHash('sha256').update([...outputs].sort().join('|')).digest('hex') });
    console.log(name, 'distinct', outputs.size);
  }
  const granted = await runner.run({ modules: modulesOf('exports.main = () => [Date.now(), new Date().getTime(), Math.random(), Math.random()];'), entry: '/guest/main.js', contract: { grants: { clock: { fixedMs: 1000 }, random: { seed: 7 } } } });
  rows.push({ name: 'granted', distinct: 1, sample: granted.output ?? granted.reason, sampleHash: createHash('sha256').update(granted.output ?? '').digest('hex') });
  await runner.close();
  writeFileSync(join(output, `determinism-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, arm, rows }, null, 1));
}

async function spawnLoad() {
  const arm = flag('arm', 'cohort-cell'), mark = name => { try { statSync(`/__ef_mark__/${name}`); } catch {} };
  const runner = ARMS[arm](armOptions(arm, { width: 1 }));
  await runner.ready();
  await runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } });
  await new Promise(done => setTimeout(done, 300));
  mark('warm-begin');
  const n = Number(flag('n', 200));
  for (let i = 0; i < n; i++) { const result = await runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } }); if (result.status !== 'completed') throw new Error(result.reason); }
  mark('warm-end');
  const kinds = { deadline: BREACHES.loop, heap: BREACHES.heap, stack: BREACHES.stack, fatal: ATTACKS.find(item => item.name === 'map-table-limit').source };
  for (const [kind, source] of Object.entries(kinds)) {
    mark(`${kind}-begin`);
    await runner.run({ modules: modulesOf(source), entry: '/guest/main.js', deadlineMs: kind === 'deadline' ? 200 : 15000 });
    await new Promise(done => setTimeout(done, 500));
    mark(`${kind}-end`);
  }
  await runner.close();
}

async function spawnsPerCandidateControl() {
  const mark = name => { try { statSync(`/__ef_mark__/${name}`); } catch {} };
  mark('warm-begin');
  for (let i = 0; i < 5; i++) spawnSync(process.execPath, ['--permission', '-e', '1']);
  mark('warm-end');
}

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; };
const rssOf = pids => {
  let total = 0;
  for (const pid of pids) { try { total += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096; } catch {} }
  return total;
};
async function speed() {
  const arms = (flag('arms') || 'cohort-oneshot,cohort-reuse,cohort-cell,process-cell,isolated-vm,vm-thread').split(',');
  const widths = (flag('widths') || '1,8,16').split(',').map(Number), n = Number(flag('n', 200));
  const rows = [];
  for (const arm of arms) for (const width of widths) {
    await gate();
    const created = performance.now();
    const runner = ARMS[arm](armOptions(arm, { width }));
    await runner.ready();
    const readyMs = performance.now() - created;
    await new Promise(done => setTimeout(done, 300));
    const pids = runner.pids(), idleRss = rssOf(pids);
    const firstStart = performance.now();
    await runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } });
    const firstMs = performance.now() - firstStart;
    const latency = [], total = n * Math.max(1, width);
    let next = 0, peak = 0;
    const sampler = setInterval(() => { peak = Math.max(peak, rssOf(pids)); }, 20);
    const wallStart = performance.now();
    await Promise.all(Array.from({ length: width }, async () => {
      while (next < total) {
        next += 1;
        const start = performance.now();
        const result = await runner.run({ modules: modulesOf(BENIGN), entry: '/guest/main.js', input: { spin: 10 } });
        if (result.status !== 'completed') throw new Error(`benign refused: ${result.reason} ${result.detail}`);
        latency.push(performance.now() - start);
      }
    }));
    clearInterval(sampler);
    const wall = performance.now() - wallStart;
    const row = { arm, node: nodeVersion, width, readyMs: Math.round(readyMs), firstMs: +firstMs.toFixed(2), candidates: total, p50: +percentile(latency, 0.5).toFixed(2), p95: +percentile(latency, 0.95).toFixed(2), throughputPerS: +(total / wall * 1000).toFixed(1),
      idleRssMiB: +(idleRss / 1048576).toFixed(1), peakRssMiB: +(peak / 1048576).toFixed(1), peakPerCellMiB: +(peak / 1048576 / width).toFixed(1), load: readFileSync('/proc/loadavg', 'utf8').split(' ')[0] };
    rows.push(row);
    console.log(JSON.stringify(row));
    await runner.close();
    writeFileSync(join(output, `speed-${nodeVersion}.json`), JSON.stringify({ node: nodeVersion, rows }, null, 1));
  }
}

await { attacks, breach, speed, control, assumeBreach, deadlines, determinism, spawnLoad, spawnsPerCandidateControl }[mode]();
process.exit(0);
