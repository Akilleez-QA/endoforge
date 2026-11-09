import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { exitWrapper, readExit } from '../exitfile.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-exitfile-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const wrapped = (file, ...command) => spawnSync('sh', ['-c', exitWrapper(file), 'sh', ...command], { encoding: 'utf8' });

test('exitWrapper runs the command, keeps its exit code and output, and records the code in the file', () => {
  for (const code of [0, 1, 75, 78]) {
    const file = path.join(tmp, `exit-${code}`);
    const r = wrapped(file, 'sh', '-c', `echo out; exit ${code}`);
    assert.equal(r.status, code);
    assert.equal(r.stdout, 'out\n');
    assert.equal(readExit(file), code);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  }
});

test('exitWrapper passes arguments through unchanged and quotes a file path with spaces and quotes', () => {
  const file = path.join(tmp, "it's a $dir", 'code');
  fs.mkdirSync(path.dirname(file));
  const r = wrapped(file, 'printf', '%s|', 'a b', "c'd", '$HOME');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "a b|c'd|$HOME|");
  assert.equal(readExit(file), 0);
});

test('readExit is null for a worker that has not finished or a file that is not an exit code', () => {
  assert.equal(readExit(path.join(tmp, 'never-written')), null);
  for (const [name, text] of [['empty', ''], ['word', 'done\n'], ['negative', '-1\n'], ['partial', '1 2\n']]) {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, text);
    assert.equal(readExit(file), null, name);
  }
  fs.writeFileSync(path.join(tmp, 'spaced'), '124  \n');
  assert.equal(readExit(path.join(tmp, 'spaced')), 124);
});

test('a command killed by a signal is recorded as 128 plus the signal', () => {
  const file = path.join(tmp, 'killed');
  const r = wrapped(file, 'sh', '-c', 'kill -9 $$');
  assert.equal(r.status, 137);
  assert.equal(readExit(file), 137);
});

test('a wrapper killed before the command ends leaves no exit file, so a restart sees the worker as not finished', () => {
  const file = path.join(tmp, 'wrapper-killed');
  const r = spawnSync('sh', ['-c', `sh -c '${exitWrapper(file).replaceAll("'", `'\\''`)}' sh sleep 5 >/dev/null 2>&1 & sleep 0.2; kill -9 $!; wait $!; exit 0`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readExit(file), null);
});
