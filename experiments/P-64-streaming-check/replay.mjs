import { readFileSync } from 'node:fs';
import { usageOf } from '../../core/runtime/x1/transports.mjs';
import { requestKey } from './record.mjs';

export function loadStreams(file) {
  const map = new Map();
  let order = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const record = JSON.parse(line);
    record.order = order++;
    if (!map.has(record.key)) map.set(record.key, []);
    map.get(record.key).push(record);
  }
  return map;
}

export const replyOf = record => {
  const result = record.events.find(entry => entry.event.type === 'result')?.event;
  if (!result || result.is_error || record.code) throw Error('recorded turn has no successful result');
  return { text: result.structured_output ? JSON.stringify(result.structured_output) : result.result, usage: usageOf(result), wallMs: record.wallMs, apiMs: result.duration_api_ms ?? null, usageDetail: result.usage ?? null };
};

const lastStage = messages => {
  const last = messages.at(-1);
  if (last?.role !== 'user') return null;
  try { return JSON.parse(last.content).stage ?? null; } catch { return null; }
};

export class ReplayProvider {
  name = 'replay'; testDouble = true; calls = 0; liveCalls = 0; replayed = 0; errors = []; turns = [];
  constructor({ recorded, clock = true, onTurn = null }) { Object.assign(this, { recorded, clock, onTurn }); }
  async start() { return { startupMs: 0, lanes: 0 }; }
  async send({ session, messages, remaining }) {
    if (remaining !== undefined && remaining <= 0) throw Error('model token budget reached');
    const key = requestKey(messages), record = this.recorded.get(key)?.[0];
    if (!record) { this.errors.push(`no recording for ${key}`); throw Error(`no recording for ${key}`); }
    this.calls += 1; this.replayed += 1;
    const turn = { key, label: record.label, index: this.turns.length, messages };
    this.turns.push(turn);
    const reply = replyOf(record);
    if (this.onTurn) await this.onTurn(turn, record);
    else if (this.clock) await new Promise(resolve => setTimeout(resolve, record.wallMs));
    if (remaining !== undefined && reply.usage > remaining) throw Error('model token budget exceeded');
    return reply;
  }
  endSession() {}
  async close() {}
}

export class HybridProvider {
  name = 'hybrid'; testDouble = false; replayed = 0; errors = []; live; recorded; going = false;
  constructor({ recorded, live, source }) { Object.assign(this, { recorded, live, source }); }
  get liveCalls() { return this.live.calls; }
  get calls() { return this.live.calls; }
  get inits() { return this.live.inits; }
  async start() { return { startupMs: 0, lanes: 0 }; }
  async send(request) {
    if (!this.going && lastStage(request.messages) === 'implementation') this.going = true;
    if (this.going) return this.live.send(request);
    const record = this.recorded.get(requestKey(request.messages))?.[0];
    if (!record) { this.errors.push('specification turn not recorded'); throw Error('specification turn not recorded'); }
    if (record.label !== this.source) { this.errors.push('recording from another run'); throw Error('recording from another run'); }
    this.replayed += 1;
    return replyOf(record);
  }
  endSession() {}
  async close() { await this.live.close(); }
}
