import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { SpawnClaudeTransport, WarmClaudeTransport } from '../../core/runtime/x1/transports.mjs';

const [output, step, out] = process.argv.slice(2);
const { P50_CLAUDE_CONFIG_DIR: configDir, P50_MODEL: model = 'haiku' } = process.env;
if (!configDir) throw Error('P50_CLAUDE_CONFIG_DIR required');
mkdirSync(output, { recursive: true });
const cwd = mkdtempSync(join(output, 'empty-'));
const nearest = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1] ?? null; };
const detail = turns => turns.map(({ wallMs, apiMs, usage, usageDetail }) => ({ wallMs, apiMs, usage, input: usageDetail?.input_tokens, output: usageDetail?.output_tokens, cacheCreation: usageDetail?.cache_creation_input_tokens, cacheRead: usageDetail?.cache_read_input_tokens }));
const overhead = turns => turns.map((turn, index) => turn.wallMs - ((turn.apiMs ?? 0) - (index && turn.apiMs >= turns[index - 1].apiMs && turn.apiMs > turn.wallMs ? turns[index - 1].apiMs : 0)));
const summary = {};
if (step === 'transports') {
  const prompt = [{ role: 'user', content: 'Return one done call.' }];
  const spawned = new SpawnClaudeTransport({ configDir, model, cwd }), turns = [];
  for (let i = 0; i < 5; i++) turns.push(await spawned.send({ session: 's', messages: prompt }));
  const warm = new WarmClaudeTransport({ instances: [{ name: 'proof', configDir }], model, cwd });
  const started = await warm.start(), warmTurns = [];
  for (let i = 0; i < 5; i++) {
    warmTurns.push(await warm.send({ session: `w${i}`, messages: prompt }));
    warm.endSession(`w${i}`);
  }
  await warm.close();
  summary.spawn = { turns: detail(turns), wallP50: nearest(turns.map(turn => turn.wallMs), 0.5), overheadP50: nearest(overhead(turns), 0.5), spawns: spawned.spawns };
  summary.warm = { startup: started, startups: warm.startups.length, turns: detail(warmTurns), wallP50: nearest(warmTurns.map(turn => turn.wallMs), 0.5), firstTurnOverhead: overhead(warmTurns)[0], laterOverheadP50: nearest(overhead(warmTurns).slice(1), 0.5) };
} else {
  const provider = new WarmClaudeTransport({ instances: [{ name: 'proof', configDir }], model, cwd });
  const startupBegin = performance.now();
  const started = await provider.start();
  const replies = [], send = provider.send.bind(provider);
  provider.send = async request => { const reply = await send(request); replies.push(reply); return reply; };
  const pool = createLoopPool({ provider, jobTimeoutMs: 60000 });
  await pool.ready();
  const readyMs = performance.now() - startupBegin;
  const mark = name => statSync(`/__ef_mark__/proof/${name}`, { throwIfNoEntry: false });
  const directory = join(output, `proof-${step}`), begin = performance.now();
  const answer = await runNeed({ need: 'Implement pure integer add(a,b) for integers in [-10,10]. Freeze six exact tests before code: (0,0)=0, (2,3)=5, (-4,3)=-1, (10,-10)=0, (-10,-10)=-20, (10,10)=20. Include complete declarative glue.', directory, pool,
    env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 4, maxTokens: 40000 }, observe: step === 'traced' ? mark : undefined });
  const wall = performance.now() - begin;
  await pool.close(); await provider.close();
  summary.proof = { step, model, promoted: answer.promoted, error: answer.error ?? null, status: answer.status ?? null, problem: answer.problem ?? null, agent: answer.agent, wall, modelMs: answer.modelMs, nonModel: wall - answer.modelMs,
    transportOverhead: overhead(replies), replies: detail(replies), startup: started, startups: provider.startups.length, readyMs, timings: answer.timings };
}
rmSync(cwd, { recursive: true, force: true });
writeFileSync(out, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary).slice(0, 1600));
