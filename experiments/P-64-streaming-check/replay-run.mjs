import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLoopPool } from '../../core/runtime/x1/loop.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { implementation, specification, stageOf } from '../../core/runtime/test/fixtures/x1/scripted-model.mjs';
import { buildCorpus } from '../P-50-in-isolate/corpus.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { ReplayProvider, loadStreams } from './replay.mjs';
import { Prechecker, mutateRecord, mutations, overlayFrom, replayTurn, summarize } from './harness.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const [arm, workArg, outArg, widthArg] = process.argv.slice(2);
const work = resolve(workArg), out = resolve(outArg), width = Number(widthArg ?? 1);
assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(/\s/)[0], hash(readFileSync(here('./PRECOMMIT.md'))), 'PRECOMMIT.md differs from its recorded hash');
mkdirSync(out, { recursive: true });
const load = () => Number(loadavg()[0].toFixed(2));
const log = (name, value) => appendFileSync(join(out, `${name}.jsonl`), `${JSON.stringify(value)}\n`);
const recorded = loadStreams(join(work, 'streams.jsonl'));
const recordRows = readFileSync(join(work, 'rows.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.kind === 'record');

function random(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function profiles() {
  const byStage = { specification: [], implementation: [] };
  for (const [, records] of [...recorded.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const record = records[0], info = summarize(record), calls = info.structured?.calls ?? [];
    if (!info.toolStart || !info.toolChars || info.lastToken - info.toolStart < 50) continue;
    if (calls.some(call => call.path === 'kernel.ts')) byStage.implementation.push({ record, info });
    else if (calls.some(call => call.path === 'tests.json')) byStage.specification.push({ record, info });
  }
  return byStage;
}

function synthesize(profile, value) {
  const { record, info } = profile, text = JSON.stringify(value), events = [];
  const rate = info.toolChars / (info.lastToken - info.toolStart), chunks = Math.max(1, Math.round(record.events.filter(e => e.event.type === 'stream_event' && e.event.event.delta?.type === 'input_json_delta').length * text.length / info.toolChars));
  for (const entry of record.events) {
    if (entry.t > info.toolStart) break;
    if (entry.event.type === 'stream_event' && entry.event.event.delta?.type === 'input_json_delta') continue;
    events.push(entry);
  }
  const span = text.length / rate, size = Math.ceil(text.length / chunks);
  for (let i = 0, k = 0; i < text.length; i += size, k++) events.push({ t: info.toolStart + span * Math.min(1, (i + size) / text.length), event: { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: text.slice(i, i + size) } } } });
  const last = info.toolStart + span, resultAt = last + (info.result - info.lastToken), close = resultAt + (record.wallMs - info.result);
  events.push({ t: resultAt, event: { type: 'result', subtype: 'success', is_error: false, structured_output: value, usage: { input_tokens: 0, output_tokens: 10 }, duration_api_ms: Math.round(last) } });
  return { label: `synth:${record.label}`, key: null, wallMs: close, code: 0, events };
}

class TurnProvider extends ReplayProvider {
  constructor({ lookup, stream, base, collect }) {
    super({ recorded: new Map() });
    Object.assign(this, { lookup, stream, base, collect });
  }
  async send({ session, messages, remaining }) {
    if (remaining !== undefined && remaining <= 0) throw Error('model token budget reached');
    const record = this.lookup(messages);
    this.calls += 1; this.replayed += 1;
    if (this.onContext) { const context = overlayFrom(messages); if (context.stage === 'implementation') this.onContext({ label: record.label, order: record.order, ...context }); }
    const turn = await replayTurn({ record, messages, stream: this.stream, base: this.base });
    this.collect.push(turn.finish());
    const result = record.events.find(entry => entry.event.type === 'result').event;
    const usage = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((total, key) => total + (Number.isSafeInteger(result.usage?.[key]) ? result.usage[key] : 0), 0);
    if (remaining !== undefined && usage > remaining) throw Error('model token budget exceeded');
    return { text: JSON.stringify(result.structured_output), usage, wallMs: record.wallMs };
  }
}

async function lane(items, runOne) {
  const stream = new Prechecker(), base = new Prechecker();
  await Promise.all([stream.ready, base.ready]);
  const holder = { current: null };
  const proxy = { name: 'p64-replay', testDouble: true, async start() { return { startupMs: 0, lanes: 0 }; }, send: request => holder.current.send(request), endSession() {}, async close() {} };
  const pool = createLoopPool({ provider: proxy });
  await pool.ready();
  try { for (;;) { const item = items.next(); if (item.done) break; await runOne(item.value, { pool, stream, base, holder }); } }
  finally { await pool.close(); await stream.close(); await base.close(); }
}

const environment = { arm, width, node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here('../../'), encoding: 'utf8' }).trim(), cpus: cpus()[0]?.model, started: new Date().toISOString(), loadStart: load() };
writeFileSync(join(out, `${arm}-environment.json`), JSON.stringify(environment, null, 1));

if (arm === 'h') {
  const items = recordRows.map(row => row)[Symbol.iterator]();
  const byLabel = new Map();
  for (const records of recorded.values()) for (const record of records) { if (!byLabel.has(record.label)) byLabel.set(record.label, []); byLabel.get(record.label).push(record); }
  for (const list of byLabel.values()) list.sort((a, b) => a.order - b.order);
  await Promise.all(Array.from({ length: width }, () => lane(items, async (row, { pool, stream, base, holder }) => {
    const collect = [], keys = [];
    let turn = 0;
    const lookup = messages => {
      const key = hash(messages.map(message => `${message.role}: ${message.content}`).join('\n\n')), record = byLabel.get(row.name)?.[turn++];
      if (!record) throw Error(`no recording for ${row.name} turn ${turn - 1}`);
      keys.push(record.key === key);
      return record;
    };
    holder.current = new TurnProvider({ lookup, stream, base, collect });
    holder.current.onContext = context => log('h-contexts', context);
    const loadStart = load(), begin = performance.now();
    const answer = await runNeed({ need: hNeeds.find(need => need.id === row.need).need, directory: join(out, 'h', row.name), pool, env: { ENDOFORGE_LOOP: 'agent' } });
    const wall = performance.now() - begin;
    const turns = await Promise.all(collect);
    const rounds = (answer.rounds ?? []).map(round => Boolean(round.failures));
    const result = { arm, name: row.name, need: row.need, promoted: Boolean(answer.promoted), recordedPromoted: row.promoted, status: answer.status ?? null, error: answer.error ?? null, rounds, recordedRounds: row.rounds.map(r => r.failed),
      exit: answer.agent?.exit_reason ?? null, keysMatched: keys, recordedTurns: byLabel.get(row.name)?.length ?? 0, wallMs: wall, modelMs: answer.modelMs, timings: answer.timings, turns, loadStart, loadEnd: load() };
    log('h-rows', result);
    console.log(JSON.stringify({ name: row.name, promoted: result.promoted, same: result.promoted === row.promoted && JSON.stringify(rounds) === JSON.stringify(result.recordedRounds), turns: turns.length,
      before: Math.round(turns.reduce((s, t) => s + t.base.tailMs, 0)), after: Math.round(turns.reduce((s, t) => s + t.stream.tailMs, 0)), refusals: turns.filter(t => t.refusal).length, load: result.loadEnd }));
  })));
} else if (arm === 'p57') {
  const corpus = await buildCorpus(), known = new Map(corpus.map(entry => [entry.name, entry])), byStage = profiles();
  const reps = 5, list = Array.from({ length: reps * corpus.length }, (_, index) => ({ index, input: corpus[index % corpus.length] }));
  const items = list[Symbol.iterator]();
  await Promise.all(Array.from({ length: width }, () => lane(items, async ({ index, input }, { pool, stream, base, holder }) => {
    const collect = [], draw = random(6400 + index);
    const lookup = messages => {
      const stage = stageOf(messages), choices = byStage[stage], profile = choices[Math.floor(draw() * choices.length)];
      const value = stage === 'specification' ? specification(input) : implementation(input, JSON.parse(messages[0].content).id);
      return synthesize(profile, value);
    };
    holder.current = new TurnProvider({ lookup, stream, base, collect });
    const loadStart = load(), begin = performance.now();
    const answer = await runNeed({ need: `TEST DOUBLE ONLY: ${input.name}`, directory: join(out, 'p57', `${input.name}-${index}`), pool, env: { ENDOFORGE_LOOP: 'agent' }, limits: { maxTurns: 2, maxTokens: 64000 } });
    const wall = performance.now() - begin;
    const turns = await Promise.all(collect);
    const result = { arm, name: input.name, index, promoted: Boolean(answer.promoted), expected: input.expectPromoted, error: answer.error ?? null, rounds: (answer.rounds ?? []).map(round => Boolean(round.failures)),
      wallMs: wall, modelMs: answer.modelMs, timings: answer.timings, turns, loadStart, loadEnd: load() };
    log('p57-rows', result);
    console.log(JSON.stringify({ name: input.name, index, promoted: result.promoted, expected: result.expected, turns: turns.length, wallS: +(wall / 1000).toFixed(1),
      before: Math.round(turns.reduce((s, t) => s + t.base.tailMs, 0)), after: Math.round(turns.reduce((s, t) => s + t.stream.tailMs, 0)), load: result.loadEnd }));
  })));
} else if (arm === 'seeded') {
  const byOrder = new Map([...recorded.values()].flat().map(record => [record.order, record]));
  const contexts = readFileSync(join(out, 'h-contexts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const list = [];
  for (const context of contexts) {
    const record = byOrder.get(context.order), calls = summarize(record).structured?.calls ?? [];
    const edit = calls.find(call => call.name === 'edit_file' && call.path === 'kernel.ts' && typeof call.content === 'string');
    if (!edit || calls.filter(call => call.path === 'kernel.ts').length !== 1) continue;
    for (const [operator, mutate] of Object.entries(mutations)) {
      const changed = mutate(edit.content);
      if (!changed || changed === edit.content) continue;
      const mutant = mutateRecord(record, edit.content, changed);
      if (mutant) list.push({ context, mutant, operator, source: record.label, order: record.order });
    }
  }
  console.log(JSON.stringify({ contexts: contexts.length, mutants: list.length }));
  const items = list[Symbol.iterator]();
  await Promise.all(Array.from({ length: width }, async () => {
    const stream = new Prechecker(), base = new Prechecker();
    await Promise.all([stream.ready, base.ready]);
    try {
      for (;;) {
        const next = items.next();
        if (next.done) break;
        const { context, mutant, operator, source, order } = next.value, loadStart = load();
        const { overlay, stage, id } = context;
        const turn = await (await replayTurn({ record: mutant, messages: null, stream, base, context: { overlay, stage, id } })).finish();
        log('seeded-rows', { arm, operator, source, order, turn, loadStart, loadEnd: load() });
        console.log(JSON.stringify({ source, operator, failed: turn.base.failed, streamFailed: turn.stream.failed, refused: Boolean(turn.refusal), early: turn.refusal?.beforeLastToken ?? false, savedMs: Math.round(turn.refusal?.savedMs ?? 0) }));
      }
    } finally { await stream.close(); await base.close(); }
  }));
} else throw Error(`unknown arm ${arm}`);
writeFileSync(join(out, `${arm}-end.json`), JSON.stringify({ arm, finished: new Date().toISOString(), loadEnd: load() }, null, 1));
