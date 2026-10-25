// Build the isolate command, mounts and prompt for one atom's worker (script | sonnet | opus | codex).
import path from 'node:path';
import fs from 'node:fs';
import { expand } from './isolate.mjs';
const INLINE_LIMIT = 60_000;
const toolchainEnv = (name) => `ENDOFORGE_TOOLCHAIN_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
export function resolveToolchainPath(name, policy, repoRoot) {
  const host = process.env[toolchainEnv(name)] ?? policy.toolchain?.[name];
  if (!host) throw new Error(`unknown toolchain ${name}`);
  return host.startsWith('~') ? expand(host) : path.resolve(repoRoot, host);
}
export function toolchainFor(names, policy, repoRoot) {
  const out = [];
  for (const n of [...new Set(typeof names === 'string' ? [names] : names)]) {
    const h = resolveToolchainPath(n, policy, repoRoot);
    if ((n === 'codex' || n === 'claude') && !fs.existsSync(h)) {
      throw new Error(`toolchain ${n} host path does not exist: ${h}; override with ${toolchainEnv(n)}`);
    }
    const bin = n === 'node' || n === 'codex' ? path.join(h, 'bin') : n === 'claude' ? h : n === 'wasmtime' ? path.dirname(h) : n === 'asc' ? path.join(h, '.bin') : null;
    out.push({ host: h, guest: h, bin });
  }
  return out;
}
export function stripFences(s) {
  let t = String(s ?? '').trim();
  const m = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (m) t = m[1];
  return t;
}
function procedureFor(atom, doc, policy, repoRoot) {
  let t = policy.kindProcedures?.[atom.kind];
  if (!t) return null;
  const repo = (rel) => path.resolve(repoRoot, rel);
  const asc = path.join(repo(policy.toolchain.asc), '.bin', 'asc');
  let glueSchema = '';
  try { glueSchema = fs.readFileSync(path.join(repo(policy.toolchain.gate), 'glue.schema.json'), 'utf8'); } catch { glueSchema = '(schema file unavailable)'; }
  return t.replaceAll('{needId}', doc.need.id).replaceAll('{asc}', asc).replaceAll('{gate}', path.join(repo(policy.toolchain.gate), 'gate.mjs')).replaceAll('{helper}', path.join(repo(policy.toolchain.atomizer), 'bin', 'compose-kernel.mjs')).replaceAll('{glueSchema}', glueSchema);
}
export function buildPrompt(doc, atom, staged, toolUsing, procedure) {
  const L = [];
  L.push(`You are one atom of a larger job (need ${doc.need.id}). Produce exactly what your contract asks and nothing else. You cannot see the other atoms; you have only what is listed here, and nothing else exists for you.`);
  L.push('', '## The need, verbatim', '', doc.need.text.trim());
  L.push('', `## Your atom: ${atom.id}: ${atom.title ?? ''} (${atom.kind})`, '', atom.contract.trim());
  L.push('', '## Your inputs (read-only)');
  if (!staged.length) L.push('- none besides the need above');
  for (const s of staged) {
    L.push(`- /in/${s.from}/${s.path}${s.describe ? `: ${s.describe}` : ''}`);
    if (!toolUsing && s.inline != null) L.push('', '```', s.inline, '```');
  }
  L.push('', '## Your outputs');
  for (const o of atom.outputs) L.push(`- ${o.path}${o.describe ? `: ${o.describe}` : ''}`);
  if (toolUsing) L.push('', 'Write each output under /out (writable, together with /work and /tmp). Finish when the files are written; do not print them.');
  else L.push('', `Reply with only the exact content of ${atom.outputs[0].path}. No code fences, no commentary before or after.`);
  if (atom.worker.prompt) L.push('', '## Instructions for this atom', '', atom.worker.prompt.trim());
  if (procedure) L.push('', '## Fixed procedure for this kind of atom', '', procedure);
  return L.join('\n');
}
/** Returns { cmd, stdin, toolchain, captureResultTo } for the atom. */
export function workerCommand(doc, atom, staged, policy, repoRoot) {
  const w = atom.worker;
  const subst = (s) => s.replaceAll('{in}', '/in').replaceAll('{out}', '/out').replaceAll('{work}', '/work').replaceAll('{atomizer}', path.join(path.resolve(repoRoot, policy.toolchain.atomizer)));
  if (w.model === 'script') return { cmd: w.command.map(subst), stdin: null, toolchain: toolchainFor(w.toolchain ?? [], policy, repoRoot), captureResultTo: null };
  const tools = w.tools ?? [];
  const toolUsing = tools.length > 0;
  if (!toolUsing && atom.outputs.length !== 1) throw new Error(`${atom.id}: a tool-less model worker must declare exactly one output`);
  for (const s of staged) if (!toolUsing) { try { const st = fs.statSync(s.host); s.inline = st.size <= INLINE_LIMIT ? fs.readFileSync(s.host, 'utf8') : `(file of ${st.size} bytes, too large to inline)`; } catch { s.inline = '(unreadable)'; } }
  const prompt = buildPrompt(doc, atom, staged, toolUsing, procedureFor(atom, doc, policy, repoRoot));
  const kindTools = policy.kindToolchain?.[atom.kind] ?? [];
  const declared = typeof w.toolchain === 'string' ? [w.toolchain] : (w.toolchain ?? []);
  if (w.model === 'codex') {
    const out = `/out/${atom.outputs[0].path}`;
    return { cmd: ['codex', ...policy.codexFlags, '-o', out, prompt], stdin: null, toolchain: toolchainFor(['codex', ...kindTools, ...declared], policy, repoRoot), captureResultTo: null, prompt };
  }
  const cmd = ['claude', '-p', ...policy.claudeLeanFlags, '--model', policy.models[w.model], '--tools', tools.join(',')];
  if (toolUsing) cmd.push('--permission-mode', 'bypassPermissions');
  if (w.effort) cmd.push('--effort', w.effort);
  return { cmd, stdin: prompt, toolchain: toolchainFor(['claude', 'node', ...kindTools, ...declared], policy, repoRoot), captureResultTo: toolUsing ? null : atom.outputs[0].path, prompt };
}
/** Parse usage from Claude's JSON result or Codex's JSONL events. */
export function parseUsage(stdout, model) {
  try {
    if (model === 'codex') {
      for (const line of stdout.split('\n')) { if (!line.trim()) continue; const e = JSON.parse(line); if (e.type === 'turn.completed' && e.usage) return { input: e.usage.input_tokens, output: e.usage.output_tokens, cacheRead: e.usage.cached_input_tokens, reasoning: e.usage.reasoning_output_tokens }; }
      return null;
    }
    const d = JSON.parse(stdout); const u = d.usage ?? {};
    return { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheCreate: u.cache_creation_input_tokens, thinking: u.output_tokens_details?.thinking_tokens, costUsdList: d.total_cost_usd, apiMs: d.duration_api_ms, isError: d.is_error, result: d.result, models: Object.keys(d.modelUsage ?? {}) };
  } catch { return null; }
}
