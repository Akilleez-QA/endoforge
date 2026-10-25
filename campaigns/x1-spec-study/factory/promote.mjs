#!/usr/bin/env node
// Promotion pass, run by the coordinator after the workers and the persona agent finish.
//   node factory/promote.mjs            verify every work/factory/<id>/, re-run the gates, apply the persona stage, write work/factory/INDEX.md and receipt/factory-summary.json
//
// Stage 1, gated: frozen.sha256 matches the files, the gates G1–G7 pass when re-run here (not just in the worker's result.json),
//   outcome.json claims promoted or promoted-with-assumption, and the worker recorded start and stop events for the id.
// Stage 2, persona-accepted: work/factory/<id>/persona.json exists and records no "reject" from any persona consulted.
//   every verdict accept                      -> promoted / promoted-with-assumption (listed under "Promoted")
//   no reject, at least one accept-with-change -> promoted-pending-change (listed separately, changes named)
//   any reject                                 -> gated-rejected-by-persona (not promoted)
//   no persona.json                            -> gated-unreviewed (not promoted)
// "promoted" in the counts and INDEX.md means gated AND persona-accepted (L-13).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACT = path.join(KIT, 'work', 'factory');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const events = fs.existsSync(path.join(KIT, 'receipt', 'events.jsonl')) ? fs.readFileSync(path.join(KIT, 'receipt', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const seconds = {}; const voids = {};
{ const open = {}; for (const e of events) { if (e.type === 'void') { seconds[e.id] = 0; voids[e.id] = (voids[e.id] || 0) + 1; delete open[e.id]; continue; } if (e.type === 'start' || e.type === 'resume') open[e.id] = Date.parse(e.at); if ((e.type === 'pause' || e.type === 'stop') && open[e.id] != null) { seconds[e.id] = (seconds[e.id] || 0) + (Date.parse(e.at) - open[e.id]) / 1000; delete open[e.id]; } } }
const VERDICTS = new Set(['accept', 'accept-with-change', 'reject']);

const rows = [];
for (const id of fs.readdirSync(FACT).filter(d => fs.statSync(path.join(FACT, d)).isDirectory()).sort()) {
  const d = path.join(FACT, id);
  const f = (n) => path.join(d, n);
  const row = { id, gated: false, verified: false, outcome: null, status: null, reasons: [], persona: null };
  try {
    if (!fs.existsSync(f('outcome.json'))) { row.reasons.push('no outcome.json (worker did not finish)'); row.status = 'unfinished'; rows.push(row); continue; }
    const outcome = JSON.parse(fs.readFileSync(f('outcome.json'), 'utf8'));
    row.outcome = outcome.outcome; row.usage = outcome.usage; row.question = outcome.question; row.rounds = outcome.rounds; row.self = outcome.self;
    if (!fs.existsSync(f('frozen.sha256'))) row.reasons.push('not frozen');
    else {
      const fr = JSON.parse(fs.readFileSync(f('frozen.sha256'), 'utf8'));
      if (sha(f('CONTRACT.md')) !== fr.contract) row.reasons.push('CONTRACT.md changed after freeze');
      if (sha(f('tests.json')) !== fr.tests) row.reasons.push('tests.json changed after freeze');
      const k = fs.existsSync(f('kernel.ts')) ? fs.statSync(f('kernel.ts')).mtimeMs : 0;
      if (k && k < Date.parse(fr.at) - 1000) row.reasons.push('kernel.ts predates the freeze');
      row.frozen = { contract: fr.contract, tests: fr.tests, at: fr.at };
    }
    const st = events.filter(e => e.id === id);
    if (!st.some(e => e.type === 'start') || !st.some(e => e.type === 'stop')) row.reasons.push('missing start/stop events');
    row.seconds = seconds[id] ?? null; row.voids = voids[id] ?? 0;
    let gate = null;
    try { execFileSync(process.execPath, [path.join(KIT, 'factory', 'gate.mjs'), 'run', d], { stdio: ['ignore', 'pipe', 'pipe'] }); gate = JSON.parse(fs.readFileSync(f('result.json'), 'utf8')); }
    catch { gate = fs.existsSync(f('result.json')) ? JSON.parse(fs.readFileSync(f('result.json'), 'utf8')) : null; }
    row.gates = gate ? Object.fromEntries(Object.entries(gate.gates).map(([g, v]) => [g, v.ok])) : null;
    row.gateFailures = gate ? Object.entries(gate.gates).filter(([, v]) => !v.ok).map(([g, v]) => `${g}: ${v.why ?? 'failed'}`) : ['no result.json'];
    row.tests = gate ? `${gate.gates.G4_tests?.passed ?? 0}/${gate.gates.G4_tests?.total ?? 0}` : null;
    row.wasmSha256 = gate?.gates?.G2_compiles?.wasmSha256 ?? null;
    row.wasmBytes = gate?.gates?.G2_compiles?.wasmBytes ?? null;
    row.glueSha256 = fs.existsSync(f('glue.json')) ? sha(f('glue.json')) : null;
    const claimsPromoted = outcome.outcome === 'promoted' || outcome.outcome === 'promoted-with-assumption';
    if (claimsPromoted && !gate?.promotable) row.reasons.push(`worker claimed promotion but gates fail on re-run (${row.gateFailures.join('; ')})`);
    if (!claimsPromoted && gate?.promotable && outcome.outcome === 'rejected') row.reasons.push('worker rejected a promotable kernel (noted, not blocking)');
    row.gated = row.reasons.filter(r => !r.includes('not blocking')).length === 0 && claimsPromoted && Boolean(gate?.promotable);

    // Stage 2: persona acceptance.
    if (fs.existsSync(f('persona.json'))) {
      const p = JSON.parse(fs.readFileSync(f('persona.json'), 'utf8'));
      const vs = Array.isArray(p.verdicts) ? p.verdicts : [];
      const bad = vs.filter(v => !v.persona || !VERDICTS.has(v.verdict));
      if (p.id !== id) row.reasons.push(`persona.json id ${p.id} is not ${id}`);
      if (!vs.length) row.reasons.push('persona.json has no verdicts');
      if (bad.length) row.reasons.push(`persona.json has ${bad.length} malformed verdict(s)`);
      row.persona = { at: p.at ?? null, reviewer: p.reviewer ?? null, calls: p.calls ?? null, personas: vs.map(v => v.persona), accept: vs.filter(v => v.verdict === 'accept').length, acceptWithChange: vs.filter(v => v.verdict === 'accept-with-change').length, reject: vs.filter(v => v.verdict === 'reject').length, changes: vs.filter(v => v.verdict !== 'accept' && v.change).map(v => `${v.persona}: ${v.change}`) };
    }
    if (!row.gated) row.status = outcome.outcome === 'rejected' ? 'rejected' : outcome.outcome === 'underdetermined' ? 'underdetermined' : 'unverified';
    else if (!row.persona || row.reasons.some(r => r.startsWith('persona.json'))) row.status = 'gated-unreviewed';
    else if (row.persona.reject > 0) row.status = 'gated-rejected-by-persona';
    else if (row.persona.acceptWithChange > 0) row.status = 'promoted-pending-change';
    else row.status = outcome.outcome; // promoted | promoted-with-assumption
    row.verified = row.status === 'promoted' || row.status === 'promoted-with-assumption' || row.status === 'promoted-pending-change';
  } catch (e) { row.reasons.push(`error: ${e.message}`); row.status = row.status ?? 'unverified'; }
  rows.push(row);
}

const by = (s) => rows.filter(r => r.status === s);
const counts = {
  folders: rows.length,
  gated: rows.filter(r => r.gated).length,
  promoted: by('promoted').length,
  promotedWithAssumption: by('promoted-with-assumption').length,
  promotedPendingChange: by('promoted-pending-change').length,
  gatedRejectedByPersona: by('gated-rejected-by-persona').length,
  gatedUnreviewed: by('gated-unreviewed').length,
  underdetermined: by('underdetermined').length,
  rejected: by('rejected').length,
  unverified: by('unverified').length,
  unfinished: by('unfinished').length,
  personaVerdicts: rows.filter(r => r.persona).reduce((a, r) => ({ accept: a.accept + r.persona.accept, acceptWithChange: a.acceptWithChange + r.persona.acceptWithChange, reject: a.reject + r.persona.reject }), { accept: 0, acceptWithChange: 0, reject: 0 }),
};
const secs = rows.map(r => r.seconds).filter(s => typeof s === 'number').sort((a, b) => a - b);
const q = (p) => secs.length ? secs[Math.min(secs.length - 1, Math.floor(p * (secs.length - 1)))] : null;
const summary = { at: new Date().toISOString(), promotionRule: 'promoted = gated (G1–G7 re-run here) AND persona-accepted (persona.json with no reject); accept-with-change -> promoted-pending-change', counts, workingSeconds: { n: secs.length, median: q(0.5), p95: q(0.95), min: secs[0] ?? null, max: secs.at(-1) ?? null, under600: secs.filter(s => s <= 600).length, voids: Object.values(voids).reduce((a, b) => a + b, 0) }, rows };
fs.mkdirSync(path.join(KIT, 'receipt'), { recursive: true });
fs.writeFileSync(path.join(KIT, 'receipt', 'factory-summary.json'), JSON.stringify(summary, null, 2) + '\n');

const esc = (s) => String(s ?? '').replaceAll('|', '/').replaceAll('\n', ' ');
const cell = (r) => `| ${r.id} | ${r.verified ? '**' + r.status + '**' : r.status} | ${r.tests ?? ''} | ${r.rounds ?? ''} | ${r.seconds != null ? r.seconds.toFixed(0) : ''} | ${r.wasmBytes ?? ''} | ${r.persona ? `${r.persona.personas.join(', ')}: ${r.persona.accept}/${r.persona.acceptWithChange}/${r.persona.reject}` : 'none'} | ${esc(r.usage)} | ${esc(r.question)}${r.persona?.changes?.length ? ' **Changes:** ' + esc(r.persona.changes.join(' / ')) : ''}${r.reasons.length ? ' **Reasons:** ' + esc(r.reasons.join('; ')) : ''} |`;
const header = ['| id | status | tests | rounds | seconds | wasm bytes | personas (accept/AwC/reject) | usage | question / changes / reasons |', '|---|---|---|---|---|---|---|---|---|'];
const lines = ['# Promoted capabilities (dark-factory run on the X1 primary set)', '',
  `Run ${summary.at}. Promotion rule: ${summary.promotionRule}. ${counts.gated} gated; ${counts.promoted} promoted, ${counts.promotedWithAssumption} promoted with a stated assumption, ${counts.promotedPendingChange} promoted pending a persona change, ${counts.gatedRejectedByPersona} gated but rejected by a persona, ${counts.gatedUnreviewed} gated and unreviewed, ${counts.underdetermined} underdetermined, ${counts.rejected} rejected, ${counts.unverified} unverified, ${counts.unfinished} unfinished. Persona verdicts over the reviewed folders: ${counts.personaVerdicts.accept} accept, ${counts.personaVerdicts.acceptWithChange} accept-with-change, ${counts.personaVerdicts.reject} reject. Working time per request: median ${summary.workingSeconds.median?.toFixed(0)} s, p95 ${summary.workingSeconds.p95?.toFixed(0)} s, ${summary.workingSeconds.under600}/${summary.workingSeconds.n} under 600 s (${summary.workingSeconds.voids} voided timings precede re-runs).`, '',
  'Try one: `node factory/try.mjs <id> <fn> <args…>` from the kit directory (renders value, unit, labels, assumption and question through `glue.json`).', ''];
const section = (title, rs, note) => { if (!rs.length) return; lines.push(`## ${title} (${rs.length})`, ''); if (note) lines.push(note, ''); lines.push(...header); for (const r of rs) lines.push(cell(r)); lines.push(''); };
section('Promoted', rows.filter(r => r.status === 'promoted' || r.status === 'promoted-with-assumption'), 'Gated and accepted by every persona consulted.');
section('Promoted pending change', by('promoted-pending-change'), 'Gated, no persona rejection, at least one accept-with-change: usable once the named change lands.');
section('Not promoted', rows.filter(r => !r.verified), 'Gated but rejected by a persona, gated but unreviewed, or not gated.');
fs.writeFileSync(path.join(FACT, 'INDEX.md'), lines.join('\n'));
console.log(JSON.stringify({ counts, workingSeconds: summary.workingSeconds }, null, 1));
