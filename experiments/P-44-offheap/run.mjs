import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { fixture } from '../../core/runtime/test/fixtures/ledger-fixture.mjs';

const [out, ...modes] = process.argv.slice(2);
const hostPort = fileURLToPath(new URL('./port.mjs', import.meta.url));
const capMb = 3072, size = 4, repetitions = 3;
const kinds = ['arraybuffer', 'typedarray', 'buffer', 'shared-arraybuffer', 'blob', 'wasm-memories', 'js-heap'];
const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const result = { node: process.version, capMb, modes, trials: [] };
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
for (const mode of modes) for (const kind of kinds) for (let rep = 0; rep < repetitions; rep++) {
  const { job, directory } = await fixture(t);
  const pool = new IsolatePool({ hostPort, size, isolation: mode === 'thread' ? 'thread' : 'process', jobTimeoutMs: 120000 });
  const barrier = join(directory, 'barrier'), release = join(directory, 'release'), progress = join(directory, 'progress.json');
  mkdirSync(barrier);
  const started = performance.now();
  const breach = pool.run(job(['pass'], { barrier, participants: size, alloc: { kind, capMb, progress } }));
  const siblings = Array.from({ length: size - 1 }, () => pool.run(job(['pass'], { barrier, participants: size, release })));
  const settled = await breach;
  const ms = Math.round(performance.now() - started);
  writeFileSync(release, 'go');
  const survivors = await Promise.all(siblings);
  const replacement = await pool.run(job(['pass'], {}));
  await pool.close();
  const trial = { mode, kind, rep, status: settled.status, reason: settled.reason, error: settled.error ?? null, signal: settled.signal ?? null,
    cgroup: settled.cgroup, outcome: settled.receipts[0].record.data.outcome_state, progress: read(progress), ms,
    siblingsLost: survivors.filter(r => r.status !== 'completed').length, replacement: replacement.status };
  result.trials.push(trial);
  console.log(JSON.stringify(trial));
}
for (const fn of cleanup) await fn();
result.hostPeakRssMiB = Math.round(Number(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024);
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
