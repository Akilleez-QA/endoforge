import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { RecordingTransport } from './record.mjs';

const [outputArg, ...ids] = process.argv.slice(2);
const output = resolve(outputArg);
mkdirSync(output, { recursive: true });
const file = join(output, 'streams.jsonl'), rows = [];
for (const id of ids) {
  const transport = new RecordingTransport({ model: 'sonnet', effort: 'low', file, label: id });
  const pool = createLoopPool({ provider: transport });
  await pool.ready();
  const begin = performance.now(), loadStart = loadavg()[0];
  const answer = await runNeed({ need: hNeeds.find(n => n.id === id).need, directory: join(output, id), pool, env: { ENDOFORGE_LOOP: 'agent' } });
  const wall = performance.now() - begin;
  await pool.close(); await transport.close();
  rows.push({ id, promoted: answer.promoted, status: answer.status, error: answer.error ?? null, calls: transport.calls, wall, model: answer.modelMs, timings: answer.timings, loadStart, loadEnd: loadavg()[0], inits: transport.inits });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(join(output, 'rows.json'), JSON.stringify(rows, null, 1));
