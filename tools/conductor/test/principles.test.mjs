// Universal principles from the live run, as Conductor mechanism (job specifics are data in these tests' manifests):
// U2 measured outcomes, U3 knowledge written back, U4 dependency-consistent checks, U5 stable measures, U6 per-item
// ratchet. (U1, the same failure twice escalates, is covered in launch.test.mjs and stream.test.mjs.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { compileAtom } from '../../job/lib/compile.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle } from '../lib/handlers.mjs';
import { loadState } from '../lib/state.mjs';
import { items } from '../lib/checks.mjs';
import { scratch } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), JOBCLI = path.join(HERE, '../../job/bin/job.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-principles-'));
let fails = 0; const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  pending.push(Promise.resolve().then(fn).then(() => done(), done)); };
// One worker for every test, driven by the file's first line and the feedback in its compiled prompt.
const setup = scratch(tmp, `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
has() { printf '%s' "$brief" | grep -q "$1"; }
case "$(head -1 "$f")" in
  level*) if has "measured 5, target 10"; then echo "level 10" > "$f"; else echo "level 5" > "$f"; fi;;
  up*) if has "failed its checks"; then echo "up v2" > "$f"; else echo "up v1" > "$f"; fi;;
  down*) echo "down ok" > "$f";;
  items*) if has "REVERTED"; then echo "items AB" > "$f"; elif has "failed its checks"; then echo "items" > "$f"; else echo "items A" > "$f"; fi;;
esac
`);
const run = (f, ticks = 300) => conduct(f, { load: loadJob, handlers, tickMs: 50, maxTicks: ticks }).then(async () => { await idle(); return loadState(loadJob(f), f); });
const firstNeeds = (f) => readEvents(loadJob(f), f).find((e) => e.kind === 'NEEDS-COORDINATOR');
// A JSON critic over named items: A passes when the atom's file contains A, B when it contains B.
const critic = `t=$(cat \${files}); a=false; b=false; case "$t" in *A*) a=true;; esac; case "$t" in *B*) b=true;; esac; ` +
  `p=false; [ $a = true ] && [ $b = true ] && p=true; echo "{\\"pass\\": $p, \\"fix\\": \\"make A and B both show\\", \\"findings\\": [{\\"name\\": \\"A\\", \\"pass\\": $a}, {\\"name\\": \\"B\\", \\"pass\\": $b}]}" > \${out}`;

test('U2: a measured outcome is compared with its target ± tolerance, and the measurement goes into the feedback', async () => {
  const { f, d } = setup('measure', { 'b1.txt': 'level 0' }, { gate: null, maxIterations: 3, checks: [{ id: 'level', measure: "sed 's/level //' ${files}", target: 10, tolerance: 1 }] });
  const s = await run(f);
  assert.deepEqual([s.atoms.B1.status, s.atoms.B1.iter], ['frozen', 2]);
  assert.match(fs.readFileSync(path.join(d, 'conductor/prompts/B1-i2.prompt'), 'utf8'), /- level: measured 5, target 10 ± 1/);
});
test('U4: when an upstream atom lands a newer candidate, its downstream atoms are re-checked against it', async () => {
  const seen = path.join(tmp, 'down-seen.txt');
  const { f } = setup('depends', { 'b1.txt': 'up v0', 'b2.txt': 'down v0' }, { gate: null, maxIterations: 3, checks: [
    { id: 'up', atoms: ['B1'], run: 'grep -q "up v2" ${files}' },
    { id: 'down', atoms: ['B2'], run: `cat game/b1.txt >> ${seen}; true` }] }, (j) => { j.atoms.find((a) => a.id === 'B2').dependsOn = ['B1']; });
  const s = await run(f);
  assert.deepEqual(Object.values(s.atoms).map((a) => a.status), ['frozen', 'frozen']); assert.equal(s.atoms.B2.iter, 1, 're-checked, not relaunched');
  const lines = fs.readFileSync(seen, 'utf8').trim().split('\n');
  assert.equal(lines.at(-1), 'up v2', `the last check of B2 saw the current upstream: ${lines}`);
  assert.deepEqual(s.atoms.B2.checkedAgainst, { B1: s.atoms.B1.sha });
});
test('U5: a judged item list is frozen on first use; a check that changes its items is unstable and not acted on', async () => {
  const c = path.join(tmp, 'n.txt');
  const shifty = `n=$(cat ${c} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${c}; ` +
    `if [ $n -eq 1 ]; then echo '{"pass": false, "fix": "x", "findings": [{"name": "A", "pass": false}]}' > \${out}; else echo '{"pass": false, "fix": "x", "findings": [{"name": "Z", "pass": false}]}' > \${out}; fi`;
  const { f, d } = setup('rubric', { 'b1.txt': 'items' }, { gate: null, maxIterations: 4, checks: [{ id: 'crit', json: true, run: shifty }] });
  const s = await run(f);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'conductor/slices/B1/rubric-crit.json'), 'utf8')).items, ['A']);
  assert.equal(s.atoms.B1.status, 'landed'); assert.match(firstNeeds(f).summary, /check crit is unstable \(crit is unstable: its item list changed \(A → Z\)/);
});
test('U5: two runs of a check on the same slice that disagree mark it unstable (its own noise)', async () => {
  const c = path.join(tmp, 'flip.txt');
  const flip = `n=$(cat ${c} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${c}; [ $((n % 2)) -eq 1 ] && p=true || p=false; echo "{\\"pass\\": $p}" > \${out}`;
  const { f } = setup('noise', { 'b1.txt': 'items' }, { gate: null, checks: [{ id: 'coin', json: true, noiseRuns: 2, run: flip }] });
  const s = await run(f, 60);
  assert.notEqual(s.atoms.B1.status, 'frozen'); assert.match(firstNeeds(f).summary, /coin is unstable \(coin is unstable: two runs on the same slice disagree/);
});
test('U6: a change that regresses a passing item and improves none is reverted; the keep-list is in the feedback', async () => {
  const { f, d, repo } = setup('ratchet', { 'b1.txt': 'items' }, { gate: null, maxIterations: 4, checks: [{ id: 'fid', json: true, run: critic }] });
  const s = await run(f);
  assert.deepEqual([s.atoms.B1.status, s.atoms.B1.iter], ['frozen', 3]);
  const p2 = fs.readFileSync(path.join(d, 'conductor/prompts/B1-i2.prompt'), 'utf8'), p3 = fs.readFileSync(path.join(d, 'conductor/prompts/B1-i3.prompt'), 'utf8');
  assert.match(p2, /Keep passing \(do not regress\): fid: A/);
  assert.match(p3, /Your change was REVERTED: it regressed fid: A and improved nothing/);
  assert.match(spawnSync('git', ['-C', repo, 'log', '--format=%s'], { encoding: 'utf8' }).stdout, /^Revert /m);
  assert.equal(fs.readFileSync(path.join(repo, 'game/b1.txt'), 'utf8').trim(), 'items AB');
  assert.deepEqual(items([{ name: 'a', score: 2 }, { name: 'b', score: 0 }, { name: 'c', score: 'later' }], 2), { a: true, b: false });
});
test('U3: knowledge found during the run is added with its source and reaches the atoms whose tags match', () => {
  const { f } = setup('knowledge', { 'b1.txt': 'x', 'b2.txt': 'x' }, {});
  const add = (...a) => spawnSync(process.execPath, [JOBCLI, 'knowledge', f, 'add', ...a], { encoding: 'utf8' });
  assert.equal(add('--text', 'the API takes degrees, not radians').status, 2, 'a fact needs its source');
  assert.equal(add('--text', 'the API takes degrees, not radians', '--source', 'run 3, B1 gate log', '--tags', 'B1').status, 0);
  const j = loadJob(f);
  assert.match(compileAtom(j, 'B1', { offline: true }), /Known facts .*\n- the API takes degrees, not radians \[source: run 3, B1 gate log\]/);
  assert(!compileAtom(j, 'B2', { offline: true }).includes('degrees'));
});
await Promise.all(pending);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all conductor principles tests passed');
process.exit(fails ? 1 : 0);
