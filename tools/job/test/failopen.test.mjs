import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emit, canFire, readEvents, renderStatus } from '../lib/events.mjs';

process.env.ENDOFORGE_NOTIFY = 'none';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-failopen-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const jobIn = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d); const f = path.join(d, 'job.json'); fs.writeFileSync(f, '{}'); return { d, f, job: { id: name, title: name } }; };
const kinds = (job, f) => readEvents(job, f).map((e) => e.kind);

test('a torn last line loses that line only, and the status says the log is incomplete', () => {
  const { d, f, job } = jobIn('torn');
  for (const kind of ['STAGED', 'FIRED', 'GATE']) emit(job, f, { kind, summary: kind });
  fs.appendFileSync(path.join(d, 'events.jsonl'), '{"ts":"2026-11-06T00:00:00Z","job":"torn","ki');
  assert.deepEqual(kinds(job, f), ['STAGED', 'FIRED', 'GATE']);
  const status = renderStatus(job, readEvents(job, f));
  assert.match(status, /state: GATE/);
  assert.match(status, /1 event line.* unreadable/);
});
test('the next event after a torn line is kept whole', () => {
  const { d, f, job } = jobIn('next');
  emit(job, f, { kind: 'STAGED', summary: 'a' });
  fs.appendFileSync(path.join(d, 'events.jsonl'), '{"ts":"2026');
  emit(job, f, { kind: 'DONE', summary: 'b' });
  assert.deepEqual(kinds(job, f), ['STAGED', 'DONE']);
});
test('a log with nothing readable is unknown, not "not staged"', () => {
  const { d, f, job } = jobIn('all-bad');
  fs.writeFileSync(path.join(d, 'events.jsonl'), 'garbage\n');
  assert.match(renderStatus(job, readEvents(job, f)), /state: unknown/);
  assert.equal(canFire(job, f).ok, false);
});
test('a missing log is empty, an unreadable one raises', () => {
  const { d, f, job } = jobIn('unreadable');
  assert.deepEqual(readEvents(job, f), []);
  assert.match(renderStatus(job, readEvents(job, f)), /state: not staged/);
  fs.mkdirSync(path.join(d, 'events.jsonl'));
  assert.throws(() => readEvents(job, f), { code: 'EISDIR' });
});
test('an event reported as written has been synced', () => {
  const { f, job } = jobIn('sync');
  const sync = fs.fsyncSync; let calls = 0;
  fs.fsyncSync = (fd) => { calls++; return sync(fd); };
  try { emit(job, f, { kind: 'STAGED', summary: 'a' }); } finally { fs.fsyncSync = sync; }
  assert.ok(calls >= 1);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
