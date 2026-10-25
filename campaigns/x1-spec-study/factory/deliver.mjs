#!/usr/bin/env node
// Deliver the gated capabilities to an application package, reproducibly.
//   node factory/deliver.mjs <path-to-packages/adapters-capabilities>
// Source of truth: work/factory/<id>/ (kernel.wasm, CONTRACT.md, tests.json, glue.json, result.json, frozen.sha256,
// outcome.json, persona.json) and receipt/factory-summary.json (promotion status). Ships every capability whose status is
// promoted, promoted-with-assumption or promoted-pending-change; removes any shipped folder whose status is not one of
// those (gated-rejected-by-persona, rejected). Rewrites capabilities/manifest.json (schema v2) in place; the package's
// scripts/embed.mjs must be run afterwards. Nothing here touches the kernels: hashes are copied from result.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACT = path.join(KIT, 'work', 'factory');
const target = process.argv[2];
if (!target) { console.error('usage: deliver.mjs <packages/adapters-capabilities>'); process.exit(2); }
const CAPS = path.join(path.resolve(target), 'capabilities');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = (p) => fs.readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

const summary = json(path.join(KIT, 'receipt', 'factory-summary.json'));
const SHIP = new Set(['promoted', 'promoted-with-assumption', 'promoted-pending-change']);
/** Export signatures from the kernel's .wat: name -> { params: ['f64',...], result: 'f64'|'i32'|null }. */
function signaturesFrom(wat) {
  const funcs = new Map();
  for (const m of wat.matchAll(/\(func (\$[^\s()]+)((?:\s*\(param[^)]*\))*)\s*(\(result ([a-z0-9]+)\))?/g)) {
    const params = [...m[2].matchAll(/\(param(?:\s+\$[^\s()]+)?((?:\s+[a-z0-9]+)+)\)/g)].flatMap(x => x[1].trim().split(/\s+/));
    funcs.set(m[1], { params, result: m[4] ?? null });
  }
  const out = {};
  for (const m of wat.matchAll(/\(export "([^"]+)" \(func (\$[^\s()]+)\)\)/g)) out[m[1]] = funcs.get(m[2]) ?? null;
  return out;
}

/** "## 2. Authoritative inputs" table rows of CONTRACT.md → [{input, source, winsOnConflict}]. */
function inputsFrom(contract) {
  const section = contract.split(/^## 2\./m)[1]?.split(/^## /m)[0] ?? '';
  return section.split('\n').filter(l => l.startsWith('|') && !/^\|\s*-/.test(l) && !/^\|\s*Input\s*\|/i.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim())).filter(c => c.length >= 3 && c[0])
    .map(([input, source, winsOnConflict]) => ({ input, source, winsOnConflict }));
}

function codesText(glue) {
  const lines = [];
  for (const e of glue.exports) {
    for (const a of e.args) if (a.kind === 'code' && a.codes) lines.push(`${e.name}.${a.name}: ${Object.entries(a.codes).map(([k, v]) => `${k}=${v}`).join('; ')}`);
    if (e.result.kind === 'code' && e.result.codes) lines.push(`${e.name} result: ${Object.entries(e.result.codes).map(([k, v]) => `${k}=${v}`).join('; ')}`);
  }
  return lines.join('\n') || 'none';
}

function capabilityRecord(row) {
  const id = row.id, d = path.join(FACT, id);
  const glue = json(path.join(d, 'glue.json'));
  const result = json(path.join(d, 'result.json'));
  const frozen = json(path.join(d, 'frozen.sha256'));
  const outcome = json(path.join(d, 'outcome.json'));
  const persona = fs.existsSync(path.join(d, 'persona.json')) ? json(path.join(d, 'persona.json')) : null;
  const contract = read(path.join(d, 'CONTRACT.md'));
  const sigs = signaturesFrom(read(path.join(d, 'kernel.wat')));
  const headline = glue.exports.find(e => e.headline) ?? glue.exports[0];
  const { id: _omit, ...glueBody } = glue;
  return {
    id,
    title: headline.label,
    outcome: outcome.outcome,
    wasm: { file: `${id}/kernel.wasm`, sha256: result.gates.G2_compiles.wasmSha256, bytes: result.gates.G2_compiles.wasmBytes },
    exports: glue.exports.map(e => {
      const sig = sigs[e.name];
      if (!sig) throw new Error(`${id}: glue names export ${e.name} but kernel.wat has no such export`);
      if (sig.params.length !== e.args.length) throw new Error(`${id}.${e.name}: glue has ${e.args.length} args, kernel takes ${sig.params.length}`);
      return {
        name: e.name,
        args: e.args.map((a, i) => ({ name: a.name, type: sig.params[i], unit: a.unit })),
        returns: { type: e.result.kind === 'boolean' ? 'bool' : sig.result ?? 'f64', unit: e.result.unit },
      };
    }),
    codes: codesText(glue),
    inputs: inputsFrom(contract),
    assumption: glue.assumption,
    question: glue.question,
    usage: outcome.usage,
    contract: `${id}/CONTRACT.md`,
    tests: `${id}/tests.json`,
    glue: `${id}/glue.json`,
    presentation: glueBody,
    promotion: {
      status: row.status,
      personaVerdicts: persona ? persona.verdicts.map(v => ({ persona: v.persona, verdict: v.verdict, change: v.change ?? null })) : [],
      reviewedAt: persona?.at ?? null,
    },
    gates: { tests: `${result.gates.G4_tests.passed}/${result.gates.G4_tests.total}`, rounds: outcome.rounds, verifiedAt: result.at, deterministic: result.gates.G5_deterministic.ok, maxMs: result.gates.G6_bounded.maxMs, glue: result.gates.G7_glue?.ok ?? false },
    frozen: { contractSha256: frozen.contract, testsSha256: frozen.tests, at: frozen.at },
  };
}

const shipped = [], removed = [];
for (const row of summary.rows) {
  const dst = path.join(CAPS, row.id);
  if (!SHIP.has(row.status)) { if (fs.existsSync(dst)) { fs.rmSync(dst, { recursive: true }); removed.push(`${row.id} (${row.status})`); } continue; }
  const src = path.join(FACT, row.id);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['kernel.wasm', 'CONTRACT.md', 'tests.json', 'glue.json']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  const rec = capabilityRecord(row);
  if (sha(path.join(dst, 'kernel.wasm')) !== rec.wasm.sha256) throw new Error(`${row.id}: shipped kernel hash differs from result.json`);
  if (sha(path.join(dst, 'CONTRACT.md')) !== rec.frozen.contractSha256 || sha(path.join(dst, 'tests.json')) !== rec.frozen.testsSha256) throw new Error(`${row.id}: shipped contract/tests differ from the freeze`);
  shipped.push(rec);
}
shipped.sort((a, b) => a.id.localeCompare(b.id));
const manifest = {
  schema: 'refrigeration-ai/capabilities-manifest/v2',
  generatedFrom: `endoforge campaigns/x1-spec-study @ ${execGit()} by factory/deliver.mjs, ${new Date().toISOString()}; promotion = gated (G1–G7) and persona-accepted; pending-change items list the change each persona named`,
  capabilities: shipped,
};
fs.writeFileSync(path.join(CAPS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ shipped: shipped.map(c => `${c.id}:${c.promotion.status}`), removed }, null, 1));

function execGit() {
  try { return execSync(`git -C "${KIT}" rev-parse --short HEAD`, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}
