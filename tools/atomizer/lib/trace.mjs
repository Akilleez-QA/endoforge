// Append-only timing evidence; no prompts, environments or credential contents.
import fs from 'node:fs';
import path from 'node:path';
import { deps, topo } from './dag.mjs';
export const nowEpoch = () => performance.timeOrigin + performance.now();
export function openTrace(runDir, { runId }) {
  const enabled = process.env.ENDOFORGE_TRACE !== '0', file = path.join(runDir, 'trace.jsonl');
  let selfMs = 0, lines = 0, closed = false;
  const span = (name, start, end, attrs = {}, type = 'span') => {
    if (!enabled || closed) return;
    const t = nowEpoch(), round = (x) => Math.round(x * 10) / 10;
    start = round(start); end = round(end);
    fs.appendFileSync(file, JSON.stringify({ ...attrs, v: 1, runId, type, name, start, end, dur: round(end - start) }) + '\n');
    selfMs += nowEpoch() - t; lines++;
  };
  const mark = (name, attrs) => { const t = nowEpoch(); span(name, t, t, attrs, 'mark'); };
  return { enabled, file, span, mark, close() { if (!closed) { mark('trace.self', { selfMs, lines }); closed = true; } } };
}
export function readTrace(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } }
export function p(values, q) { const xs = [...values].sort((a, b) => a - b); return xs.length ? xs[Math.max(0, Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1))] : null; }
export function analyzeTrace(lines, atoms, { concurrency } = {}) {
  const run = lines.findLast((x) => x.type === 'span' && x.name === 'run');
  if (!run) return {};
  const same = lines.filter((x) => x.runId === run.runId), spans = same.filter((x) => x.type === 'span'), named = (n) => spans.filter((x) => x.name === n), sum = (xs) => xs.reduce((s, x) => s + x.dur, 0);
  const phases = Object.fromEntries('queue setup preflight worker pool.acquire codex.exec isolate.home post verify verify.acceptance archive'.split(' ').map((n) => [n, sum(named(n))]));
  const byBackend = Object.fromEntries(['codex', 'script', 'claude'].map((b) => [b, sum(named('worker').filter((x) => x.backend === b))])), byTier = {};
  for (const w of named('worker').filter((x) => x.backend === 'codex')) (byTier[w.tier] ??= []).push(w.dur);
  for (const [tier, xs] of Object.entries(byTier)) byTier[tier] = { n: xs.length, totalMs: xs.reduce((a, b) => a + b, 0), medianMs: p(xs, 0.5) };
  const measured = named('atom').map((x) => ({ id: x.atom, kind: x.kind, start: x.start - run.start, end: x.end - run.start, durMs: x.dur, queueMs: sum(named('queue').filter((q) => q.atom === x.atom)), attempts: x.attempts, ok: x.ok, backend: x.backend, tier: x.tier, model: x.codexModel ?? x.model, effort: x.effort, account: x.account, accounts: x.accounts }));
  const byId = Object.fromEntries(measured.map((x) => [x.id, x])), specs = Object.fromEntries(atoms.map((x) => [x.id, x])), parents = (id) => deps(specs[id] ?? {}).filter((d) => byId[d]);
  const cp = {}, paths = {};
  for (const id of topo(atoms).order) { const d = parents(id).sort((a, b) => (cp[b] ?? 0) - (cp[a] ?? 0))[0]; cp[id] = (cp[d] ?? 0) + (byId[id]?.durMs ?? 0); paths[id] = [...(paths[d] ?? []), id]; }
  const tip = Object.keys(cp).sort((a, b) => cp[b] - cp[a])[0], criticalPathMs = cp[tip] ?? 0, realizedChain = [];
  let cur = [...measured].sort((a, b) => b.end - a.end)[0];
  while (cur) {
    const dep = parents(cur.id).map((id) => byId[id]).sort((a, b) => b.end - a.end)[0];
    realizedChain.unshift({ id: cur.id, queueMs: cur.queueMs, gapMs: dep ? cur.start - cur.queueMs - dep.end : -cur.queueMs, durMs: cur.durMs, codexMs: sum(named('codex.exec').filter((x) => x.atom === cur.id)), backend: cur.backend });
    cur = dep;
  }
  const chain = Object.fromEntries(['durMs', 'queueMs', 'gapMs', 'codexMs'].map((k) => [k, realizedChain.reduce((s, x) => s + x[k], 0)]));
  chain.nonCodexMs = chain.durMs - chain.codexMs;
  // Root queue is already inside lead; its gap cancels that duplicate contribution.
  chain.leadMs = realizedChain.length ? byId[realizedChain[0].id].start : 0;
  chain.tailMs = run.dur - (realizedChain.length ? byId[realizedChain.at(-1).id].end : 0);
  const events = new Map([[run.start, 0], [run.end, 0]]), event = (t, delta) => events.set(t, (events.get(t) ?? 0) + delta);
  for (const x of named('atom')) { event(Math.max(run.start, x.start), 1); event(Math.min(run.end, x.end), -1); }
  let active = 0, max = 0, prev = run.start; const msAt = {};
  for (const [t, delta] of [...events].sort((a, b) => a[0] - b[0])) { msAt[active] = (msAt[active] ?? 0) + t - prev; active += delta; max = Math.max(max, active); prev = t; }
  const busyMs = measured.reduce((s, x) => s + x.durMs, 0), codexMs = phases['codex.exec'];
  return { wallMs: run.dur, processStartMs: run.procStartEpoch == null ? null : run.start - run.procStartEpoch, atoms: measured, phases, byBackend, byTier, codexMs, poolAcquireMs: phases['pool.acquire'], busyMs, nonCodexBusyMs: busyMs - codexMs, criticalPathMs, criticalPath: paths[tip] ?? [], wallOverCritical: criticalPathMs ? run.dur / criticalPathMs : null, realizedChain, chain, concurrency: { avg: busyMs / run.dur, max, msAt }, parallelEfficiency: busyMs / (run.dur * (run.concurrency ?? concurrency)), errors: { atomsFailed: measured.filter((x) => !x.ok).length, retries: measured.reduce((s, x) => s + Math.max(0, x.attempts - 1), 0), failovers: named('worker').reduce((s, x) => s + (x.failovers ?? 0), 0), modelFallbacks: named('worker').filter((x) => x.modelFallback).length, verifyOk: named('verify').at(-1)?.ok ?? null }, traceSelfMs: same.filter((x) => x.type === 'mark' && x.name === 'trace.self').reduce((s, x) => s + x.selfMs, 0) };
}
