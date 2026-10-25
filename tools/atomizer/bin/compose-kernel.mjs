#!/usr/bin/env node
// Deterministic compose for kernel capabilities: merge the atoms' parts into one artefact directory, freeze, run the fixed gates, copy outputs.
// usage: node compose-kernel.mjs --id <needId> --in /in --out /out --work /work --gate <gate.mjs>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function args(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; return o; }
const A = args(process.argv.slice(2));
for (const k of ['id', 'in', 'out', 'work', 'gate']) if (!A[k]) { console.error(`missing --${k}`); process.exit(2); }
const dir = path.join(A.work, A.id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const atoms = fs.existsSync(A.in) ? fs.readdirSync(A.in).filter((d) => fs.statSync(path.join(A.in, d)).isDirectory()).sort() : [];
const files = []; for (const at of atoms) for (const f of fs.readdirSync(path.join(A.in, at))) files.push({ atom: at, name: f, path: path.join(A.in, at, f) });
const log = { id: A.id, parts: { contract: null, tests: [], kernels: [], glues: [] }, steps: [] };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; } };
// 1. contract
const contracts = files.filter((f) => f.name === 'CONTRACT.md' || /contract/i.test(f.name) && f.name.endsWith('.md'));
if (!contracts.length) { console.error('no CONTRACT.md among the inputs'); process.exit(3); }
fs.copyFileSync(contracts[0].path, path.join(dir, 'CONTRACT.md')); log.parts.contract = `${contracts[0].atom}/${contracts[0].name}`;
// 2. tests: every JSON array of {fn, args}; merged at the text level so tokens like 1e999 (Infinity) survive (JSON.stringify would turn them into null)
function splitTopLevel(text) {
  const t = text.trim(); if (!t.startsWith('[')) return null;
  const items = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 1; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; if (depth === 0 && start < 0) start = i; continue; }
    if (ch === '{' || ch === '[') { if (depth === 0 && start < 0) start = i; depth++; continue; }
    if (ch === '}' || ch === ']') { depth--; if (depth === 0 && start >= 0) { items.push(t.slice(start, i + 1)); start = -1; } if (depth < 0) break; continue; }
  }
  return items;
}
const testTexts = []; const seen = new Set(); const rawByName = new Map();
for (const f of files.filter((x) => x.name.endsWith('.json'))) {
  const j = readJson(f.path);
  if (!(Array.isArray(j) && j.length && j.every((t) => t && typeof t.fn === 'string' && Array.isArray(t.args)))) continue;
  const raws = splitTopLevel(fs.readFileSync(f.path, 'utf8')) ?? []; if (raws.length !== j.length) { console.error(`cannot split ${f.atom}/${f.name} at the text level`); process.exit(3); }
  log.parts.tests.push(`${f.atom}/${f.name}`);
  j.forEach((t, i) => {
    let raw = raws[i]; let name = String(t.name ?? `${t.fn}(${t.args.join(',')})`);
    if (seen.has(name)) { const renamed = `${name} [${f.atom}]`; raw = raw.replace(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/, () => `"name": ${JSON.stringify(renamed)}`); if (!raw.includes(JSON.stringify(renamed))) raw = raw.replace(/^\{/, `{"name": ${JSON.stringify(renamed)}, `); name = renamed; }
    seen.add(name); rawByName.set(name, raw); testTexts.push(raw);
  });
}
if (!testTexts.length) { console.error('no tests among the inputs'); process.exit(3); }
fs.writeFileSync(path.join(dir, 'tests.json'), '[\n' + testTexts.join(',\n') + '\n]\n');
JSON.parse(fs.readFileSync(path.join(dir, 'tests.json'), 'utf8'));
// 3. freeze before any code
let r = spawnSync(process.execPath, [A.gate, 'freeze', dir], { encoding: 'utf8' }); log.steps.push({ step: 'freeze', exit: r.status, out: (r.stdout + r.stderr).trim().slice(0, 400) });
if (r.status !== 0) { console.error(`freeze failed: ${r.stderr}`); process.exit(4); }
// 4. kernel: concatenate parts in atom order
const kernels = files.filter((f) => f.name.endsWith('.ts')).sort((x, y) => x.atom.localeCompare(y.atom) || x.name.localeCompare(y.name));
if (!kernels.length) { console.error('no kernel parts (.ts) among the inputs'); process.exit(3); }
fs.writeFileSync(path.join(dir, 'kernel.ts'), kernels.map((k) => `// ---- part ${k.atom}/${k.name}\n${fs.readFileSync(k.path, 'utf8').trim()}\n`).join('\n')); log.parts.kernels = kernels.map((k) => `${k.atom}/${k.name}`);
// 5. glue: union of partial glues
const glues = files.filter((x) => x.name.endsWith('.json')).map((f) => ({ f, j: readJson(f.path) })).filter((x) => x.j && typeof x.j === 'object' && !Array.isArray(x.j) && Array.isArray(x.j.exports) && ('assumption' in x.j || 'question' in x.j || 'traps' in x.j));
if (!glues.length) { console.error('no glue among the inputs'); process.exit(3); }
const glue = { id: A.id, assumption: '', question: '', notes: '', exports: [], traps: [] };
const exportNames = new Set(), trapKeys = new Set(), notes = [];
for (const { f, j } of glues) {
  log.parts.glues.push(`${f.atom}/${f.name}`);
  if (!glue.assumption && j.assumption) glue.assumption = j.assumption;
  if (!glue.question && j.question) glue.question = j.question;
  if (j.notes) notes.push(String(j.notes));
  for (const e of j.exports) if (e?.name && !exportNames.has(e.name)) { exportNames.add(e.name); glue.exports.push(e); }
  for (const t of j.traps ?? []) { const k = `${t.fn}|${t.when}`; if (!trapKeys.has(k)) { trapKeys.add(k); glue.traps.push(t); } }
}
glue.notes = notes.join(' ').trim(); if (!glue.notes) delete glue.notes;
fs.writeFileSync(path.join(dir, 'glue.json'), JSON.stringify(glue, null, 1) + '\n');
// 6. gates
r = spawnSync(process.execPath, [A.gate, 'run', dir], { encoding: 'utf8', timeout: 600_000 }); log.steps.push({ step: 'run', exit: r.status, out: (r.stdout + r.stderr).trim().slice(0, 1200) });
const result = readJson(path.join(dir, 'result.json')) ?? { error: 'no result.json', stdout: r.stdout, stderr: r.stderr };
// 7. outputs
fs.mkdirSync(A.out, { recursive: true });
for (const n of ['kernel.wasm', 'kernel.wat', 'CONTRACT.md', 'tests.json', 'glue.json', 'kernel.ts', 'frozen.sha256']) if (fs.existsSync(path.join(dir, n))) fs.copyFileSync(path.join(dir, n), path.join(A.out, n));
fs.writeFileSync(path.join(A.out, 'gates.json'), JSON.stringify({ ...result, compose: log }, null, 1) + '\n');
fs.writeFileSync(path.join(A.out, 'failures.json'), JSON.stringify((result.tests ?? []).filter((t) => !t.pass).map((t) => ({ name: t.name, fn: t.fn, args: t.args, expected: t.expect, got: t.got, rawTest: rawByName.get(t.name) ?? null, note: 'args as the runner parsed them; rawTest is the test as written (1e999 means Infinity)' })), null, 1) + '\n');
const promotable = !!result.promotable;
console.log(JSON.stringify({ promotable, gates: result.gates ? Object.fromEntries(Object.entries(result.gates).map(([k, v]) => [k, v.ok ?? v])) : null, parts: log.parts, gateExit: r.status }));
if (A.preflight) process.exit(result.gates?.G2_compiles?.ok ? 0 : 10);
process.exit(promotable ? 0 : 1);
