import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ATOMIZER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name) => path.join(ATOMIZER, 'bin', name);
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomizer-gaps-'));
const sources = () => fs.readdirSync(path.join(ATOMIZER, 'bin')).map((f) => path.join(ATOMIZER, 'bin', f))
  .concat(fs.readdirSync(path.join(ATOMIZER, 'lib')).map((f) => path.join(ATOMIZER, 'lib', f))).filter((f) => f.endsWith('.mjs'));

test('the ledger schema named by lib/ledger.mjs exists next to it', () => {
  const ledger = fs.readFileSync(path.join(ATOMIZER, 'lib/ledger.mjs'), 'utf8');
  for (const [, ref] of ledger.matchAll(/Schema: ([A-Z]+\.md)/g)) assert.ok(fs.existsSync(path.join(ATOMIZER, ref)), `${ref} is missing`);
  assert.ok(fs.existsSync(path.join(ATOMIZER, 'LEDGER.md')), 'LEDGER.md is missing');
});

test('LEDGER.md documents the schema id, the common fields and exactly the events the code emits', () => {
  const doc = fs.readFileSync(path.join(ATOMIZER, 'LEDGER.md'), 'utf8');
  const { SCHEMA } = { SCHEMA: /export const SCHEMA = '([^']+)'/.exec(fs.readFileSync(path.join(ATOMIZER, 'lib/ledger.mjs'), 'utf8'))[1] };
  assert.ok(doc.includes(SCHEMA), `schema id ${SCHEMA} not documented`);
  for (const f of ['v', 'ts', 'event']) assert.match(doc, new RegExp(`^\\| \`${f}\` \\|`, 'm'), `common field ${f} not documented`);
  const emitted = new Set(sources().flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/\bemit\(([^,]+),/g)]
    .flatMap((m) => [...m[1].matchAll(/'([a-z]+\.[a-z]+)'/g)].map((x) => x[1]))));
  assert.ok(emitted.has('run.archived') && emitted.has('archive.refused'), 'conditional event names not found');
  const documented = new Set([...doc.matchAll(/^\| `([a-z]+\.[a-z]+)` \|/gm)].map((m) => m[1]));
  assert.ok(emitted.size >= 10, `found only ${emitted.size} emitted events`);
  assert.deepEqual([...emitted].filter((e) => !documented.has(e)).sort(), [], 'emitted but not documented');
  assert.deepEqual([...documented].filter((e) => !emitted.has(e)).sort(), [], 'documented but never emitted');
});

test('bench.mjs defaults to an atoms file that exists in the repository', () => {
  const src = fs.readFileSync(BIN('bench.mjs'), 'utf8');
  const m = /A\.atoms \?\? path\.join\(REPO, '([^']+)'\)/.exec(src);
  assert.ok(m, 'bench default atoms path not found');
  assert.ok(fs.existsSync(path.join(ATOMIZER, '../..', m[1])), `${m[1]} does not exist`);
});

const sandboxEnv = () => ({ ...process.env, ATOMIZER_LEDGER_DIR: path.join(tmp, 'ledger'), ENDOFORGE_CLAUDE_ACCOUNTS: path.join(tmp, 'none'), ENDOFORGE_CODEX_POOL: 'true', ENDOFORGE_TRACE: '1' });

test('a bare bench run on the default atoms completes every repetition', () => {
  const r = spawnSync(process.execPath, [BIN('bench.mjs'), '--n', '1', '--out-dir', path.join(tmp, 'bench')], { encoding: 'utf8', env: sandboxEnv(), timeout: 120_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /reps=1 ok=1/);
});

test('bench refuses an atoms file that does not exist instead of recording ok=0', () => {
  const r = spawnSync(process.execPath, [BIN('bench.mjs'), '--atoms', path.join(tmp, 'absent.json'), '--out-dir', path.join(tmp, 'bench-absent')], { encoding: 'utf8', env: sandboxEnv() });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /absent\.json/);
  assert.ok(!fs.existsSync(path.join(tmp, 'bench-absent')), 'bench created an output directory for a run it cannot do');
});

test('testcheck.mjs prints its usage and exits 2 without the arguments it needs', () => {
  for (const args of [[], ['strip'], ['merge', 'a.json'], ['bogus', 'x.json']]) {
    const r = spawnSync(process.execPath, [BIN('testcheck.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /usage: testcheck\.mjs/, args.join(' '));
    assert.doesNotMatch(r.stderr, /ERR_INVALID_ARG_TYPE|at file:/, args.join(' '));
  }
});

test('testcheck.mjs strip and merge still work', () => {
  const tests = path.join(tmp, 'tests.json'), computed = path.join(tmp, 'computed.json');
  fs.writeFileSync(tests, JSON.stringify([{ name: 'a', fn: 'f', args: [1], expect: 2 }, { name: 'b', fn: 'f', args: [2], expect: 9 }]));
  fs.writeFileSync(computed, JSON.stringify([{ name: 'a', value: 2 }, { name: 'b', value: 4 }]));
  let r = spawnSync(process.execPath, [BIN('testcheck.mjs'), 'strip', tests, path.join(tmp, 'cases.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'cases.json'), 'utf8')), [{ name: 'a', fn: 'f', args: [1] }, { name: 'b', fn: 'f', args: [2] }]);
  r = spawnSync(process.execPath, [BIN('testcheck.mjs'), 'merge', tests, computed, path.join(tmp, 'kept.json'), path.join(tmp, 'report.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'kept.json'), 'utf8')).map((t) => t.name), ['a']);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('atomizer tool gaps: all passed');
