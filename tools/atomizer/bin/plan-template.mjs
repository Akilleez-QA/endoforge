#!/usr/bin/env node
// Templated planner (S-08): one fast model call writes only the interface (exports grouped into modules, assumption, question, refusals);
// a script expands the fixed kernel-capability template into atoms.json. Target: planning under 10 s.
// usage: node plan-template.mjs <need.md> --out <dir> [--model sonnet] [--effort low] [--reviews 2]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { plan } from '../lib/dag.mjs';
import { makeHomeTemplate, runIsolated } from '../lib/isolate.mjs';
import { toolchainFor, parseUsage, stripFences } from '../lib/workers.mjs';
import { emit, context, load, newId } from '../lib/ledger.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const REPO = path.resolve(HERE, '../../..');
const argv = process.argv.slice(2); const get = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const needPath = argv[0]; const OUT = path.resolve(get('out')); const model = get('model', 'sonnet'); const effort = get('effort', 'low'); const REVIEWS = Number(get('reviews', 2));
const policy = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8'));
const needText = fs.readFileSync(needPath, 'utf8'); const needId = (needText.match(/^# Request (\S+)/m) ?? [, path.basename(needPath, '.md')])[1];
fs.mkdirSync(path.join(OUT, 'receipt'), { recursive: true });
const PROMPT = `${!argv.includes('--deliberate') ? 'Answer immediately: write the lines directly, without deliberating first; a first reasonable interface is what is wanted.\n\n' : ''}Write the interface of a pure numeric WebAssembly capability for the need below, in this exact line format and nothing else:
E name(arg:type:unit, arg:type:unit) -> kind:type:unit
C name.arg 1=meaning;2=meaning        (only for code arguments; use name.return for code results)
M m1 name,name | shared logic in at most 12 words
A assumption: the open facts and defaults, at most 40 words
Q the one question that resolves them
R refused input classes, separated by ;
type is f64 or i32; kind is number, integer, boolean or code; booleans are i32 0/1 with kind boolean. Cover the whole need with the fewest exports (at most 12) and group exports that share helpers or tables into one M line (at most 6 modules; modules cannot call each other). Do not invent equipment facts; put defaults in A.

Need (${needId}):
${needText.trim()}
`;
function parseCompact(text) {
  const exports = [], modules = []; let assumption = '', question = '', refuses = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim(); if (!line) continue;
    let m;
    if ((m = line.match(/^E\s+([A-Za-z_]\w*)\s*\((.*)\)\s*->\s*(\w+)\s*:\s*(f64|i32)\s*:\s*(.+)$/))) {
      const args = m[2].trim() ? m[2].split(',').map((a) => { const [n, t, ...u] = a.trim().split(':'); return { name: n.trim(), type: (t ?? 'f64').trim(), unit: (u.join(':') || 'dimensionless').trim() }; }) : [];
      exports.push({ name: m[1], args, returns: { kind: m[3], type: m[4], unit: m[5].trim() } });
    } else if ((m = line.match(/^C\s+([A-Za-z_]\w*)\.(\w+)\s+(.+)$/))) {
      const codes = Object.fromEntries(m[3].split(';').map((kv) => kv.split('=').map((x) => x.trim())).filter((kv) => kv.length === 2 && /^-?\d+$/.test(kv[0])));
      const e = exports.find((x) => x.name === m[1]); if (!e) continue;
      if (m[2] === 'return') e.returns.codes = codes; else { const a = e.args.find((x) => x.name === m[2]); if (a) a.codes = codes; }
    } else if ((m = line.match(/^M\s+(\w+)\s+([^|]+)\|?(.*)$/))) modules.push({ id: m[1], exports: m[2].split(',').map((x) => x.trim()).filter(Boolean), logic: m[3].trim() });
    else if (line.startsWith('A ')) assumption = line.slice(2).replace(/^assumption:\s*/i, '').trim();
    else if (line.startsWith('Q ')) question = line.slice(2).trim();
    else if (line.startsWith('R ')) refuses = line.slice(2).split(';').map((x) => x.trim()).filter(Boolean);
  }
  if (!exports.length || !modules.length) throw new Error('missing E or M lines');
  return { exports, modules, assumption, question, refuses };
}
const id = newId(`plan-${needId}`);
emit('plan.start', { planId: id, need: needId, model, effort, promptSha256: crypto.createHash('sha256').update(PROMPT).digest('hex'), promptBytes: Buffer.byteLength(PROMPT), context: context(), load: load() });
const home = makeHomeTemplate(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-home-'))); const work = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-work-'));
let iface = null, wallMs = 0, usage = null, error = null;
try {
  for (let attempt = 1; attempt <= 2 && !iface; attempt++) {
    const isCodex = model === 'codex';
    const cmd = isCodex ? ['codex', ...policy.codexFlags, '-c', `model_reasoning_effort="${get('codex-effort', 'minimal')}"`, '-o', '/work/plan.txt', PROMPT] : ['claude', '-p', ...policy.claudeLeanFlags, '--model', policy.models[model], '--tools', '', '--effort', effort];
    const r = await runIsolated({ homeTemplate: home, mounts: [{ host: work, guest: '/work', mode: 'rw' }], toolchain: toolchainFor(isCodex ? ['codex'] : ['claude', 'node'], policy, REPO), cmd, stdin: isCodex ? null : PROMPT, cwd: '/work', timeoutMs: 120_000, env: get('thinking') != null ? { MAX_THINKING_TOKENS: get('thinking') } : {} });
    wallMs += Math.round(r.wallMs); usage = parseUsage(r.stdout, model);
    fs.writeFileSync(path.join(OUT, 'receipt', `plan-stdout-${attempt}.json`), r.stdout);
    try { const txt = isCodex ? (fs.existsSync(path.join(work, 'plan.txt')) ? fs.readFileSync(path.join(work, 'plan.txt'), 'utf8') : '') : (usage?.result ?? ''); iface = parseCompact(stripFences(txt)); } catch (e) { error = String(e.message); }
    emit('plan.attempt', { planId: id, need: needId, attempt, wallMs: Math.round(r.wallMs), ok: !!iface, error: iface ? null : error, cli: (() => { try { const d = JSON.parse(r.stdout); return { durationMs: d.duration_ms, apiMs: d.duration_api_ms, usage: d.usage }; } catch { return null; } })() });
  }
} finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); }
if (!iface) { emit('plan.end', { planId: id, need: needId, ok: false, wallMs, error }); console.log(JSON.stringify({ ok: false, wallMs, error })); process.exit(1); }
// normalize: every export in exactly one module
const names = iface.exports.map((e) => e.name); const assigned = new Set();
iface.modules = iface.modules.map((m, i) => ({ id: `m${i + 1}`, logic: m.logic ?? '', exports: (m.exports ?? []).filter((n) => names.includes(n) && !assigned.has(n) && assigned.add(n)) })).filter((m) => m.exports.length);
const orphans = names.filter((n) => !assigned.has(n)); if (orphans.length) iface.modules.push({ id: `m${iface.modules.length + 1}`, logic: 'remaining exports', exports: orphans });
// expand the fixed template
const ifaceText = JSON.stringify(iface, null, 1);
const sig = (e) => `${e.name}(${e.args.map((a) => `${a.name}: ${a.type} [${a.unit}]`).join(', ')}) -> ${e.returns.type} [${e.returns.unit}]`;
const atoms = [];
const SIGTEXT = JSON.stringify({ exports: iface.exports.map((e) => ({ name: e.name, args: e.args.map((x) => ({ name: x.name, type: x.type, unit: x.unit })), returns: { type: e.returns.type, unit: e.returns.unit } })) }, null, 1);
atoms.push({ id: 'iface', kind: 'interface', title: 'Interface from the templated planner', contract: 'interface.json exactly as planned: exports, arguments, units, codes, module grouping, assumption, question, refusals.', inputs: [{ from: 'need' }], outputs: [{ name: 'interface', path: 'interface.json' }, { name: 'signature', path: 'signature.json', describe: 'bare signature for eval writers (DEC-80): names, arguments, units; no assumption, defaults or question' }], verify: 'parses as JSON', worker: { model: 'script', command: ['node', '-e', `require('fs').writeFileSync('/out/interface.json', ${JSON.stringify(ifaceText)}); require('fs').writeFileSync('/out/signature.json', ${JSON.stringify(SIGTEXT)})`], toolchain: ['node'] }, size: { work: 1, interface: 1 } });
atoms.push({ id: 'contract', kind: 'contract', title: 'Contract', contract: 'CONTRACT.md: what each export computes (formula or method and source), the assumption and the one question from the interface, the refused input classes; consistent with interface.json exactly.', inputs: [{ from: 'need' }, { from: 'iface', output: 'interface' }], outputs: [{ name: 'contract', path: 'CONTRACT.md' }], verify: 'non-empty markdown', worker: { model: 'sonnet', tools: [], effort: 'low', prompt: 'Write the contract for exactly the interface given. State methods and sources briefly.' }, size: { work: 2, interface: 1 } });
for (const m of iface.modules) {
  const ex = iface.exports.filter((e) => m.exports.includes(e.name));
  atoms.push({ id: `k-${m.id}`, kind: 'kernel', title: `Kernel module ${m.id}`, contract: `AssemblyScript file ${m.id}.ts exporting exactly: ${ex.map(sig).join('; ')}. Module logic: ${m.logic}. Refuse (unreachable()) the input classes in interface.json. Prefix every private helper and constant with k${m.id}_.`, inputs: [{ from: 'need' }, { from: 'iface', output: 'interface' }], outputs: [{ name: 'kernel', path: `${m.id}.ts` }], verify: 'compiles with asc, exports present', worker: { model: 'sonnet', tools: ['Bash', 'Read', 'Write', 'Edit'], effort: 'low', prompt: `Implement module ${m.id} only. Compile-check once; do not over-iterate.` }, size: { work: 2, interface: 1 } });
  atoms.push({ id: `t-${m.id}`, kind: 'tests', title: `Blind tests for module ${m.id}`, contract: `Executable tests for ${ex.map((e) => e.name).join(', ')} from the need and the bare signature only (never the kernel, never the planner's assumption or defaults; DEC-80): the request's own case where it applies, boundaries, and one refusal per refused input class. Compute expectations carefully and show the arithmetic in the test name.`, inputs: [{ from: 'need' }, { from: 'iface', output: 'signature' }], outputs: [{ name: 'tests', path: `tests-${m.id}.json` }], verify: 'JSON array in gate format', worker: { model: 'sonnet', tools: [], effort: 'low', prompt: 'At most 12 tests for this module. Prefer cases whose expected value you can compute exactly.' }, size: { work: 2, interface: 1 } });
}
const CHECK = !argv.includes('--no-test-check');
if (CHECK) for (const m of iface.modules) {
  atoms.push({ id: `strip-${m.id}`, kind: 'other', title: `Strip expectations from module ${m.id} tests`, contract: 'cases.json: every test of the module with name, fn and args only; no expected value and no refusal flag.', inputs: [{ from: `t-${m.id}`, output: 'tests' }], outputs: [{ name: 'cases', path: `cases-${m.id}.json` }], verify: 'JSON array', worker: { model: 'script', command: ['node', '{atomizer}/bin/testcheck.mjs', 'strip', `/in/t-${m.id}/tests-${m.id}.json`, `/out/cases-${m.id}.json`], toolchain: ['node', 'atomizer'] }, size: { work: 1, interface: 1 } });
  atoms.push({ id: `check-${m.id}`, kind: 'other', title: `Independent computation for module ${m.id}`, contract: `computed-${m.id}.json: for every case in cases-${m.id}.json, the value the export should return, computed independently from the need and the interface with a short node script you write and run: [{"name": "<case name>", "value": number | true | false | "refuse"}]. "refuse" when the input belongs to a refused class. Never guess: compute.`, inputs: [{ from: 'need' }, { from: 'iface', output: 'signature' }, { from: `strip-${m.id}`, output: 'cases' }], outputs: [{ name: 'computed', path: `computed-${m.id}.json` }], verify: 'JSON array of name/value', worker: { model: 'sonnet', tools: ['Bash', 'Read', 'Write'], effort: 'low', prompt: `First apply every refusal class in interface.json ("refuses"): a case whose input falls in a refused class has value "refuse" whatever the arithmetic would give. Then write /work/ref.mjs implementing the exports of module ${m.id} as the interface and the need define them (state any default you take in a comment), run it over every case, and write /out/computed-${m.id}.json. Arguments 1e999 / -1e999 mean +/-Infinity and "NaN" means NaN.` }, size: { work: 2, interface: 1 } });
  atoms.push({ id: `merge-${m.id}`, kind: 'other', title: `Keep only tests both computations agree on (module ${m.id})`, contract: 'tests-checked.json: the module tests the independent computation agrees with; check-report.json: every keep, drop and widen decision with both values.', inputs: [{ from: `t-${m.id}`, output: 'tests' }, { from: `check-${m.id}`, output: 'computed' }], outputs: [{ name: 'tests', path: `tests-checked-${m.id}.json` }, { name: 'report', path: `check-report-${m.id}.json` }], verify: 'JSON array', worker: { model: 'script', command: ['node', '{atomizer}/bin/testcheck.mjs', 'merge', `/in/t-${m.id}/tests-${m.id}.json`, `/in/check-${m.id}/computed-${m.id}.json`, `/out/tests-checked-${m.id}.json`, `/out/check-report-${m.id}.json`], toolchain: ['node', 'atomizer'] }, size: { work: 1, interface: 1 } });
}
atoms.push({ id: 'glue', kind: 'glue', title: 'Glue for all exports', contract: 'glue.json for every export in interface.json: labels, argument kinds and units, result kind, unit and precision, codes and labels, the assumption, the question, one trap message per refusing export.', inputs: [{ from: 'need' }, { from: 'iface', output: 'interface' }], outputs: [{ name: 'glue', path: 'glue.json' }], verify: 'validates against the glue schema', worker: { model: 'sonnet', tools: [], effort: 'low', prompt: 'Describe every export in the interface.' }, size: { work: 2, interface: 1 } });
const partInputs = [{ from: 'contract', output: 'contract' }, { from: 'glue', output: 'glue' }, ...iface.modules.flatMap((m) => [{ from: `k-${m.id}`, output: 'kernel' }, { from: CHECK ? `merge-${m.id}` : `t-${m.id}`, output: 'tests' }])];
atoms.push({ id: 'compose', kind: 'compose', title: 'Compose and gate', contract: 'Merge the parts, freeze contract and tests, run gates G1-G7; outputs are the compose helper files.', inputs: partInputs, outputs: ['kernel.wasm', 'CONTRACT.md', 'tests.json', 'glue.json', 'gates.json'].map((p) => ({ name: p.replace(/\W+/g, '-'), path: p })), verify: 'gates.json written', worker: { model: 'sonnet', tools: ['Bash', 'Read', 'Write', 'Edit'], prompt: 'Assemble and gate.' }, size: { work: 2, interface: 2 } });
const reviewers = [{ id: 'r-tech', model: 'sonnet', persona: 'field technician' }, { id: 'r-codex', model: 'codex', persona: 'independent engineering reviewer' }].slice(0, REVIEWS);
for (const r of reviewers) atoms.push({ id: r.id, kind: 'review', title: `Review: ${r.persona}`, contract: `Verdict as a ${r.persona} on whether the artefact answers the need as asked: accept, accept-with-change (one named change) or reject, with reasons.`, inputs: [{ from: 'need' }, { from: 'compose', output: 'CONTRACT-md' }, { from: 'compose', output: 'glue-json' }, { from: 'compose', output: 'gates-json' }], outputs: [{ name: 'review', path: `review-${r.id}.json` }], verify: 'JSON verdict', worker: { model: r.model, tools: [], prompt: `You are a ${r.persona}.` }, size: { work: 1, interface: 1 } });
const doc = { schema: 'endoforge/atoms/1', need: { id: needId, text: needText.trim() }, arm: 'templated', template: CHECK ? 'kernel-capability/2 (test check)' : 'kernel-capability/1', testCheck: CHECK, planId: id,
  acceptance: [{ id: 'A1', statement: 'gates G1-G7 pass on the composed artefact', check: { kind: 'command', run: `node -e "const g=JSON.parse(require('fs').readFileSync('/in/compose/gates.json','utf8'));process.exit(g.promotable===true?0:1)"` } },
    { id: 'A2', statement: 'every planned export is in the module', check: { kind: 'command', run: `node -e "const m=new WebAssembly.Module(require('fs').readFileSync('/in/compose/kernel.wasm'));const e=WebAssembly.Module.exports(m).map(x=>x.name);const need=[${names.map((n) => `'${n}'`).join(',')}];process.exit(need.every(n=>e.includes(n))?0:1)"` } }],
  atoms };
const v = validate(doc, policy); const P = plan(atoms);
fs.writeFileSync(path.join(OUT, 'atoms.json'), JSON.stringify(doc, null, 1)); fs.writeFileSync(path.join(OUT, 'interface.json'), ifaceText); fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(P, null, 1));
const receipt = { planId: id, needId, model, effort, valid: v.ok, errors: v.errors, attempts: [{ wallMs, usage: usage && { input: usage.input, output: usage.output, thinking: usage.thinking } }], exports: names.length, modules: iface.modules.length };
fs.writeFileSync(path.join(OUT, 'receipt', 'atomize.json'), JSON.stringify(receipt, null, 1));
emit('plan.end', { planId: id, need: needId, ok: v.ok, errors: v.errors, wallMs, exports: names.length, modules: iface.modules.length, atoms: atoms.length, plan: { total: P.total, critical: P.critical, criticalPath: P.criticalPath, width: P.width }, usage: usage && { output: usage.output, thinking: usage.thinking } });
console.log(JSON.stringify({ ok: v.ok, errors: v.errors.slice(0, 3), wallMs, exports: names.length, modules: iface.modules.length, atoms: atoms.length, outTok: usage?.output }));
process.exit(v.ok ? 0 : 1);
