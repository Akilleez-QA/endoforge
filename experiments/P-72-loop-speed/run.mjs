import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASC_PATH } from '../../tools/asc/pin.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { SpawnClaudeTransport } from '../../core/runtime/x1/transports.mjs';
import { hNeeds, heldOutTests, readR } from '../P-56-model-effort/needs.mjs';
import { heldOut } from '../P-56-model-effort/heldout.mjs';
import { armNames, budgetRefusal, callCeiling, loadLimit, p66Needs, slotsOf, startOrder, tokenBudgetErrors, verifiedPrecommit } from './design.mjs';

const precommit = verifiedPrecommit();
const here = path => fileURLToPath(new URL(path, import.meta.url));
const root = here('../../');
const [outputArg, stage] = process.argv.slice(2);
const output = resolve(outputArg ?? '');
if (!outputArg || !relative(root, output).split(sep).includes('..')) throw Error('output must be outside the checkout');
const plan = JSON.parse(readFileSync(here('./plan.json'), 'utf8'));
const spec = plan.stages[stage];
assert.ok(spec, `unknown stage ${stage}`);
const testDouble = spec.testDouble === true;
const ceiling = plan.budget.modelCalls;
assert.ok(Number.isSafeInteger(ceiling) && ceiling > 0 && ceiling <= callCeiling, `the call budget must be at most ${callCeiling}`);
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.ok(!(name in process.env), `${name} must be unset`);
const standIn = process.env.P72_STAND_IN;
assert.equal(Boolean(standIn), testDouble, 'P72_STAND_IN is for test-double stages only, and they need it');
const command = standIn ?? 'claude';
if (!testDouble) assert.deepEqual(spec.needs, p66Needs(), 'a model stage runs the 27 needs P-66 ran, in P-66\'s seeded order');
const configDir = process.env.CLAUDE_CONFIG_DIR, needsRoot = process.env.P56_NEEDS_ROOT;
assert.ok(configDir && existsSync(configDir), 'CLAUDE_CONFIG_DIR must name the signed-in account directory');
if (spec.needs.some(need => !need.startsWith('H'))) assert.ok(needsRoot && existsSync(needsRoot), 'P56_NEEDS_ROOT required');
mkdirSync(join(output, stage), { recursive: true });
const log = (name, value) => appendFileSync(join(output, `${name}.jsonl`), `${JSON.stringify(value)}\n`);
const load = () => Number(loadavg()[0].toFixed(2));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function authStatus(label) {
  const raw = execFileSync(command, ['auth', 'status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: configDir }, encoding: 'utf8', timeout: 60000 });
  const status = JSON.parse(raw);
  const kept = { at: new Date().toISOString(), stage, label, loggedIn: status.loggedIn, authMethod: status.authMethod, apiProvider: status.apiProvider, subscriptionType: status.subscriptionType };
  log('auth', kept);
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw Error(`auth check failed before ${label}`);
  return kept;
}

async function environmentCheck() {
  const file = join(output, 'env-probe.json'), probe = join(output, 'env-probe.mjs');
  writeFileSync(probe, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(file)}, JSON.stringify({ names: Object.keys(process.env).sort(), configDir: process.env.CLAUDE_CONFIG_DIR }));\nprocess.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: [], apiKeySource: 'none', mcp_servers: [] }) + '\\n' + JSON.stringify({ type: 'result', result: '{"calls":[]}', usage: {} }) + '\\n');\n`);
  const transport = new SpawnClaudeTransport({ configDir, model: plan.model, command: process.execPath, base: { ...process.env, ANTHROPIC_PROBE_UNUSED: 'x' } });
  transport.arguments = [probe];
  await transport.send({ messages: [{ role: 'user', content: 'x' }] });
  await transport.close();
  const seen = JSON.parse(readFileSync(file, 'utf8'));
  const credential = seen.names.filter(name => /^ANTHROPIC_|API_KEY|AUTH_TOKEN|OAUTH_TOKEN/i.test(name));
  const result = { configDir: seen.configDir === configDir, credentialNames: credential, names: seen.names };
  writeFileSync(join(output, 'env-check.json'), JSON.stringify(result, null, 1));
  if (!result.configDir || credential.length) throw Error('transport environment check failed');
  return result;
}

const mentions = (tree, key) => readdirSync(join(tree, 'core/runtime/x1'), { recursive: true }).filter(name => String(name).endsWith('.mjs'))
  .some(name => new RegExp(`\\b${key}\\b`).test(readFileSync(join(tree, 'core/runtime/x1', String(name)), 'utf8')));

function materialize(sha) {
  const tree = join(output, 'trees', sha);
  if (!existsSync(join(tree, 'core/runtime/x1/loop.mjs'))) {
    mkdirSync(tree, { recursive: true });
    execFileSync('sh', ['-c', 'git archive --format=tar "$1" | tar -x -C "$2"', 'sh', sha, tree], { cwd: root });
  }
  return tree;
}

const arms = armNames.filter(arm => { assert.ok(plan.arms[arm], `plan.json lacks arm ${arm}`); return !plan.arms[arm].dropped; });
const harness = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
const trees = {};
for (const arm of arms) {
  const entry = plan.arms[arm];
  if (testDouble) { trees[arm] = { arm, tree: root, commit: harness.commit, source: 'checkout', limits: entry.limits }; continue; }
  if (!entry.commit) throw Error(`arm ${arm} has no commit yet: ${entry.pending ?? 'not integrated'}`);
  const sha = git('rev-parse', '--verify', `${entry.commit}^{commit}`);
  trees[arm] = { arm, tree: materialize(sha), commit: sha, source: 'archive', limits: entry.limits };
}
for (const arm of arms) trees[arm].flags = Object.fromEntries(Object.keys(trees[arm].limits).map(key => [key, mentions(trees[arm].tree, key)]));
if (!testDouble) {
  assert.ok(trees.main.commit.startsWith('f834d21'), 'the main arm runs main at f834d21');
  if (arms.includes('fixed')) git('merge-base', '--is-ancestor', trees.main.commit, trees.fixed.commit);
  if (arms.includes('oracle')) assert.equal(trees.oracle.commit, trees.fixed.commit, 'oracle is the fixed commit with limits.oracle on');
  for (const arm of ['overlap', 'compact'].filter(name => arms.includes(name))) git('merge-base', '--is-ancestor', trees.fixed.commit, trees[arm].commit);
  for (const arm of arms) for (const [key, present] of Object.entries(trees[arm].flags)) assert.ok(present, `arm ${arm}: limits.${key} is not read anywhere in its loop at ${trees[arm].commit}`);
}

const needText = id => id.startsWith('H') ? hNeeds.find(need => need.id === id).need : readR(needsRoot, id);
const slots = slotsOf(arms, plan.perArm);
const callsFile = join(output, 'calls.json');
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : { model: 0, refused: 0, needs: 0 };
const saveCalls = () => writeFileSync(callsFile, JSON.stringify(calls));
const previous = existsSync(join(output, 'rows.jsonl')) ? readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage) : [];
const done = new Set(previous.map(row => row.need));
const stopped = Object.fromEntries(previous.filter(row => row.escaped).map(row => [row.arm, { need: row.need, sample: row.sample }]));

writeFileSync(join(output, stage, 'environment.json'), JSON.stringify({ precommit, stage, testDouble, node: process.version, harness, claude: execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(),
  started: new Date().toISOString(), load: load(), needs: spec.needs, arms: Object.values(trees).map(({ tree, ...rest }) => ({ ...rest, tree: rest.source === 'checkout' ? '.' : relative(output, tree) })),
  model: plan.model, effort: plan.effort, perArm: plan.perArm, slots: slots.length, budget: ceiling, alreadyDone: [...done], stopped }, null, 1));
authStatus(`${stage}:start`);
if (!testDouble && !existsSync(join(output, 'env-check.json'))) await environmentCheck();

function permit() {
  if (calls.model >= ceiling) { calls.refused += 1; saveCalls(); return false; }
  calls.model += 1;
  saveCalls();
  return true;
}

function spawnWorker(slot) {
  const child = fork(here('./worker.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const pending = new Map();
  let next = 0;
  child.on('message', message => {
    if (message.type === 'permit') return child.send({ type: 'permit', id: message.id, ok: permit() });
    const entry = pending.get(message.id);
    if (!entry) return undefined;
    if (message.type === 'started') return entry.started?.(message);
    pending.delete(message.id);
    return message.error ? entry.reject(Error(message.error)) : entry.resolve(message.value);
  });
  child.on('exit', code => { for (const entry of pending.values()) entry.reject(Error(`worker exited with ${code}`)); pending.clear(); });
  const call = (type, body = {}, started) => new Promise((resolveCall, reject) => { const id = ++next; pending.set(id, { resolve: resolveCall, reject, started }); child.send({ type, id, ...body }); });
  return { slot, child, call };
}

const workers = slots.map(spawnWorker);
for (const worker of workers) worker.limits = (await worker.call('init', { tree: trees[worker.slot.arm].tree, ascPath: ASC_PATH, armLimits: trees[worker.slot.arm].limits })).limits;
const empty = mkdtempSync(join(output, 'empty-'));

const leuOf = replies => {
  let previousCost = 0, total = 0;
  for (const reply of replies) if (!reply.failed && Number.isFinite(reply.costUsd)) { total += Math.max(0, reply.costUsd - previousCost); previousCost = Math.max(previousCost, reply.costUsd); }
  return total;
};
const causeCount = (replies, cause) => replies.filter(reply => reply.causes?.includes(cause)).length;

function buildRow(entry, worker, startIndex, result, needBegin) {
  const { arm, sample } = worker.slot, answer = result.answer ?? { promoted: false, error: result.crashed ?? 'no answer' };
  const replies = result.replies ?? [], sendErrors = result.sendErrors ?? (result.crashed ? [result.crashed] : []);
  const rounds = (answer.rounds ?? []).map(round => ({ failed: Boolean(round.failures), gates: round.failures ? Object.keys(round.failures.gates ?? {}) : [], failingTests: round.failures?.tests?.length ?? 0,
    g8: round.failures?.gates?.G8_nonfinite?.why ?? null }));
  const first = rounds[0], blocked = first ? first.gates.some(gate => /^G[123]_/.test(gate)) : false;
  const firstCheck = first ? { g4: !blocked && !first.gates.includes('G4_tests'), g7: !blocked && !first.gates.includes('G7_glue'), gates: first.gates } : null;
  if (firstCheck) firstCheck.pass = firstCheck.g4 && firstCheck.g7;
  let held = null, tests = null;
  if (answer.content) {
    writeFileSync(join(output, stage, `${entry.need}--${arm}--${sample}.content.json`), answer.content);
    try { tests = JSON.parse(JSON.parse(answer.content).files['tests.json']); } catch { tests = null; }
  }
  if (answer.promoted) {
    assert.equal(hash(answer.content), answer.candidate, 'returned content is not the promoted candidate');
    const need = hNeeds.find(h => h.id === entry.need);
    if (need) held = heldOut(answer.content, heldOutTests(need));
  }
  const corrections = (answer.oracle?.spec_errors ?? []).filter(error => error.status === 'corrected').map(error => ({ index: error.index, sources: error.sources, literal: error.literal, computed: error.computed, frozen: tests?.[error.index] ?? null }));
  const known = new Set(['promoted', 'status', 'problem', 'error', 'agent', 'rounds', 'content', 'candidate', 'oracle', 'overlap', 'compact', 'modelMs', 'timings', 'testDouble', 'receipt', 'decision', 'rerun']);
  const transportErrors = sendErrors.filter(error => !tokenBudgetErrors.includes(error) && error !== budgetRefusal);
  return { stage, testDouble, need: entry.need, kind: entry.need.startsWith('H') ? 'H' : 'R', position: entry.position, arm, sample, startIndex, commit: trees[arm].commit, limits: worker.limits,
    model: plan.model, effort: plan.effort, at: new Date().toISOString(), needBegin, startedAt: result.startedAt ? new Date(result.startedAt).toISOString() : null, startedEpochMs: result.startedAt ?? null,
    promoted: Boolean(answer.promoted), status: answer.status ?? null, problem: answer.problem ?? null, error: answer.error ?? null, agent: answer.agent ?? null, rounds, firstCheck,
    g8Failures: rounds.map(round => round.g8).filter(Boolean), oracle: answer.oracle ?? null, oracleFlags: replies.flatMap(reply => reply.oracleFlags ?? []), corrections,
    overlap: answer.overlap ?? null, compact: answer.compact ?? null, answerExtra: Object.fromEntries(Object.entries(answer).filter(([key]) => !known.has(key))),
    heldOut: held, escaped: Boolean(answer.promoted && held && held.clean !== true),
    wallMs: result.wallMs ?? null, modelMs: answer.modelMs ?? null, timings: answer.timings ?? null, startupMs: worker.startupMs ?? null, replies, calls: replies.length,
    outputTokens: replies.reduce((total, reply) => total + (reply.detail?.output ?? 0), 0), leu: leuOf(replies),
    extraTurns: { g8: causeCount(replies, 'g8'), afterPass: causeCount(replies, 'after-pass'), repeated: causeCount(replies, 'repeated'), oracleFlag: causeCount(replies, 'oracle-flag'),
      failedCheck: causeCount(replies, 'failed-check'), invalidReply: causeCount(replies, 'invalid-reply') },
    sendErrors, transportErrors, unknownProviderAccess: result.unknownProviderAccess ?? [], inits: result.inits ?? [], loadStart: result.loadStart ?? null, loadEnd: result.loadEnd ?? null,
    loaded: (result.loadStart ?? 0) > loadLimit || (result.loadEnd ?? 0) > loadLimit, candidate: answer.candidate ?? null, contentHash: answer.content ? hash(answer.content) : null };
}

let halted = null, consecutiveErrorNeeds = 0;
const order = spec.needs.map((need, position) => ({ need, position }));
try {
  for (const entry of order) {
    if (halted) break;
    if (done.has(entry.need)) continue;
    if (calls.model >= ceiling) { halted = budgetRefusal; break; }
    const active = workers.filter(worker => !stopped[worker.slot.arm]);
    if (!active.length) { halted = 'every arm stopped at an escape'; break; }
    authStatus(`${stage}:${entry.need}`);
    for (const worker of active) {
      const started = await worker.call('start', { configDir, model: plan.model, effort: plan.effort, cwd: empty, command: standIn });
      worker.startupMs = started.startupMs;
    }
    const sequence = startOrder(precommit, entry.need, workers.length).filter(index => !stopped[workers[index].slot.arm]);
    const needBegin = new Date().toISOString(), text = needText(entry.need), running = [];
    for (const index of sequence) {
      const worker = workers[index], { arm, sample } = worker.slot, startIndex = startOrder(precommit, entry.need, workers.length).indexOf(index);
      let started;
      const ack = new Promise(resolveAck => { started = resolveAck; });
      const run = worker.call('run', { need: entry.need, text, directory: join(output, stage, `${entry.need}--${arm}--${sample}`) }, started)
        .then(result => ({ worker, startIndex, result }), error => ({ worker, startIndex, result: { crashed: String(error?.message ?? error) } }));
      running.push(run);
      await Promise.race([ack, run]);
    }
    const results = await Promise.all(running);
    for (const worker of active) await worker.call('stop');
    const rows = results.map(({ worker, startIndex, result }) => buildRow(entry, worker, startIndex, result, needBegin));
    const complete = rows.every(row => !row.sendErrors.includes(budgetRefusal));
    for (const row of rows.sort((a, b) => a.startIndex - b.startIndex)) log('rows', { ...row, complete });
    calls.needs += 1;
    saveCalls();
    for (const row of rows) if (row.escaped && !stopped[row.arm]) { stopped[row.arm] = { need: row.need, sample: row.sample }; log('stops', { stage, arm: row.arm, need: row.need, sample: row.sample, heldOut: row.heldOut }); }
    const transportErrors = rows.flatMap(row => row.transportErrors);
    consecutiveErrorNeeds = transportErrors.length >= 2 ? consecutiveErrorNeeds + 1 : 0;
    console.log(JSON.stringify({ need: entry.need, calls: calls.model, complete, load: load(), stopped: Object.keys(stopped),
      runs: rows.map(row => `${row.arm}#${row.sample}:${row.promoted ? (row.escaped ? 'E' : 'P') : 'F'}${row.rounds.filter(round => round.failed).length}:${(row.wallMs / 1000).toFixed(0)}s`).join(' '), errors: transportErrors.slice(0, 3) }));
    if (!complete) halted = budgetRefusal;
    else if (consecutiveErrorNeeds >= 2) halted = `two consecutive needs with two or more transport errors: ${transportErrors.slice(0, 3).join('; ')}`;
  }
} finally {
  for (const worker of workers) await worker.call('exit').catch(() => null);
  rmSync(empty, { recursive: true, force: true });
}
const end = { stage, finished: new Date().toISOString(), halted, calls, stopped, load: load() };
writeFileSync(join(output, stage, 'end.json'), JSON.stringify(end, null, 1));
console.log(JSON.stringify(end));
if (halted?.startsWith('two consecutive')) process.exitCode = 2;
