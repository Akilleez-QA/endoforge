import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
const here = fileURLToPath(new URL('./', import.meta.url)), root = resolve(here, '../..');
const ids = 'C-015 CC-036 CC-011 CC-014 CC-025 CC-027 C-007 C-019 CC-002 C-016 CC-001 CC-007 C-012 C-005 CC-026 CC-022 C-010 C-006 CC-013 CC-009'.split(' ');
const fake = process.argv.includes('--fake'), output = resolve(process.env.P22_OUTPUT || ''), needs = process.env.P22_NEEDS_ROOT;
if (!process.env.P22_OUTPUT || !relative(root, output).split(sep).includes('..')) throw Error('P22_OUTPUT must be outside checkout');
if (!fake && (!needs || !process.env.ENDOFORGE_CODEX_CMD || !process.env.CODEX_HOME || !process.env.ENDOFORGE_ASC_CMD)) throw Error('needs root, Codex command/home and asc required');
const precommit = hash(await readFile(join(here, 'PRECOMMIT.md')));
assert.equal((await readFile(join(here, 'receipt/precommit.sha256'), 'utf8')).split(/\s/)[0], precommit);
const manifest = await readFile(join(root, 'sources/SHA256SUMS'), 'utf8');
for (const line of manifest.trim().split('\n')) {
  const [digest, name] = line.split('  ');
  assert.equal(hash(await readFile(resolve(root, 'sources', name))), digest, 'source digest drift');
}
await mkdir(output);
const env = { ...process.env, ENDOFORGE_CODEX_TEST_DOUBLE: fake ? '1' : '0' };
if (fake) Object.assign(env, { ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(root, 'core/runtime/test/fixtures/x1/fake-codex.mjs')]), CODEX_HOME: join(output, 'unused-client-home'), ENDOFORGE_ASC_CMD: join(root, 'core/runtime/test/fixtures/x1/fake-asc.mjs') });
const width = Number(process.env.P29_WIDTH) || 10;
const add = 'Implement pure integer add(a,b) for integers in [-10,10]. Freeze six exact tests before code: (0,0)=0, (2,3)=5, (-4,3)=-1, (10,-10)=0, (-10,-10)=-20, (10,10)=20. Include complete declarative glue.';
const rows = [], cohorts = [], started = performance.now();
await writeFile(join(output, 'environment.json'), JSON.stringify({ precommit, testDouble: fake, node: process.version,
  sourceManifest: hash(await readFile(join(root, 'sources/SHA256SUMS'))), concurrency: width, terse: process.env.ENDOFORGE_CODEX_TERSE ?? null, selfCheck: process.env.ENDOFORGE_SELF_CHECK === "1", effort: process.env.ENDOFORGE_CODEX_EFFORT ?? null,  started: new Date().toISOString() }, null, 2));
for (const isolation of ['thread']) {
  await mkdir(join(output, isolation));
  const pool = new IsolatePool({ hostPort: join(root, 'core/runtime/x1/host.mjs'), size: width, isolation, prewarm: true });
  await pool.ready();
  try {
    for (const cohort of ["P21", "P19"]) {
      const requests = (cohort === 'P21' ? ids : Array.from({ length: 10 }, (_, i) => `add-${i + 1}`)).slice(0, fake ? Number(process.env.P22_LIMIT) || undefined : undefined);
      let cursor = 0;
      const start = performance.now();
      await Promise.all(Array.from({ length: width }, async () => {
        while (cursor < requests.length) {
          const id = requests[cursor++], total = performance.now();
          let read = null, result;
          try {
            const begin = performance.now();
            const need = cohort === 'P19' ? add : fake && !needs ? `TEST DOUBLE ONLY: ${id}` : await readFile(join(needs, id, 'atoms/direct/in/need/NEED.md'), 'utf8');
            read = performance.now() - begin;
            result = await runNeed({ need, directory: join(output, isolation, id), pool, env });
          } catch { result = { promoted: false, error: 'need read failed', timings: {} }; }
          const row = { id, isolation, cohort, ...result, testDouble: fake,
            timings: { ...Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null])), read, ...result.timings, total: performance.now() - total } };
          rows.push(row);
          await writeFile(join(output, isolation, `${id}.json`), JSON.stringify(row, null, 2));
        }
      }));
      cohorts.push({ isolation, cohort, wallMs: performance.now() - start });
    }
  } finally { await pool.close(); }
}
const stages = ['read', 'generate', 'freeze', 'compile', 'gate', 'ledger', 'promote', 'total'];
const summary = cohorts.map(cohort => {
  const selected = rows.filter(r => r.isolation === cohort.isolation && r.cohort === cohort.cohort);
  return { ...cohort, count: selected.length, promoted: selected.filter(r => r.promoted).length, stages: Object.fromEntries(stages.map(stage => {
    const values = selected.map(r => r.timings[stage]).filter(Number.isFinite).sort((a, b) => a - b);
    return [stage, { n: values.length, p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null }];
  })) };
});
await writeFile(join(output, 'summary.json'), JSON.stringify({ precommit, testDouble: fake, wallMs: performance.now() - started, cohorts: summary, rows }, null, 2));
console.log(JSON.stringify({ testDouble: fake, records: rows.length, promoted: rows.filter(r => r.promoted).length }));
if (rows.length !== (fake && Number(process.env.P22_LIMIT) ? Number(process.env.P22_LIMIT) * 2 : 30)) process.exitCode = 1;
