import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
const log = process.env.P53_SPAWN_LOG;
if (log) {
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    const real = childProcess[name];
    childProcess[name] = function counted(command, ...rest) { appendFileSync(log, `${name} ${String(command).split('/').pop()}\n`); return real.call(this, command, ...rest); };
  }
  syncBuiltinESMExports();
}
