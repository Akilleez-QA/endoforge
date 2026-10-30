#!/usr/bin/env node
// Atomize a need: an agent inside an isolate (seeing only the need and the rules) writes atoms.json; the script validates, repairs once, plans.
// usage: node atomize.mjs <need.md> --out <dir> [--model sonnet|opus|codex] [--repair 1] [--fixture atoms.json]
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
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
function args(argv) { const o = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(a); } return o; }
const A = args(process.argv.slice(2));
if (!A._[0] || !A.out) { console.error('usage: atomize.mjs <need.md> --out <dir> [--model sonnet|opus|codex] [--repair 1] [--fixture atoms.json]'); process.exit(2); }
const policy = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'policy.json'), 'utf8'));
const needText = fs.readFileSync(A._[0], 'utf8');
const needId = (needText.match(/^# Request (\S+)/m) ?? [, path.basename(A._[0], '.md')])[1];
const model = A.model ?? 'sonnet', REPAIR = Number(A.repair ?? 1);
const OUT = path.resolve(A.out); fs.mkdirSync(path.join(OUT, 'receipt'), { recursive: true });
const RULES = `You are the task atomizer of a software factory. Decompose the need below into the smallest units of work that can run in parallel, as one JSON document (schema "endoforge/atoms/1"). Output only the JSON: no prose, no code fences.

## What the factory makes from a technician's request
A capability: a pure AssemblyScript->WASM kernel (exported numeric functions over f64/i32/bool, no imports, deterministic), CONTRACT.md (what is computed, the assumption taken where the request left a fact open, the one question that resolves it, which inputs are refused), tests.json (executable tests in the fixed gate format: calls with expected values or expected traps), glue.json (labels, units, precision, codes, the assumption, the question, trap messages), then the fixed gates G1-G7 (frozen, compiles, exports, tests, deterministic, bounded, glue) and blind reviews by personas who judge from the request and the artefact's interface.

## Rules of atomization
1. An atom is the smallest unit that (a) has a contract verifiable from its declared inputs and outputs alone, (b) one worker finishes in one turn with bounded output (size.work <= 3 on a 1-5 scale), (c) fails alone. Split until (a)-(c) hold.
2. Stop splitting when the interface a split creates costs more than the work it saves: size.interface > size.work marks over-atomization. Keep the interface score honest.
3. Declare every input. An atom's isolate mounts only its declared inputs; anything undeclared does not exist for it. An input is {"from":"need"} or {"from":"<atomId>","output":"<outputName>"}.
4. Forbidden edges (enforced by the validator): tests -> kernel; kernel -> tests; kernel -> review; review -> kernel. The test writer and the kernel writer both work from the interface and the contract, never from each other.
5. Write the acceptance list from the need itself, before the atoms. Each item: {"id","statement","check"} with check {"kind":"command","run":"<shell using /in/compose/<file> paths>"} when it can be executed against the composed artefact, else {"kind":"oracle","criteria":"..."}.
6. Exactly one atom of kind "compose" gathers the parts into the artefact and runs the gates; its verify names the acceptance ids it satisfies.
7. Prefer wide waves: wave 0 = the interface stub (export names, argument names, units, codes, return types), the contract, and any data lookups, all independent; then per-export kernel atoms, per-family test atoms and per-export glue atoms in parallel; then compose; then reviews per persona in parallel, on different model families.
8. Workers: "sonnet" (default), "opus" (only where judgement is scarce), "codex" (a different model family; use it for at least one review), "script" (a deterministic command: "command" as an argv array using {in}, {out}, {work} placeholders, and "toolchain" from [node, asc, wasmtime]). A tool-less model worker ("tools": []) replies with exactly one file's content, so give it exactly one output. A worker that must compile or run tests needs "tools": ["Bash","Read","Write","Edit"] and a "toolchain".
9. Each atom: "id" (short, letters/digits/-/_), "kind" (interface|contract|tests|kernel|glue|data|compose|review|repair|other), "title", "contract" (precise, at least 20 characters, states what the output must satisfy), "inputs", "outputs" [{"name","path","describe"}], "verify" (how a script checks the output without a model), "worker" {"model","tools","toolchain" (optional),"prompt" (the worker's own instructions)}, "size" {"work","interface"}.
10. Kernel atoms must prefix every private helper or constant with the atom id so parts concatenate into one module; the scheduler appends a fixed procedure (formats, commands) to kernel, tests, glue, compose and review atoms, so do not restate formats in the worker prompts; say what, not how.
11. Do not invent facts about the equipment; where the request leaves a fact open, the contract atom records the assumption and the question, and the kernel implements the assumption.

## Fixed formats of the factory (reference real fields in acceptance commands)
- tests.json: a JSON array of {"name","fn","args":[numbers],"expect":number|boolean,"tol":number (absolute, for non-integers),"expectError":true (the call must refuse)}.
- glue.json (closed schema; no other top-level keys): {"id","assumption","question","notes" (optional),"exports":[{"name","label","args":[{"name","kind":"number|integer|boolean|code","unit","codes"|"labels"}],"result":{"kind","unit","precision"|"codes"|"labels"}}],"traps":[{"fn","when","message"}]}. Codes live inside the argument or result entries, never at the top level.
- gates.json (written by compose): {"promotable":boolean,"gates":{"G1_frozen":{"ok"},...,"G7_glue":{"ok"}},"tests":[{"name","fn","args","expect","got","pass"}]}; kernel.wasm has no imports; call exports through new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).
- compose outputs are fixed by the compose helper: kernel.wasm, kernel.wat, kernel.ts, CONTRACT.md, tests.json, glue.json, gates.json, failures.json, frozen.sha256; declare only these (one output per file, never a directory). Reviews read CONTRACT.md, glue.json, gates.json and tests.json, never kernel.ts.
- tests.json arguments: 1e999 for +Infinity, -1e999 for -Infinity, the string "NaN" for NaN; never null or bare words.
- A fixed repair stage is added by the scheduler after compose (draft compose -> one repair round that sees only the failing tests -> final compose); do not add repair atoms yourself.

## Output shape
{"schema":"endoforge/atoms/1","need":{"id":"${needId}","text":"<the need, verbatim>"},"acceptance":[...],"atoms":[...]}
`;
const prompt = `${RULES}\n## The need (id ${needId})\n\n${needText.trim()}\n`;
const promptSha = crypto.createHash('sha256').update(prompt).digest('hex');
const homeTemplate = makeHomeTemplate(fs.mkdtempSync(path.join(os.tmpdir(), 'atomize-home-')));
const ATOMIZE_ID = newId(`atomize-${needId}`);
const receipt = { atomizeId: ATOMIZE_ID, needId, model, promptSha256: promptSha, attempts: [], startedAt: new Date().toISOString() };
emit('atomize.start', { atomizeId: ATOMIZE_ID, need: needId, model, promptSha256: promptSha, promptBytes: Buffer.byteLength(prompt), needSha256: crypto.createHash('sha256').update(needText).digest('hex'), out: OUT, fixture: A.fixture ?? null, context: context(), load: load() });
async function turn(text, label) {
  if (A.fixture) return { json: fs.readFileSync(A.fixture, 'utf8'), wallMs: 0, usage: null, fixture: A.fixture };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atomize-work-'));
  let cmd, stdin = null, toolchain;
  if (model === 'codex') { cmd = ['codex', ...policy.codexFlags, '-o', '/work/atoms.json', text]; toolchain = toolchainFor(['codex'], policy, REPO); }
  else { cmd = ['claude', '-p', ...policy.claudeLeanFlags, '--model', policy.models[model], '--tools', '']; stdin = text; toolchain = toolchainFor(['claude', 'node'], policy, REPO); }
  const r = await runIsolated({ homeTemplate, mounts: [{ host: work, guest: '/work', mode: 'rw' }], toolchain, cmd, stdin, cwd: '/work', timeoutMs: 900_000 });
  const usage = parseUsage(r.stdout, model);
  const json = model === 'codex' ? (fs.existsSync(path.join(work, 'atoms.json')) ? fs.readFileSync(path.join(work, 'atoms.json'), 'utf8') : '') : (usage?.result ?? '');
  fs.writeFileSync(path.join(OUT, 'receipt', `${label}-stdout.json`), r.stdout); fs.writeFileSync(path.join(OUT, 'receipt', `${label}-prompt.md`), text);
  fs.rmSync(work, { recursive: true, force: true });
  return { json, wallMs: Math.round(r.wallMs), usage: usage && { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheCreate: usage.cacheCreate, thinking: usage.thinking, reasoning: usage.reasoning, costUsdList: usage.costUsdList, models: usage.models }, exit: r.exit, stderrTail: r.stderr.slice(-300) };
}
let doc = null, v = null;
try {
  let text = prompt;
  for (let attempt = 1; attempt <= 1 + REPAIR; attempt++) {
    const t = await turn(text, `turn-${attempt}`);
    let parsed = null, parseError = null;
    try { parsed = JSON.parse(stripFences(t.json)); } catch (e) { parseError = String(e.message); }
    if (parsed && !parsed.need?.text) parsed.need = { ...(parsed.need ?? {}), id: needId, text: needText.trim() };
    v = parsed ? validate(parsed, policy) : { ok: false, errors: [`output is not JSON: ${parseError}`], warnings: [] };
    receipt.attempts.push({ attempt, wallMs: t.wallMs, usage: t.usage, exit: t.exit, parsed: !!parsed, errors: v.errors, warnings: v.warnings, atoms: parsed?.atoms?.length ?? 0 });
    doc = parsed;
    emit('atomize.attempt', { atomizeId: ATOMIZE_ID, need: needId, model, attempt, wallMs: t.wallMs, exit: t.exit ?? null, usage: t.usage, parsed: !!parsed, valid: v.ok, errors: v.errors, warnings: v.warnings, atoms: parsed?.atoms?.length ?? 0, outputBytes: Buffer.byteLength(t.json ?? '') });
    if (v.ok) break;
    text = `${prompt}\n## Your previous answer failed validation. Fix every error and output the complete corrected JSON only.\n\nErrors:\n${v.errors.map((e) => '- ' + e).join('\n')}\n\nPrevious answer:\n${stripFences(t.json).slice(0, 60_000)}\n`;
  }
} finally { fs.rmSync(homeTemplate, { recursive: true, force: true }); }
receipt.finishedAt = new Date().toISOString(); receipt.valid = !!v?.ok;
const P = doc?.atoms ? plan(doc.atoms) : null;
if (doc) fs.writeFileSync(path.join(OUT, 'atoms.json'), JSON.stringify(doc, null, 1));
if (P) fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(P, null, 1));
fs.writeFileSync(path.join(OUT, 'receipt', 'atomize.json'), JSON.stringify(receipt, null, 1));
emit('atomize.end', { atomizeId: ATOMIZE_ID, need: needId, model, valid: receipt.valid, attempts: receipt.attempts.length, atomsSha256: doc ? crypto.createHash('sha256').update(JSON.stringify(doc, null, 1)).digest('hex') : null, plan: P && !P.cycle ? { atoms: doc.atoms.length, total: P.total, critical: P.critical, criticalPath: P.criticalPath, speedupBound: P.speedupBound, width: P.width, waves: P.waves } : null, kinds: doc?.atoms ? Object.fromEntries(Object.entries(doc.atoms.reduce((m, a) => { m[a.kind] = (m[a.kind] ?? 0) + 1; return m; }, {}))) : null });
const R = [`# Atomization of ${needId}`, '', `Model ${model}; attempts ${receipt.attempts.length}; valid: ${receipt.valid}. Prompt sha256 ${promptSha.slice(0, 16)}…`, ''];
if (P && !P.cycle) {
  R.push(`Atoms ${doc.atoms.length}; total work ${P.total}; critical path ${P.critical} (${P.criticalPath.join(' → ')}); speedup bound ${P.speedupBound}x; widest wave ${P.width}.`, '', '| Wave | Atoms |', '|---|---|');
  for (const [l, ids] of Object.entries(P.waves)) R.push(`| ${l} | ${ids.map((id) => { const a = doc.atoms.find((x) => x.id === id); return `${id} (${a.kind}, ${a.worker.model}${a.worker.tools?.length ? '+tools' : ''}, w${a.size.work}/i${a.size.interface})`; }).join('; ')} |`);
  R.push('', '## Acceptance (from the need)', '');
  for (const a of doc.acceptance) R.push(`- ${a.id}: ${a.statement} [${a.check.kind}]`);
}
if (v?.errors?.length) R.push('', '## Validation errors', '', ...v.errors.map((e) => '- ' + e));
if (v?.warnings?.length) R.push('', '## Warnings', '', ...v.warnings.map((e) => '- ' + e));
fs.writeFileSync(path.join(OUT, 'report.md'), R.join('\n') + '\n');
console.log(JSON.stringify({ valid: receipt.valid, attempts: receipt.attempts.map((a) => ({ wallMs: a.wallMs, atoms: a.atoms, errors: a.errors.length, usage: a.usage })), plan: P && !P.cycle ? { atoms: doc.atoms.length, total: P.total, critical: P.critical, speedupBound: P.speedupBound, width: P.width } : P }));
process.exit(receipt.valid ? 0 : 1);
