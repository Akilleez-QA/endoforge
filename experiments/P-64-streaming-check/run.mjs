import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { RecordingTransport, childEnvironment } from './record.mjs';
import { HybridProvider, loadStreams } from './replay.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [mode, outputArg, ...rest] = process.argv.slice(2);
const output = resolve(outputArg);
assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(/\s/)[0], hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded hash');
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.ok(!(name in process.env), `${name} must be unset`);
mkdirSync(output, { recursive: true });
const BUDGET = 280, SPENT_BEFORE = 9;
const callsFile = join(output, 'calls.json');
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : { diagnostic: SPENT_BEFORE, record: 0, hedge: 0 };
const total = () => calls.diagnostic + calls.record + calls.hedge;
const load = () => Number(loadavg()[0].toFixed(2));
const log = (name, value) => appendFileSync(join(output, `${name}.jsonl`), `${JSON.stringify(value)}\n`);

function authStatus(label) {
  const status = JSON.parse(execFileSync('claude', ['auth', 'status'], { env: childEnvironment(), encoding: 'utf8', timeout: 60000 }));
  const kept = { at: new Date().toISOString(), label, loggedIn: status.loggedIn, authMethod: status.authMethod, subscriptionType: status.subscriptionType };
  log('auth', kept);
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw Error(`auth check failed before ${label}`);
}

const needText = id => hNeeds.find(need => need.id === id).need;
let halted = null, consecutiveErrors = 0;

async function runItems(items, width, makeProvider, kind) {
  let cursor = 0, sinceAuth = 0;
  const worker = async () => {
    const holder = { current: null };
    const proxy = { name: 'p64', testDouble: false, async start() { return { startupMs: 0, lanes: 0 }; }, send: request => holder.current.send(request), endSession: s => holder.current?.endSession?.(s), async close() {} };
    const pool = createLoopPool({ provider: proxy });
    await pool.ready();
    try {
      while (!halted && cursor < items.length) {
        if (total() + 12 > BUDGET) { halted = 'call budget reached'; break; }
        if (sinceAuth >= 10) { sinceAuth = 0; authStatus(`${kind}:batch`); }
        const item = items[cursor++];
        sinceAuth += 1;
        const provider = makeProvider(item);
        holder.current = provider;
        const loadStart = load(), begin = performance.now();
        const answer = await runNeed({ need: needText(item.need), directory: join(output, kind, item.name), pool, env: { ENDOFORGE_LOOP: 'agent' } });
        const wall = performance.now() - begin;
        await provider.close();
        calls[kind] += provider.liveCalls ?? provider.calls;
        writeFileSync(callsFile, JSON.stringify(calls));
        const row = { kind, ...item, promoted: Boolean(answer.promoted), status: answer.status ?? null, error: answer.error ?? null, agent: answer.agent ?? null,
          rounds: (answer.rounds ?? []).map(round => ({ failed: Boolean(round.failures), gates: round.failures ? Object.keys(round.failures.gates ?? {}) : [], failingTests: round.failures?.tests?.length ?? 0, problems: round.failures?.problems ?? null })),
          wallMs: wall, modelMs: answer.modelMs ?? null, timings: answer.timings ?? null, liveCalls: provider.liveCalls ?? provider.calls, replayed: provider.replayed ?? 0, errors: provider.errors ?? [],
          inits: [...new Map((provider.inits ?? []).map(init => [JSON.stringify(init), init])).values()], loadStart, loadEnd: load(), candidate: answer.candidate ?? null };
        log('rows', row);
        console.log(JSON.stringify({ kind, name: item.name, promoted: row.promoted, rounds: row.rounds.map(r => r.failed ? 'F' : 'P').join(''), exit: row.agent?.exit_reason ?? row.error, live: row.liveCalls, total: total(), wallS: +(wall / 1000).toFixed(1), load: row.loadEnd }));
        if (row.inits.some(init => init.apiKeySource !== 'none')) { halted = 'init with an API key source'; break; }
        consecutiveErrors = row.error ? consecutiveErrors + 1 : 0;
        if (consecutiveErrors >= 2) halted = 'two consecutive runs with errors';
      }
    } finally { await pool.close(); }
  };
  await Promise.all(Array.from({ length: width }, worker));
}

writeFileSync(join(output, `${mode}-environment.json`), JSON.stringify({ mode, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(),
  claude: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), load: load() }, null, 1));
authStatus(`${mode}:start`);
if (mode === 'record') {
  const streams = join(output, 'streams.jsonl');
  const items = hNeeds.flatMap(need => [0, 1, 2].map(rep => ({ need: need.id, rep, name: `${need.id}-r${rep}` })));
  const order = [0, 1, 2].flatMap(rep => items.filter(item => item.rep === rep));
  await runItems(order, 3, item => new RecordingTransport({ model: 'sonnet', effort: 'low', file: streams, label: item.name }), 'record');
} else if (mode === 'hedge') {
  const plan = JSON.parse(readFileSync(rest[0], 'utf8'));
  const recorded = loadStreams(join(output, 'streams.jsonl'));
  const streams = join(output, 'hedge-streams.jsonl');
  await runItems(plan.map(item => ({ ...item, need: item.from.split("-")[0], name: item.from })), 2, item => new HybridProvider({ recorded, live: new RecordingTransport({ model: 'sonnet', effort: 'low', file: streams, label: `${item.from}-hedge` }), source: item.from, liveFrom: item.liveFrom }), 'hedge');
} else throw Error(`unknown mode ${mode}`);
const end = { mode, finished: new Date().toISOString(), halted, calls, total: total(), load: load() };
writeFileSync(join(output, `${mode}-end.json`), JSON.stringify(end, null, 1));
console.log(JSON.stringify(end));
if (halted) process.exitCode = 2;
