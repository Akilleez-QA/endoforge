// Exploratory (P-78 profile): CPU and wall a fresh x1 cell spends from spawn to ready (process start, compiler load, 8 primer rounds).
import { execFileSync } from 'node:child_process';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
const forbidden = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'];
if (forbidden.some(name => process.env[name] !== undefined)) throw Error('credential variables must be unset');
const [size = 1, reps = 5, ...flags] = process.argv.slice(2);
const cpuOf = pids => { const rows = execFileSync('ps', ['-o', 'pid=,time=', '-p', pids.join(',')], { encoding: 'utf8' }).trim().split('\n');
  return Object.fromEntries(rows.map(line => { const [pid, time] = line.trim().split(/\s+/); return [pid, time.split(':').reduce((t, p) => t * 60 + Number(p), 0)]; })); };
const kids = () => execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const out = [];
for (let r = 0; r < Number(reps); r++) {
  const begin = performance.now();
  const pool = createLoopPool({ size: Number(size), ...(flags.includes('noprimes') ? { primes: 0 } : {}) });
  await pool.ready();
  const wall = performance.now() - begin, cells = kids().filter(pid => pid !== String(pool.ledger.pid));
  const cpu = cpuOf(cells);
  out.push({ wallMs: Math.round(wall), cpuS: Object.values(cpu).map(v => +v.toFixed(2)) });
  await pool.close();
}
console.log(JSON.stringify({ size: Number(size), flags, reps: out }));
