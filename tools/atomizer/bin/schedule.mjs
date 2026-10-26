#!/usr/bin/env node
// Run an atoms.json DAG: every atom in its own isolate with only its declared inputs mounted; ready-queue scheduling with a concurrency limit.
// usage: node schedule.mjs run <atoms.json> --run-dir <dir> [--concurrency 8] [--retries 1] [--timeout-ms 900000] [--policy tools/atomizer/policy.json] [--force]
import fs from 'node:fs';
import { openTrace, nowEpoch } from '../lib/trace.mjs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { plan, deps } from '../lib/dag.mjs';
import { makeHomeTemplate, runIsolated, sha256File, listFiles } from '../lib/isolate.mjs';
import { atomBinds, atomTimeoutMs } from '../lib/binds.mjs';
import { workerCommand, parseUsage, stripFences, toolchainFor } from '../lib/workers.mjs';
import { augment } from '../lib/augment.mjs';
import { emit, context, load, newId, archiveRun, shaFile } from '../lib/ledger.mjs';
import { loadRouting, resolve } from '../lib/routing.mjs';
import { headroom } from '../../throttle/throttle.mjs';
import { runLessons } from '../lib/lessons.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(a); } return o; }
const A = args(process.argv.slice(2));
if (A._[0] !== 'run' || !A._[1] || !A['run-dir']) { console.error('usage: schedule.mjs run <atoms.json> --run-dir <dir> [--concurrency N] [--retries N] [--timeout-ms N] [--policy file] [--force]'); process.exit(2); }
const policy = JSON.parse(fs.readFileSync(A.policy ? path.resolve(A.policy) : path.join(HERE, '..', 'policy.json'), 'utf8'));
const doc = A['no-augment'] ? JSON.parse(fs.readFileSync(A._[1], 'utf8')) : augment(JSON.parse(fs.readFileSync(A._[1], 'utf8')), policy);
const backend = process.env.ENDOFORGE_WORKER ?? policy.workerBackend ?? 'native';
if (backend === 'codex') for (const atom of doc.atoms ?? []) {
  if (atom.worker && !['script', 'codex'].includes(atom.worker.model)) {
    atom.worker.requestedModel ??= atom.worker.model; atom.worker.model = 'codex';
  }
}
const routing = loadRouting();
const v = validate(doc, policy);
if (!v.ok && !A.force) { console.error(JSON.stringify(v, null, 1)); process.exit(3); }
const RUN = path.resolve(A['run-dir']);
const CONC = Number(A.concurrency ?? (backend === 'codex' ? Number(process.env.ENDOFORGE_CODEX_CONCURRENCY) || 3 : 8)), RETRIES = Number(A.retries ?? 1), TIMEOUT = Number(A['timeout-ms'] ?? 900_000);
fs.mkdirSync(path.join(RUN, 'receipt', 'atoms'), { recursive: true });
fs.writeFileSync(path.join(RUN, 'atoms.json'), JSON.stringify(doc, null, 1));
const P = plan(doc.atoms);
const RUN_ID = A['run-id'] ?? newId(`run-${doc.need.id}`);
const T = openTrace(RUN, { runId: RUN_ID });
const POOL_ID = A['pool-id'] ?? null;
const runT0 = Date.now(), traceRunT0 = nowEpoch();
emit('run.start', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, runDir: path.relative(REPO, RUN), concurrency: CONC, retries: RETRIES, timeoutMs: TIMEOUT, atomsSha256: shaFile(A._[1]), atoms: doc.atoms.length, augmented: doc.augmented ?? null, normalizedCompose: doc.normalizedCompose ?? null, plan: { waves: P.waves, total: P.total, critical: P.critical, criticalPath: P.criticalPath, speedupBound: P.speedupBound, width: P.width }, atomSpecs: doc.atoms.map((a) => ({ id: a.id, kind: a.kind, model: a.worker.model, tools: a.worker.tools ?? [], effort: a.worker.effort ?? null, size: a.size, inputs: (a.inputs ?? []).map((i) => i.from === 'need' ? 'need' : i.output ? `${i.from}#${i.output}` : i.from), outputs: a.outputs.map((o) => o.path) })), context: context(), load: load() });
const readyAt = {}, traceReadyAt = {};
const byId = new Map(doc.atoms.map((a) => [a.id, a]));
const state = new Map(doc.atoms.map((a) => [a.id, 'pending']));
const receipts = {}, codexAccounts = {};
const homeTemplate = makeHomeTemplate(fs.mkdtempSync(path.join(os.tmpdir(), 'atom-home-template-')));
const stage = (atom) => {
  const inDir = path.join(RUN, 'atoms', atom.id, 'in'); fs.rmSync(inDir, { recursive: true, force: true }); fs.mkdirSync(inDir, { recursive: true });
  const staged = [];
  for (const i of atom.inputs ?? []) {
    if (i.from === 'need') { const d = path.join(inDir, 'need'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'NEED.md'), doc.need.text); staged.push({ from: 'need', path: 'NEED.md', host: path.join(d, 'NEED.md'), describe: 'the need, verbatim' }); continue; }
    const prod = byId.get(i.from); const outs = i.output ? prod.outputs.filter((o) => o.name === i.output) : prod.outputs;
    for (const o of outs) {
      const src = path.join(RUN, 'atoms', prod.id, 'out', o.path); const dst = path.join(inDir, prod.id, o.path);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
      staged.push({ from: prod.id, path: o.path, host: dst, describe: o.describe ?? `${prod.title ?? prod.id} → ${o.name}` });
    }
  }
  return { inDir, staged };
};
async function runAtom(atom) {
  const tStart = Date.now(), atomStart = nowEpoch();
  T.span('queue', traceReadyAt[atom.id] ?? atomStart, atomStart, { atom: atom.id, attempt: 1 });
  emit('atom.start', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, atom: atom.id, kind: atom.kind, model: atom.worker.model, readyAtMs: (readyAt[atom.id] ?? tStart) - runT0, startAtMs: tStart - runT0, queueMs: tStart - (readyAt[atom.id] ?? tStart), running: running.size, load: load() });
  const outDir = path.join(RUN, 'atoms', atom.id, 'out'), workDir = path.join(RUN, 'atoms', atom.id, 'work');
  const rec = { id: atom.id, kind: atom.kind, model: atom.worker.model, attempts: [], readyAt: new Date(readyAt[atom.id] ?? tStart).toISOString(), startedAt: new Date(tStart).toISOString() };
  for (let attempt = 1; attempt <= 1 + RETRIES; attempt++) {
    const setupStart = nowEpoch();
    fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true }); fs.rmSync(workDir, { recursive: true, force: true }); fs.mkdirSync(workDir, { recursive: true });
    const tStage = Date.now();
    const { inDir, staged } = stage(atom);
    const stageMs = Date.now() - tStage;
    T.span('setup', setupStart, nowEpoch(), { atom: atom.id, attempt, inputs: staged.length, bytes: staged.reduce((n, x) => n + fs.statSync(x.host).size, 0) });
    if (atom.worker.preflight && attempt === 1 && !A['no-preflight']) {
      const pfStart = nowEpoch();
      const pf = atom.worker.preflight;
      const subst = (x) => x.replaceAll('{in}', '/in').replaceAll('{out}', '/out').replaceAll('{work}', '/work').replaceAll('{atomizer}', path.join(REPO, policy.toolchain.atomizer)).replaceAll('{gate}', path.join(REPO, policy.toolchain.gate, 'gate.mjs'));
      const pr = await runIsolated({ homeTemplate, mounts: [{ host: inDir, guest: '/in', mode: 'ro' }, { host: outDir, guest: '/out', mode: 'rw' }, { host: workDir, guest: '/work', mode: 'rw' }, ...atomBinds(atom, policy).mounts], toolchain: toolchainFor(pf.toolchain ?? ['node'], policy, REPO), cmd: pf.command.map(subst), stdin: null, cwd: '/work', timeoutMs: atomTimeoutMs(atom, policy, TIMEOUT) });
      const pmissing = atom.outputs.filter((o) => { const p = path.join(outDir, o.path); return !fs.existsSync(p) || fs.statSync(p).size === 0; }).map((o) => o.path);
      const hit = pr.exit === 0 && pmissing.length === 0;
      fs.writeFileSync(path.join(RUN, 'atoms', atom.id, 'preflight-stdout.txt'), pr.stdout); fs.writeFileSync(path.join(RUN, 'atoms', atom.id, 'preflight-stderr.txt'), pr.stderr);
      emit('preflight.end', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, atom: atom.id, kind: atom.kind, hit, exit: pr.exit, wallMs: Math.round(pr.wallMs), stageMs, missing: pmissing, stdoutTail: pr.stdout.slice(-300), stderrTail: pr.stderr.slice(-300), load: load() });
      T.span('preflight', pfStart, nowEpoch(), { atom: atom.id, attempt, hit });
      rec.preflight = { hit, exit: pr.exit, wallMs: Math.round(pr.wallMs) };
      if (hit) { rec.attempts.push({ attempt: 0, preflight: true, exit: 0, wallMs: Math.round(pr.wallMs), usage: null, missing: [], ok: true, stderrTail: pr.stderr.slice(-400) }); break; }
      fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true }); fs.rmSync(workDir, { recursive: true, force: true }); fs.mkdirSync(workDir, { recursive: true });
    }
    const isCodex = atom.worker.model === 'codex';
    const routed = { ...atom, prompt: atom.worker.prompt, consumes: atom.inputs, produces: atom.outputs };
    let sel = isCodex ? resolve(routed, attempt, routing) : null;
    const meta = isCodex ? { account: null, accounts: [], failovers: [], modelFallback: false } : {};
    const workerStart = nowEpoch(), workerBackend = isCodex ? 'codex' : atom.worker.model === 'script' ? 'script' : 'claude';
    let w, r, launchWallMs = 0;
    for (;;) {
      const bin = process.env.ENDOFORGE_CODEX_POOL || '/home/box/.local/bin/codex-pool';
      if (isCodex) Object.assign(meta, { tier: sel.tier, tierReason: sel.reason, codexModel: sel.model, effort: sel.effort });
      if (isCodex && !fs.existsSync(bin)) {
        meta.reason = `codex-pool not found: ${bin}; set ENDOFORGE_CODEX_POOL`;
        w = { cmd: [] }; r = { exit: 127, stdout: '', stderr: meta.reason, wallMs: 0 }; break;
      }
      w = workerCommand(doc, atom, staged, policy, REPO, sel);
      r = await runIsolated({ homeTemplate, mounts: [{ host: inDir, guest: '/in', mode: 'ro' }, { host: outDir, guest: '/out', mode: 'rw' }, { host: workDir, guest: '/work', mode: 'rw' }, ...atomBinds(atom, policy).mounts], toolchain: w.toolchain, cmd: w.cmd, stdin: w.stdin, cwd: '/work', timeoutMs: atomTimeoutMs(atom, policy, TIMEOUT),
        ...(isCodex ? { pool: { bin, env: { CODEX_POOL_TIER: sel.tier, ...(sel.tier === 'throwaway' ? { CODEX_POOL_THROWAWAY: '1' } : {}) } } } : {}) });
      if (r.claudeAccount) meta.account = r.claudeAccount;  // which pool login served this attempt (name only)
      T.span('isolate.home', r.spawnEpoch - r.homeMs, r.spawnEpoch, { atom: atom.id, attempt });
      if (isCodex) {
        T.span('pool.acquire', r.spawnEpoch, r.tries[0]?.start ?? r.endEpoch, { atom: atom.id, attempt });
        r.tries.forEach((t, i) => { if (t.end != null) T.span('codex.exec', t.start, t.end, { atom: atom.id, attempt, exit: t.exit, try: i + 1, ...(i === r.tries.length - 1 && r.firstStdoutEpoch > t.start ? { firstEventMs: r.firstStdoutEpoch - t.start } : {}) }); });
      }
      launchWallMs += r.wallMs;
      if (!isCodex) break;
      const accounts = [], failovers = [];
      try {
        const log = fs.readFileSync(path.join(process.env.CODEX_POOL_STATE_DIR || path.join(os.homedir(), '.codex-pool'), 'log'), 'utf8');
        for (const line of log.split('\n').filter((l) => l.includes(` pid=${r.poolPid} `))) {
          const account = line.match(/(?:^| )account=(\S+)/)?.[1];
          if (account) { accounts.push(account); if (/ failover=yes(?: |$)/.test(line)) failovers.push({ account, class: line.match(/ class=(\S+)/)?.[1] }); }
        }
      } catch (error) { if (error.code !== 'ENOENT') console.error(`codex-pool log unavailable: ${error.message}`); }
      meta.accounts.push(...accounts); meta.failovers.push(...failovers); meta.account = accounts.at(-1) ?? null;
      console.error(`codex ${atom.id} attempt=${attempt} tier=${sel.tier} (${sel.reason}) model=${sel.model} effort=${sel.effort} account=${meta.account ?? '?'} failover=${failovers.map((f) => `${f.account}:${f.class}`).join(',') || 'none'}`);
      if (r.exit === 75) meta.reason = 'codex-pool: all accounts exhausted or guard blocked (exit 75)';
      else if (r.exit === 77) meta.reason = 'codex-guard ledger denied';
      else if (r.exit !== 0 && /codex-pool: all accounts exhausted/.test(r.stderr)) meta.reason = 'codex-pool: all accounts exhausted';
      if (meta.reason) break;
      if (sel.tier !== 'deep' || r.exit === 0 || r.timedOut || meta.modelFallback || !/model.*(not (found|supported|available)|does not exist|unknown|invalid)|unsupported model/i.test(r.stdout + r.stderr)) break;
      fs.writeFileSync(path.join(RUN, 'atoms', atom.id, `model-rejected-${attempt}.txt`), r.stdout + r.stderr);
      fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
      sel = resolve(routed, attempt, routing, { fallback: true }); meta.modelFallback = true;
    }
    const workerEnd = nowEpoch(), postStart = workerEnd;
    r.wallMs = launchWallMs;
    if (isCodex && r.exit === 0 && !(atom.worker.tools ?? []).length) {
      const output = path.join(outDir, atom.outputs[0].path);
      if (fs.existsSync(output)) { const content = stripFences(fs.readFileSync(output, 'utf8')); fs.writeFileSync(output, content ? content + '\n' : ''); }
    }
    const usage = parseUsage(r.stdout, atom.worker.model);
    let cli = null; if (atom.worker.model !== 'codex' && atom.worker.model !== 'script') { try { const d = JSON.parse(r.stdout); cli = { durationMs: d.duration_ms ?? null, apiMs: d.duration_api_ms ?? null, turns: d.num_turns ?? null, subtype: d.subtype ?? null, isError: d.is_error ?? null, usage: d.usage ?? null, modelUsage: d.modelUsage ?? null, totalCostUsdList: d.total_cost_usd ?? null }; } catch {} }
    let codexEvents = null; if (atom.worker.model === 'codex') { codexEvents = { items: 0, reasoning: 0, commands: 0, webSearches: 0, errors: 0, usage: null }; for (const line of r.stdout.split('\n')) { try { const e = JSON.parse(line); if (e.type === 'item.completed') { codexEvents.items++; const t = e.item?.type; if (t === 'reasoning') codexEvents.reasoning++; if (t === 'command_execution') codexEvents.commands++; if (t === 'web_search') codexEvents.webSearches++; } if (e.type === 'error') codexEvents.errors++; if (e.type === 'turn.completed') codexEvents.usage = e.usage; } catch {} } }
    if (w.captureResultTo && usage?.result != null && !usage.isError) { const p = path.join(outDir, w.captureResultTo); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, stripFences(usage.result) + '\n'); }
    const missing = atom.outputs.filter((o) => { const p = path.join(outDir, o.path); return !fs.existsSync(p) || fs.statSync(p).size === 0; }).map((o) => o.path);
    const ok = r.exit === 0 && !r.timedOut && missing.length === 0 && !usage?.isError;
    fs.writeFileSync(path.join(RUN, 'atoms', atom.id, `stdout-${attempt}.txt`), r.stdout); fs.writeFileSync(path.join(RUN, 'atoms', atom.id, `stderr-${attempt}.txt`), r.stderr);
    if (w.prompt) fs.writeFileSync(path.join(RUN, 'atoms', atom.id, `prompt-${attempt}.md`), w.prompt);
    rec.attempts.push({ ...meta, attempt, exit: r.exit, signal: r.signal, timedOut: r.timedOut, wallMs: Math.round(r.wallMs), usage: usage && { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheCreate: usage.cacheCreate, thinking: usage.thinking, reasoning: usage.reasoning, costUsdList: usage.costUsdList, models: usage.models }, missing, ok, stderrTail: r.stderr.slice(-400) });
    T.span('worker', workerStart, workerEnd, { ...meta, atom: atom.id, attempt, backend: workerBackend, model: atom.worker.model, tier: meta.tier ?? null, tierReason: meta.tierReason ?? null, codexModel: meta.codexModel ?? null, effort: meta.effort ?? atom.worker.effort ?? null, account: meta.account ?? null, accounts: meta.accounts ?? [], modelFallback: meta.modelFallback ?? false, failovers: meta.failovers?.length ?? 0, exit: r.exit, ok, timedOut: r.timedOut });
    const att = rec.attempts.at(-1);
    emit('attempt.end', { ...meta, runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, atom: atom.id, kind: atom.kind, model: atom.worker.model, tools: atom.worker.tools ?? [], attempt, ok, exit: r.exit, signal: r.signal, timedOut: r.timedOut, stageMs, wallMs: att.wallMs,
      split: cli?.durationMs != null ? { modelApiMs: cli.apiMs, toolMs: Math.max(0, cli.durationMs - (cli.apiMs ?? 0)), harnessMs: Math.max(0, Math.round(r.wallMs) - cli.durationMs) } : null,
      cli, codex: codexEvents, promptBytes: w.prompt ? Buffer.byteLength(w.prompt) : 0, promptSha256: w.prompt ? createHash('sha256').update(w.prompt).digest('hex') : null, stdinBytes: w.stdin ? Buffer.byteLength(w.stdin) : 0,
      stdoutBytes: Buffer.byteLength(r.stdout), stderrBytes: Buffer.byteLength(r.stderr), missing, inputsStaged: staged.map((x) => ({ from: x.from, path: x.path, bytes: (() => { try { return fs.statSync(x.host).size; } catch { return null; } })() })),
      outputs: listFiles(outDir).map((f) => ({ path: f, bytes: fs.statSync(path.join(outDir, f)).size, sha256: sha256File(path.join(outDir, f)) })), cmd: w.cmd.map((c) => c.length > 200 ? `<${c.length} chars>` : c), stderrTail: r.stderr.slice(-300), load: load() });
    T.span('post', postStart, nowEpoch(), { atom: atom.id, attempt });
    if (ok && meta.account) codexAccounts[meta.account] = (codexAccounts[meta.account] ?? 0) + 1;
    if (ok || meta.reason) break;
  }
  const last = rec.attempts.at(-1);
  rec.ok = last.ok; rec.finishedAt = new Date().toISOString(); rec.wallMs = rec.attempts.reduce((s, a) => s + a.wallMs, 0);
  rec.outputs = Object.fromEntries(listFiles(outDir).map((f) => [f, sha256File(path.join(outDir, f))]));
  rec.inputs = (atom.inputs ?? []).map((i) => i.from === 'need' ? 'need' : i.output ? `${i.from}#${i.output}` : i.from);
  fs.writeFileSync(path.join(RUN, 'receipt', 'atoms', `${atom.id}.json`), JSON.stringify(rec, null, 1));
  emit('atom.end', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, atom: atom.id, kind: atom.kind, model: atom.worker.model, ok: rec.ok, attempts: rec.attempts.length, wallMs: rec.wallMs, endAtMs: Date.now() - runT0, outputs: rec.outputs });
  T.span('atom', atomStart, nowEpoch(), { atom: atom.id, kind: atom.kind, ok: rec.ok, attempts: rec.attempts.length, backend: atom.worker.model === 'codex' ? 'codex' : atom.worker.model === 'script' ? 'script' : 'claude', tier: last.tier, codexModel: last.codexModel, model: atom.worker.model, effort: last.effort ?? atom.worker.effort ?? null, account: last.account ?? null, accounts: [...new Set(rec.attempts.flatMap((a) => a.accounts ?? []))] });
  receipts[atom.id] = rec;
  return rec;
}
const t0 = Date.now();
const running = new Map();
let throttled = 0;                                   // headroom holds, for the receipt's lessons
const ready = () => doc.atoms.filter((a) => state.get(a.id) === 'pending' && deps(a).every((d) => state.get(d) === 'done'));
const blockDescendants = (id) => { for (const a of doc.atoms) if (state.get(a.id) === 'pending' && deps(a).includes(id)) { state.set(a.id, 'blocked'); emit('atom.blocked', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, atom: a.id, by: id }); blockDescendants(a.id); } };
const sample = () => T.mark('sched.sample', { running: running.size, ready: ready().length, done: [...state.values()].filter((s) => s === 'done').length });
try {
  while ([...state.values()].some((s) => s === 'pending' || s === 'running')) {
    for (const a of ready()) { readyAt[a.id] ??= Date.now(); traceReadyAt[a.id] ??= nowEpoch(); }
    let held = null;                                   // throttle (tools/throttle): no new atom without headroom; one always runs
    for (const a of ready()) {
      if (running.size >= CONC) break;
      const room = running.size ? headroom() : { ok: true };
      if (!room.ok) { held = room; throttled++; T.mark('sched.throttled', room); break; }
      state.set(a.id, 'running'); running.set(a.id, runAtom(a).then((rec) => ({ id: a.id, rec }))); sample();
    }
    if (!running.size) break;
    const next = await Promise.race([...running.values(), ...(held ? [new Promise((r) => setTimeout(r, 15_000, null))] : [])]);
    if (!next) continue;                               // recheck headroom
    const { id, rec } = next;
    running.delete(id);
    state.set(id, rec.ok ? 'done' : 'failed');
    if (!rec.ok) blockDescendants(id);
    sample();
    console.error(`${rec.ok ? 'done  ' : 'FAILED'} ${id} (${rec.wallMs} ms, attempts ${rec.attempts.length})`);
  }
} finally { fs.rmSync(homeTemplate, { recursive: true, force: true }); }
const wallMs = Date.now() - t0;
const sumAtomWall = Object.values(receipts).reduce((s, r) => s + r.wallMs, 0);
const criticalWall = P.criticalPath.reduce((s, id) => s + (receipts[id]?.wallMs ?? 0), 0);
const tok = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, calls: 0 };
for (const r of Object.values(receipts)) for (const a of r.attempts) if (a.usage) { tok.calls++; for (const k of ['input', 'output', 'cacheRead', 'cacheCreate']) tok[k] += Number(a.usage[k] ?? 0); }
const summary = { trace: T.enabled ? 'trace.jsonl' : null, codexAccounts, runDir: RUN, need: doc.need.id, atoms: doc.atoms.length, concurrency: CONC, statuses: Object.fromEntries(state), plan: { waves: P.waves, total: P.total, critical: P.critical, criticalPath: P.criticalPath, speedupBound: P.speedupBound, width: P.width }, wallMs, sumAtomWallMs: sumAtomWall, criticalPathWallMs: criticalWall, realizedSpeedup: sumAtomWall ? +(sumAtomWall / wallMs).toFixed(2) : null, tokens: tok, allDone: [...state.values()].every((s) => s === 'done') };
summary.runId = RUN_ID; summary.poolId = POOL_ID; summary.lessons = runLessons(receipts, { throttled });
fs.writeFileSync(path.join(RUN, 'receipt', 'run.json'), JSON.stringify(summary, null, 1));
emit('run.end', { runId: RUN_ID, poolId: POOL_ID, need: doc.need.id, allDone: summary.allDone, statuses: summary.statuses, wallMs, sumAtomWallMs: sumAtomWall, criticalPathWallMs: criticalWall, realizedSpeedup: summary.realizedSpeedup, speedupBound: P.speedupBound, tokens: tok, load: load() });
console.log(JSON.stringify({ allDone: summary.allDone, wallMs, sumAtomWallMs: sumAtomWall, realizedSpeedup: summary.realizedSpeedup, speedupBound: P.speedupBound, statuses: summary.statuses, tokens: tok }));
if (doc.atoms.some((a) => a.worker.model === 'codex')) console.error(`codexAccounts=${JSON.stringify(codexAccounts)}`);
T.span('run', traceRunT0, nowEpoch(), { concurrency: CONC, atoms: doc.atoms.length, backend, need: doc.need.id, allDone: summary.allDone, procStartEpoch: performance.timeOrigin }); T.close();
process.exit(summary.allDone ? 0 : 1);
