import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { SpawnClaudeTransport, WarmClaudeTransport } from '../../core/runtime/x1/transports.mjs';
import { hNeeds, heldOutTests, readR } from '../P-56-model-effort/needs.mjs';
import { heldOut } from '../P-56-model-effort/heldout.mjs';
import { needOrder } from './order.mjs';

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
const configDir = process.env.CLAUDE_CONFIG_DIR, needsRoot = process.env.P56_NEEDS_ROOT, fakeCli = process.env.P66_FAKE_CLI;
assert.equal(Boolean(fakeCli), stage === 'smoke', 'P66_FAKE_CLI is for the smoke stage only, and the smoke stage needs it');
assert.ok(configDir && existsSync(configDir), 'CLAUDE_CONFIG_DIR must name the signed-in account directory');
assert.ok(needsRoot && existsSync(needsRoot), 'P56_NEEDS_ROOT required');
mkdirSync(join(output, stage), { recursive: true });
const log = (name, value) => appendFileSync(join(output, `${name}.jsonl`), `${JSON.stringify(value)}\n`);
const load = () => Number(loadavg()[0].toFixed(2));

function authStatus(label) {
  if (fakeCli) return null;
  const raw = execFileSync('claude', ['auth', 'status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: configDir }, encoding: 'utf8', timeout: 60000 });
  const status = JSON.parse(raw);
  const kept = { at: new Date().toISOString(), label, loggedIn: status.loggedIn, authMethod: status.authMethod, apiProvider: status.apiProvider, subscriptionType: status.subscriptionType };
  log('auth', kept);
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw Error(`auth check failed before ${label}`);
  return kept;
}

async function environmentCheck() {
  const file = join(output, 'env-probe.json');
  const probe = join(output, 'env-probe.mjs');
  writeFileSync(probe, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(file)}, JSON.stringify({ names: Object.keys(process.env).sort(), configDir: process.env.CLAUDE_CONFIG_DIR }));\nprocess.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: [], apiKeySource: 'none', mcp_servers: [] }) + '\\n' + JSON.stringify({ type: 'result', result: '{"calls":[]}', usage: {} }) + '\\n');\n`);
  const transport = new SpawnClaudeTransport({ configDir, model: 'sonnet', command: process.execPath, base: { ...process.env, ANTHROPIC_PROBE_UNUSED: 'x' } });
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

const needText = id => id.startsWith('H') ? hNeeds.find(need => need.id === id).need : readR(needsRoot, id);
const spec = plan.stages[stage];
const order = needOrder(precommit, spec.needs);
const slots = Object.entries(plan.perNeed).flatMap(([arm, count]) => Array.from({ length: count }, (_, sample) => ({ arm, sample })));
const callsFile = join(output, 'calls.json');
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : { model: 0, refused: 0, needs: 0 };
const done = new Set(existsSync(join(output, 'rows.jsonl')) ? readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage).map(row => row.need) : []);

writeFileSync(join(output, stage, 'environment.json'), JSON.stringify({ precommit, stage, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  claude: fakeCli ? 'fake' : execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), load: load(), order, slots: slots.length, alreadyDone: [...done], budget: plan.budget }, null, 1));
authStatus(`${stage}:start`);
if (!fakeCli && !existsSync(join(output, 'env-check.json'))) await environmentCheck();

class Proxy {
  name = 'claude-warm'; testDouble = false; current = null; replies = []; errors = []; t0 = 0;
  async start() { return { startupMs: 0, lanes: 0 }; }
  async send(request) {
    if (calls.model >= plan.budget.modelCalls) { calls.refused += 1; this.errors.push('call budget reached'); throw Error('call budget reached'); }
    calls.model += 1;
    const begin = performance.now() - this.t0;
    try {
      const reply = await this.current.send(request);
      this.replies.push({ beginMs: begin, endMs: performance.now() - this.t0, wallMs: reply.wallMs, apiMs: reply.apiMs, usage: reply.usage, costUsd: reply.costUsd, detail: reply.usageDetail && { input: reply.usageDetail.input_tokens, output: reply.usageDetail.output_tokens,
        cacheCreation: reply.usageDetail.cache_creation_input_tokens, cacheRead: reply.usageDetail.cache_read_input_tokens } });
      return reply;
    } catch (error) { this.replies.push({ beginMs: begin, endMs: performance.now() - this.t0, failed: true }); this.errors.push(String(error?.message ?? error)); throw error; }
  }
  endSession(session) { this.current?.endSession(session); }
  async close() {}
}

const workers = slots.map(slot => { const proxy = new Proxy(); return { slot, proxy, pool: createLoopPool({ provider: proxy, waits: 'hold' }) }; });
for (const worker of workers) await worker.pool.ready();
const empty = mkdtempSync(join(output, 'empty-'));
let halted = null, consecutiveErrorNeeds = 0;

async function runOne(worker, need, barrier) {
  const { arm, sample } = worker.slot, transport = worker.transport, armSpec = plan.arms[arm];
  const directory = join(output, stage, `${need}--${arm}--${sample}`);
  const loadStart = load();
  let answer, wall = null;
  await barrier;
  const begin = performance.now();
  worker.proxy.t0 = begin;
  try { answer = await runNeed({ need: needText(need), directory, pool: worker.pool, env: { ENDOFORGE_LOOP: 'agent' } }); }
  catch (error) { answer = { promoted: false, error: String(error?.message ?? error) }; }
  wall = performance.now() - begin;
  const rounds = (answer.rounds ?? []).map(round => ({ failed: Boolean(round.failures), gates: round.failures ? Object.keys(round.failures.gates ?? {}) : [], failingTests: round.failures?.tests?.length ?? 0 }));
  let held = null;
  if (answer.content) writeFileSync(join(output, stage, `${need}--${arm}--${sample}.content.json`), answer.content);
  if (answer.promoted) {
    assert.equal(hash(answer.content), answer.candidate, 'returned content is not the promoted candidate');
    const entry = hNeeds.find(h => h.id === need);
    if (entry) held = heldOut(answer.content, heldOutTests(entry));
  }
  return { stage, testDouble: Boolean(fakeCli), need, arm, model: armSpec.model, effort: armSpec.effort, sample, at: new Date().toISOString(), promoted: Boolean(answer.promoted), status: answer.status ?? null, problem: answer.problem ?? null,
    error: answer.error ?? null, agent: answer.agent ?? null, rounds, heldOut: held, wallMs: wall, modelMs: answer.modelMs ?? null, startupMs: worker.startupMs,
    replies: worker.proxy.replies, sendErrors: worker.proxy.errors, inits: [...new Map(transport.inits.map(init => [JSON.stringify(init), init])).values()], loadStart, loadEnd: load(),
    candidate: answer.candidate ?? null, contentHash: answer.content ? hash(answer.content) : null };
}

try {
  for (const entry of order) {
    if (halted) break;
    if (done.has(entry.need)) continue;
    if (calls.model >= plan.budget.modelCalls) { halted = 'call budget reached'; break; }
    authStatus(`${stage}:${entry.need}`);
    for (const worker of workers) {
      const armSpec = plan.arms[worker.slot.arm];
      worker.transport = new WarmClaudeTransport({ instances: [{ name: 'account', configDir }], model: armSpec.model, effort: armSpec.effort, cwd: empty, ...(fakeCli ? { command: fakeCli } : {}) });
      worker.proxy.current = worker.transport; worker.proxy.replies = []; worker.proxy.errors = [];
      const s = performance.now();
      try { await worker.transport.start(); worker.startupMs = performance.now() - s; } catch (error) { worker.startupMs = null; worker.proxy.errors.push(`transport start failed: ${error?.message ?? error}`); }
    }
    let open;
    const barrier = new Promise(r => { open = r; });
    const running = workers.map(worker => runOne(worker, entry.need, barrier));
    const needBegin = new Date().toISOString();
    open();
    const rows = await Promise.all(running);
    for (const worker of workers) await worker.transport.close();
    const complete = rows.every(row => !row.sendErrors.includes('call budget reached'));
    for (const row of rows) log('rows', { ...row, split: entry.split, position: entry.position, needBegin, complete });
    calls.needs += 1;
    writeFileSync(callsFile, JSON.stringify(calls));
    const transportErrors = rows.flatMap(row => row.sendErrors.filter(error => error !== 'model token budget exceeded' && error !== 'call budget reached'));
    consecutiveErrorNeeds = transportErrors.length >= 2 ? consecutiveErrorNeeds + 1 : 0;
    console.log(JSON.stringify({ need: entry.need, split: entry.split, calls: calls.model, complete, load: load(),
      runs: rows.map(row => `${row.arm}#${row.sample}:${row.promoted ? 'P' : 'F'}${row.rounds.filter(r => r.failed).length}:${(row.wallMs / 1000).toFixed(0)}s`).join(' '), errors: transportErrors.slice(0, 3) }));
    if (!complete) halted = 'call budget reached';
    if (consecutiveErrorNeeds >= 2) halted = `two consecutive needs with transport errors: ${transportErrors.slice(0, 3).join('; ')}`;
  }
} finally { for (const worker of workers) await worker.pool.close(); rmSync(empty, { recursive: true, force: true }); }
const end = { stage, finished: new Date().toISOString(), halted, calls, load: load() };
writeFileSync(join(output, stage, 'end.json'), JSON.stringify(end, null, 1));
console.log(JSON.stringify(end));
if (halted && halted !== 'call budget reached') process.exitCode = 2;
