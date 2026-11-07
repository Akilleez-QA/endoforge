import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
const [tree, corpus, baselines, output] = process.argv.slice(2), load = path => import(resolve(tree, path));
const { loadCorpus } = await load('experiments/P-51-escape-rate/prepare.mjs');
const { submit } = await load('experiments/P-51-escape-rate/run.mjs');
const { createLoopPool } = await load('core/runtime/x1/loop.mjs');
const kernels = loadCorpus(corpus, 'cand'), wasm = JSON.parse(readFileSync(baselines, 'utf8'));
process.env.ENDOFORGE_LOOP = 'isolate';
const pool = createLoopPool({ size: 1, primes: 8, jobTimeoutMs: 60000 });
await pool.ready();
const rows = [];
for (let pass = 0; pass < 3; pass++) for (const kernel of kernels) {
  const begin = performance.now();
  const outcome = await submit({ replay: { contract: kernel.contract, tests: kernel.testsText, kernel: kernel.source, glue: kernel.glue }, pool, asc: process.env.ENDOFORGE_ASC_CMD, scratch: output, name: `${pass}|${kernel.key}`, wasm: wasm[kernel.key] });
  rows.push({ key: kernel.key, pass, promoted: outcome.promoted, gate: outcome.timings?.gate, compile: outcome.timings?.compile, ledger: outcome.timings?.ledger, wall: performance.now() - begin });
}
await pool.close();
const quantile = (values, q) => values.sort((a, b) => a - b)[Math.floor(q * (values.length - 1))];
const warm = rows.filter(row => row.pass > 0);
console.log(JSON.stringify({ tree, kernels: kernels.length, promoted: rows.filter(row => row.pass === 0 && row.promoted).length, gate: { p50: quantile(warm.map(r => r.gate), 0.5), p95: quantile(warm.map(r => r.gate), 0.95) }, compile: { p50: quantile(warm.map(r => r.compile), 0.5) } }));
