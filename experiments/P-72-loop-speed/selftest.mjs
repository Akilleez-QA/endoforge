import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { analyze } from './analyze.mjs';
import { budgetRefusal, startOrder, verifiedPrecommit } from './design.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const root = here('../../'), runner = here('./run.mjs'), standIn = here('./stand-in.mjs');
const precommit = verifiedPrecommit();
const base = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'p72-selftest-'));
mkdirSync(base, { recursive: true });
const credentialNames = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function account(name, settings = {}) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic', scopes: ['user:inference'], subscriptionType: 'max' } }), { mode: 0o600 });
  writeFileSync(join(dir, 'stand-in.json'), JSON.stringify(settings));
  return dir;
}

const shim = join(base, 'python-shim');
mkdirSync(shim, { recursive: true });
writeFileSync(join(shim, 'sitecustomize.py'), 'import os\nif not hasattr(os, "fdatasync"):\n    os.fdatasync = os.fsync\n');
const environment = (config, extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !credentialNames.includes(name)));
  return { ...env, CLAUDE_CONFIG_DIR: config, ENDOFORGE_USAGE_STATE: join(base, 'usage.json'), P72_STAND_IN: standIn, ...(process.platform === 'darwin' ? { PYTHONPATH: shim } : {}), ...extra };
};
const run = (script, output, stage, env) => spawnSync(process.execPath, [script, output, stage], { env, encoding: 'utf8', timeout: 900000 });
const normal = account('account');

{
  const mirror = join(base, 'mirror'), copy = join(mirror, 'experiments/P-72-loop-speed');
  mkdirSync(copy, { recursive: true });
  for (const name of ['core', 'tools']) symlinkSync(join(root, name), join(mirror, name));
  for (const name of ['P-56-model-effort', 'P-66-best-of-n']) symlinkSync(join(root, 'experiments', name), join(mirror, 'experiments', name));
  for (const name of readdirSync(here('./'))) if (name.endsWith('.mjs') || name.endsWith('.json') || name.endsWith('.md')) copyFileSync(here(`./${name}`), join(copy, name));
  cpSync(here('./receipt'), join(copy, 'receipt'), { recursive: true });
  writeFileSync(join(copy, 'PRECOMMIT.md'), `${readFileSync(here('./PRECOMMIT.md'), 'utf8')}\nAn unrecorded edit.\n`);
  const output = join(base, 'out-hash'), result = run(join(copy, 'run.mjs'), output, 'smoke', environment(normal));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PRECOMMIT\.md differs from its recorded hash/);
  assert.equal(existsSync(output), false, 'nothing written before the hash check');
  console.log('hash check: a PRECOMMIT.md that differs from receipt/precommit.sha256 stops the runner before it writes anything');
}

for (const name of credentialNames) {
  const result = run(runner, join(base, `out-${name}`), 'smoke', environment(normal, { [name]: 'synthetic-unused' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${name} must be unset`));
}
{
  const result = run(runner, join(base, 'out-auth'), 'smoke', environment(account('api-login', { authMethod: 'console' })));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth check failed before smoke:start/);
  const env = environment(normal, { P56_NEEDS_ROOT: base });
  delete env.P72_STAND_IN;
  const main = run(runner, join(base, 'out-main'), 'main', env);
  assert.notEqual(main.status, 0);
  assert.match(main.stderr, /arm fixed has no commit yet/);
  console.log('environment: each credential variable, a non-claude.ai login, and a main stage without the arm commits are refused');
}

const required = ['stage', 'testDouble', 'need', 'kind', 'position', 'arm', 'sample', 'startIndex', 'commit', 'limits', 'model', 'effort', 'needBegin', 'startedAt', 'startedEpochMs', 'promoted', 'status', 'problem', 'error',
  'agent', 'rounds', 'firstCheck', 'g8Failures', 'oracle', 'oracleFlags', 'corrections', 'overlap', 'compact', 'answerExtra', 'heldOut', 'escaped', 'wallMs', 'modelMs', 'timings', 'startupMs', 'replies', 'calls',
  'outputTokens', 'leu', 'extraTurns', 'sendErrors', 'transportErrors', 'unknownProviderAccess', 'inits', 'loadStart', 'loadEnd', 'loaded', 'candidate', 'contentHash', 'complete'];
{
  const output = join(base, 'out-smoke'), result = run(runner, output, 'smoke', environment(normal));
  assert.equal(result.status, 0, result.stderr);
  const rows = lines(join(output, 'rows.jsonl')), end = json(join(output, 'smoke', 'end.json')), calls = json(join(output, 'calls.json'));
  assert.equal(end.halted, null);
  assert.deepEqual(Object.keys(end.stopped), ['fixed']);
  assert.equal(calls.model, rows.reduce((sum, row) => sum + row.calls, 0));
  assert.equal(calls.refused, 0);
  const byNeed = need => rows.filter(row => row.need === need);
  assert.equal(byNeed('H05').length, 20);
  assert.equal(byNeed('H01').length, 16, 'the fixed arm stopped after its escape on H05');
  assert.ok(byNeed('H01').every(row => row.arm !== 'fixed'));
  for (const row of rows) for (const key of required) assert.ok(key in row, `row lacks ${key}`);
  for (const row of rows) for (const reply of row.replies) for (const key of ['beginMs', 'endMs', 'wallMs', 'usage', 'costUsd', 'detail', 'stage', 'causes']) assert.ok(key in reply, `reply lacks ${key}`);
  const slots = ['main', 'fixed', 'oracle', 'overlap', 'compact'].flatMap(arm => [0, 1, 2, 3].map(sample => `${arm}#${sample}`));
  for (const need of ['H05', 'H01']) {
    const order = startOrder(precommit, need, 20), started = byNeed(need).sort((a, b) => a.startedEpochMs - b.startedEpochMs);
    for (const row of started) assert.equal(order[row.startIndex], slots.indexOf(`${row.arm}#${row.sample}`));
    assert.deepEqual(started.map(row => row.startIndex), [...started.map(row => row.startIndex)].sort((a, b) => a - b), 'runs start in the shuffled order');
  }
  assert.notDeepEqual(startOrder(precommit, 'H05', 20), startOrder(precommit, 'H01', 20));
  const find = (need, arm, sample) => rows.find(row => row.need === need && row.arm === arm && row.sample === sample);
  const escape = find('H05', 'fixed', 0);
  assert.ok(escape.promoted && escape.escaped && escape.heldOut.clean === false);
  const repeated = find('H01', 'main', 3);
  assert.ok(!repeated.promoted && repeated.extraTurns.repeated >= 4 && repeated.agent.exit_reason === 'max_turns');
  const afterPass = find('H01', 'main', 0);
  assert.ok(afterPass.promoted && afterPass.extraTurns.afterPass === 1 && afterPass.firstCheck.pass === false && afterPass.firstCheck.g7 === true);
  const g8 = find('H05', 'compact', 1);
  assert.ok(g8.promoted && g8.extraTurns.g8 === 1 && /returned where the contract requires a trap/.test(g8.g8Failures[0]) && g8.firstCheck.gates.includes('G8_nonfinite') && g8.firstCheck.pass);
  const corrected = find('H01', 'oracle', 0);
  assert.equal(corrected.oracle.corrected, 1);
  assert.equal(corrected.corrections[0].frozen.expect, hNeeds.find(need => need.id === 'H01').reference.kwToHp(1));
  assert.ok(rows.filter(row => row.arm !== 'oracle').every(row => row.oracle === null));
  assert.ok(rows.every(row => row.inits.every(init => init.apiKeySource === 'none') && row.unknownProviderAccess.length === 0));
  const auth = lines(join(output, 'auth.jsonl'));
  assert.deepEqual(auth.map(entry => entry.label), ['smoke:start', 'smoke:H05', 'smoke:H01']);
  assert.ok(auth.every(entry => entry.loggedIn === true && entry.authMethod === 'claude.ai'));
  const analysis = analyze(rows, { precommit, resamples: 1000 });
  assert.deepEqual(analysis.completeNeeds, ['H05', 'H01']);
  assert.equal(analysis.arms.fixed.escapes, 1);
  assert.equal(analysis.verdicts.find(v => v.arm === 'fixed').checks.noMoreEscapes, false);
  assert.equal(analysis.arms.oracle.oracle.contradicted, 0);
  assert.equal(analysis.arms.main.passRate, 7 / 8);
  console.log(`smoke: ${rows.length} runs on H05 and H01, ${calls.model} stand-in calls counted; per-need shuffled starts, escape stop, repeated, after-pass, G8 and oracle-correction rows as scripted`);
}

{
  const output = join(base, 'out-budget');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'calls.json'), JSON.stringify({ model: 1285, refused: 0, needs: 0 }));
  const result = run(runner, output, 'smoke', environment(normal));
  assert.equal(result.status, 0, result.stderr);
  const rows = lines(join(output, 'rows.jsonl')), end = json(join(output, 'smoke', 'end.json'));
  assert.equal(end.halted, budgetRefusal);
  assert.equal(end.calls.model, 1300);
  assert.ok(end.calls.refused > 0);
  assert.deepEqual([...new Set(rows.map(row => row.need))], ['H05']);
  assert.ok(rows.every(row => row.complete === false));
  assert.equal(rows.reduce((sum, row) => sum + row.calls, 0), 15);
  assert.deepEqual(analyze(rows, { precommit, resamples: 1000 }).completeNeeds, []);
  console.log(`budget: from 1,285 calls the runner made 15 more, refused ${end.calls.refused} past 1,300, marked H05 incomplete and stopped`);
}

{
  const output = join(base, 'out-halt'), result = run(runner, output, 'smoke-halt', environment(account('erroring', { mode: 'errors' })));
  assert.equal(result.status, 2, result.stderr);
  const rows = lines(join(output, 'rows.jsonl')), end = json(join(output, 'smoke-halt', 'end.json'));
  assert.match(end.halted, /^two consecutive needs with two or more transport errors/);
  assert.deepEqual([...new Set(rows.map(row => row.need))], ['H01', 'H05'], 'the third need never starts');
  for (const need of ['H01', 'H05']) assert.ok(rows.filter(row => row.need === need).flatMap(row => row.transportErrors).length >= 2);
  console.log('halt: two consecutive needs with two or more transport errors stop the run before the third need, exit 2');
}
console.log(`selftest passed (${base})`);
