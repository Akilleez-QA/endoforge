import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

const guard = join(base, 'no-model-bin');
mkdirSync(guard, { recursive: true });
writeFileSync(join(guard, 'claude'), '#!/bin/sh\necho "selftest: the real claude CLI is never run" >&2\nexit 97\n');
chmodSync(join(guard, 'claude'), 0o755);
const plan = json(here('./plan.json'));
const shim = join(base, 'python-shim');
mkdirSync(shim, { recursive: true });
writeFileSync(join(shim, 'sitecustomize.py'), 'import os\nif not hasattr(os, "fdatasync"):\n    os.fdatasync = os.fsync\n');
const environment = (config, extra = {}) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !credentialNames.includes(name)));
  return { ...env, PATH: `${guard}:${env.PATH ?? ''}`, CLAUDE_CONFIG_DIR: config, ENDOFORGE_USAGE_STATE: join(base, 'usage.json'), P72_STAND_IN: standIn, ...(process.platform === 'darwin' ? { PYTHONPATH: shim } : {}), ...extra };
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
  assert.match(main.stderr, /selftest: the real claude CLI is never run/);
  assert.equal(existsSync(join(base, 'out-main', 'calls.json')), false);
  assert.equal(existsSync(join(base, 'out-main', 'main', 'environment.json')), false);
  const pinned = [...new Set(Object.values(plan.arms).map(arm => arm.commit))];
  assert.deepEqual(readdirSync(join(base, 'out-main', 'trees')).sort(), [...pinned].sort());
  console.log(`environment: each credential variable and a non-claude.ai login are refused; the main stage passes every pin check on ${pinned.length} commits (main at f834d21, fixed descends from main, oracle = fixed, overlap and compact descend from fixed, each limits key read in its arm's loop) and stops at the first claude invocation, a guard on PATH`);
}

const required = ['stage', 'testDouble', 'need', 'kind', 'position', 'arm', 'sample', 'startIndex', 'commit', 'limits', 'model', 'effort', 'needBegin', 'startedAt', 'startedEpochMs', 'promoted', 'status', 'problem', 'error',
  'agent', 'rounds', 'firstCheck', 'g8Failures', 'oracle', 'oracleFlags', 'corrections', 'overlap', 'compact', 'answerExtra', 'heldOut', 'escaped', 'wallMs', 'modelMs', 'timings', 'startupMs', 'replies', 'calls',
  'outputTokens', 'leu', 'extraTurns', 'overlapCalls', 'overlapSends', 'endSessions', 'cancelledSends', 'transport', 'sendErrors', 'transportErrors', 'unknownProviderAccess', 'inits', 'loadStart', 'loadEnd', 'loaded', 'candidate', 'contentHash', 'complete'];
{
  const output = join(base, 'out-smoke'), result = run(runner, output, 'smoke', environment(normal));
  assert.equal(result.status, 0, result.stderr);
  const rows = lines(join(output, 'rows.jsonl')), end = json(join(output, 'smoke', 'end.json')), calls = json(join(output, 'calls.json'));
  assert.equal(end.halted, null);
  assert.deepEqual(Object.keys(end.stopped), ['fixed']);
  assert.equal(calls.model, rows.reduce((sum, row) => sum + row.calls, 0));
  assert.equal(calls.overlap, rows.reduce((sum, row) => sum + row.overlapCalls, 0));
  assert.equal(calls.refused, 0);
  for (const row of rows) assert.equal(row.commit, plan.arms[row.arm].commit, `${row.arm} ran its pinned commit`);
  const byNeed = need => rows.filter(row => row.need === need);
  assert.equal(byNeed('H05').length, 20);
  assert.equal(byNeed('H01').length, 16, 'the fixed arm stopped after its escape on H05');
  assert.ok(byNeed('H01').every(row => row.arm !== 'fixed'));
  for (const row of rows) for (const key of required) assert.ok(key in row, `row lacks ${key}`);
  for (const row of rows) for (const reply of row.replies) for (const key of ['beginMs', 'endMs', 'wallMs', 'usage', 'costUsd', 'detail', 'stage', 'causes', 'session', 'overlap', 'hooks', 'startedMs', 'partials']) assert.ok(key in reply, `reply lacks ${key}`);
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
  assert.ok(!repeated.promoted && repeated.extraTurns.repeated >= 4 && repeated.agent.exit_reason === 'max_turns' && repeated.calls === 7);
  const stoppedEarly = find('H01', 'compact', 3);
  assert.ok(!stoppedEarly.promoted && stoppedEarly.agent.exit_reason === 'repeated_failure' && stoppedEarly.calls === 3, 'PR #167: the same failure twice ends the stage');
  const afterPass = find('H01', 'main', 0);
  assert.ok(afterPass.promoted && afterPass.extraTurns.afterPass === 1 && afterPass.firstCheck.pass === false && afterPass.firstCheck.g7 === true);
  for (const [arm, sample] of [['oracle', 1], ['overlap', 0], ['compact', 0]]) {
    const row = find('H01', arm, sample);
    assert.ok(row.promoted && row.extraTurns.afterPass === 0 && row.agent.exit_reason === 'stop', `PR #164: ${arm}#${sample} ends on its passing check`);
  }
  const g8 = find('H05', 'main', 1);
  assert.ok(g8.promoted && g8.extraTurns.g8 === 1 && /returned where the contract requires a trap/.test(g8.g8Failures[0]) && g8.firstCheck.gates.includes('G8_nonfinite') && g8.firstCheck.pass);
  const g8Named = find('H05', 'compact', 1);
  assert.ok(g8Named.promoted && g8Named.extraTurns.g8 === 0 && g8Named.g8Failures.length === 0 && g8Named.firstCheck.pass && !g8Named.firstCheck.gates.includes('G8_nonfinite'), 'PR #165: the same NaN-only guard passes G8 when the contract names only NaN');
  for (const row of rows.filter(row => row.arm === 'overlap')) {
    assert.deepEqual(row.transport, { lanes: 2, partial: true, error: null });
    assert.equal(row.overlapCalls, 1, `${row.need} overlap#${row.sample} counts its overlap send`);
    assert.ok(row.overlap?.ran === true && row.overlap.trigger === 'partial' && row.overlap.outcome === 'used' && row.overlap.offsetMs < row.overlap.specReplyMs, `${row.need} overlap#${row.sample}: ${JSON.stringify(row.overlap)}`);
    const sent = row.replies.find(reply => reply.overlap), specification = row.replies.find(reply => reply.stage === 'specification');
    assert.ok(sent.hooks.onStart && sent.startedMs !== null && sent.beginMs < specification.endMs, 'the overlap send starts, through onStart, before the specification reply ends');
    assert.ok(specification.hooks.onPartial && specification.partials >= 2 && specification.firstPartialMs < specification.endMs, 'onPartial reaches the loop through the wrapper');
    assert.ok(row.endSessions.some(entry => entry.session === 'overlap'), 'endSession on the overlap session is recorded');
    assert.equal(row.cancelledSends.length, 0);
  }
  for (const row of rows.filter(row => row.arm !== 'overlap')) assert.ok(row.overlap === null && row.overlapCalls === 0 && row.transport.lanes === 1 && row.transport.partial === false);
  for (const row of rows.filter(row => row.arm === 'compact')) assert.ok(row.compact && row.compact.tests > 0 && /^[0-9a-f]{64}$/.test(row.compact.sha256) && row.compact.chars < row.compact.expandedBytes, `${row.need} compact#${row.sample}: ${JSON.stringify(row.compact)}`);
  for (const row of rows.filter(row => row.arm !== 'compact')) assert.equal(row.compact, null);
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
  assert.equal(analysis.arms.compact.passRate, 7 / 8);
  writeFileSync(join(output, 'analysis.json'), JSON.stringify(analysis, null, 1));
  console.log(`smoke: ${rows.length} runs on H05 and H01 against the pinned commits, ${calls.model} stand-in calls counted, ${calls.overlap} of them overlap sends (one per overlap run, each streamed from a partial reply, used, and its session ended); per-need shuffled starts, escape stop, repeated (main) against repeated_failure (fixed family), after-pass (main) against ending on a pass, G8 on main against named-kinds G8, compact receipts and oracle-correction rows as scripted`);
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
