import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
const [tree, corpus, output] = process.argv.slice(2), load = path => import(resolve(tree, path));
const { loadCorpus } = await load('experiments/P-51-escape-rate/prepare.mjs');
const { runNeed } = await load('core/runtime/x1/pipeline.mjs');
const { createLoopPool } = await load('core/runtime/x1/loop.mjs');
const kernels = loadCorpus(corpus, 'cand');
process.env.ENDOFORGE_LOOP = 'isolate';
const pool = createLoopPool({ size: 1, primes: 8, jobTimeoutMs: 60000 });
await pool.ready();
const rows = [];
for (let pass = 0; pass < 3; pass++) for (const kernel of kernels) {
  const directory = join(output, `t${pass}-${kernel.key.replace(/\W/g, '-')}`), casePath = `${directory}.json`;
  mkdirSync(`${directory}.home`, { recursive: true });
  writeFileSync(casePath, JSON.stringify({ contract: kernel.contract, tests: kernel.testsText, kernel: kernel.source, glue: kernel.glue }));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, resolve(tree, 'experiments/P-51-escape-rate/replay-codex.mjs')]), CODEX_HOME: `${directory}.home`, ENDOFORGE_CODEX_TERSE: 'scalar', ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_SELF_CHECK: '0', P51_CASE: casePath };
  const begin = performance.now();
  const outcome = await runNeed({ need: `Replayed ${kernel.key} pass ${pass}`, directory, pool, env });
  rmSync(directory, { recursive: true, force: true }); rmSync(`${directory}.home`, { recursive: true, force: true }); rmSync(casePath, { force: true });
  rows.push({ key: kernel.key, pass, promoted: outcome.promoted, gate: outcome.timings?.gate, compile: outcome.timings?.compile, ledger: outcome.timings?.ledger, wall: performance.now() - begin });
}
await pool.close();
const quantile = (values, q) => values.sort((a, b) => a - b)[Math.floor(q * (values.length - 1))];
const warm = rows.filter(row => row.pass > 0);
console.log(JSON.stringify({ tree, kernels: kernels.length, promoted: rows.filter(row => row.pass === 0 && row.promoted).length, gate: { p50: quantile(warm.map(r => r.gate), 0.5), p95: quantile(warm.map(r => r.gate), 0.95) }, compile: { p50: quantile(warm.map(r => r.compile), 0.5) } }));
