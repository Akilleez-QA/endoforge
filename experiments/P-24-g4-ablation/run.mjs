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
const arms = [['A0', 'fresh', 'default'], ['A1', 'resume', 'default'], ['A2', 'fresh', 'auto'], ['A3', 'resume', 'auto']];
const fake = process.argv.includes('--fake'), output = resolve(process.env.P24_OUTPUT || ''), needs = process.env.P24_NEEDS_ROOT;
if (!process.env.P24_OUTPUT || !relative(root, output).split(sep).includes('..')) throw Error('P24_OUTPUT must be outside checkout');
if (!fake && (!needs || !process.env.ENDOFORGE_CODEX_CMD || !process.env.CODEX_HOME || !process.env.ENDOFORGE_ASC_CMD)) throw Error('needs root, Codex command/home and asc required');
const precommit = hash(await readFile(join(here, 'PRECOMMIT.md')));
assert.equal((await readFile(join(here, 'receipt/precommit.sha256'), 'utf8')).split(/\s/)[0], precommit);
await mkdir(output);
const base = { ...process.env, ENDOFORGE_CODEX_TEST_DOUBLE: fake ? '1' : '0' };
if (fake) Object.assign(base, { ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(root, 'core/runtime/test/fixtures/x1/fake-codex.mjs')]), CODEX_HOME: join(output, 'unused-client-home'), ENDOFORGE_ASC_CMD: join(root, 'core/runtime/test/fixtures/x1/fake-asc.mjs') });
const limit = fake ? Number(process.env.P24_LIMIT) || 2 : ids.length;
const rows = [], started = performance.now();
await writeFile(join(output, 'environment.json'), JSON.stringify({ precommit, testDouble: fake, node: process.version, concurrency: 10, started: new Date().toISOString() }, null, 2));
const pool = new IsolatePool({ hostPort: join(root, 'core/runtime/x1/host.mjs'), size: 10, isolation: 'thread' });
try {
  for (const [arm, session, effort] of arms) {
    await mkdir(join(output, arm));
    const env = { ...base, ENDOFORGE_CODEX_SESSION: session, ENDOFORGE_CODEX_EFFORT: effort }, requests = ids.slice(0, limit);
    let cursor = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (cursor < requests.length) {
        const id = requests[cursor++], total = performance.now(), directory = join(output, arm, id);
        let result;
        try {
          const need = fake && !needs ? `TEST DOUBLE ONLY: ${id}` : await readFile(join(needs, id, 'atoms/direct/in/need/NEED.md'), 'utf8');
          result = await runNeed({ need, directory, pool, env });
        } catch { result = { promoted: false, error: 'need read failed', timings: {} }; }
        const kernel = await readFile(join(directory, 'candidate/kernel.ts'), 'utf8').catch(() => null);
        const row = { arm, session, effort, id, promoted: Boolean(result.promoted), error: result.error ?? null,
          asserts: kernel === null ? null : (kernel.match(/\bassert\s*\(/g) || []).length, generate: result.timings?.generate ?? null, total: performance.now() - total };
        rows.push(row);
        await writeFile(join(output, arm, `${id}.json`), JSON.stringify({ ...row, result }, null, 2));
      }
    }));
  }
} finally { await pool.close(); }
await writeFile(join(output, 'rows.json'), JSON.stringify({ precommit, testDouble: fake, wallMs: performance.now() - started, rows }, null, 2));
console.log(JSON.stringify({ testDouble: fake, records: rows.length, promoted: rows.filter(r => r.promoted).length }));
