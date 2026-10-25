#!/usr/bin/env node
// Verify a finished run: every atom done, outputs match receipts, interfaces resolve, acceptance commands pass inside an isolate.
// usage: node verify.mjs <run-dir> [--policy file]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHomeTemplate, runIsolated, sha256File } from '../lib/isolate.mjs';
import { toolchainFor } from '../lib/workers.mjs';
import { emit, context, archiveRun } from '../lib/ledger.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.resolve(process.argv[2] ?? '');
if (!RUN || !fs.existsSync(path.join(RUN, 'atoms.json'))) { console.error('usage: verify.mjs <run-dir>'); process.exit(2); }
const doc = JSON.parse(fs.readFileSync(path.join(RUN, 'atoms.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8'));
const REPO = path.resolve(HERE, '../../..');
const TOOLCHAIN = toolchainFor(['node'], policy, REPO);
const run = JSON.parse(fs.readFileSync(path.join(RUN, 'receipt', 'run.json'), 'utf8'));
const fails = [], notes = [];
for (const a of doc.atoms) {
  if (run.statuses[a.id] !== 'done') { fails.push(`${a.id}: status ${run.statuses[a.id]}`); continue; }
  const rec = JSON.parse(fs.readFileSync(path.join(RUN, 'receipt', 'atoms', `${a.id}.json`), 'utf8'));
  for (const o of a.outputs) { const p = path.join(RUN, 'atoms', a.id, 'out', o.path); if (!fs.existsSync(p)) fails.push(`${a.id}: output ${o.path} missing`); else if (sha256File(p) !== rec.outputs[o.path]) fails.push(`${a.id}: output ${o.path} changed since its receipt`); }
  for (const i of a.inputs ?? []) if (i.from !== 'need') { const prod = doc.atoms.find((x) => x.id === i.from); for (const o of prod.outputs) if (!i.output || o.name === i.output) { const s = path.join(RUN, 'atoms', a.id, 'in', prod.id, o.path); if (!fs.existsSync(s)) fails.push(`${a.id}: staged input ${prod.id}/${o.path} missing`); } }
}
const compose = doc.atoms.find((a) => a.kind === 'compose' || a.kind === 'direct');
const homeTemplate = makeHomeTemplate(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-home-')));
const acceptance = [];
try {
  for (const acc of doc.acceptance) {
    if (acc.check.kind !== 'command') { acceptance.push({ id: acc.id, kind: acc.check.kind, result: 'not executed here' }); notes.push(`${acc.id}: ${acc.check.kind} check not executed by verify.mjs`); continue; }
    const mounts = compose && run.statuses[compose.id] === 'done' ? [{ host: path.join(RUN, 'atoms', compose.id, 'out'), guest: `/in/${compose.id}`, mode: 'ro' }] : [];
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-work-'));
    const r = await runIsolated({ homeTemplate, mounts: [...mounts, { host: work, guest: '/work', mode: 'rw' }], toolchain: TOOLCHAIN, cmd: ['/bin/sh', '-c', acc.check.run], cwd: '/work', timeoutMs: 120_000 });
    fs.rmSync(work, { recursive: true, force: true });
    const ok = r.exit === 0; acceptance.push({ id: acc.id, kind: 'command', run: acc.check.run, exit: r.exit, ok, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 400) });
    if (!ok) fails.push(`acceptance ${acc.id} failed (exit ${r.exit}): ${r.stderr.trim().slice(0, 200) || r.stdout.trim().slice(0, 200)}`);
  }
} finally { fs.rmSync(homeTemplate, { recursive: true, force: true }); }
const report = { runDir: RUN, ok: fails.length === 0, fails, notes, acceptance, checkedAt: new Date().toISOString() };
fs.writeFileSync(path.join(RUN, 'receipt', 'verify.json'), JSON.stringify(report, null, 1));
const gatesFile = compose ? path.join(RUN, 'atoms', compose.id, 'out', 'gates.json') : null;
const gates = gatesFile && fs.existsSync(gatesFile) ? JSON.parse(fs.readFileSync(gatesFile, 'utf8')) : null;
const reviews = doc.atoms.filter((a) => a.kind === 'review').map((a) => { const p = path.join(RUN, 'atoms', a.id, 'out', a.outputs[0].path); let j = null; try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} return { atom: a.id, model: a.worker.model, persona: j?.persona ?? null, verdict: j?.verdict ?? null, change: j?.change ?? null }; });
emit('verify.end', { runId: run.runId ?? null, poolId: run.poolId ?? null, need: doc.need.id, ok: report.ok, fails, acceptance: acceptance.map((a) => ({ id: a.id, kind: a.kind, ok: a.ok ?? null, exit: a.exit ?? null })), gates: gates ? { promotable: gates.promotable, byGate: Object.fromEntries(Object.entries(gates.gates ?? {}).map(([k, v]) => [k, v.ok])), testsPassed: gates.gates?.G4_tests?.passed ?? null, testsTotal: gates.gates?.G4_tests?.total ?? null } : null, reviews, context: context() });
if (!process.argv.includes('--no-archive')) { const ar = archiveRun(RUN, run.runId ?? path.basename(RUN)); emit(ar.refused ? 'archive.refused' : 'run.archived', { runId: run.runId ?? null, poolId: run.poolId ?? null, need: doc.need.id, ...ar }); }
console.log(JSON.stringify({ ok: report.ok, fails, acceptance: acceptance.map((a) => ({ id: a.id, ok: a.ok ?? a.result })) }));
process.exit(report.ok ? 0 : 1);
