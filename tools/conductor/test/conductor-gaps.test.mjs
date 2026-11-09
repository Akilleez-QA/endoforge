import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomChecks } from '../lib/checks.mjs';
import { collectLock } from '../lib/collect.mjs';
import { claudeArguments } from '../../hillclimb/lib/fanout.mjs';

test('an atom with no conductor.checks gets the runnable checks of its criteria', () => {
  const job = { atoms: [{ id: 'A', checks: ['C1', 'C2'] }], criteria: [
    { id: 'C1', check: { kind: 'tests', run: 'true' } }, { id: 'C2', check: { kind: 'human', gate: 'g' } }] };
  assert.deepEqual(atomChecks(job, 'A'), [{ id: 'C1', run: 'true' }]);
  job.conductor = { checks: [{ id: 'K', atoms: ['A'], run: 'false' }] };
  assert.deepEqual(atomChecks(job, 'A').map((k) => k.id), ['K']);
});

test('the collect lock lives in the real git directory of a worktree repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-lock-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main', 'main');
  execFileSync('git', ['-C', path.join(root, 'main'), '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 's']);
  execFileSync('git', ['-C', path.join(root, 'main'), 'worktree', 'add', '-q', path.join(root, 'wt')]);
  const lock = collectLock({ repo: path.join(root, 'wt') });
  assert.ok(lock.includes(path.join('.git', 'worktrees')), lock);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Claude workers may run make and python3, and conductor.claudeTools overrides the list', () => {
  const run = (tools) => claudeArguments(tools ? { claudeTools: tools } : {}, 'p').join(' ');
  assert.match(run(), /Bash\(make:\*\)/);
  assert.match(run(), /Bash\(python3:\*\)/);
  assert.match(run('Read'), /--allowedTools Read/);
});
