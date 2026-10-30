#!/usr/bin/env node
// Markdown report for one run directory: timeline per atom, waves, tokens, realized speedup against the sequential equivalent.
import fs from 'node:fs';
import path from 'node:path';
const RUN = path.resolve(process.argv[2] ?? '');
if (!RUN || !fs.existsSync(path.join(RUN, 'receipt', 'run.json'))) { console.error('usage: report.mjs <run-dir>'); process.exit(2); }
const run = JSON.parse(fs.readFileSync(path.join(RUN, 'receipt', 'run.json'), 'utf8'));
const doc = JSON.parse(fs.readFileSync(path.join(RUN, 'atoms.json'), 'utf8'));
const recs = fs.readdirSync(path.join(RUN, 'receipt', 'atoms')).map((f) => JSON.parse(fs.readFileSync(path.join(RUN, 'receipt', 'atoms', f), 'utf8')));
const t0 = Math.min(...recs.map((r) => Date.parse(r.startedAt)));
const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
const tok = (r) => { let i = 0, o = 0, cr = 0, cc = 0; for (const a of r.attempts) if (a.usage) { i += a.usage.input ?? 0; o += a.usage.output ?? 0; cr += a.usage.cacheRead ?? 0; cc += a.usage.cacheCreate ?? 0; } return { i, o, cr, cc }; };
const L = [`# Run report: ${run.need}`, '', `Atoms ${run.atoms}; concurrency ${run.concurrency}; wall ${(run.wallMs / 1000).toFixed(1)} s; sequential equivalent ${(run.sumAtomWallMs / 1000).toFixed(1)} s; realized speedup ${run.realizedSpeedup}x (planned bound ${run.plan.speedupBound}x); critical path realized ${(run.criticalPathWallMs / 1000).toFixed(1)} s (${run.plan.criticalPath.join(' → ')}); all done: ${run.allDone}.`, '',
  `Tokens: ${run.tokens.calls} model calls; input ${run.tokens.input}; output ${run.tokens.output}; cache read ${run.tokens.cacheRead}; cache creation ${run.tokens.cacheCreate}.`, '',
  '| Atom | Kind | Worker | Start (s) | End (s) | Wall (s) | Attempts | Status | in / out / cache-read tokens |', '|---|---|---|---|---|---|---|---|---|'];
for (const a of doc.atoms) {
  const r = byId[a.id]; if (!r) { L.push(`| ${a.id} | ${a.kind} | ${a.worker.model} | — | — | — | — | ${run.statuses[a.id]} | — |`); continue; }
  const t = tok(r); const s = (Date.parse(r.startedAt) - t0) / 1000, e = (Date.parse(r.finishedAt) - t0) / 1000;
  L.push(`| ${a.id} | ${a.kind} | ${a.worker.model}${a.worker.tools?.length ? '+tools' : ''} | ${s.toFixed(1)} | ${e.toFixed(1)} | ${(r.wallMs / 1000).toFixed(1)} | ${r.attempts.length} | ${run.statuses[a.id]} | ${t.i} / ${t.o} / ${t.cr} |`);
}
L.push('', '## Waves (planned)', '');
for (const [l, ids] of Object.entries(run.plan.waves)) L.push(`- wave ${l}: ${ids.join(', ')}`);
const v = fs.existsSync(path.join(RUN, 'receipt', 'verify.json')) ? JSON.parse(fs.readFileSync(path.join(RUN, 'receipt', 'verify.json'), 'utf8')) : null;
if (v) { L.push('', '## Verification', '', `ok: ${v.ok}`); for (const a of v.acceptance) L.push(`- ${a.id}: ${a.kind === 'command' ? (a.ok ? 'pass' : `FAIL (exit ${a.exit}) ${(a.stderr || a.stdout || '').trim().slice(0, 160)}`) : a.result}`); for (const f of v.fails) L.push(`- fail: ${f}`); }
const gatesPath = (() => { const c = doc.atoms.find((x) => x.kind === 'compose'); const p = c && path.join(RUN, 'atoms', c.id, 'out', 'gates.json'); return p && fs.existsSync(p) ? p : null; })();
if (gatesPath) { const g = JSON.parse(fs.readFileSync(gatesPath, 'utf8')); L.push('', '## Gates (compose)', '', `promotable: ${g.promotable}`); for (const [k, x] of Object.entries(g.gates ?? {})) L.push(`- ${k}: ${x.ok ? 'ok' : 'FAIL ' + JSON.stringify(x).slice(0, 200)}`); }
const out = L.join('\n') + '\n';
fs.writeFileSync(path.join(RUN, 'receipt', 'REPORT.md'), out);
process.stdout.write(out);
