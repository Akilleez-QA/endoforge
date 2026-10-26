// Fan-out round end to end on a scratch git repo: stub engines (no model), stub render and evals, local launcher.
// Checks evals-first, smoke per engine, rotation, owned-diff collection (strays ignored), one commit per piece, the
// ratchet reverting a piece that regressed, pre-evals reuse, freezing, the split proof and the smoke gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), BIN = path.join(HERE, '../bin/hillclimb.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-fanout-round-'));
let fails = 0;
const pending = [];
const test = (name, fn) => { const done = (e) => { if (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } else console.log(`PASS ${name}`); };
  try { const r = fn(); if (r?.then) pending.push(r.then(() => done(), done)); else done(); } catch (e) { done(e); } };
const sh = (cwd, ...a) => { const r = spawnSync(a[0], a.slice(1), { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const repo = path.join(tmp, 'repo'), home = path.join(tmp, 'home'), stubs = path.join(tmp, 'stubs');
fs.mkdirSync(path.join(repo, 'game'), { recursive: true });
for (const [f, v] of [['b01.txt', 'bad'], ['b02.txt', 'regress'], ['b03.txt', 'bad'], ['shared.txt', 'contract']]) fs.writeFileSync(path.join(repo, 'game', f), v + '\n');
sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'empty');
sh(repo, 'git', 'add', 'game'); sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed');
sh(repo, 'git', 'tag', 'seed'); sh(repo, 'git', 'config', 'user.email', 't@t'); sh(repo, 'git', 'config', 'user.name', 't');
for (const p of ['.codex/auth.json', '.claude-accts/acct1/.credentials.json']) { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), ''); }
fs.mkdirSync(stubs);
// One stub for both engines: find the brief among the args, fix the owned file ("regress" makes it worse), and leave
// a stray file outside the piece's files, which collect must ignore.
const stub = `#!/bin/bash
for a in "$@"; do case "$a" in *READY*) [ -n "$STUB_FAIL_SMOKE" ] && exit 3; echo READY; exit 0;; *"YOUR PIECE"*|*"You own ONLY"*) brief="$a";; esac; done
file=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
if grep -q regress "$file"; then printf 'bad\\nbad\\n' > "$file"; else echo good > "$file"; fi
echo stray > stray.txt
echo "fixed $file"
`;
for (const b of ['codex-pool', 'claude']) fs.writeFileSync(path.join(stubs, b), stub, { mode: 0o755 });
const render = ['node', '-e', 'const fs=require("fs");for(const f of fs.readdirSync(process.argv[1]))fs.copyFileSync(process.argv[1]+"/"+f,process.argv[2]+"/"+f)', '${repo}/game', '${out}'];
const evals = ['node', '-e', `const fs=require("fs"),[g,o]=process.argv.slice(1);const findings=[{beat:"b1|b2",rule:"SEAM",level:"STYLE"}];
for(const n of [1,2,3])for(const l of fs.readFileSync(g+"/b0"+n+".txt","utf8").split("\\n"))if(l==="bad")findings.push({beat:"b"+n,rule:"R1",level:"HARD",detail:"reads badly"});
fs.writeFileSync(o+"/evals.json",JSON.stringify({findings}));process.exit(findings.length>1?1:0)`, '${repo}/game', '${out}'];
const campaign = (extra = {}) => ({
  schema: 'endoforge/hillclimb/1', id: 'demo', mode: 'fanout', goal: 'every beat reads clearly in every aspect today',
  repo, workdir: path.join(tmp, 'work'), render: [{ id: 'main', command: render }], stop: { maxRounds: 3 },
  evals: { command: evals, key: 'beat' }, contracts: ['game/shared.txt'], apply: { trailer: 'Co-Authored-By: test' },
  fanout: { launcher: 'local', pollSec: 0.05, codexPool: path.join(stubs, 'codex-pool'), claudeBin: path.join(stubs, 'claude'), freezeAfter: 1 },
  pieces: {
    B1: { files: ['game/b01.txt'], brief: 'beat one: the plant reveal wide shot', keys: ['b1'], engine: 'codex', stills: ['main/b01.txt'] },
    B2: { files: ['game/b02.txt'], brief: 'beat two: the hero struts in from the left', keys: ['b2'], engine: 'claude' },
    B3: { files: ['game/b03.txt'], brief: 'beat three: the compressor close-up', keys: ['b3'] },
  }, ...extra,
});
const write = (name, c) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(c)); return f; };
const env = { ...process.env, HOME: home, FLEET_STATE_DIR: path.join(tmp, 'fleet') };
for (const k of Object.keys(env)) if (k.startsWith('CODEX_POOL_') || k === 'ENDOFORGE_CLAUDE_ACCOUNTS') delete env[k];
const hc = (...a) => spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8', timeout: 120_000 });

try {
  const cf = write('demo.json', campaign());
  const r1 = hc('round', cf);
  const dir = path.join(tmp, 'work/rounds/r01'), summary = r1.stdout ? JSON.parse(r1.stdout) : {};
  test('round 1 runs evals first, smokes each engine, launches every piece', () => {
    assert.equal(r1.status, 0, r1.stderr.slice(-1500));
    assert.deepEqual(readJSON(path.join(dir, 'pre/meta.json')).hard, 2);
    assert.deepEqual(Object.keys(summary.smokes).sort(), ['claude', 'codex']); assert(Object.values(summary.smokes).every((s) => s.ok));
    assert.deepEqual(summary.lanes.map((l) => [l.lane, l.exit]), [['b1', 0], ['b2', 0], ['b3', 0]]);
    assert.equal(new Set(summary.lanes.map((l) => `${l.engine}:${l.account}`)).size, 2);
    assert.match(fs.readFileSync(path.join(dir, 'prompts/b1.prompt'), 'utf8'), /\[HARD R1\] reads badly/);
  });
  test('collect commits each piece\'s own files only; strays are ignored', () => {
    const log = sh(repo, 'git', 'log', '--format=%s', 'seed..HEAD').split('\n');
    assert.equal(log.filter((s) => / fan-out r1 B\d/.test(s) && !s.startsWith('Revert')).length, 3, log.join(' | '));
    assert(!fs.existsSync(path.join(repo, 'stray.txt')));
    assert(readJSON(path.join(dir, 'collect.json')).filter((x) => x.status === 'applied').every((x) => x.stray.includes('stray.txt')));
    assert.match(sh(repo, 'git', 'log', '-1', '--format=%B', 'HEAD~1'), /Co-Authored-By: test/);
  });
  test('the ratchet reverts the piece whose own HARD count rose, and the round passes', () => {
    assert.deepEqual(summary.ratchet.reverted, ['B2']); assert.equal(summary.ratchet.pass, true); assert.equal(summary.ratchet.hard, 0);
    assert.equal(fs.readFileSync(path.join(repo, 'game/b02.txt'), 'utf8'), 'regress\n');
    assert.equal(fs.readFileSync(path.join(repo, 'game/b01.txt'), 'utf8'), 'good\n');
    assert.deepEqual(readJSON(path.join(tmp, 'work/baseline.json')), { score: 1, hard: 0 });
    assert.equal(summary.unattributed, 1); assert.equal(summary.wallClock.longPole != null, true);
    assert.equal(sh(repo, 'git', 'status', '--porcelain'), '');
  });
  test('round 1 writes LESSONS.md from its measurements and reports open lessons', () => {
    const md = fs.readFileSync(path.join(dir, 'LESSONS.md'), 'utf8');
    assert.match(md, /\| ratchet \| pass \|/); assert.match(md, /\| B2 \| b2 \| 0 \| [\d.]+ \| 0 → 0 \| reverted \|/);
    assert.match(md, /`regressed-b2` \(recombine\)/); assert.match(md, /`unattributed` \(attribution\)/); assert.match(md, /`stray-b1` \(atomize\)/);
    assert(summary.openLessons.includes('regressed-b2')); assert.match(r1.stderr, /open lessons with no tool change yet/);
    const closed = hc('lessons', cf, '--close', 'regressed-b2', '--by', 'PR #388');
    assert.equal(closed.status, 0, closed.stderr); assert(!closed.stdout.includes('regressed-b2')); assert.match(closed.stdout, /^unattributed\tattribution/m);
  });
  test('round 2 reuses round 1\'s post-evals and freezes the clean pieces', () => {
    const r2 = hc('round', cf); assert.equal(r2.status, 0, r2.stderr.slice(-800));
    const s2 = JSON.parse(r2.stdout);
    assert(!fs.existsSync(path.join(tmp, 'work/rounds/r02/pre'))); assert.deepEqual(s2.frozen, ['B1', 'B2', 'B3']); assert.deepEqual(s2.lanes, []);
    const md2 = fs.readFileSync(path.join(tmp, 'work/rounds/r02/LESSONS.md'), 'utf8');
    assert(!md2.includes('`regressed-b2`')); assert.match(md2, /`unattributed` \(attribution, rounds 1–2, seen 2x\)/);
  });
  test('a failed smoke launch stops the round before any worktree is made', () => {
    const c = campaign({ id: 'smoke', workdir: path.join(tmp, 'work-smoke') });
    const r = spawnSync(process.execPath, [BIN, 'round', write('smoke.json', c)], { env: { ...env, STUB_FAIL_SMOKE: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.match(r.stderr, /smoke launch failed/);
    assert(!fs.existsSync(path.join(tmp, 'work-smoke/worktrees')));
  });
  test('atomize exits 1 on a shared file', () => {
    const c = campaign(); c.pieces.B3.files.push('game/b01.txt');
    const f = path.join(tmp, 'shared.json'); fs.writeFileSync(f, JSON.stringify(c));
    const r = hc('check', f); assert.equal(r.status, 1); assert.match(r.stdout, /B1 and B3 share game\/b01.txt/);
  });
  test('prove-split compares pixels, not file hashes', () => {
    const py = `import sys; from PIL import Image, PngImagePlugin
for d, tag, px in (("a", "one", 0), ("b", "two", 0), ("c", "one", 9)):
    import os; os.makedirs(sys.argv[1] + "/" + d, exist_ok=True); im = Image.new("RGB", (8, 8), (10, 20, 30)); im.putpixel((3, 3), (px, 0, 0))
    m = PngImagePlugin.PngInfo(); m.add_text("made", tag); im.save(sys.argv[1] + "/" + d + "/f0.png", pnginfo=m)`;
    sh(tmp, 'python3', '-c', py, path.join(tmp, 'px'));
    assert.notEqual(fs.readFileSync(path.join(tmp, 'px/a/f0.png')).toString('hex'), fs.readFileSync(path.join(tmp, 'px/b/f0.png')).toString('hex'));
    const same = hc('prove-split', cf, '--before', path.join(tmp, 'px/a'), '--after', path.join(tmp, 'px/b'));
    assert.equal(same.status, 0, same.stdout + same.stderr); assert.equal(JSON.parse(same.stdout).compared, 1);
    const diff = hc('prove-split', cf, '--before', path.join(tmp, 'px/a'), '--after', path.join(tmp, 'px/c'));
    assert.equal(diff.status, 1); assert.equal(JSON.parse(diff.stdout).differ[0].pixels, 1);
  });
  test('a job-backed campaign refuses to fire on an unconfirmed card, then fires compiled prompts once confirmed', async () => {
    const { cardHash } = await import('../../job/lib/card.mjs');
    const jd = path.join(tmp, 'job'); fs.mkdirSync(jd);
    fs.writeFileSync(path.join(jd, 'REQUEST.md'), 'Make every beat read good.\n'); fs.writeFileSync(path.join(jd, 'NOTES.md'), '# notes\n'); fs.writeFileSync(path.join(jd, 'smoke.json'), '{}');
    const c = campaign({ id: 'jobbed', workdir: path.join(tmp, 'work-job'), job: path.join(jd, 'job.json') });
    const job = { schema: 'endoforge/job/1', id: 'demo-job', kind: 'code', title: 'demo',
      goal: { verbatim: 'make every beat read good, today', by: 'Craig' },
      brief: { objective: 'o', acceptance: 'a', scope: 's', authority: 'au', assumptions: { stated: [], inferred: [] } },
      sources: [{ id: 'request', primary: true, path: path.join(jd, 'REQUEST.md'), governs: ['beat'], what: 'the request' }],
      criteria: [{ id: 'T1', statement: 'tests pass', check: { kind: 'tests', run: 'true' } }],
      atoms: Object.entries(c.pieces).map(([id, p]) => ({ id, engine: p.engine ?? 'codex', aspects: ['beat'], files: p.files, sources: ['request'], checks: ['T1'] })),
      gates: [], resources: { capacityDial: true, throttle: 'hillclimb-fanout', ownerBound: true, health: ['true'] }, ratchet: { kind: 'tests' },
      criticalPath: 'B1', rival: 'compete mode', deadline: '2026-10-27T00:00:00Z', notes: path.join(jd, 'NOTES.md'),
      proofs: { smoke: { engines: { codex: true, claude: true }, receipt: path.join(jd, 'smoke.json') }, lessons: { retrieved: 'now', count: 0 } } };
    fs.writeFileSync(c.job, JSON.stringify(job));
    const pushed = path.join(jd, 'pushed.txt'), hook = path.join(jd, 'push.sh');
    fs.writeFileSync(hook, `#!/bin/sh\necho "$ENDOFORGE_EVENT_KIND" >> ${pushed}\n`, { mode: 0o755 });
    const jenv = { ...env, ENDOFORGE_VOLATILE: '/nonexistent-volatile', ENDOFORGE_JOBS: path.join(tmp, 'no-jobs'), ENDOFORGE_NOTIFY: 'none', ENDOFORGE_PUSH_HOOKS: hook };
    const cf2 = write('jobbed.json', c), run = () => spawnSync(process.execPath, [BIN, 'round', cf2], { env: jenv, encoding: 'utf8', timeout: 120_000 });
    const JOB = path.join(HERE, '../../job/bin/job.mjs'), jobCli = (...a) => spawnSync(process.execPath, [JOB, ...a], { env: jenv, encoding: 'utf8' });
    const refused = run();
    assert.equal(refused.status, 1); assert.match(refused.stderr, /cannot fire \(I1, I11\): the card was never staged/);
    assert(!fs.existsSync(path.join(tmp, 'work-job/worktrees')));
    const staged = jobCli('stage', c.job); assert.equal(staged.status, 0, staged.stdout + staged.stderr);
    assert.equal(run().status, 1, 'staged but not confirmed must not fire');
    assert.equal(jobCli('confirm', c.job, '--sha', cardHash(job), '--by', 'Craig', '--words', 'go').status, 0);
    sh(repo, 'git', 'checkout', '-q', 'seed', '--', 'game'); sh(repo, 'git', 'commit', '-q', '-m', 'reset for the job round');
    const fired = run(); assert.equal(fired.status, 0, fired.stderr.slice(-800));
    const p = fs.readFileSync(path.join(tmp, 'work-job/rounds/r01/prompts/b1.prompt'), 'utf8');
    assert.match(p, /THE GOAL, in Craig's own words[^\n]*\n> make every beat read good, today/); assert.match(p, /<<<request\nMake every beat read good./);
    assert.match(p, /Reply in exactly this form/);
    const kinds = fs.readFileSync(path.join(jd, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind);
    assert.deepEqual(kinds, ['STAGED', 'SMOKE', 'FIRED', 'SCORED', 'GATE']);
    assert.deepEqual(fs.readFileSync(pushed, 'utf8').trim().split('\n'), ['FIRED', 'GATE']);
    const st = jobCli('status', c.job); assert.match(st.stdout, /\* FIRED +demo fired: 3 atoms/); assert.match(st.stdout, /state: GATE; 3 atoms fired/);
  });
  await Promise.all(pending);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(fails ? `${fails} failure(s)` : 'all fan-out round tests passed');
process.exit(fails ? 1 : 0);
