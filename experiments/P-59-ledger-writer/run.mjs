import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { hash } from '../../core/runtime/x1/host.mjs';
import { capture, here, random, repository } from './common.mjs';

const [outputArg, stampArg, baselineArg, ...selected] = process.argv.slice(2);
const output = resolve(outputArg), receipt = here(`./receipt/${stampArg}`), baseline = resolve(baselineArg);
const precommit = readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1);
assert.equal(precommit, hash(readFileSync(here('./PRECOMMIT.md'))));
mkdirSync(output, { recursive: true });
mkdirSync(receipt, { recursive: true });
process.env.ENDOFORGE_LEDGER_JOURNAL = join(output, 'journal');
const summaryPath = join(receipt, 'summary.json');
const result = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : { arms: {}, crash: [] };
Object.assign(result, { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baseline, encoding: 'utf8' }).trim(), precommit, testDouble: true, node: process.version,
  python: execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim(), cpus: cpus()[0]?.model, parallelism: availableParallelism(), totalMemory: totalmem() });
result.started ??= new Date().toISOString();
if (!existsSync(join(output, 'capture.json'))) {
  const captured = await capture(output);
  writeFileSync(join(output, 'capture.json'), JSON.stringify({ streams: captured.streams, digest: captured.digest }));
}
const captured = JSON.parse(readFileSync(join(output, 'capture.json'), 'utf8'));
result.capture = { digest: captured.digest, kernels: captured.streams.length,
  requestsPerCandidate: captured.streams.reduce((total, stream) => total + stream.requests.length, 0) / captured.streams.length,
  modelCallsPerCandidate: captured.streams.reduce((total, stream) => total + stream.requests.reduce((sum, r) => sum + r.models, 0), 0) / captured.streams.length };
const save = () => { result.finished = new Date().toISOString(); writeFileSync(summaryPath, JSON.stringify(result, null, 1).replaceAll(output, '<work>')); };
const child = (script, options) => {
  const run = spawnSync(process.execPath, [here(script), JSON.stringify({ output, ...options })], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`${script} ${JSON.stringify(options)} exited ${run.status} ${run.signal}`);
  return run.stdout.trim().split('\n').at(-1);
};
const ledgerArms = {
  'ledger-new': { bridgeModule: join(repository, 'core/runtime/isolate-ledger.mjs'), count: 4096, width: 1024, seed: 59, journal: join(output, 'journal-ledger-new') },
  'ledger-old': { bridgeModule: join(baseline, 'core/runtime/isolate-ledger.mjs'), count: 1024, width: 1024, seed: 59 },
};
const loopArms = ['serial-hold', 'serial-release', 'swarm-hold', 'swarm-release', 'swarm-release-256'];
const points = ['after_apply', 'half_frame', 'after_sync', 'half_acks'];
for (const arm of selected) {
  if (ledgerArms[arm]) {
    const line = child('./ledger-arm.mjs', { name: arm, ...ledgerArms[arm] });
    result.arms[arm] = JSON.parse(line.replaceAll(output, '<work>'));
    console.log(arm, line);
  } else if (arm.startsWith('loop:')) {
    const name = arm.slice(5);
    assert(loopArms.includes(name));
    console.log(child('./loop-arm.mjs', { name }));
    result.arms[`loop-${name}`] = JSON.parse(readFileSync(join(output, `loop-${name}.json`), 'utf8')).summary;
  } else if (arm === 'crash') {
    const next = random(5959);
    result.crash = [];
    for (let trial = 0; trial < 24; trial++) {
      const point = points[trial % 4], lost = Math.floor(trial / 4) % 2 === 1, batch = 3 + Math.floor(next() * 18);
      const line = child('./crash-trial.mjs', { trial, point, batch, lost });
      result.crash.push(JSON.parse(line));
      console.log(line);
      save();
    }
  } else throw Error(`unknown arm ${arm}`);
  save();
}
save();
