#!/usr/bin/env node
// Speed decomposition. North star: wall per request (and per pool). Underneath: where every second went, so improvements can be focused.
// usage: node speed.mjs <run-dir | fanout-dir>... [--out SPEED.md] [--json speed.json]
//
// Per atom attempt (from receipts + the CLI's own JSON in stdout-N.txt):
//   depWaitMs     run start -> all inputs ready            (structure: how deep the atom sits)
//   queueMs       ready -> started                          (concurrency limit; zero means no queueing)
//   modelApiMs    Claude duration_api_ms                    (time inside model calls)
//   toolMs        duration_ms - duration_api_ms             (agent's local tool time: compiles, test runs, file edits)
//   harnessMs     attempt wall - duration_ms                (bwrap + CLI start + auth + teardown)
//   codexTurnMs   whole Codex attempt (the JSONL has no timings; reported as one bucket)
//   scriptMs      whole script attempt
//   retryMs       wall of failed attempts before the last one
//   turns         agent turns (Claude num_turns)
// Per run: wall, the realized critical chain (walk back from the last atom through the input that finished last),
//   and that chain's time split into the buckets above. Shortening anything off the chain does not move wall.
import fs from 'node:fs';
import path from 'node:path';
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(a); } return o; }
const A = args(process.argv.slice(2));
const runDirs = [];
for (const d of A._) { const p = path.resolve(d); if (fs.existsSync(path.join(p, 'receipt', 'run.json'))) runDirs.push(p); else if (fs.existsSync(path.join(p, 'fanout.json'))) for (const e of fs.readdirSync(p)) if (fs.existsSync(path.join(p, e, 'receipt', 'run.json'))) runDirs.push(path.join(p, e)); }
if (!runDirs.length) { console.error('usage: speed.mjs <run-dir|fanout-dir>... [--out SPEED.md] [--json speed.json]'); process.exit(2); }
const deps = (a) => (a.inputs ?? []).filter((i) => i.from && i.from !== 'need').map((i) => i.from);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const BUCKETS = ['queueMs', 'modelApiMs', 'toolMs', 'harnessMs', 'codexTurnMs', 'scriptMs', 'retryMs'];
function analyseRun(dir) {
  const run = readJson(path.join(dir, 'receipt', 'run.json')); const doc = readJson(path.join(dir, 'atoms.json'));
  const recs = {}; for (const f of fs.readdirSync(path.join(dir, 'receipt', 'atoms'))) { const r = readJson(path.join(dir, 'receipt', 'atoms', f)); recs[r.id] = r; }
  const t0 = Math.min(...Object.values(recs).map((r) => Date.parse(r.readyAt ?? r.startedAt)));
  const byId = Object.fromEntries(doc.atoms.map((a) => [a.id, a]));
  const atoms = [];
  for (const a of doc.atoms) {
    const r = recs[a.id]; if (!r) continue;
    const start = Date.parse(r.startedAt), end = Date.parse(r.finishedAt);
    const depEnds = deps(a).map((d) => recs[d] ? Date.parse(recs[d].finishedAt) : t0);
    const ready = r.readyAt ? Date.parse(r.readyAt) : (depEnds.length ? Math.max(...depEnds) : t0);
    const x = { id: a.id, kind: a.kind, model: a.worker.model, tools: (a.worker.tools ?? []).length > 0, start: start - t0, end: end - t0, wallMs: end - start, depWaitMs: ready - t0, queueMs: Math.max(0, start - ready), modelApiMs: 0, toolMs: 0, harnessMs: 0, codexTurnMs: 0, scriptMs: 0, retryMs: 0, turns: 0, attempts: r.attempts.length, ok: r.ok };
    r.attempts.forEach((at, i) => {
      const last = i === r.attempts.length - 1;
      if (!last) { x.retryMs += at.wallMs; return; }
      if (r.preflight && !r.preflight.hit) x.retryMs += r.preflight.wallMs;
      if (a.worker.model === 'script' || at.preflight) { x.scriptMs += at.wallMs; return; }
      if (a.worker.model === 'codex') { x.codexTurnMs += at.wallMs; return; }
      const cli = readJson(path.join(dir, 'atoms', a.id, `stdout-${at.attempt}.txt`));
      if (cli?.duration_ms != null) { x.modelApiMs += cli.duration_api_ms ?? 0; x.toolMs += Math.max(0, (cli.duration_ms ?? 0) - (cli.duration_api_ms ?? 0)); x.harnessMs += Math.max(0, at.wallMs - cli.duration_ms); x.turns += cli.num_turns ?? 0; }
      else x.harnessMs += at.wallMs;
    });
    atoms.push(x);
  }
  const A2 = Object.fromEntries(atoms.map((x) => [x.id, x]));
  // realized critical chain: from the atom that finished last, walk back through the input that finished last
  let cur = atoms.reduce((m, x) => (x.end > (m?.end ?? -1) ? x : m), null); const chain = [];
  while (cur) { chain.unshift(cur); const ds = deps(byId[cur.id]).map((d) => A2[d]).filter(Boolean); cur = ds.length ? ds.reduce((m, x) => (x.end > m.end ? x : m)) : null; }
  const chainSplit = Object.fromEntries(BUCKETS.map((b) => [b, chain.reduce((s, x) => s + x[b], 0)]));
  const wallMs = Math.max(...atoms.map((x) => x.end));
  chainSplit.gapMs = Math.max(0, wallMs - Object.values(chainSplit).reduce((s, v) => s + v, 0)); // scheduler gaps, staging, receipt writing
  return { id: run.need, dir, wallMs, atoms, chain: chain.map((x) => x.id), chainSplit, chainKinds: chain.map((x) => `${x.id}:${x.kind}`) };
}
const runs = runDirs.map(analyseRun);
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1));
// aggregate on-chain time by kind and bucket: this is where wall actually goes
const onChain = {}; const allAtoms = runs.flatMap((r) => r.atoms.map((a) => ({ ...a, onChain: r.chain.includes(a.id), run: r.id })));
for (const r of runs) for (const id of r.chain) { const a = r.atoms.find((x) => x.id === id); const k = a.kind; onChain[k] ??= { n: 0, wall: 0, ...Object.fromEntries(BUCKETS.map((b) => [b, 0])) }; onChain[k].n++; onChain[k].wall += a.wallMs; for (const b of BUCKETS) onChain[k][b] += a[b]; }
const totalChain = runs.reduce((s, r) => s + r.wallMs, 0);
const bucketTotals = Object.fromEntries([...BUCKETS, 'gapMs'].map((b) => [b, runs.reduce((s, r) => s + r.chainSplit[b], 0)]));
const L = ['# Speed decomposition', '', `Runs: ${runs.length} (${runs.map((r) => r.id).join(', ')}). North star: wall per request. Every number is **Recorded (probe)** from atom receipts and the CLI's own timing fields; Codex attempts carry no internal timings and appear as one bucket.`, '',
  '## North star', '', '| Request | Wall (s) | Atoms | Realized critical chain |', '|---|---|---|---|'];
for (const r of runs) L.push(`| ${r.id} | ${sec(r.wallMs)} | ${r.atoms.length} | ${r.chainKinds.join(' → ')} |`);
const walls = runs.map((r) => r.wallMs); L.push('', `Median wall ${sec(q(walls, 0.5))} s; max ${sec(Math.max(...walls))} s.`, '',
  '## Where the wall goes (critical-chain time summed over runs)', '', 'Only time on the critical chain moves wall. Off-chain work is free until it becomes the chain.', '', '| Bucket | Seconds | Share |', '|---|---|---|');
for (const [b, v] of Object.entries(bucketTotals).sort((x, y) => y[1] - x[1])) if (v > 0) L.push(`| ${b.replace(/Ms$/, '')} | ${sec(v)} | ${(100 * v / totalChain).toFixed(0)} % |`);
L.push('', '## On-chain time by atom kind', '', '| Kind | Times on chain | Wall (s) | model API | local tools | harness | codex | script | retry | queue |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(onChain).sort((x, y) => y[1].wall - x[1].wall)) L.push(`| ${k} | ${v.n} | ${sec(v.wall)} | ${sec(v.modelApiMs)} | ${sec(v.toolMs)} | ${sec(v.harnessMs)} | ${sec(v.codexTurnMs)} | ${sec(v.scriptMs)} | ${sec(v.retryMs)} | ${sec(v.queueMs)} |`);
L.push('', '## Atom wall by kind and worker (all atoms, on or off chain)', '', '| Kind | Worker | n | p50 (s) | p95 (s) | max (s) | turns p50 | API share |', '|---|---|---|---|---|---|---|---|');
const groups = {}; for (const a of allAtoms) (groups[`${a.kind}|${a.model}${a.tools ? '+tools' : ''}`] ??= []).push(a);
for (const [g, xs] of Object.entries(groups).sort((x, y) => q(y[1].map((a) => a.wallMs), 0.5) - q(x[1].map((a) => a.wallMs), 0.5))) { const [k, m] = g.split('|'); const w = xs.map((a) => a.wallMs); const api = xs.reduce((s, a) => s + a.modelApiMs, 0), tot = xs.reduce((s, a) => s + a.wallMs, 0); L.push(`| ${k} | ${m} | ${xs.length} | ${sec(q(w, 0.5))} | ${sec(q(w, 0.95))} | ${sec(Math.max(...w))} | ${q(xs.map((a) => a.turns), 0.5) ?? '—'} | ${m === 'codex' || m === 'script' ? '—' : (100 * api / tot).toFixed(0) + ' %'} |`); }
L.push('', '## Slowest atoms', '', '| Run | Atom | Kind | Worker | Wall (s) | API (s) | tools (s) | harness (s) | turns | on chain |', '|---|---|---|---|---|---|---|---|---|---|');
for (const a of [...allAtoms].sort((x, y) => y.wallMs - x.wallMs).slice(0, 12)) L.push(`| ${a.run} | ${a.id} | ${a.kind} | ${a.model}${a.tools ? '+tools' : ''} | ${sec(a.wallMs)} | ${sec(a.modelApiMs)} | ${sec(a.toolMs)} | ${sec(a.harnessMs)} | ${a.turns || '—'} | ${a.onChain ? 'yes' : ''} |`);
const out = L.join('\n') + '\n';
if (A.out) { fs.mkdirSync(path.dirname(path.resolve(A.out)), { recursive: true }); fs.writeFileSync(A.out, out); } if (A.json) fs.writeFileSync(A.json, JSON.stringify({ runs, onChain, bucketTotals }, null, 1));
process.stdout.write(out);
