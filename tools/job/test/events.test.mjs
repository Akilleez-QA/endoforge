// Job events: STAGED → the user's go → FIRED, never the other way; channels; push only for what matters; status.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit, canFire, readEvents, renderStatus, PUSH_KINDS } from '../lib/events.mjs';
import { cardHash } from '../lib/card.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), BIN = path.join(HERE, '../bin/job.mjs'), EF = path.join(HERE, '../../runtime/endoforge');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures', n), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-events-'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const all = path.join(tmp, 'all.txt'), push = path.join(tmp, 'push.txt'), bad = path.join(tmp, 'bad.sh');
const hook = (f) => { const p = `${f}.sh`; fs.writeFileSync(p, `#!/bin/sh\nread -r line; echo "$ENDOFORGE_EVENT_KIND $ENDOFORGE_EVENT_PUSH" >> ${f}\n`, { mode: 0o755 }); return p; };
fs.writeFileSync(bad, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
const env = { ...process.env, ENDOFORGE_NOTIFY: 'none', ENDOFORGE_EVENT_HOOKS: hook(all), ENDOFORGE_PUSH_HOOKS: hook(push), ENDOFORGE_JOBS: path.join(tmp, 'none'), ENDOFORGE_RUNTIME_ENV: 'none' };
const setup = (name) => {
  const d = path.join(tmp, name); fs.mkdirSync(d); const j = fx('mrton.json'); delete j.confirmed; j.resources.health = ['true'];
  const f = path.join(d, 'job.json'); fs.writeFileSync(f, JSON.stringify(j)); return { d, f, j };
};
const cli = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8' });

test('emit writes the durable log first, then the desktop and hooks; phones get only FIRED, GATE, NEEDS-YOU and DONE', () => {
  const { f, j } = setup('emit');
  for (const k of ['STAGED', 'FIRED', 'SMOKE', 'SCORED', 'GATE', 'NEEDS-YOU', 'DONE']) emit(j, f, { kind: k, summary: `${k} happened` }, { env });
  assert.throws(() => emit(j, f, { kind: 'PROGRESS', summary: 'x' }, { env }), /unknown event kind/);
  assert.equal(readEvents(j, f).length, 7); assert.match(fs.readFileSync(path.join(path.dirname(f), 'EVENTS.md'), 'utf8'), /· NEEDS-YOU · NEEDS-YOU happened/);
  assert.equal(fs.readFileSync(all, 'utf8').trim().split('\n').length, 7);
  assert.deepEqual(fs.readFileSync(push, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]), PUSH_KINDS);
  emit(j, f, { kind: 'DONE', summary: 'x' }, { env: { ...env, ENDOFORGE_EVENT_HOOKS: bad } });
  assert.deepEqual(readEvents(j, f).at(-1), { ...readEvents(j, f).at(-1), kind: 'DELIVERY-FAILED', of: 'DONE', channels: [bad] });
});
test('canFire: never staged, changed since staging, a go from before the card, a relayed go, then the real go', () => {
  const { f, j } = setup('canfire'), sha = cardHash(j);
  assert.match(canFire(j, f).why, /never staged/);
  emit(j, f, { kind: 'STAGED', summary: 's', data: { cardSha256: 'old' } }, { env });
  assert.match(canFire(j, f).why, /changed after its card was staged/);
  emit(j, f, { kind: 'STAGED', summary: 's', data: { cardSha256: sha } }, { env });
  assert.match(canFire({ ...j, confirmed: { via: 'direct', cardSha256: sha, at: '2026-01-01T00:00:00Z' } }, f).why, /predates the staged card/);
  assert.match(canFire({ ...j, confirmed: { via: 'relayed', cardSha256: sha, at: new Date().toISOString() } }, f).why, /no direct go/);
  assert(canFire({ ...j, confirmed: { via: 'direct', cardSha256: sha, at: new Date(Date.now() + 1000).toISOString() } }, f).ok);
});
test('CLI: stage refuses an invalid job and stages a valid one; fire needs the go, then emits FIRED and launches', () => {
  const b = path.join(tmp, 'briefed.json'); fs.writeFileSync(b, JSON.stringify(fx('mrton-as-briefed.json')));
  const r = cli('stage', b, '--offline'); assert.equal(r.status, 1); assert.match(r.stdout, /REFUSED observe I7/);
  assert(!fs.existsSync(path.join(tmp, 'events.jsonl')));
  const { d, f, j } = setup('fire');
  assert.equal(cli('stage', f, '--offline').status, 0); assert(fs.existsSync(path.join(d, `JOB-${j.id}.md`)));
  const early = cli('fire', f, '--offline'); assert.equal(early.status, 1); assert.match(early.stderr, /refused \(I1, I11\): no direct go/);
  assert.equal(cli('confirm', f, '--sha', cardHash(j).slice(0, 12), '--by', 'Craig', '--words', 'go').status, 0);
  const fired = spawnSync(process.execPath, [BIN, 'fire', f, '--offline', '--', 'sh', '-c', 'ls "$ENDOFORGE_PROMPTS" > "$(dirname "$ENDOFORGE_JOB")/launched.txt"'], { env, encoding: 'utf8' });
  assert.equal(fired.status, 0, fired.stdout + fired.stderr);
  const ev = readEvents(j, f).filter((e) => e.kind === 'FIRED').at(-1);
  assert.match(ev.summary, /fired: (6|5) atoms/); assert.match(ev.data.promptManifest, /^[0-9a-f]{64}$/); assert.match(ev.detail, /\*\*Stop:\*\*/);
  assert.match(fs.readFileSync(path.join(d, 'launched.txt'), 'utf8'), /CHAR.prompt/);
});
test('CLI: event refuses FIRED; status shows the timeline, push marks and a blocking NEEDS-YOU; endoforge job status works', () => {
  const { f } = setup('status');
  assert.equal(cli('event', f, 'FIRED', 'sneaky').status, 2);
  assert.equal(cli('event', f, 'SCORED', 'round 1: score 88 (-136)').status, 0);
  assert.equal(cli('event', f, 'NEEDS-YOU', 'pick a character take').status, 0);
  const s = spawnSync(EF, ['job', 'status', f], { env, encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr); assert.match(s.stdout, /SCORED +round 1: score 88/); assert.match(s.stdout, /\* NEEDS-YOU/); assert.match(s.stdout, /NEEDS YOU: pick a character take/);
  assert.match(renderStatus({ id: 'x', kind: 'video' }, []), /state: not staged/);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all events tests passed');
process.exit(fails ? 1 : 0);
