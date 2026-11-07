// P-56 runner. Usage, from the repository root, with the account directory already signed in:
//   env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN \
//     CLAUDE_CONFIG_DIR=<account dir> P56_NEEDS_ROOT=<baseline-20 runs> \
//     node experiments/P-56-model-effort/run.mjs <output outside checkout> <pilot|main>
// The plan for each stage is in plan.json. Each run gets a fresh warm transport for its arm,
// one process cell from a pool reused across runs, and the unchanged agent loop.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createLoopPool, agentLimits } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { SpawnClaudeTransport, WarmClaudeTransport } from '../../core/runtime/x1/transports.mjs';
import { hNeeds, heldOutTests, rIds, readR } from './needs.mjs';
import { heldOut } from './heldout.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const root = here('../../');
const [outputArg, stage] = process.argv.slice(2);
const output = resolve(outputArg ?? '');
if (!outputArg || !relative(root, output).split(sep).includes('..')) throw Error('output must be outside the checkout');
const plan = JSON.parse(readFileSync(here('./plan.json'), 'utf8'));
const precommit = hash(readFileSync(here('./PRECOMMIT.md')));
assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(/\s/)[0], precommit, 'PRECOMMIT.md differs from its recorded hash');
assert.ok(plan.stages[stage], `unknown stage ${stage}`);
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.ok(!(name in process.env), `${name} must be unset`);
const configDir = process.env.CLAUDE_CONFIG_DIR, needsRoot = process.env.P56_NEEDS_ROOT, fakeCli = process.env.P56_FAKE_CLI;
assert.equal(Boolean(fakeCli), stage === 'smoke', 'P56_FAKE_CLI is for the smoke stage only, and the smoke stage needs it');
assert.ok(configDir && existsSync(configDir), 'CLAUDE_CONFIG_DIR must name the signed-in account directory');
assert.ok(needsRoot && existsSync(needsRoot), 'P56_NEEDS_ROOT required');
mkdirSync(join(output, stage), { recursive: true });
const log = (name, value) => appendFileSync(join(output, `${name}.jsonl`), `${JSON.stringify(value)}\n`);
const load = () => Number(loadavg()[0].toFixed(2));

function authStatus(label) {
  const raw = execFileSync('claude', ['auth', 'status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: configDir }, encoding: 'utf8', timeout: 60000 });
  const status = JSON.parse(raw);
  const kept = { at: new Date().toISOString(), label, loggedIn: status.loggedIn, authMethod: status.authMethod, apiProvider: status.apiProvider, subscriptionType: status.subscriptionType };
  log('auth', kept);
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw Error(`auth check failed before ${label}`);
  return kept;
}

// The transport builds the child environment from an allow-list plus CLAUDE_CONFIG_DIR.
// Prove it with a stand-in command, a parent environment holding a credential-shaped name.
async function environmentCheck() {
  const file = join(output, 'env-probe.json');
  const probe = join(output, 'env-probe.mjs');
  writeFileSync(probe, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(file)}, JSON.stringify({ names: Object.keys(process.env).sort(), configDir: process.env.CLAUDE_CONFIG_DIR }));\nprocess.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: [], apiKeySource: 'none', mcp_servers: [] }) + '\\n' + JSON.stringify({ type: 'result', result: '{"calls":[]}', usage: {} }) + '\\n');\n`);
  const transport = new SpawnClaudeTransport({ configDir, model: 'haiku', command: process.execPath, base: { ...process.env, ANTHROPIC_PROBE_UNUSED: 'x' } });
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

function seededOrder(items, seed) {
  let state = parseInt(hash(seed).slice(0, 8), 16) >>> 0;
  const next = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; state = (state ^ (state >>> 13)) >>> 0; return state / 2 ** 32; };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

const needText = id => id.startsWith('H') ? hNeeds.find(need => need.id === id).need : readR(needsRoot, id);
const { arms, budget } = plan;
const spec = plan.stages[stage];
for (const id of spec.needs) assert.ok(id.startsWith('H') ? hNeeds.some(need => need.id === id) : rIds.includes(id), `unknown need ${id}`);
const items = seededOrder(spec.needs.flatMap(need => spec.arms.flatMap(arm => Array.from({ length: spec.reps }, (_, rep) => ({ need, arm, rep })))), `${precommit}:${stage}`);
const callsFile = join(output, 'calls.json');
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : { model: 0, runs: 0 };
const maxPerRun = 2 * agentLimits.maxTurns;
const done = new Set(existsSync(join(output, 'rows.jsonl')) ? readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage).map(row => `${row.need}|${row.arm}|${row.rep}`) : []);

writeFileSync(join(output, stage, 'environment.json'), JSON.stringify({ precommit, stage, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  claude: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), load: load(), items: items.length, alreadyDone: done.size, limits: agentLimits, width: spec.width }, null, 1));
authStatus(`${stage}:start`);
if (stage === 'pilot') await environmentCheck();

class Proxy {
  name = 'claude-warm'; testDouble = false; current = null; replies = []; errors = [];
  async start() { return { startupMs: 0, lanes: 0 }; }
  async send(request) {
    calls.model += 1;
    try {
      const reply = await this.current.send(request);
      this.replies.push({ wallMs: reply.wallMs, apiMs: reply.apiMs, usage: reply.usage, costUsd: reply.costUsd, detail: reply.usageDetail && { input: reply.usageDetail.input_tokens, output: reply.usageDetail.output_tokens,
        cacheCreation: reply.usageDetail.cache_creation_input_tokens, cacheRead: reply.usageDetail.cache_read_input_tokens, thinking: reply.usageDetail.output_tokens_details?.thinking_tokens ?? null } });
      return reply;
    } catch (error) { this.errors.push(String(error?.message ?? error)); throw error; }
  }
  endSession(session) { this.current?.endSession(session); }
  async close() {}
}

const workers = Array.from({ length: spec.width }, () => { const proxy = new Proxy(); return { proxy, pool: createLoopPool({ provider: proxy }), busyArm: null }; });
for (const worker of workers) await worker.pool.ready();
const empty = mkdtempSync(join(output, 'empty-'));
let cursor = 0, halted = null, consecutiveErrors = 0, sinceAuth = 0;
const pending = items.filter(item => !done.has(`${item.need}|${item.arm}|${item.rep}`));

async function runOne(worker, item) {
  const arm = arms[item.arm];
  const transport = new WarmClaudeTransport({ instances: [{ name: 'account', configDir }], model: arm.model, effort: arm.effort, cwd: empty, ...(fakeCli ? { command: fakeCli } : {}) });
  worker.proxy.current = transport; worker.proxy.replies = []; worker.proxy.errors = [];
  const loadStart = load(), startBegin = performance.now();
  let startupMs = null, answer, wall = null;
  try {
    await transport.start();
    startupMs = performance.now() - startBegin;
    const directory = join(output, stage, `${item.need}--${item.arm}--${item.rep}`);
    const begin = performance.now();
    answer = await runNeed({ need: needText(item.need), directory, pool: worker.pool, env: { ENDOFORGE_LOOP: 'agent' } });
    wall = performance.now() - begin;
  } catch (error) { answer = { promoted: false, error: `transport start failed: ${error?.message ?? error}` }; }
  finally { await transport.close(); }
  const rounds = (answer.rounds ?? []).map(round => ({ failed: Boolean(round.failures), gates: round.failures ? Object.keys(round.failures.gates ?? {}) : [], failingTests: round.failures?.tests?.length ?? 0, problems: round.failures?.problems ?? null }));
  let held = null;
  if (answer.promoted) {
    assert.equal(hash(answer.content), answer.candidate, 'returned content is not the promoted candidate');
    const need = hNeeds.find(entry => entry.id === item.need);
    if (need) held = heldOut(answer.content, heldOutTests(need));
  }
  const row = { stage, testDouble: Boolean(fakeCli), need: item.need, arm: item.arm, model: arm.model, effort: arm.effort, rep: item.rep, at: new Date().toISOString(), promoted: Boolean(answer.promoted), status: answer.status ?? null, problem: answer.problem ?? null,
    error: answer.error ?? null, agent: answer.agent ?? null, rounds, heldOut: held, wallMs: wall, modelMs: answer.modelMs ?? null, nonModelMs: wall === null ? null : wall - (answer.modelMs ?? 0), startupMs,
    replies: worker.proxy.replies, sendErrors: worker.proxy.errors, inits: [...new Map(transport.inits.map(init => [JSON.stringify(init), init])).values()], timings: answer.timings ?? null, loadStart, loadEnd: load(),
    candidate: answer.candidate ?? null };
  log('rows', row);
  return row;
}

async function workerLoop(worker) {
  while (!halted) {
    const index = pending.findIndex(item => !item.claimed && !workers.some(other => other.busyArm === item.arm));
    if (index < 0) { if (pending.every(item => item.claimed)) return; await new Promise(r => setTimeout(r, 200)); continue; }
    if (calls.model + maxPerRun * workers.filter(other => other.busyArm).length + maxPerRun > budget.modelCalls) { halted = 'call budget reached'; return; }
    if (sinceAuth >= plan.batchSize) { sinceAuth = 0; authStatus(`${stage}:batch`); }
    const item = pending[index];
    item.claimed = true; worker.busyArm = item.arm; sinceAuth += 1;
    const row = await runOne(worker, item);
    worker.busyArm = null;
    calls.runs += 1;
    writeFileSync(callsFile, JSON.stringify(calls));
    consecutiveErrors = row.sendErrors.length ? consecutiveErrors + 1 : 0;
    console.log(JSON.stringify({ n: calls.runs, calls: calls.model, need: row.need, arm: row.arm, promoted: row.promoted, failed: row.rounds.filter(r => r.failed).length, rounds: row.rounds.length, held: row.heldOut?.clean ?? null,
      wallS: row.wallMs && +(row.wallMs / 1000).toFixed(1), exit: row.agent?.exit_reason ?? row.error, errors: row.sendErrors, load: row.loadEnd }));
    if (consecutiveErrors >= 2) halted = `two consecutive runs with transport errors: ${row.sendErrors.join('; ')}`;
  }
}
try { await Promise.all(workers.map(workerLoop)); }
finally { for (const worker of workers) await worker.pool.close(); rmSync(empty, { recursive: true, force: true }); }
const end = { stage, finished: new Date().toISOString(), halted, calls, load: load() };
writeFileSync(join(output, stage, 'end.json'), JSON.stringify(end, null, 1));
console.log(JSON.stringify(end));
if (halted) process.exitCode = 2;
