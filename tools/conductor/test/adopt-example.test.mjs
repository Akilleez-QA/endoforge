import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(TOOL, '../..');
const CONDUCT = path.join(TOOL, 'bin/conduct.mjs');
const EXAMPLES = path.join(TOOL, 'examples');
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-adopt-'));
const env = { ...process.env, HOME: path.join(tmp, 'home'), ENDOFORGE_NOTIFY: 'none', ENDOFORGE_JOBS: path.join(tmp, 'none') };

test('adopt without --map names a directory of example maps that exists', () => {
  const r = spawnSync(process.execPath, [CONDUCT, 'adopt', path.join(tmp, 'x.json')], { encoding: 'utf8', env });
  assert.equal(r.status, 2, r.stderr);
  const named = /see (tools\/conductor\/examples[^\s)]*)/.exec(r.stderr)?.[1];
  assert.ok(named, r.stderr);
  const dir = path.join(REPO, named);
  assert.ok(fs.existsSync(dir), `${named} does not exist`);
  assert.ok(fs.readdirSync(dir).some((f) => f.endsWith('.adopt-map.json')), `${named} holds no *.adopt-map.json`);
});

test('every example map has the layout adopt requires', () => {
  const maps = fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.adopt-map.json'));
  assert.ok(maps.length >= 1);
  for (const f of maps) {
    const m = JSON.parse(fs.readFileSync(path.join(EXAMPLES, f), 'utf8'));
    assert.ok(m.layout?.worktree && m.layout?.base, `${f}: layout.worktree and layout.base are required`);
    assert.ok(Array.isArray(m.atoms) && m.atoms.length, `${f}: atoms rules missing`);
  }
});

test('the example map adopts the example old job: running lanes are tracked, collected ones are checked, others keep their status', () => {
  const lanes = path.join(tmp, 'lanes'), logs = path.join(tmp, 'logs'), repo = path.join(tmp, 'repo'), out = path.join(tmp, 'job', 'job.json');
  fs.mkdirSync(path.join(lanes, '2', 'a1'), { recursive: true }); fs.mkdirSync(path.join(lanes, '3'), { recursive: true }); fs.mkdirSync(logs); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(lanes, '2', 'a1.json'), JSON.stringify({ base: 'abc123' }));
  fs.writeFileSync(path.join(lanes, '3', 'b2.collected'), '');
  fs.writeFileSync(path.join(tmp, 'NOTES.md'), '# notes\n');
  const r = spawnSync(process.execPath, [CONDUCT, 'adopt', out, '--map', path.join(EXAMPLES, 'fanout-loop.adopt-map.json'),
    '--legacy', path.join(EXAMPLES, 'fanout-loop.legacy.json'), '--loop-state', path.join(EXAMPLES, 'fanout-loop.loop-state.json'),
    '--lanes', lanes, '--logs', logs, '--repo', repo, '--notes', path.join(tmp, 'NOTES.md'), '--deadline', '2026-12-01T00:00:00Z'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /adopted 3 atoms/);
  const job = JSON.parse(fs.readFileSync(out, 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(path.dirname(out), 'conductor', 'state.json'), 'utf8'));
  assert.equal(job.schema, 'endoforge/job/1');
  assert.deepEqual(job.atoms.map((a) => a.id).sort(), ['A1', 'B2', 'C3']);
  assert.deepEqual(job.atoms.find((a) => a.id === 'C3').aspects, ['request']);
  assert.deepEqual(job.atoms.find((a) => a.id === 'A1').aspects, ['request', 'framing']);
  assert.equal(job.sources.find((s) => s.primary)?.id, 'request');
  const a1 = state.atoms.A1;
  assert.equal(a1.status, 'launched');
  assert.deepEqual([a1.lane.worktree, a1.lane.base, a1.lane.unit, a1.lane.log], [path.join(lanes, '2', 'a1'), 'abc123', 'fanout-2-a1', path.join(logs, '2-a1.log')]);
  assert.equal(state.atoms.B2.status, 'checking');
  assert.equal(state.atoms.C3.status, 'frozen');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('conductor adopt example: all passed');
