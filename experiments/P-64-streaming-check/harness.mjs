import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { applyCall, applyReply } from '../../core/runtime/x1/agent.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { CallScanner } from './stream.mjs';

const editableFor = stage => stage === 'implementation' ? ['kernel.ts', 'glue.json'] : ['CONTRACT.md', 'tests.json'];

export class Prechecker {
  #seq = 0; #waiting = new Map();
  constructor() {
    this.worker = new Worker(new URL('./precheck-worker.mjs', import.meta.url));
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('error', reject);
      this.worker.on('message', message => {
        if (message.ready) return resolve();
        const waiter = this.#waiting.get(message.seq);
        this.#waiting.delete(message.seq);
        waiter?.(message);
      });
    });
  }
  check(kind, id, files) {
    const seq = ++this.#seq, begin = performance.now();
    return new Promise(resolve => {
      this.#waiting.set(seq, message => resolve({ ...message, roundTripMs: performance.now() - begin }));
      this.worker.postMessage({ seq, kind, id, files });
    });
  }
  close() { return this.worker.terminate(); }
}

export function overlayFrom(messages) {
  const overlay = {};
  let stage = null, id = null;
  for (const message of messages) {
    if (message.role === 'user') {
      let value = null;
      try { value = JSON.parse(message.content); } catch { }
      if (value?.stage) {
        stage = value.stage; id = value.id ?? id;
        if (value.frozen) Object.assign(overlay, value.frozen);
      }
    } else applyReply(overlay, editableFor(stage), message.content);
  }
  if (stage === 'implementation') overlay['frozen.sha256'] = JSON.stringify({ contract: hash(overlay['CONTRACT.md']), tests: hash(overlay['tests.json']) });
  return { overlay, stage, id };
}

const filesOf = overlay => ({ 'CONTRACT.md': overlay['CONTRACT.md'], 'tests.json': overlay['tests.json'], 'frozen.sha256': overlay['frozen.sha256'], 'kernel.ts': overlay['kernel.ts'] ?? '', 'glue.json': overlay['glue.json'] ?? '' });
const runsCheck = calls => calls.length === 0 || calls.some(call => call?.name === 'check' || call?.name === 'done');

export function summarize(record) {
  let firstOutput = null, toolStart = null, lastToken = null, result = null, toolChars = 0;
  for (const { t, event } of record.events) {
    if (event.type === 'stream_event') {
      const inner = event.event;
      if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') toolStart ??= t;
      if (inner.type === 'content_block_delta') { firstOutput ??= t; lastToken = t; if (inner.delta?.type === 'input_json_delta') toolChars += (inner.delta.partial_json ?? '').length; }
    } else if (event.type === 'result') result = { t, event };
  }
  return { firstOutput, toolStart, lastToken, result: result?.t ?? null, close: record.wallMs, toolChars, usage: result?.event?.usage ?? null, structured: result?.event?.structured_output ?? null };
}

export async function replayTurn({ record, messages, stream, base, context = null }) {
  const { overlay, stage, id } = context ? structuredClone(context) : overlayFrom(messages);
  const editable = editableFor(stage), copy = { ...overlay }, scanner = new CallScanner(), info = summarize(record);
  const t0 = performance.now(), now = () => performance.now() - t0;
  const fulls = [], prechecks = [];
  let charsSeen = 0, refusal = null, lastEditAt = null;
  const dispatchFull = () => {
    const files = filesOf(copy), at = now(), snapshot = stage === 'implementation' ? files : { 'CONTRACT.md': copy['CONTRACT.md'], 'tests.json': copy['tests.json'] };
    const entry = { at, digest: hash(JSON.stringify(snapshot)) };
    entry.done = stream.check(stage === 'implementation' ? 'full' : 'spec', id, snapshot).then(result => Object.assign(entry, { result, finishedAt: now() }));
    fulls.push(entry);
  };
  for (const { t, event } of record.events) {
    const wait = t - now();
    if (wait > 1) await sleep(wait);
    if (event.type !== 'stream_event' || event.event.type !== 'content_block_delta' || event.event.delta?.type !== 'input_json_delta') continue;
    const chunk = event.event.delta.partial_json ?? '';
    charsSeen += chunk.length;
    for (const call of scanner.push(chunk)) {
      if (call?.name !== 'edit_file') continue;
      if (applyCall(copy, editable, call).error) continue;
      lastEditAt = now();
      if (stage === 'implementation' && call.path === 'kernel.ts') {
        const at = now(), kernel = copy['kernel.ts'], chars = charsSeen;
        const entry = { at, kernelDigest: hash(kernel), chars };
        entry.done = stream.check('kernel', id, filesOf(copy)).then(result => {
          Object.assign(entry, { result, finishedAt: now() });
          if (result.refuse && !refusal) refusal = { at, finishedAt: entry.finishedAt, kernelDigest: entry.kernelDigest, chars, failedGates: result.failedGates };
        });
        prechecks.push(entry);
      }
      if (stage === 'specification' && call.path === 'tests.json') {
        const at = now(), chars = charsSeen;
        const entry = { at, chars };
        entry.done = stream.check('spec', id, { 'CONTRACT.md': copy['CONTRACT.md'] ?? 'x', 'tests.json': copy['tests.json'] }).then(result => {
          Object.assign(entry, { result, finishedAt: now() });
          if (result.refuse && !refusal) refusal = { at, finishedAt: entry.finishedAt, chars, kernelDigest: null };
        });
        prechecks.push(entry);
      }
      dispatchFull();
    }
  }
  if (!fulls.length) dispatchFull();
  const remaining = record.wallMs - now();
  if (remaining > 1) await sleep(remaining);
  const closeAt = now();
  const finalFiles = stage === 'implementation' ? filesOf(copy) : { 'CONTRACT.md': copy['CONTRACT.md'], 'tests.json': copy['tests.json'] };
  const baseline = base.check(stage === 'implementation' ? 'full' : 'spec', id, finalFiles).then(result => ({ result, finishedAt: now() }));
  const finish = async () => {
    await Promise.all([...fulls.map(entry => entry.done), ...prechecks.map(entry => entry.done)]);
    const base = await baseline;
    const final = fulls.at(-1);
    const calls = info.structured?.calls ?? [];
    const checked = runsCheck(calls);
    const kernelEdits = calls.filter(call => call?.name === 'edit_file' && call.path === 'kernel.ts').length;
    const lastToken = info.lastToken ?? info.result;
    const streamReady = Math.max(lastToken, final.finishedAt);
    return {
      label: record.label, stage, id, checked, kernelEdits, calls: calls.map(call => call?.name === 'edit_file' ? `edit:${call.path}` : call?.name),
      firstOutput: info.firstOutput, toolStart: info.toolStart, lastToken, resultAt: info.result, closeAt: record.wallMs, replayCloseAt: closeAt, lastEditAt,
      toolChars: info.toolChars, usage: info.usage,
      stream: { finalAt: final.at, finalFinishedAt: final.finishedAt, failed: final.result.failed, error: final.result.error ?? null, digest: final.digest, checks: fulls.length,
        tailMs: (streamReady - lastToken) + (info.result - lastToken) },
      base: { failed: base.result.failed, error: base.result.error ?? null, roundTripMs: base.result.roundTripMs, compileMs: base.result.compileMs, finishedAt: base.finishedAt,
        tailMs: (record.wallMs - lastToken) + base.result.roundTripMs, digest: hash(JSON.stringify(finalFiles)) },
      prechecks: prechecks.map(entry => ({ at: entry.at, finishedAt: entry.finishedAt, refuse: entry.result.refuse, failedGates: entry.result.failedGates ?? null, chars: entry.chars, kernelDigest: entry.kernelDigest ?? null })),
      refusal: refusal && { ...refusal, beforeLastToken: refusal.finishedAt < lastToken, savedMs: Math.max(0, lastToken - refusal.finishedAt), charsAfter: info.toolChars - refusal.chars,
        finalKernelSame: refusal.kernelDigest === null ? true : refusal.kernelDigest === hash(copy['kernel.ts'] ?? '') },
    };
  };
  return { finish };
}

const boundary = (x, start, oldEnd, newEnd) => x <= start ? x : x >= oldEnd ? x + (newEnd - oldEnd) : start + Math.round((x - start) * (newEnd - start) / (oldEnd - start));
export function mutateRecord(record, oldKernel, newKernel) {
  const deltas = record.events.filter(entry => entry.event.type === 'stream_event' && entry.event.event.delta?.type === 'input_json_delta');
  const text = deltas.map(entry => entry.event.event.delta.partial_json ?? '').join('');
  const from = JSON.stringify(oldKernel).slice(1, -1), to = JSON.stringify(newKernel).slice(1, -1);
  const start = text.indexOf(from);
  if (start < 0 || text.indexOf(from, start + 1) >= 0) return null;
  const changed = text.slice(0, start) + to + text.slice(start + from.length), oldEnd = start + from.length, newEnd = start + to.length;
  let offset = 0, previous = 0;
  const replaced = new Map();
  for (const entry of deltas) {
    offset += (entry.event.event.delta.partial_json ?? '').length;
    const next = boundary(offset, start, oldEnd, newEnd);
    replaced.set(entry, changed.slice(previous, next));
    previous = next;
  }
  const events = record.events.map(entry => {
    if (replaced.has(entry)) return { t: entry.t, event: { ...entry.event, event: { ...entry.event.event, delta: { ...entry.event.event.delta, partial_json: replaced.get(entry) } } } };
    if (entry.event.type === 'result' && entry.event.structured_output) {
      const structured = structuredClone(entry.event.structured_output);
      for (const call of structured.calls) if (call.name === 'edit_file' && call.path === 'kernel.ts' && call.content === oldKernel) call.content = newKernel;
      return { t: entry.t, event: { ...entry.event, structured_output: structured } };
    }
    return entry;
  });
  return { ...record, label: `${record.label}:mutant`, events };
}
export const mutations = {
  constant: source => { const m = /(?<![\w.])(\d+\.\d+)(?![\w.])/.exec(source); return m ? source.slice(0, m.index) + String(Number(m[1]) * 1.001) + source.slice(m.index + m[1].length) : null; },
  compare: source => { for (const [a, b] of [[' <= ', ' < '], [' >= ', ' > '], [' < ', ' <= '], [' > ', ' >= ']]) { const i = source.indexOf(a); if (i >= 0) return source.slice(0, i) + b + source.slice(i + a.length); } return null; },
  operator: source => { for (const [a, b] of [[' * ', ' / '], [' - ', ' + '], [' + ', ' - ']]) { const i = source.indexOf(a); if (i >= 0) return source.slice(0, i) + b + source.slice(i + a.length); } return null; },
  trap: source => { const i = source.indexOf('abort()'); return i >= 0 ? `${source.slice(0, i)}0${source.slice(i + 7)}` : null; },
  syntax: source => { const i = source.lastIndexOf('}'); return i >= 0 ? source.slice(0, i) + source.slice(i + 1) : null; },
};
