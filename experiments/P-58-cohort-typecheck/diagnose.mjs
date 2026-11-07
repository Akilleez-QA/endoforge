// Diagnostic, not an acceptance figure: CPU per check for N concurrent checkers as Worker threads of one
// process against N separate processes, same pinned module and project, to see where per-check cost grows.
// node experiments/P-58-cohort-typecheck/diagnose.mjs <output dir> [--widths=1,8,16]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const CHILD = process.argv[2] === '--child';
const KERNEL = 'function toBaseFactor(u: u32): f64 { if (u == 0) return 1.0; if (u == 1) return 1000.0; return 0.0; }\nexport function convertUnit(value: f64, from: u32, to: u32): f64 { if (from == to) return value; const fa = toBaseFactor(from); const fb = toBaseFactor(to); if (fa == 0.0 || fb == 0.0) return NaN; return value * fa / fb; }\n';
const CHECKS = 60;
const body = `
  const { typecheck } = await import(${JSON.stringify(new URL('../../tools/tscheck/checker.mjs', import.meta.url).href)});
  const { projectFor } = await import(${JSON.stringify(new URL('../../tools/tscheck/contained-route.mjs', import.meta.url).href)});
  const project = projectFor(${JSON.stringify(KERNEL)});
  await typecheck(project, { emit: true });
  const cpu0 = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage(), t0 = performance.now();
  for (let i = 0; i < ${CHECKS}; i++) await typecheck(project, { emit: true });
  const cpu = process.threadCpuUsage ? process.threadCpuUsage(cpu0) : process.cpuUsage(cpu0);
  return { wallMs: (performance.now() - t0) / ${CHECKS}, cpuMs: (cpu.user + cpu.system) / 1000 / ${CHECKS} };`;
if (CHILD) {
  const run = new Function(`return (async () => {${body}})()`);
  process.stdout.write(JSON.stringify(await run()));
  process.exit(0);
}
const output = process.argv[2];
const widths = (process.argv.find(arg => arg.startsWith('--widths='))?.slice(9) || '1,8,16').split(',').map(Number);
mkdirSync(output, { recursive: true });
const load = () => Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
const threads = width => Promise.all(Array.from({ length: width }, () => new Promise((resolve, reject) => {
  const worker = new Worker(`(async () => {${body}})().then(r => require('node:worker_threads').parentPort.postMessage(r))`, { eval: true });
  worker.once('message', resolve); worker.once('error', reject);
}).finally(() => {})));
const processes = width => Promise.all(Array.from({ length: width }, () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--child'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  child.stdout.on('data', chunk => { text += chunk; });
  child.on('close', code => code === 0 ? resolve(JSON.parse(text)) : reject(new Error(`exit ${code}`)));
})));
const rows = [];
const mean = (items, key) => +(items.reduce((sum, item) => sum + item[key], 0) / items.length).toFixed(2);
for (const width of widths) for (const [kind, fn] of [['threads', threads], ['processes', processes]]) {
  const loadStart = load(), results = await fn(width);
  rows.push({ kind, width, checks: width * CHECKS, wallMsPerCheck: mean(results, 'wallMs'), cpuMsPerCheck: mean(results, 'cpuMs'), checksPerSecond: +(width * 1000 / mean(results, 'wallMs')).toFixed(1), loadStart, loadEnd: load() });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(join(output, `diagnose-${process.versions.node}.json`), JSON.stringify({ node: process.versions.node, note: 'diagnostic only, not an acceptance figure', rows }, null, 1));
process.exit(0);
