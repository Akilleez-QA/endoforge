// The shared error taxonomy: 75 waits and retries with backoff, 78 stops at once, other failures pass through,
// and a gate that could not run is "unscored". Also the fan-out evals runner, retrofitted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, runTyped, unscored, isScored, StopError } from '../errors.mjs';
import { renderAndEval } from '../../hillclimb/lib/fanout-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), RUN = path.join(HERE, '../run-typed');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'errors-test-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
// A command that is busy (75) for its first N calls, then runs `then`.
const busy = (name, n, then) => { const c = path.join(tmp, `${name}.count`), p = path.join(tmp, `${name}.sh`);
  fs.writeFileSync(p, `#!/bin/sh\nn=$(cat ${c} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${c}\n[ $n -le ${n} ] && exit 75\n${then}\n`, { mode: 0o755 }); return p; };

test('classify: 0 ok, 75 transient, 78 stop, anything else fail', () => {
  assert.deepEqual([0, 75, 78, 1, 124, null].map(classify), ['ok', 'transient', 'stop', 'fail', 'fail', 'fail']);
  assert.deepEqual(unscored('guard down'), { scored: false, why: 'guard down' }); assert(!isScored(unscored('x'))); assert(isScored({ score: 3 }));
  assert.equal(new StopError('x').exitCode, 78);
});
test('runTyped waits out a busy guard with backoff, then succeeds', () => {
  const waits = [], r = runTyped([busy('a', 3, 'echo done')], { baseMs: 10, capMs: 25, sleep: (ms) => waits.push(ms) });
  assert.deepEqual([r.kind, r.attempts, r.stdout.trim()], ['ok', 4, 'done']); assert.deepEqual(waits, [10, 20, 25]);
});
test('runTyped gives up as transient after max wait; 78 and failures return at once', () => {
  const r = runTyped([busy('b', 99, 'exit 0')], { baseMs: 10, maxWaitMs: 35, sleep: () => {} });
  assert.equal(r.kind, 'transient'); assert(r.attempts >= 2);
  const s = runTyped([busy('c', 0, 'exit 78')], { sleep: () => assert.fail('no retry on 78') }); assert.deepEqual([s.kind, s.attempts], ['stop', 1]);
  const f = runTyped([busy('d', 0, 'exit 1')], { sleep: () => assert.fail('no retry on failure') }); assert.equal(f.kind, 'fail');
});
test('run-typed CLI: retries busy, passes 78 through loudly', () => {
  const ok = spawnSync(RUN, ['--base', '0.01', '--', busy('e', 2, 'exit 0')], { encoding: 'utf8' });
  assert.equal(ok.status, 0); assert.match(ok.stderr, /busy \(exit 75\); retrying/);
  const st = spawnSync(RUN, ['--', busy('f', 0, 'exit 78')], { encoding: 'utf8' }); assert.equal(st.status, 78); assert.match(st.stderr, /STOP/);
  assert.equal(spawnSync(RUN, [], { encoding: 'utf8' }).status, 2);
});
test('fan-out evals: a busy guard waits (the eval-round fix), 78 stops, a missing result is unscored', () => {
  const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo); spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x']);
  const c = (evals) => ({ id: 'e', repo, workdir: tmp, render: [{ id: 'r', command: ['true'] }], evals: { command: [evals, '${out}'] }, fanout: { busyBaseSec: 0.01 } });
  const write = busy('g', 2, 'echo \'{"findings":[]}\' > "$1/evals.json"');
  const okr = renderAndEval(c(write), 1, path.join(tmp, 'p1')); assert.equal(okr.scored, undefined); assert.deepEqual(okr.evals, { findings: [] });
  assert.throws(() => renderAndEval(c(busy('h', 0, 'exit 78')), 1, path.join(tmp, 'p2')), StopError);
  const un = renderAndEval(c(busy('i', 0, 'exit 1')), 1, path.join(tmp, 'p3')); assert.equal(un.scored, false); assert.match(un.why, /exited 1 without writing/);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all errors tests passed');
process.exit(fails ? 1 : 0);
