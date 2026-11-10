import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, recordsCheck, makeRules, classifyBaseline } from '../lib/validate.mjs';
import { INVARIANT, GATES } from '../lib/invariants.mjs';
import { calibrateBase } from '../bin/job.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOB_BIN = path.join(HERE, '..', 'bin', 'job.mjs');
const ROOT = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-invgates-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const git = (cwd, ...args) => { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

function makeRepo(name, files) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  for (const [rel, text] of Object.entries(files)) { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
  return repo;
}

function fixtureJob(dir, repo, { gate, atomGate, runs = { 'C-T': 'true' } } = {}) {
  const at = (rel) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p)) fs.writeFileSync(p, 'x'); return p; };
  const ids = Object.keys(runs);
  return {
    schema: 'endoforge/job/1', id: path.basename(dir), title: 'fixture', kind: 'code', repo,
    goal: { verbatim: 'keep the parser accepting every input', by: 'Sam', at: '2026-11-01' },
    brief: { objective: 'o', acceptance: 'a', scope: 's', authority: 'Sam', assumptions: { stated: [], inferred: [] } },
    notes: at('NOTES.md'),
    sources: [{ id: 'spec', path: at('spec.md'), what: 'the spec', governs: ['parser'], primary: true }],
    criteria: ids.map((id) => ({ id, statement: id, check: { kind: 'tests', run: runs[id] }, satisfiedBy: ['A'], requires: ['edit'] })),
    atoms: [{ id: 'A', engine: 'script', aspects: ['parser'], sources: ['spec'], files: ['src'], checks: ids, capabilities: ['edit'], ...(atomGate ? { gate: atomGate } : {}) }],
    criticalPath: 'A', rival: 'r', deadline: '2026-12-01T00:00:00Z', ratchet: { kind: 'tests' },
    proofs: { smoke: { engines: { script: true }, receipt: at('smoke.json') }, lessons: { retrieved: '2026-11-01T00:00:00Z' } },
    ...(gate ? { conductor: { gate } } : {}),
  };
}

const errs = (v, inv) => v.errors.filter((e) => e.inv === inv);
const decide = (job, o = {}) => validate(job, { gate: 'decide', offline: true, volatile: [], confirmation: { ok: true }, ...o });

test('I16 and I17 are listed invariants held at Decide', () => {
  assert.ok(INVARIANT.I16 && INVARIANT.I17);
  const d = GATES.find((g) => g.id === 'decide');
  assert.ok(d.invariants.includes('I16') && d.invariants.includes('I17'));
});

test('I16: a collect gate that runs the trace check is refused, saying records are written after freeze', () => {
  const dir = path.join(tmp, 'i16-gate'); fs.mkdirSync(dir);
  const v = decide(fixtureJob(dir, dir, { gate: 'make sums && python3 -I tools/check_trace.py' }));
  const e = errs(v, 'I16');
  assert.equal(e.length, 1);
  assert.match(e[0].msg, /conductor\.gate/);
  assert.match(e[0].msg, /check_trace/);
  assert.match(e[0].msg, /records are written after freeze/);
  assert.equal(v.status.I16, 'broken');
});

test('I16: an atom gate (argv form) and an atom check running a trace test are refused', () => {
  const dir = path.join(tmp, 'i16-atom'); fs.mkdirSync(dir);
  const v = decide(fixtureJob(dir, dir, { atomGate: ['python3', '-I', 'tests/test_requirements_trace.py'], runs: { 'C-T': 'node --test x.test.mjs && python3 -B tests/test_trace_rows.py' } }));
  const e = errs(v, 'I16');
  assert.equal(e.length, 2);
  assert.ok(e.some((x) => /atom A's gate/.test(x.msg) && /test_requirements_trace/.test(x.msg)));
  assert.ok(e.some((x) => /criterion C-T/.test(x.msg) && /atom A/.test(x.msg) && /test_trace_rows/.test(x.msg)));
  for (const x of e) assert.match(x.msg, /records are written after freeze/);
});

test('I16: a make target whose recipe reaches the trace check is refused through the Makefile', () => {
  const mk = 'all: check\n\ncheck:\n\tpython3 -I tools/check-docs.py\n\tpython3 -I tools/check_trace.py\n\nfull: unit check\n\nunit:\n\tnode --test\n\nopt:\n\t$(MAKE) full PYTHON="py -O"\n\nX := check\n';
  const repo = makeRepo('i16-make', { Makefile: mk });
  const rules = makeRules(mk);
  assert.match(recordsCheck('make check', rules), /check_trace/);
  assert.match(recordsCheck('make -k full >/dev/null', rules), /full → check → check_trace/);
  assert.match(recordsCheck('make opt', rules), /check_trace/);
  assert.match(recordsCheck('make', rules), /check_trace/);
  assert.equal(recordsCheck('make unit && node --test a.mjs', rules), null);
  const dir = path.join(tmp, 'i16-make-job'); fs.mkdirSync(dir);
  const v = validate(fixtureJob(dir, repo, { gate: 'make full' }), { gate: 'decide', offline: false, volatile: [], confirmation: { ok: true } });
  assert.match(errs(v, 'I16')[0]?.msg ?? '', /conductor\.gate.*make full/);
});

test('I16: the real Makefile: make check and make test reach the trace check; the atom test targets do not', () => {
  const rules = makeRules(fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8'));
  assert.match(recordsCheck('make check', rules), /check_trace/);
  assert.match(recordsCheck('make test', rules), /check_trace/);
  for (const ok of ['make lib-test', 'make atomizer-test', 'make library-test', 'make loop-setup tscheck-setup >/dev/null && make sums >/dev/null', 'python3 -I tools/check_comments.py tools/job'])
    assert.equal(recordsCheck(ok, rules), null, ok);
});

test('I16: ordinary gates and checks pass', () => {
  const dir = path.join(tmp, 'i16-ok'); fs.mkdirSync(dir);
  const v = decide(fixtureJob(dir, dir, { gate: 'make sums >/dev/null && python3 -I tools/check-docs.py && python3 -I tools/check-privacy.py', runs: { 'C-T': 'test -f a.test.mjs && node --test a.test.mjs && make lib-test' } }));
  assert.deepEqual(errs(v, 'I16'), []);
});

test('classifyBaseline: import, module and path errors are broken; an ordinary failure is a failure', () => {
  const c = (output, status = 1, extra = {}) => classifyBaseline({ status, output, ms: 5, ...extra });
  assert.equal(c('', 0).status, 'passed');
  assert.equal(c('AssertionError: expected 1 to equal 2').status, 'failed');
  for (const [out, why] of [
    ['Traceback...\nModuleNotFoundError: No module named \'lib\'', /ModuleNotFoundError/],
    ['Could not find \'/r/tools/x.test.mjs\'', /Could not find/],
    ['Error: spawn foo ENOENT', /ENOENT/],
    ['Error [ERR_MODULE_NOT_FOUND]: Cannot find module \'/r/a.mjs\'', /module/i],
    ['make: *** No rule to make target \'nope\'.  Stop.', /No rule to make target/],
  ]) { const r = c(out, out.startsWith('make') ? 2 : 1); assert.equal(r.status, 'broken', out); assert.match(r.why, why); }
  assert.equal(c('sh: 1: nosuch: not found', 127).status, 'broken');
  assert.match(c('sh: 1: nosuch: not found', 127).why, /not found/);
  const t = c('', null, { timedOut: true, ms: 1200 });
  assert.equal(t.status, 'failed');
  assert.match(t.why, /timed out after 1200 ms/);
});

test('I17: calibrateBase runs each check once on the base tree in a throwaway worktree and records why', () => {
  const repo = makeRepo('i17-repo', { 'marker.txt': 'base\n', 'ok.mjs': 'process.exit(0)\n', 'fail.mjs': 'console.error("AssertionError: 1 !== 2"); process.exit(1)\n' });
  fs.writeFileSync(path.join(repo, 'marker.txt'), 'dirty\n');
  const linked = path.join(tmp, 'i17-linked'); fs.mkdirSync(linked); fs.writeFileSync(path.join(linked, 'tool'), 'here\n');
  const dir = path.join(tmp, 'i17-job'); fs.mkdirSync(dir);
  const job = fixtureJob(dir, repo, { runs: {
    'C-BASE': 'grep -qx base marker.txt && node ok.mjs',
    'C-LINK': 'test -f .tools/tool',
    'C-NEW': 'test -f t/new.test.mjs && node --test t/new.test.mjs',
    'C-FAIL': 'node fail.mjs',
    'C-PATH': 'node --test t/missing.test.mjs',
    'C-PY': 'python3 -I -c "import no_such_module_xyz"',
    'C-CMD': 'no-such-command-xyz --flag',
  } });
  job.conductor = { links: [{ path: '.tools', target: linked }] };
  const before = git(repo, 'worktree', 'list').split('\n').length;
  const b = calibrateBase(job);
  assert.equal(b.base, git(repo, 'rev-parse', 'HEAD'));
  const s = Object.fromEntries(Object.entries(b.checks).map(([id, r]) => [id, r.status]));
  assert.deepEqual(s, { 'C-BASE': 'passed', 'C-LINK': 'passed', 'C-NEW': 'failed', 'C-FAIL': 'failed', 'C-PATH': 'broken', 'C-PY': 'broken', 'C-CMD': 'broken' });
  for (const r of Object.values(b.checks)) { assert.equal(typeof r.run, 'string'); assert.equal(typeof r.why, 'string'); assert.ok(r.why.length); }
  assert.match(b.checks['C-FAIL'].why, /exited 1/);
  assert.match(b.checks['C-PY'].why, /ModuleNotFoundError/);
  assert.equal(git(repo, 'worktree', 'list').split('\n').length, before);
  assert.equal(fs.readFileSync(path.join(repo, 'marker.txt'), 'utf8'), 'dirty\n');
});

test('I17: a check one atom breaks for the next (it writes into the tree) is run on a clean tree each time', () => {
  const repo = makeRepo('i17-clean', { 'a.txt': 'a\n' });
  const dir = path.join(tmp, 'i17-clean-job'); fs.mkdirSync(dir);
  const job = fixtureJob(dir, repo, { runs: { 'C-1': 'test ! -e stray && touch stray && rm a.txt', 'C-2': 'test ! -e stray && test -f a.txt' } });
  const b = calibrateBase(job);
  assert.equal(b.checks['C-1'].status, 'passed');
  assert.equal(b.checks['C-2'].status, 'passed');
});

test('I17: validate refuses a broken baseline always, and a missing or stale one when staging', () => {
  const dir = path.join(tmp, 'i17-validate'); fs.mkdirSync(dir);
  const job = fixtureJob(dir, dir, { runs: { 'C-T': 'node --test t/x.test.mjs' } });
  assert.deepEqual(errs(decide(job), 'I17'), []);
  assert.equal(decide(job).status.I17, 'partial');
  assert.match(errs(decide(job, { requireBaseline: true }), 'I17')[0]?.msg ?? '', /criterion C-T.*not been calibrated on the base tree/);
  const rec = (status, run = 'node --test t/x.test.mjs', why = 'exited 1') => ({ ...job, proofs: { ...job.proofs, baseline: { base: 'abc', checks: { 'C-T': { run, status, why } } } } });
  const broken = decide(rec('broken', undefined, 'Could not find \'/r/t/x.test.mjs\''));
  assert.match(errs(broken, 'I17')[0]?.msg ?? '', /criterion C-T.*broken on the base tree.*Could not find/);
  assert.equal(broken.status.I17, 'broken');
  assert.deepEqual(errs(decide(rec('failed'), { requireBaseline: true }), 'I17'), []);
  assert.equal(decide(rec('failed'), { requireBaseline: true }).status.I17, 'holds');
  assert.match(errs(decide(rec('failed', 'older command'), { requireBaseline: true }), 'I17')[0]?.msg ?? '', /changed since it was calibrated/);
  const passed = decide(rec('passed'), { requireBaseline: true });
  assert.deepEqual(errs(passed, 'I17'), []);
  assert.ok(passed.warnings.some((w) => w.inv === 'I17' && /passes on the base tree/.test(w.msg)));
});

function stage(name, runs, extra = {}) {
  const repo = makeRepo(`${name}-repo`, { 'ok.mjs': 'process.exit(0)\n' });
  const dir = path.join(tmp, name); fs.mkdirSync(dir);
  const job = { ...fixtureJob(dir, repo, { runs }), ...extra };
  const proofs = job.proofs; delete job.proofs;
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify(job, null, 1));
  fs.writeFileSync(path.join(dir, 'job.proofs.json'), JSON.stringify(proofs, null, 1));
  const r = spawnSync(process.execPath, [JOB_BIN, 'stage', file, '--offline'], { encoding: 'utf8', env: { ...process.env, ENDOFORGE_NOTIFY: 'none', ENDOFORGE_JOBS: path.join(tmp, 'no-jobs'), ENDOFORGE_VOLATILE: '/nonexistent-volatile' } });
  return { r, dir, file, proofs: JSON.parse(fs.readFileSync(path.join(dir, 'job.proofs.json'), 'utf8')) };
}

test('I17: job.mjs stage calibrates every check, records it, and refuses a broken one', () => {
  const { r, dir, proofs } = stage('stage-broken', { 'C-OK': 'node ok.mjs', 'C-BAD': 'node --test t/missing.test.mjs' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /REFUSED decide I17: criterion C-BAD/);
  assert.match(r.stderr, /C-BAD\s+broken/);
  assert.equal(proofs.baseline.checks['C-BAD'].status, 'broken');
  assert.equal(proofs.baseline.checks['C-OK'].status, 'passed');
  assert.ok(!fs.existsSync(path.join(dir, 'JOB-stage-broken.md')));
});

test('I17: job.mjs stage stages a job whose checks are calibrated and not broken', () => {
  const { r, dir, proofs } = stage('stage-good', { 'C-NEW': 'test -f t/new.test.mjs && node --test t/new.test.mjs' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(proofs.baseline.checks['C-NEW'].status, 'failed');
  assert.ok(fs.existsSync(path.join(dir, 'JOB-stage-good.md')));
});

test('I16: job.mjs stage refuses a trace gate before running any check', () => {
  const { r, proofs } = stage('stage-trace', { 'C-OK': 'node ok.mjs' }, { conductor: { gate: 'python3 -I tools/check_trace.py' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /REFUSED decide I16: conductor\.gate/);
  assert.equal(proofs.baseline, undefined);
});
