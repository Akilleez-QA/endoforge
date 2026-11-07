import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASELINE, createContainedRoute } from '../../tools/tscheck/contained-route.mjs';
import { globalScopeKernels } from '../../tools/tscheck/test/global-scope-kernels.mjs';

const [mode, output, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const hit = rest.find(item => item.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
mkdirSync(output, { recursive: true });
const node = process.versions.node;
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const LOADED = 16;
const gate = async () => { const until = Date.now() + 30 * 60000; while (load() > LOADED && Date.now() < until) await new Promise(done => setTimeout(done, 15000)); };
const percentile = (values, p) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2); };
const TICK = 100;
const cpuOf = pid => { try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14])) / TICK; } catch { return 0; } };
const rssOf = pid => { try { return Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096; } catch { return 0; } };
const MiB = bytes => +(bytes / 1048576).toFixed(1);
const save = (name, data) => writeFileSync(join(output, `${name}-${node}.json`), JSON.stringify({ node, ...data }, null, 1));
const ARMS = {
  supervisor: { check: 'supervisor' },
  fused: { check: 'fused', checker: { reuse: false, incremental: false } },
  'fused-reuse': { check: 'fused', checker: { reuse: { growthMb: 256 }, incremental: false } },
  'fused-reuse-base': { check: 'fused', checker: { reuse: { growthMb: 256 }, incremental: true } },
  'sibling-reuse-base': { check: 'sibling', checker: { reuse: { growthMb: 256 }, incremental: true } },
  'fused-base': { check: 'fused', checker: { reuse: false, incremental: true } },
  'fused-reuse16-base': { check: 'fused', checker: { reuse: { growthMb: 16 }, incremental: true } },
};
const NEW = flag('new', 'fused-reuse,fused-reuse-base,sibling-reuse-base,fused-base,fused-reuse16-base').split(',');
const routeFor = (arm, options) => createContainedRoute({ ...options, check: ARMS[arm].check, checker: { ...(ARMS[arm].checker || {}), ...(options.checker || {}) } });

async function needs(ascPath) {
  const asc = await import(pathToFileURL(resolve(ascPath, 'node_modules/assemblyscript/dist/asc.js')).href);
  const kernels = new URL('../P-15-workcell-concurrency/kernels/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', kernels)));
  const extract = (source, signature) => {
    const start = source.indexOf(signature);
    if (start < 0) return null;
    let depth = 0;
    for (let at = source.indexOf('{', start); at < source.length; at++) {
      if (source[at] === '{') depth += 1;
      if (source[at] === '}' && --depth === 0) return source.slice(start, at + 1);
    }
    return null;
  };
  const argumentSets = [[1, 0, 1], [2.5, 1, 2], [100, 3, 4], [7, 4, 0], [3, 6, 5], [1, 0, 99], [0, 2, 2], [12345.5, 5, 6]];
  const out = [];
  for (const { name } of manifest) {
    const whole = readFileSync(new URL(`${name}.ts`, kernels), 'utf8');
    const helper = extract(whole, 'function toBaseFactor'), convert = extract(whole, 'export function convertUnit');
    if (!helper || !convert) continue;
    const scalar = `${helper}\n${convert}\n`, files = {};
    const result = await asc.main(['kernel.ts', '-O3', '--runtime', 'stub', '--noColors', '--noAssert', '--outFile', 'out.wasm'],
      { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: file => file === 'kernel.ts' ? scalar : null, writeFile: (file, data) => { files[file] = data; }, listFiles: () => [] });
    if (result.error) continue;
    const instance = new WebAssembly.Instance(new WebAssembly.Module(files['out.wasm']), { env: { abort() { throw new Error('abort'); } } });
    const tests = argumentSets.map((args, index) => ({ name: `c${index}`, fn: 'convertUnit', args, expect: instance.exports.convertUnit(...args), tol: 1e-9 })).filter(test => Number.isFinite(test.expect));
    out.push({ name, scalar, whole, tests: JSON.stringify(tests) });
  }
  return out;
}
const candidateOf = (name, kernel, tests) => ({ name, files: { 'kernel.ts': kernel, 'tests.json': tests } });

async function route() {
  const widths = flag('widths', '1,8,16,32').split(',').map(Number), round = Number(flag('round', 1)), arms = flag('arms', Object.keys(ARMS).join(',')).split(',');
  const candidates = (await needs(flag('asc', '.scratch/asc'))).map(need => candidateOf(need.name, need.scalar, need.tests));
  const file = join(output, `route-round${round}-${node}.json`);
  const rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rows : [];
  for (const width of widths) for (const check of arms) {
    if (rows.some(row => row.check === check && row.width === width)) continue;
    await gate();
    const loadStart = load(), created = performance.now();
    const route = routeFor(check, { width, deadlineMs: 2000 });
    await route.ready();
    await Promise.all(Array.from({ length: width }, (_, index) => route.check(candidates[index % candidates.length])));
    const readyMs = performance.now() - created;
    const pool = route.pool, pid = pool.pid;
    const total = Math.max(400, 40 * width), latency = [], checkMs = [], outcomes = {};
    let accepted = 0, next = 0, peakCohort = 0, peakBoth = 0, peakSelf = 0;
    const stats0 = { ...pool.stats }, cpu0 = cpuOf(pid), self0 = process.cpuUsage();
    const sampler = setInterval(() => { const cohort = rssOf(pid), self = rssOf(process.pid); peakCohort = Math.max(peakCohort, cohort); peakSelf = Math.max(peakSelf, self); peakBoth = Math.max(peakBoth, cohort + self); }, 20);
    const wallStart = performance.now();
    await Promise.all(Array.from({ length: width }, async () => {
      while (next < total) {
        const index = next++, started = performance.now();
        const receipt = await route.check(candidates[index % candidates.length]);
        latency.push(performance.now() - started);
        checkMs.push(receipt.checkMs ?? 0);
        outcomes[`${receipt.status}:${receipt.reason}`] = (outcomes[`${receipt.status}:${receipt.reason}`] || 0) + 1;
        if (receipt.status === 'completed') accepted += 1;
      }
    }));
    const wall = performance.now() - wallStart;
    clearInterval(sampler);
    const self = process.cpuUsage(self0), selfCpu = (self.user + self.system) / 1e6, childCpu = cpuOf(pid) - cpu0, stats1 = pool.stats;
    const row = { check, width, round, attempts: total, accepted, outcomes, acceptedPerSecond: +(accepted / wall * 1000).toFixed(1), p50: percentile(latency, 0.5), p95: percentile(latency, 0.95),
      checkP50: percentile(checkMs, 0.5), readyMs: Math.round(readyMs),
      cpuMsPerAccepted: +((childCpu + selfCpu) / accepted * 1000).toFixed(2), cohortCpuMsPerAccepted: +(childCpu / accepted * 1000).toFixed(2), supervisorCpuMsPerAccepted: +(selfCpu / accepted * 1000).toFixed(2),
      peakRssMiB: MiB(peakBoth), peakPerActiveMiB: +(MiB(peakBoth) / width).toFixed(1), cohortPeakPerActiveMiB: +(MiB(peakCohort) / width).toFixed(1), cohortPeakRssMiB: MiB(peakCohort), supervisorPeakRssMiB: MiB(peakSelf),
      cohortStarts: stats1.cohortStarts - stats0.cohortStarts, ipcPerAttempt: +((stats1.messages - stats0.messages) / total).toFixed(2), samePid: pool.pid === pid, loadStart, loadEnd: load() };
    row.loaded = Math.max(row.loadStart, row.loadEnd) > LOADED;
    rows.push(row);
    console.log(JSON.stringify(row));
    await route.close();
    writeFileSync(file, JSON.stringify({ node, round, workload: { needs: candidates.length, names: candidates.map(item => item.name), deadlineMs: 2000 }, rows }, null, 1));
  }
}

const add = 'function add(a: i32, b: i32): i32 { return a + b; }';
const ADD_TESTS = JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]);
const adversarial = () => [
  ...globalScopeKernels().map(item => candidateOf(item.name, item.kernel, ADD_TESTS)),
  candidateOf('baseline-equal', BASELINE, ADD_TESTS),
  candidateOf('growth', `export ${add}\nexport type T0 = 0;\n${Array.from({ length: 12000 }, (_, index) => `export type T${index + 1} = T${index} | ${index + 1};`).join('\n')}\n`, ADD_TESTS),
];
const TRAP = candidateOf('trap', `export ${add}\nexport const deep = ${'('.repeat(50000)}1${')'.repeat(50000)};\n`, ADD_TESTS);
const shuffled = (items, seed) => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const other = seed % (index + 1);
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
};

async function parity() {
  const list = [];
  for (const need of await needs(flag('asc', '.scratch/asc'))) {
    const params = /export function convertUnit\(([^)]*)\)/.exec(need.scalar)[1].split(',').map(part => part.split(':')[0].trim());
    list.push(candidateOf(`${need.name}:asis`, need.scalar, need.tests));
    list.push(candidateOf(`${need.name}:type`, need.scalar.replace(/(export function convertUnit\([^)]*\)\s*:\s*f64\s*\{)/, '$1\n  return "x";'), need.tests));
    list.push(candidateOf(`${need.name}:wrong`, `${need.scalar.replace('export function convertUnit(', 'function convertUnitBase(')}\nexport function convertUnit(${/export function convertUnit\(([^)]*)\)/.exec(need.scalar)[1]}): f64 { return convertUnitBase(${params.join(', ')}) + 1; }\n`, need.tests));
    list.push(candidateOf(`${need.name}:whole`, need.whole, need.tests));
  }
  const corpus = list.length, all = [...list, ...adversarial()];
  const verdict = receipt => ({ status: receipt.status, reason: receipt.reason ?? null, passed: receipt.passed ?? null, total: receipt.total ?? null,
    diagnostics: (receipt.diagnostics || []).map(({ file, line, column, code }) => ({ file, line, column, code })), artifact: receipt.artifact ?? null });
  const settle = (route, item) => route.check(item).then(verdict, error => ({ status: 'threw', reason: error.message.slice(0, 80) }));
  const results = {};
  for (const arm of ['supervisor', 'fused', ...NEW]) {
    await gate();
    const route = routeFor(arm, { width: 8, deadlineMs: 2000 });
    results[arm] = await Promise.all(all.map(item => settle(route, item)));
    await route.close();
    console.log(arm, 'parallel done');
  }
  const diffs = [];
  const compare = (arm, against, names, got, want) => names.forEach((name, index) => {
    if (JSON.stringify(got[index]) !== JSON.stringify(want[index])) diffs.push({ arm, against, name, expected: want[index], got: got[index] });
  });
  const names = all.map(item => item.name);
  for (const arm of NEW) {
    compare(arm, 'fused', names, results[arm], results.fused);
    compare(arm, 'supervisor', names, results[arm], results.supervisor);
  }
  compare('fused', 'supervisor', names, results.fused, results.supervisor);
  const byName = Object.fromEntries(names.map((name, index) => [name, results.fused[index]]));
  const sequences = [];
  const trapFused = await (async () => { const route = routeFor('fused', { width: 1, deadlineMs: 2000 }); const out = await settle(route, TRAP); await route.close(); return out; })();
  for (const arm of ['fused', ...NEW]) for (const seed of [1, 2, 3]) {
    await gate();
    const route = routeFor(arm, { width: 1, spare: 1, deadlineMs: 2000 });
    const order = [TRAP, ...shuffled(all, seed)];
    const got = [];
    for (const item of order) got.push(await settle(route, item));
    const want = order.map(item => item === TRAP ? trapFused : byName[item.name]);
    const before = diffs.length;
    compare(`${arm}:sequence${seed}`, 'fused', order.map(item => item.name), got, want);
    sequences.push({ arm, seed, checks: order.length, diffs: diffs.length - before, dispatched: route.pool.stats.dispatched, cohortStarts: route.pool.stats.cohortStarts });
    await route.close();
    console.log(JSON.stringify(sequences.at(-1)));
  }
  const tally = Object.fromEntries(['supervisor', 'fused', ...NEW].map(arm => [arm, results[arm].reduce((sum, item) => { const key = `${item.status}:${item.reason}`; sum[key] = (sum[key] || 0) + 1; return sum; }, {})]));
  const libDiagnosed = results.fused.filter(item => item.diagnostics.some(d => !String(d.file).startsWith('/proj/'))).length;
  save(flag('name', 'parity'), { corpus, adversarial: all.length - corpus, trap: trapFused, libDiagnosed, tally, sequences, diffs, verdicts: names.map((name, index) => ({ name, fused: results.fused[index] })) });
  console.log(JSON.stringify({ candidates: all.length, diffs: diffs.length, diffArms: [...new Set(diffs.map(item => `${item.arm}/${item.against}`))], tally }));
}

async function fatal() {
  const width = 16, rows = [];
  const [first] = await needs(flag('asc', '.scratch/asc'));
  const good = candidateOf('good', first.scalar, first.tests);
  const bomb = candidateOf('bomb', `${first.scalar}\n${Array.from({ length: 150000 }, (_, index) => `const v${index}: string = 1;`).join('\n')}`, first.tests);
  const slow = candidateOf('slow', `${first.scalar}\n${Array.from({ length: 4000 }, (_, index) => `export const v${index}: number = ${index};`).join('\n')}`, first.tests);
  for (const check of NEW) for (let rep = 0; rep < 3; rep++) {
    await gate();
    const loadStart = load();
    let route = routeFor(check, { width, deadlineMs: 2000 });
    await route.ready();
    const batch = [bomb, ...Array.from({ length: width * 2 - 1 }, () => good)];
    const results = await Promise.all(batch.map(item => route.check(item)));
    const stats = route.pool.stats;
    rows.push({ kind: 'checker-heap', check, rep, attempts: batch.length, breacher: { status: results[0].status, reason: results[0].reason, detail: results[0].detail },
      neighboursCompleted: results.slice(1).filter(item => item.status === 'completed').length, neighbours: batch.length - 1, dispatched: stats.dispatched, cohortStarts: stats.cohortStarts, loadStart, loadEnd: load() });
    await route.close();
    route = routeFor(check, { width, deadlineMs: 2000 });
    await route.ready();
    await Promise.all(Array.from({ length: width }, () => route.check(good)));
    const before = { ...route.pool.stats };
    const pending = Array.from({ length: width * 2 }, () => route.check(slow).then(receipt => ({ receipt, at: performance.now() })));
    await new Promise(done => setTimeout(done, 40));
    const killedAt = performance.now();
    process.kill(route.pool.pid, 'SIGKILL');
    const settled = await Promise.all(pending);
    const after = route.pool.stats;
    const firstAfter = Math.min(...settled.filter(item => item.receipt.status === 'completed').map(item => item.at));
    rows.push({ kind: 'cohort-kill', check, rep, attempts: width * 2, unknown: settled.filter(item => item.receipt.status === 'outcome_unknown').length,
      unknownReasons: [...new Set(settled.filter(item => item.receipt.status === 'outcome_unknown').map(item => item.receipt.reason))],
      completed: settled.filter(item => item.receipt.status === 'completed').length, dispatched: after.dispatched - before.dispatched, cohortStarts: after.cohortStarts - before.cohortStarts,
      lossToFirstResultMs: Math.round(firstAfter - killedAt), loadStart, loadEnd: load() });
    console.log(JSON.stringify(rows.at(-2)), JSON.stringify(rows.at(-1)));
    await route.close();
  }
  save(flag('name', 'fatal'), { width, rows });
}

await { route, parity, fatal }[mode]();
process.exit(0);
