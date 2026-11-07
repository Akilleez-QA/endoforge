import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
const tree = resolve(process.argv[2]), load = path => import(join(tree, path));
const { IsolatePool } = await load('core/runtime/isolate-pool.mjs');
const { runNeed } = await load('core/runtime/x1/pipeline.mjs');
const { seeds } = await load('core/runtime/test/fixtures/x1/seeds.mjs');
const seed = seeds.find(item => item.name === 'infinite-loop'), root = mkdtempSync(join(tmpdir(), 'ef-p52-hang-'));
const env = { ...process.env, CODEX_HOME: join(root, 'h'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_ASC_CMD: join(tree, 'tools/asc/node_modules/.bin/asc'),
  ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(tree, 'core/runtime/test/fixtures/x1/fake-codex.mjs')]), FAKE_CODEX_KERNEL: seed.kernel, FAKE_CODEX_GLUE: seed.glue };
const pool = new IsolatePool({ hostPort: join(tree, 'core/runtime/x1/host.mjs'), size: 1 });
await pool.ready();
const begin = performance.now();
const outcome = await Promise.race([runNeed({ need: 'integer add(a,b)', directory: join(root, 'addition'), pool, env }), new Promise(done => setTimeout(() => done('no result'), Number(process.argv[3] ?? 60000)))]);
console.log(JSON.stringify({ tree, outcome: outcome === 'no result' ? outcome : { promoted: outcome.promoted, inconclusive: outcome.inconclusive ?? false, gateMs: outcome.timings?.gate }, seconds: (performance.now() - begin) / 1000 }));
rmSync(root, { recursive: true, force: true });
process.exit(0);
