// Conductor stage 3: per-atom streaming with pluggable checks (stub workers, a stub slice render, stub critics).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle } from '../lib/handlers.mjs';
import { updateState, loadState } from '../lib/state.mjs';
import { scratch } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-stream-'));
let fails = 0; const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  pending.push(Promise.resolve().then(fn).then(() => done(), done)); };
// Each atom writes "meh" first and "good" once its prompt carries the critic's feedback; b3 never gets it right.
const setup = scratch(tmp, `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
case "$f" in *b3.txt) echo meh > "$f"; exit 0;; esac           # b3 never gets it right
if printf '%s' "$brief" | grep -q "failed its checks"; then echo good > "$f"; else echo meh > "$f"; fi
`);
const render = `cp game/$(echo \${atom} | tr A-Z a-z).txt \${out}/slice.txt`;
const critic = (log) => `start=$(date +%s%N); sleep 0.4; c=$(cat \${input}/slice.txt); echo "\${atom} $start $(date +%s%N)" >> ${log}; ` +
  `if [ "$c" = good ]; then echo '{"pass": true}' > \${out}; else echo '{"pass": false, "fix": "make it read good", "elements": [{"name": "reads good", "score": 0}]}' > \${out}; fi`;
const run = (f, ticks = 400) => conduct(f, { load: loadJob, handlers, tickMs: 50, maxTicks: ticks }).then(async (s) => { await idle(); return loadState(loadJob(f), f); });
const kinds = (f) => readEvents(loadJob(f), f).map((e) => e.kind);

test('each atom climbs on its own: slice render → critic → relaunch with the findings → frozen; a hopeless one escalates', async () => {
  const log = path.join(tmp, 'critic-1.log');
  const { f, d } = setup('climb', { 'b1.txt': 'bad', 'b2.txt': 'bad', 'b3.txt': 'never' }, { gate: null, maxIterations: 3, checkConcurrency: 3,
    slice: { command: render }, checks: [{ id: 'fidelity', json: true, run: critic(log) }] });
  const s = await run(f);
  assert.deepEqual(Object.fromEntries(Object.entries(s.atoms).map(([k, v]) => [k, [v.status, v.iter]])), { B1: ['frozen', 2], B2: ['frozen', 2], B3: ['needs-coordinator', 2] }, 'B3 failed the same way twice (U1): a decision, not a third retry');
  assert.match(fs.readFileSync(path.join(d, 'conductor/prompts/B1-i2.prompt'), 'utf8'), /failed its checks. Fix first:\n- fidelity: make it read good/);
  assert(fs.existsSync(path.join(d, 'conductor/slices/B1/i1/verdict.json')));
  const e = readEvents(loadJob(f), f).find((x) => x.kind === 'NEEDS-COORDINATOR'); assert.match(e.summary, /B3: failed the same way twice \(fidelity:reads good\)/);
  // checks of different atoms overlapped in time: no barrier, several at once
  const spans = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([a, b, e]) => [a, Number(b) / 1e6, Number(e) / 1e6]);
  const overlap = spans.some((x, i) => spans.some((y, j) => j !== i && x[0] !== y[0] && x[1] < y[2] && y[1] < x[2]));
  assert(overlap, `no two atoms' checks overlapped: ${JSON.stringify(spans)}`);
});
test('a check that cannot run is "not scored", retried, then wakes the coordinator; it never freezes the atom', async () => {
  const { f } = setup('unscored', { 'b1.txt': 'bad' }, { gate: null, maxUnscored: 2, busyWaitSec: 0.05, busyBaseSec: 0.01,
    checks: [{ id: 'busy', json: true, run: 'exit 75' }] });
  const s = await run(f, 60);
  assert.equal(s.atoms.B1.status, 'needs-coordinator'); assert.match(s.atoms.B1.last, /not scored: busy still busy/); assert.equal(s.atoms.B1.history.length, 0, 'not scored is not a failed iteration');
  assert.match(readEvents(loadJob(f), f).find((x) => x.kind === 'NEEDS-COORDINATOR').summary, /checks could not run 2 times/);
});
test('a check that reports 78 stops the whole job loudly', async () => {
  const { f } = setup('stop78', { 'b1.txt': 'bad' }, { gate: null, checks: [{ id: 'latch', run: 'exit 78' }] });
  const s = await run(f, 60);
  assert.equal(s.phase, 'done'); assert.match(s.stopped.why, /check latch for B1 exited 78/); assert.equal(kinds(f).at(-1), 'DONE');
});
test('a daemon restart resumes an atom that was mid-check', async () => {
  const { f, repo } = setup('resume', { 'b1.txt': 'good' }, { gate: null, checks: [{ id: 'fidelity', json: true, run: critic(path.join(tmp, 'critic-r.log')) }], slice: { command: render } });
  updateState(loadJob(f), f, (s) => { s.phase = 'streaming'; Object.assign(s.atoms.B1, { status: 'checking', iter: 1, sha: 'x' }); });
  const s = await run(f, 40);
  assert.equal(s.atoms.B1.status, 'frozen'); assert.equal(s.atoms.B1.iter, 1, 'resumed the check, no relaunch');
  assert.equal(fs.readFileSync(path.join(repo, 'game/b1.txt'), 'utf8').trim(), 'good');
});
await Promise.all(pending);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all conductor stream tests passed');
process.exit(fails ? 1 : 0);
