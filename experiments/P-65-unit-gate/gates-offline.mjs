import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import { runGates } from '../../core/runtime/x1/gates.mjs';
import { unitFindings } from '../../core/runtime/x1/dimensions.mjs';
const [root, prep, output, surfaces = 'control,kernel,glue'] = process.argv.slice(2);
const sha = text => createHash('sha256').update(text).digest('hex');
const baselines = JSON.parse(readFileSync(join(prep, 'baselines.json'), 'utf8'));
const files = key => {
  const [run, id] = key.split('/'), dir = join(root, run, 'thread', id, 'candidate');
  return Object.fromEntries(['CONTRACT.md', 'tests.json', 'glue.json', 'kernel.ts', 'frozen.sha256'].map(n => [n, readFileSync(join(dir, n), 'utf8')]));
};
const cache = new Map(), wanted = surfaces.split(','), lines = [], gateMs = [];
const judge = row => {
  if (!cache.has(row.key)) cache.set(row.key, files(row.key));
  const base = cache.get(row.key), candidate = { ...base, ...(row.source ? { 'kernel.ts': row.source } : {}), ...(row.glue ? { 'glue.json': row.glue } : {}) };
  const result = runGates({ id: row.id, files: candidate, compiled: { wasm: row.wasm ?? baselines[row.key], source: sha(candidate['kernel.ts']) } });
  const outputs = (result.tests ?? []).map(t => ({ fn: t.fn, out: t.got, err: t.trap || (typeof t.got === 'string' && Number.isNaN(Number(t.got))) ? 'trap' : null }));
  const t0 = performance.now();
  let glue = null; try { glue = JSON.parse(candidate['glue.json']); } catch {}
  if (glue?.exports) unitFindings(glue, { source: candidate['kernel.ts'], outputs });
  gateMs.push(performance.now() - t0);
  const failed = Object.entries(result.gates).filter(([, g]) => !g.ok).map(([k]) => k);
  lines.push(JSON.stringify({ mutant: row.mutant, key: row.key, cohort: row.cohort, surface: row.surface, class: row.class, op: row.op, failed, units: result.gates.G9_units?.why ?? null, checks: result.gates.G9_units?.checks ?? null }));
};
const keys = Object.keys(baselines);
if (wanted.includes('control')) for (const key of keys) judge({ mutant: `${key}#control`, key, id: key.split('/')[1], cohort: key.includes('/add-') ? 'add' : 'P21', surface: 'control', class: 'control', op: 'pristine' });
for await (const line of createInterface({ input: createReadStream(join(prep, 'mutants.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (wanted.includes(row.surface)) judge(row);
}
writeFileSync(output, `${lines.join('\n')}\n`);
const sorted = gateMs.sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log(JSON.stringify({ rows: lines.length, unitGateMs: { p50: q(0.5), p95: q(0.95), max: sorted.at(-1) } }));
