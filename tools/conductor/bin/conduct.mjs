#!/usr/bin/env node
// endoforge conduct <job.json>            start the job's Conductor as a systemd user service (heavy.slice, restarts on
//                                        failure, resumes from <jobdir>/conductor/state.json)
// conduct.mjs run <job.json> [--tick S] [--max-ticks N]   the daemon in the foreground (what the service runs)
// conduct.mjs unit <job.json> [--dry-run]
// conduct.mjs status|go|lock|pause|resume|budget|stop <job.json> …   also as `endoforge job <command>`
//   go     --sha <card sha> --by <user> --words "<their words>"      the user's go on the staged card
//   lock   <atom> --by <user> --words "<their words>"                a taste lock
//   budget [--launches N] [--iterations N] [--by … --words …]        raising it is spend: the user's words
//   stop   [--by <who>] [--why <text>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import * as C from '../lib/commands.mjs';
import { conduct } from '../lib/daemon.mjs';
import { loadState } from '../lib/state.mjs';

const HERE = fileURLToPath(import.meta.url);
export async function main(argv) {
  const [cmd, file, ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i < 0 ? undefined : rest[i + 1]; };
  const o = { by: flag('--by'), words: flag('--words'), via: flag('--via'), sha: flag('--sha'), why: flag('--why'), launches: flag('--launches'), iterations: flag('--iterations') };
  if (!file) { console.error(fs.readFileSync(HERE, 'utf8').split('\n').slice(1, 12).join('\n')); return 2; }
  const f = path.resolve(file), job = loadJob(f), out = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
  try {
    if (cmd === 'run') { const { handlers } = await import('../lib/handlers.mjs').catch(() => ({ handlers: {} }));
      const s = await conduct(f, { load: loadJob, handlers, tickMs: Number(flag('--tick') ?? 5) * 1000, maxTicks: Number(flag('--max-ticks') ?? Infinity) }); out(`phase ${s.phase}`); return 0; }
    if (cmd === 'unit') {
      const unit = `endoforge-conductor-${job.id}`;
      const a = ['systemd-run', '--user', `--unit=${unit}`, '--slice=heavy.slice', '--property=Restart=on-failure', '--property=RestartSec=10', `--setenv=PATH=${process.env.PATH}`,
        '--', process.execPath, HERE, 'run', f];
      if (rest.includes('--dry-run')) { out(a.join(' ')); return 0; }
      const r = spawnSync(a[0], a.slice(1), { stdio: 'inherit' }); if (r.status === 0) out(`${unit} started; endoforge job status ${f}`); return r.status ?? 1;
    }
    if (cmd === 'status') { out(C.status(job, f)); return 0; }
    if (cmd === 'go') { const s = C.go(job, f, o); out(`phase ${s.phase}`); return 0; }
    if (cmd === 'lock') { C.lock(job, f, rest[0], o); out(`${rest[0]} locked`); return 0; }
    if (cmd === 'pause') { C.pause(job, f, o.why); out('paused'); return 0; }
    if (cmd === 'resume') { C.resume(job, f); out('resumed'); return 0; }
    if (cmd === 'budget') { const s = C.budget(job, f, o); out(JSON.stringify(s.budget)); return 0; }
    if (cmd === 'stop') { C.stop(job, f, o); out('stop requested; the conductor stops its lanes and ends the job'); return 0; }
    console.error(`unknown command ${cmd}`); return 2;
  } catch (e) { console.error(`conduct ${cmd}: ${e.message}`); return e.exitCode ?? 1; }
}
export { loadState };
if (process.argv[1] && fs.realpathSync(process.argv[1]) === HERE) process.exitCode = await main(process.argv.slice(2));
