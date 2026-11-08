import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { agentLimits, createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { WarmClaudeTransport } from '../../core/runtime/x1/transports.mjs';
import { hNeeds, heldOutTests, readR } from '../P-56-model-effort/needs.mjs';
import { heldOut } from '../P-56-model-effort/heldout.mjs';

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
const configDir = process.env.CLAUDE_CONFIG_DIR, needsRoot = process.env.P56_NEEDS_ROOT, fakeCli = process.env.P69_FAKE_CLI;
assert.equal(Boolean(fakeCli), stage === 'smoke', 'P69_FAKE_CLI is for the smoke stage only, and the smoke stage needs it');
assert.ok(configDir && existsSync(configDir), 'CLAUDE_CONFIG_DIR must name the signed-in account directory');
assert.ok(needsRoot && existsSync(needsRoot), 'P56_NEEDS_ROOT required');
mkdirSync(join(output, stage), { recursive: true });
const log = (name, value) => appendFileSync(join(output, `${name}.jsonl`), `${JSON.stringify(value)}\n`);
const load = () => Number(loadavg()[0].toFixed(2));
const pressure = () => { try { return Number(/some avg10=([\d.]+)/.exec(readFileSync('/proc/pressure/cpu', 'utf8'))[1]); } catch { return null; } };

function authStatus(label) {
  if (fakeCli) return null;
  const status = JSON.parse(execFileSync('claude', ['auth', 'status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: configDir }, encoding: 'utf8', timeout: 60000 }));
  const kept = { at: new Date().toISOString(), label, loggedIn: status.loggedIn, authMethod: status.authMethod, apiProvider: status.apiProvider, subscriptionType: status.subscriptionType };
  log('auth', kept);
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw Error(`auth check failed before ${label}`);
  return kept;
}

const needText = id => id.startsWith('H') ? hNeeds.find(need => need.id === id).need : readR(needsRoot, id);
const spec = plan.stages[stage], reps = spec.reps ?? plan.reps;
const callsFile = join(output, 'calls.json');
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : { model: 0, refused: 0 };
const done = new Set(existsSync(join(output, 'rows.jsonl')) ? readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stage === stage).map(row => `${row.need}/${row.rep}`) : []);
writeFileSync(join(output, stage, 'environment.json'), JSON.stringify({ precommit, stage, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  claude: fakeCli ? 'fake' : execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), load: load(), psi: pressure(), needs: spec.needs, reps, budget: plan.budget, alreadyDone: [...done] }, null, 1));
authStatus(`${stage}:start`);

class Proxy {
  testDouble = false; current = null; replies = []; errors = [];
  async start() { return { startupMs: 0, lanes: 0 }; }
  async send(request) {
    if (calls.model >= plan.budget.modelCalls) { calls.refused += 1; this.errors.push('call budget reached'); throw Error('call budget reached'); }
    calls.model += 1;
    const begin = performance.now();
    try {
      const reply = await this.current.send(request);
      this.replies.push({ wallMs: performance.now() - begin, usage: reply.usage, costUsd: reply.costUsd });
      return reply;
    } catch (error) { this.replies.push({ wallMs: performance.now() - begin, failed: true }); this.errors.push(String(error?.message ?? error)); throw error; }
  }
  endSession(session) { this.current?.endSession(session); }
  async close() {}
}

const empty = mkdtempSync(join(output, 'empty-'));
const arms = Object.keys(plan.arms);
const slots = Array.from({ length: reps }, (_, rep) => rep);
let halted = null;

async function runOne(arm, need, rep) {
  const proxy = new Proxy(), pool = createLoopPool({ provider: proxy, waits: 'hold' });
  const transport = new WarmClaudeTransport({ instances: [{ name: 'account', configDir }], model: plan.model.model, effort: plan.model.effort, cwd: empty, ...(fakeCli ? { command: fakeCli } : {}) });
  proxy.current = transport;
  const directory = join(output, stage, `${need}--${arm}--${rep}`), loadStart = load(), psiStart = pressure();
  let answer, wall = null;
  try {
    await pool.ready();
    await transport.start();
    const begin = performance.now();
    try { answer = await runNeed({ need: needText(need), directory, pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { ...agentLimits, oracle: plan.arms[arm].oracle } }); }
    catch (error) { answer = { promoted: false, error: String(error?.message ?? error) }; }
    wall = performance.now() - begin;
  } finally { await transport.close().catch(() => {}); await pool.close(); }
  if (answer.content) writeFileSync(join(output, stage, `${need}--${arm}--${rep}.content.json`), answer.content);
  let held = null;
  if (answer.promoted) {
    assert.equal(hash(answer.content), answer.candidate, 'returned content is not the promoted candidate');
    const entry = hNeeds.find(h => h.id === need);
    if (entry) held = heldOut(answer.content, heldOutTests(entry));
  }
  return { stage, testDouble: Boolean(fakeCli), need, arm, rep, at: new Date().toISOString(), promoted: Boolean(answer.promoted), status: answer.status ?? null, error: answer.error ?? null,
    agent: answer.agent ?? null, rounds: (answer.rounds ?? []).map(round => ({ source: round.source, failures: round.failures ?? null })), oracle: answer.oracle ?? null, heldOut: held,
    wallMs: wall, modelMs: answer.modelMs ?? null, freezeMs: answer.timings?.freeze ?? null, calls: proxy.replies.length, replies: proxy.replies, sendErrors: proxy.errors,
    inits: [...new Map((transport.inits ?? []).map(init => [JSON.stringify(init), init])).values()], loadStart, loadEnd: load(), psiStart, psiEnd: pressure(), candidate: answer.candidate ?? null };
}

try {
  for (const need of spec.needs) {
    if (halted) break;
    for (let first = 0; first < slots.length && !halted; first += plan.wave) {
      const wave = slots.slice(first, first + plan.wave).filter(rep => !done.has(`${need}/${rep}`));
      if (!wave.length) continue;
      if (calls.model >= plan.budget.modelCalls) { halted = 'call budget reached'; break; }
      authStatus(`${stage}:${need}:${first}`);
      const order = wave.flatMap(rep => (rep % 2 ? [...arms].reverse() : arms).map(arm => ({ arm, rep })));
      const rows = await Promise.all(order.map(({ arm, rep }) => runOne(arm, need, rep)));
      for (const row of rows) log('rows', { ...row, complete: !rows.some(r => r.sendErrors.includes('call budget reached')) });
      writeFileSync(callsFile, JSON.stringify(calls));
      const failedRounds = row => row.rounds.filter(r => r.failures).length;
      console.log(JSON.stringify({ need, wave: first, calls: calls.model, load: load(), psi: pressure(), runs: rows.map(row => `${row.arm}#${row.rep}:${row.promoted ? 'P' : 'F'}${failedRounds(row)}:c${row.calls}${row.oracle ? `:o${row.oracle.corrected}/${row.oracle.flagged}` : ''}`).join(' '),
        errors: rows.flatMap(row => row.sendErrors).slice(0, 3) }));
      if (rows.some(row => row.sendErrors.includes('call budget reached'))) halted = 'call budget reached';
      const transportErrors = rows.flatMap(row => row.sendErrors.filter(error => error !== 'call budget reached' && error !== 'model token budget exceeded'));
      if (transportErrors.length >= 2) halted = `transport errors: ${transportErrors.slice(0, 3).join('; ')}`;
    }
  }
} finally { rmSync(empty, { recursive: true, force: true }); }
const end = { stage, finished: new Date().toISOString(), halted, calls, load: load() };
writeFileSync(join(output, stage, 'end.json'), JSON.stringify(end, null, 1));
console.log(JSON.stringify(end));
if (halted && halted !== 'call budget reached') process.exitCode = 2;
