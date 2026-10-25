#!/usr/bin/env node
// Cutover experiment: for each case run the direct arm and the atomized arm (atomize + DAG) concurrently, paired, on the same gates; ledger everything.
// usage: node cutover.mjs <ladder.json> --out-dir <dir> [--cases id,id] [--rep 1] [--parallel-cases 2] [--dag-concurrency 6]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emit, context, load, newId } from '../lib/ledger.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2); const get = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ladderPath = path.resolve(argv[0]); const ladder = JSON.parse(fs.readFileSync(ladderPath, 'utf8'));
const OUT = path.resolve(get('out-dir')); const REP = Number(get('rep', 1)); const PAR = Number(get('parallel-cases', 2)); const DAGC = Number(get('dag-concurrency', 6));
const only = get('cases') ? new Set(get('cases').split(',')) : null;
const cases = ladder.cases.filter((c) => !only || only.has(c.id));
const EXP = get('experiment-id') ?? newId('cutover');
const node = (args, logFile) => new Promise((resolve) => { const t0 = Date.now(); const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; }); p.on('close', (code) => { if (logFile) fs.writeFileSync(logFile, o + '\n--- stderr\n' + e); let j = null; try { j = JSON.parse(o.trim().split('\n').at(-1)); } catch {} resolve({ code, wallMs: Date.now() - t0, json: j }); }); });
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
function dagTimes(runDir) {
  const doc = readJson(path.join(runDir, 'atoms.json')); const run = readJson(path.join(runDir, 'receipt', 'run.json')); if (!doc || !run) return {};
  const recs = {}; for (const f of fs.readdirSync(path.join(runDir, 'receipt', 'atoms'))) { const r = readJson(path.join(runDir, 'receipt', 'atoms', f)); recs[r.id] = r; }
  const t0 = Math.min(...Object.values(recs).map((r) => Date.parse(r.readyAt ?? r.startedAt)));
  const comp = doc.atoms.find((a) => a.kind === 'compose' || a.kind === 'direct'); const g = comp ? readJson(path.join(runDir, 'atoms', comp.id, 'out', 'gates.json')) : null;
  return { dagWallMs: run.wallMs, gatedAtMs: comp && recs[comp.id] ? Date.parse(recs[comp.id].finishedAt) - t0 : null, promotable: g?.promotable ?? false, testsPassed: g?.gates?.G4_tests?.passed ?? null, testsTotal: g?.gates?.G4_tests?.total ?? null, exports: g?.exports?.length ?? null, atoms: doc.atoms.length, calls: run.tokens?.calls, tokOut: run.tokens?.output, tokIn: run.tokens?.input, tokCacheRead: run.tokens?.cacheRead, runId: run.runId, verify: readJson(path.join(runDir, 'receipt', 'verify.json'))?.ok ?? null };
}
async function armDirect(c, dir) {
  const atoms = path.join(dir, 'direct-atoms.json'); await node([path.join(HERE, 'direct.mjs'), path.join(path.dirname(ladderPath), `${c.id}.md`), '--out', atoms]);
  const runDir = path.join(dir, 'direct'); const s = await node([path.join(HERE, 'schedule.mjs'), 'run', atoms, '--run-dir', runDir, '--concurrency', '1', '--retries', '0', '--pool-id', EXP], path.join(dir, 'direct-schedule.log'));
  await node([path.join(HERE, 'verify.mjs'), runDir], path.join(dir, 'direct-verify.log'));
  const t = dagTimes(runDir); return { arm: 'direct', planMs: 0, ...t, gatedTotalMs: t.gatedAtMs, endToEndMs: s.wallMs };
}
async function armAtomized(c, dir) {
  const ex = path.join(dir, 'atomized-plan'); const a = await node([path.join(HERE, 'atomize.mjs'), path.join(path.dirname(ladderPath), `${c.id}.md`), '--out', ex, '--model', 'sonnet'], path.join(dir, 'atomize.log'));
  const plan = readJson(path.join(ex, 'receipt', 'atomize.json')); const planMs = (plan?.attempts ?? []).reduce((s, x) => s + (x.wallMs ?? 0), 0);
  if (!fs.existsSync(path.join(ex, 'atoms.json')) || !plan?.valid) return { arm: 'atomized', planMs, planValid: false, promotable: false, gatedTotalMs: null, endToEndMs: a.wallMs };
  const runDir = path.join(dir, 'atomized'); const s = await node([path.join(HERE, 'schedule.mjs'), 'run', path.join(ex, 'atoms.json'), '--run-dir', runDir, '--concurrency', String(DAGC), '--pool-id', EXP], path.join(dir, 'atomized-schedule.log'));
  await node([path.join(HERE, 'verify.mjs'), runDir], path.join(dir, 'atomized-verify.log'));
  const t = dagTimes(runDir); const pl = readJson(path.join(ex, 'plan.json'));
  return { arm: 'atomized', planMs, planValid: true, planAtoms: pl?.order?.length ?? null, planTotal: pl?.total, planCritical: pl?.critical, speedupBound: pl?.speedupBound, ...t, gatedTotalMs: t.gatedAtMs != null ? planMs + t.gatedAtMs : null, endToEndMs: a.wallMs + s.wallMs, planTokOut: (plan?.attempts ?? []).reduce((s2, x) => s2 + (x.usage?.output ?? 0), 0) };
}
async function armTemplated(c, dir) {
  const ex = path.join(dir, 'templated-plan'); const a = await node([path.join(HERE, 'plan-template.mjs'), path.join(path.dirname(ladderPath), `${c.id}.md`), '--out', ex], path.join(dir, 'plan-template.log'));
  const plan = readJson(path.join(ex, 'receipt', 'atomize.json')); const planMs = plan?.attempts?.[0]?.wallMs ?? a.wallMs;
  if (!plan?.valid) return { arm: 'templated', planMs, planValid: false, promotable: false, gatedTotalMs: null, endToEndMs: a.wallMs };
  const runDir = path.join(dir, 'templated'); const s = await node([path.join(HERE, 'schedule.mjs'), 'run', path.join(ex, 'atoms.json'), '--run-dir', runDir, '--concurrency', String(DAGC), '--timeout-ms', String(get('atom-timeout-ms', 240000)), '--pool-id', EXP], path.join(dir, 'templated-schedule.log'));
  await node([path.join(HERE, 'verify.mjs'), runDir], path.join(dir, 'templated-verify.log'));
  const t = dagTimes(runDir);
  return { arm: 'templated', planMs, planValid: true, exportsPlanned: plan.exports, modules: plan.modules, ...t, gatedTotalMs: t.gatedAtMs != null ? planMs + t.gatedAtMs : null, endToEndMs: a.wallMs + s.wallMs, planTokOut: plan?.attempts?.[0]?.usage?.output ?? null };
}
const ARMS = (get('arms', 'direct,atomized')).split(',');
emit('cutover.start', { experimentId: EXP, ladder: path.relative(process.cwd(), ladderPath), cases: cases.map((c) => c.id), rep: REP, parallelCases: PAR, dagConcurrency: DAGC, context: context(), load: load() });
const results = []; const queue = [...cases]; const active = new Set();
await new Promise((done) => { const pump = () => { while (active.size < PAR && queue.length) { const c = queue.shift(); const dir = path.join(OUT, `${c.id}-r${REP}`); fs.mkdirSync(dir, { recursive: true }); const l0 = load();
  const fns = { direct: armDirect, atomized: armAtomized, templated: armTemplated };
  const p = Promise.all(ARMS.map((k) => fns[k](c, dir))).then((res) => { const by = Object.fromEntries(res.map((r) => [r.arm, r])); const d = by.direct ?? { promotable: false }; const at = by.atomized ?? by.templated; const prom = res.filter((r) => r.promotable && r.gatedTotalMs != null).sort((x, y) => x.gatedTotalMs - y.gatedTotalMs); const rec = { experimentId: EXP, case: c.id, tier: c.tier, rep: REP, loadStart: l0, arms: ARMS, ...by, winnerGated: prom[0]?.arm ?? 'neither', load: load() };
    emit('cutover.case', rec); results.push(rec); fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(rec, null, 1));
    console.error(`${c.id} r${REP}: ` + res.map((r) => `${r.arm} ${r.planMs ? (r.planMs / 1000).toFixed(1) + '+' : ''}${r.gatedTotalMs != null ? (r.gatedTotalMs / 1000).toFixed(0) : '-'} s P=${r.promotable}`).join(' | ') + ` -> ${rec.winnerGated}`);
    active.delete(p); if (!queue.length && !active.size) done(); else pump(); }); active.add(p); } }; pump(); });
fs.writeFileSync(path.join(OUT, `results-r${REP}.json`), JSON.stringify(results, null, 1));
emit('cutover.end', { experimentId: EXP, rep: REP, cases: results.length, load: load() });
console.log(JSON.stringify(results.map((r) => ({ case: r.case, rep: r.rep, ...Object.fromEntries(r.arms.map((k) => [k, { s: r[k]?.gatedTotalMs != null ? Math.round(r[k].gatedTotalMs / 1000) : null, P: r[k]?.promotable }])), winner: r.winnerGated }))));
