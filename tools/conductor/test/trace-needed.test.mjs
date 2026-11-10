import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJob } from '../../job/lib/load.mjs';
import { readEvents } from '../../job/lib/events.mjs';
import { conduct } from '../lib/daemon.mjs';
import { handlers, idle, isTestFile } from '../lib/handlers.mjs';
import { loadState } from '../lib/state.mjs';
import { scratch } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-trace-needed-'));
const setup = scratch(tmp, `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
d=$(dirname "$f")/t
case "$(head -1 "$f")" in
  addtest) mkdir -p "$d"; echo half > "$f"; echo x > "$d/a.test.mjs"; echo x > "$d/test_gone.py"; echo '{}' > "$d/fixture.json";;
  half) echo good > "$f"; rm -f "$d/test_gone.py";;
  plain) echo good > "$f";;
esac
`);
const run = (f) => conduct(f, { load: loadJob, handlers, tickMs: 50, maxTicks: 300 }).then(async () => { await idle(); return loadState(loadJob(f), f); });
const traceEvents = (f) => readEvents(loadJob(f), f).filter((e) => e.data?.event === 'TRACE-NEEDED');
const owning = (dir) => (j) => { for (const a of j.atoms) a.files = [...a.files, `game/${dir}/`]; j.atoms = j.atoms.map((a) => ({ ...a, engine: 'claude' })); };

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('isTestFile recognises the test files the Makefile globs reach and nothing else', () => {
  for (const p of ['tools/conductor/test/trace-needed.test.mjs', 'tests/test_lifecycle.py', 'core/ledger/test_chain.py', 'x/y_test.py', 'a/b.spec.ts', 'tools/test_gen.sh'])
    assert.ok(isTestFile(p), p);
  for (const p of ['tools/conductor/test/helpers.mjs', 'game/t/fixture.json', 'docs/testing.md', 'core/runtime/x1/gates.mjs', 'tests/test-reachability.json'])
    assert.ok(!isTestFile(p), p);
});

test('a freeze whose change adds test files emits TRACE-NEEDED listing the new tests still present', async () => {
  const { f, repo } = setup('adds-tests', { 'b1.txt': 'addtest' }, { gate: null, maxIterations: 3 }, (j) => {
    owning('t')(j); j.criteria[0].check.run = 'grep -q good game/b1.txt';
  });
  const s = await run(f);
  assert.equal(s.atoms.B1.status, 'frozen');
  assert.equal(s.atoms.B1.iter, 2, 'the test file landed in an earlier iteration than the freeze');
  assert.ok(!fs.existsSync(path.join(repo, 'game/t/test_gone.py')));
  const ev = traceEvents(f);
  assert.equal(ev.length, 1, JSON.stringify(ev));
  assert.equal(ev[0].kind, 'NEEDS-COORDINATOR');
  assert.deepEqual(ev[0].data.tests, ['game/t/a.test.mjs']);
  assert.equal(ev[0].data.atom, 'B1');
  assert.equal(ev[0].data.sha, s.atoms.B1.sha);
  assert.match(ev[0].summary, /^TRACE-NEEDED B1: .*game\/t\/a\.test\.mjs/);
  assert.match(ev[0].detail, /trace rows/);
  assert.equal(s.escalations.length, 0, 'TRACE-NEEDED is a notice, not an escalation that blocks the atom');
  assert.deepEqual(s.atoms.B1.traceNotified, ['game/t/a.test.mjs']);
});

test('a freeze that adds no test files emits no TRACE-NEEDED', async () => {
  const { f } = setup('no-tests', { 'b1.txt': 'plain' }, { gate: null }, owning('t'));
  const s = await run(f);
  assert.equal(s.atoms.B1.status, 'frozen');
  assert.deepEqual(traceEvents(f), []);
});
