import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, totalmem } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { scriptedProvider } from '../../core/runtime/x1/transports.mjs';
import { implementation, reply, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { withCapability } from '../../core/runtime/test/fixtures/x1/candidate.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';

const forbidden = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];
assert.deepEqual(forbidden.filter(name => process.env[name] !== undefined), [], 'credential variables must be unset');
const here = path => fileURLToPath(new URL(path, import.meta.url));
const [outputArg, stampArg, plan, isolationArg, sizeArg] = process.argv.slice(2);
const output = resolve(outputArg), receipt = here(`./receipt/${stampArg}`);
if (stampArg !== 'pilot') {
  const recorded = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(' ')[0];
  assert.equal(recorded, hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded digest');
}
mkdirSync(output, { recursive: true }); mkdirSync(receipt, { recursive: true });
const corpus = (await buildCorpus()).map(entry => ({ ...entry, contract: withCapability(entry.contract, entry.glue) }));
const known = new Map(corpus.map(entry => [entry.name, entry]));
const provider = scriptedProvider(async ({ messages }) => {
  const first = JSON.parse(messages[0].content), input = known.get(first.need.split(': ')[1]);
  return reply(stageOf(messages) === 'specification' ? specification(input) : implementation(input, first.id));
});
const sh = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
const vm = () => {
  const text = sh('vm_stat', []), page = Number(/page size of (\d+)/.exec(text)[1]);
  const get = name => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(text)?.[1] ?? NaN);
  const swap = /used = ([\d.]+)M/.exec(sh('sysctl', ['vm.swapusage']))[1];
  return { freeMb: get('Pages free') * page / 2 ** 20, compressorMb: get('Pages occupied by compressor') * page / 2 ** 20, storedInCompressorMb: get('Pages stored in compressor') * page / 2 ** 20,
    swapins: get('Swapins'), swapouts: get('Swapouts'), decompressions: get('Decompressions'), swapUsedMb: Number(swap),
    pressureLevel: Number(sh('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).trim()), freePercent: Number(sh('sysctl', ['-n', 'kern.memorystatus_level']).trim()),
    diskFreeGb: Number(sh('df', ['-g', output]).trim().split('\n').at(-1).trim().split(/\s+/)[3]) };
};
const tree = () => {
  const rows = sh('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm=']).trim().split('\n').map(line => line.trim().split(/\s+/)).map(([pid, ppid, rss, ...comm]) => ({ pid: +pid, ppid: +ppid, rssKb: +rss, comm: basename(comm.join(' ')) }));
  const set = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (!set.has(row.pid) && set.has(row.ppid)) { set.add(row.pid); grew = true; } }
  return rows.filter(row => set.has(row.pid));
};
const caps = state => (state.pressureLevel >= 4 ? 'memory pressure critical' : state.swapUsedMb > 8192 ? 'swap above 8 GB' : state.diskFreeGb < 20 ? 'free disk below 20 GB' : null);
let counter = 0;
async function work(pool, width, seconds, directory) {
  const walls = [], begin = performance.now(), stopAt = begin + seconds * 1000;
  let errors = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (performance.now() < stopAt) {
      const index = counter++, input = corpus[index % corpus.length], start = performance.now();
      const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(directory, `${input.name}-${index}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 2, maxTokens: 64000 } });
      walls.push(performance.now() - start); if (answer.promoted !== input.expectPromoted) errors += 1;
      rmSync(join(directory, `${input.name}-${index}`), { recursive: true, force: true });
    }
  }));
  const seconds_ = (performance.now() - begin) / 1000, sorted = walls.sort((a, b) => a - b);
  return { throughput: walls.length / seconds_, n: walls.length, wallP50: sorted[Math.floor(sorted.length / 2)], wallP95: sorted[Math.floor(sorted.length * 0.95)], errors };
}
async function onePerCell(pool, size, directory) {
  const walls = await Promise.all(Array.from({ length: size }, async () => {
    const index = counter++, input = corpus[index % corpus.length], start = performance.now();
    await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(directory, `${input.name}-${index}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 2, maxTokens: 64000 } });
    return performance.now() - start;
  }));
  const sorted = walls.sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
}
const result = { plan, commit: sh('git', ['-C', here('../../'), 'rev-parse', 'HEAD']).trim(), node: process.version, memoryGb: totalmem() / 2 ** 30, started: new Date().toISOString(), before: vm(), rows: [] };
const save = () => { result.finished = new Date().toISOString(); writeFileSync(join(receipt, `memory-${plan}${isolationArg ? `-${isolationArg}-${sizeArg}` : ''}.json`), JSON.stringify(result, null, 1)); };
const directory = mkdtempSync(join(output, `memory-${plan}-`));

if (plan === 'composition') {
  const script = `
    const m = () => { const u = process.memoryUsage(); return { rssMb: u.rss / 2 ** 20, heapUsedMb: u.heapUsed / 2 ** 20, heapTotalMb: u.heapTotal / 2 ** 20, externalMb: u.external / 2 ** 20, arrayBuffersMb: u.arrayBuffers / 2 ** 20 }; };
    const steps = { bare: m() };
    const tool = await import(${JSON.stringify(here('../assemblyscript-toolchain.mjs'))});
    const pin = await import(${JSON.stringify(here('../../tools/asc/pin.mjs'))});
    steps.toolchainImported = m();
    const source = 'export function add(a:i32,b:i32):i32{return a+b}';
    await tool.compile({ name: 'kernel', source }, pin.ASC_PATH, { flags: tool.x1Flags });
    steps.afterFirstCompile = m();
    for (let i = 0; i < 20; i++) await tool.compile({ name: 'kernel', source: source.replace('add', 'add' + i) }, pin.ASC_PATH, { flags: tool.x1Flags });
    steps.after21Compiles = m();
    globalThis.gc?.(); steps.afterGc = m();
    process.stdout.write(JSON.stringify(steps));`;
  const steps = sh(process.execPath, ['--expose-gc', '--input-type=module', '-e', script]);
  result.rows.push({ kind: 'composition', steps: JSON.parse(steps) });
} else if (plan === 'pool') {
  for (const [isolation, size] of [[isolationArg, Number(sizeArg)]]) {
    const before = tree().reduce((t, row) => t + row.rssKb, 0) / 1024;
    const pool = createLoopPool({ size, isolation, waits: 'release', provider });
    await pool.ready(); await pool.ledger.start();
    const warm = await work(pool, size, 8, directory);
    const rows = tree(), total = rows.reduce((t, row) => t + row.rssKb, 0) / 1024;
    const cells = rows.filter(row => row.pid !== process.pid && row.pid !== pool.ledger.pid && row.comm === 'node').map(row => row.rssKb / 1024);
    result.rows.push({ kind: 'pool', isolation, size, treeMb: total, grownMb: total - before, perCellMb: (total - before) / size, cellRssMb: cells, parentMb: rows.find(row => row.pid === process.pid).rssKb / 1024, writerMb: (rows.find(row => row.pid === pool.ledger.pid)?.rssKb ?? 0) / 1024, throughput: warm.throughput, errors: warm.errors, perGb: warm.throughput / (total / 1024) });
    console.log(JSON.stringify(result.rows.at(-1)));
    await pool.close(); await sleep(1000); save();
  }
} else if (plan === 'tiers') {
  const hot = createLoopPool({ size: 12, isolation: 'process', waits: 'release', provider });
  await hot.ready(); await hot.ledger.start();
  await work(hot, 12, 5, directory);
  const measure = async (label, ballast) => {
    const state = vm(), rssMb = tree().reduce((t, row) => t + row.rssKb, 0) / 1024;
    const hotRun = await work(hot, 12, 15, directory);
    const after = vm();
    const row = { label, ballastCells: ballast.length * 6, treeRssMb: rssMb, state, after, hot: hotRun, load: loadavg()[0] };
    result.rows.push(row); save(); console.log(JSON.stringify({ label, ballast: row.ballastCells, rssMb: Math.round(rssMb), thr: hotRun.throughput.toFixed(1), p95: hotRun.wallP95?.toFixed(0), swapMb: state.swapUsedMb, compMb: Math.round(state.compressorMb), free: state.freePercent, level: state.pressureLevel }));
    return row;
  };
  const ballast = [];
  await measure('hot-only', ballast);
  let stopped = null;
  for (let step = 0; step < 20 && !stopped; step++) {
    stopped = caps(vm());
    if (stopped || loadavg()[0] > 16) { stopped ||= 'load above 16'; break; }
    const pool = createLoopPool({ size: 6, isolation: 'process', waits: 'release', provider });
    await pool.ready(); await pool.ledger.start();
    await onePerCell(pool, 6, directory);
    ballast.push(pool);
    await sleep(20000);
    const row = await measure(`ballast-${ballast.length * 6}`, ballast);
    stopped = caps(row.after);
  }
  result.stopped = stopped;
  const idle = 60000; await sleep(idle);
  const idleState = vm();
  const pageIn = [];
  for (const [i, pool] of ballast.entries()) {
    const swapinsBefore = vm().swapins, decompBefore = vm().decompressions;
    const cold = await onePerCell(pool, 6, directory), warm = await onePerCell(pool, 6, directory), after = vm();
    pageIn.push({ pool: i, cold, warm, swapins: after.swapins - swapinsBefore, decompressions: after.decompressions - decompBefore });
    console.log(JSON.stringify(pageIn.at(-1)));
  }
  result.pageIn = { idleMs: idle, idleState, pools: pageIn };
  const all = ballast.length * 6 + 12;
  result.fullPool = [];
  for (const pool of ballast) result.fullPool.push(await work(pool, 6, 6, directory));
  for (const pool of ballast) await pool.close();
  await hot.close();
  result.fullPoolCells = all;
  const after = [];
  for (let i = 0; i < 6; i++) { await sleep(10000); after.push(vm()); }
  result.released = after;
  console.log('released swap MB', after.map(state => state.swapUsedMb).join(' '), 'stopped', stopped);
}
rmSync(directory, { recursive: true, force: true });
result.after = vm();
save();
