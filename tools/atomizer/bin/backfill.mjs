#!/usr/bin/env node
// One-time backfill: reconstruct ledger events from run directories and atomization receipts made before the ledger existed.
// Every event carries backfilled: true and source paths; timings come from receipts and the CLI's own JSON. Idempotent by runId.
import fs from 'node:fs';
import path from 'node:path';
import { emit, archiveRun, shaFile, EVENTS, REPO } from '../lib/ledger.mjs';
const already = new Set(fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((e) => e.runId ?? e.atomizeId) : []);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const label = process.argv.find((a) => a.startsWith('--label='))?.slice(8) ?? null;
for (const arg of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const p = path.resolve(arg);
  if (fs.existsSync(path.join(p, 'receipt', 'atomize.json'))) { // atomization example
    const r = readJson(path.join(p, 'receipt', 'atomize.json')); const id = `atomize-${r.needId}-${(r.startedAt ?? '').replace(/[-:.]/g, '')}-backfill`;
    if (already.has(id)) continue;
    const plan = readJson(path.join(p, 'plan.json')); const doc = readJson(path.join(p, 'atoms.json'));
    emit('atomize.start', { atomizeId: id, backfilled: true, source: path.relative(REPO, p), need: r.needId, model: r.model, promptSha256: r.promptSha256, at: r.startedAt });
    r.attempts.forEach((a) => emit('atomize.attempt', { atomizeId: id, backfilled: true, need: r.needId, model: r.model, attempt: a.attempt, wallMs: a.wallMs, usage: a.usage, valid: !a.errors?.length, errors: a.errors, warnings: a.warnings, atoms: a.atoms }));
    emit('atomize.end', { atomizeId: id, backfilled: true, need: r.needId, model: r.model, valid: r.valid, attempts: r.attempts.length, atomsSha256: shaFile(path.join(p, 'atoms.json')), plan: plan && { atoms: doc?.atoms?.length, total: plan.total, critical: plan.critical, criticalPath: plan.criticalPath, speedupBound: plan.speedupBound, width: plan.width, waves: plan.waves }, kinds: doc?.atoms ? doc.atoms.reduce((m, a) => { m[a.kind] = (m[a.kind] ?? 0) + 1; return m; }, {}) : null, at: r.finishedAt });
    continue;
  }
  const dirs = fs.existsSync(path.join(p, 'receipt', 'run.json')) ? [p] : fs.readdirSync(p).map((d) => path.join(p, d)).filter((d) => fs.existsSync(path.join(d, 'receipt', 'run.json')));
  const fan = readJson(path.join(p, 'fanout.json')); const poolId = fan ? `pool-${path.basename(p)}-backfill` : null;
  if (fan && !already.has(poolId)) emit('pool.start', { poolId, backfilled: true, source: path.relative(REPO, p), label, requests: fan.results.map((r) => r.id), parallelRuns: fan.parallelRuns, perRunConcurrency: fan.perRunConcurrency, at: fan.at });
  for (const d of dirs) {
    const run = readJson(path.join(d, 'receipt', 'run.json')); const doc = readJson(path.join(d, 'atoms.json'));
    const runId = run.runId ?? `run-${run.need}-${path.basename(path.dirname(d))}-${path.basename(d)}-backfill`;
    if (already.has(runId)) continue;
    const recs = Object.fromEntries(fs.readdirSync(path.join(d, 'receipt', 'atoms')).map((f) => { const r = readJson(path.join(d, 'receipt', 'atoms', f)); return [r.id, r]; }));
    const t0 = Math.min(...Object.values(recs).map((r) => Date.parse(r.startedAt)));
    emit('run.start', { runId, poolId, backfilled: true, label, source: path.relative(REPO, d), need: run.need, concurrency: run.concurrency, atoms: run.atoms, plan: run.plan, augmented: doc.augmented ?? null, atomSpecs: doc.atoms.map((a) => ({ id: a.id, kind: a.kind, model: a.worker.model, tools: a.worker.tools ?? [], size: a.size, inputs: (a.inputs ?? []).map((i) => i.from === 'need' ? 'need' : i.output ? `${i.from}#${i.output}` : i.from), outputs: a.outputs.map((o) => o.path) })), at: new Date(t0).toISOString() });
    for (const a of doc.atoms) {
      const r = recs[a.id]; if (!r) continue;
      const deps = (a.inputs ?? []).filter((i) => i.from !== 'need').map((i) => recs[i.from]).filter(Boolean).map((x) => Date.parse(x.finishedAt));
      const ready = deps.length ? Math.max(...deps) : t0; const start = Date.parse(r.startedAt);
      emit('atom.start', { runId, poolId, backfilled: true, need: run.need, atom: a.id, kind: a.kind, model: a.worker.model, readyAtMs: ready - t0, startAtMs: start - t0, queueMs: Math.max(0, start - ready), readyDerived: true });
      for (const at of r.attempts) {
        const cliRaw = readJson(path.join(d, 'atoms', a.id, `stdout-${at.attempt}.txt`));
        const cli = cliRaw && cliRaw.duration_ms != null ? { durationMs: cliRaw.duration_ms, apiMs: cliRaw.duration_api_ms, turns: cliRaw.num_turns, subtype: cliRaw.subtype, isError: cliRaw.is_error, usage: cliRaw.usage, modelUsage: cliRaw.modelUsage, totalCostUsdList: cliRaw.total_cost_usd } : null;
        emit('attempt.end', { runId, poolId, backfilled: true, need: run.need, atom: a.id, kind: a.kind, model: a.worker.model, tools: a.worker.tools ?? [], attempt: at.attempt, ok: at.ok, exit: at.exit, timedOut: at.timedOut, stageMs: null, wallMs: at.wallMs, split: cli ? { modelApiMs: cli.apiMs, toolMs: Math.max(0, cli.durationMs - (cli.apiMs ?? 0)), harnessMs: Math.max(0, at.wallMs - cli.durationMs) } : null, cli, usage: at.usage, missing: at.missing, stderrTail: at.stderrTail });
      }
      emit('atom.end', { runId, poolId, backfilled: true, need: run.need, atom: a.id, kind: a.kind, model: a.worker.model, ok: r.ok, attempts: r.attempts.length, wallMs: r.wallMs, endAtMs: Date.parse(r.finishedAt) - t0, outputs: r.outputs });
    }
    for (const [id, s] of Object.entries(run.statuses)) if (s === 'blocked') emit('atom.blocked', { runId, poolId, backfilled: true, need: run.need, atom: id });
    emit('run.end', { runId, poolId, backfilled: true, need: run.need, allDone: run.allDone, statuses: run.statuses, wallMs: run.wallMs, sumAtomWallMs: run.sumAtomWallMs, criticalPathWallMs: run.criticalPathWallMs, realizedSpeedup: run.realizedSpeedup, speedupBound: run.plan.speedupBound, tokens: run.tokens });
    const v = readJson(path.join(d, 'receipt', 'verify.json')); const c = doc.atoms.find((x) => x.kind === 'compose'); const g = c ? readJson(path.join(d, 'atoms', c.id, 'out', 'gates.json')) : null;
    const reviews = doc.atoms.filter((x) => x.kind === 'review').map((x) => { const j = readJson(path.join(d, 'atoms', x.id, 'out', x.outputs[0].path)); return { atom: x.id, model: x.worker.model, persona: j?.persona ?? null, verdict: j?.verdict ?? null, change: j?.change ?? null }; });
    if (v) emit('verify.end', { runId, poolId, backfilled: true, need: run.need, ok: v.ok, fails: v.fails, acceptance: v.acceptance.map((a) => ({ id: a.id, kind: a.kind, ok: a.ok ?? null, exit: a.exit ?? null })), gates: g ? { promotable: g.promotable, byGate: Object.fromEntries(Object.entries(g.gates ?? {}).map(([k, x]) => [k, x.ok])), testsPassed: g.gates?.G4_tests?.passed ?? null, testsTotal: g.gates?.G4_tests?.total ?? null } : null, reviews });
    const ar = archiveRun(d, runId); emit(ar.refused ? 'archive.refused' : 'run.archived', { runId, poolId, backfilled: true, need: run.need, ...ar });
    console.log(`${runId}: ${ar.refused ? 'ARCHIVE REFUSED ' + ar.refused : ar.bytes + ' bytes archived'}`);
  }
  if (fan && !already.has(poolId)) emit('pool.end', { poolId, backfilled: true, wallMs: fan.wallMs, sumAtomWallMs: fan.sumAtomWallMs, pooledSpeedup: fan.pooledSpeedup, promotable: fan.promotable, verified: fan.verified, tokens: fan.tokens, perRequest: fan.results.map((r) => ({ need: r.id, wallMs: r.wallMs, allDone: r.allDone, promotable: r.promotable, verifyExit: r.verifyExit, realizedSpeedup: r.realizedSpeedup })) });
}
