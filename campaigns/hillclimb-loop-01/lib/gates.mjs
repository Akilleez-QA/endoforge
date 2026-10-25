// Gate wrappers. G1–G7 run the loop-0 gate.mjs in place (byte-identical; its sha256 is in receipt/freeze.json); it resolves
// the AssemblyScript compiler relative to its own location, so any directory can be gated. G8 is loop 1's gate addition
// (Q-new level only) and lives in gate8.mjs; the incumbent never runs it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { X1 } from './runner.mjs';

export const GATE_MJS = path.join(X1, 'factory', 'gate.mjs');
export const SCHEMA = path.join(X1, 'factory', 'glue.schema.json');

export function freeze(dir) {
  const r = execFileSync(process.execPath, [GATE_MJS, 'freeze', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(fs.readFileSync(path.join(dir, 'frozen.sha256'), 'utf8'));
}

/** Run G1–G7; returns result.json contents (promotable true/false) and never throws on a gate failure. */
export function runGates(dir) {
  let stdout = '';
  try { stdout = execFileSync(process.execPath, [GATE_MJS, 'run', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }); }
  catch (e) { stdout = String(e.stdout || ''); if (!fs.existsSync(path.join(dir, 'result.json'))) return { at: new Date().toISOString(), gates: { G0_runner: { ok: false, why: String(e.stderr || e.message).slice(0, 500) } }, tests: [], promotable: false }; }
  return JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
}

export function gateSummary(result) {
  return { promotable: result.promotable, failed: Object.entries(result.gates).filter(([, v]) => !v.ok).map(([g, v]) => `${g}: ${v.why ?? 'failed'}`), tests: result.gates.G4_tests ? `${result.gates.G4_tests.passed}/${result.gates.G4_tests.total}` : null, wasmSha256: result.gates.G2_compiles?.wasmSha256 ?? null };
}

/** Feedback text for a repair round: failing gates and failing tests, nothing else. */
export function gateFeedback(result) {
  const lines = [];
  for (const [g, v] of Object.entries(result.gates)) if (!v.ok) lines.push(`${g} FAILED: ${v.why ?? ''}`);
  for (const t of result.tests ?? []) if (!t.pass) lines.push(`test "${t.name}": ${t.fn}(${t.args.join(', ')}) expected ${t.expect}${t.expect === 'error' ? ' (a trap)' : ''}, got ${t.got}`);
  return lines.join('\n');
}
