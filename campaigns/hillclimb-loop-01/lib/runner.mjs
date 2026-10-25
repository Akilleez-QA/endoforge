// Loop-1 runner: metered single-shot model turns through the user's own CLI logins. Zero dependencies.
// Every call appends one line to receipt/tokens.jsonl and saves the raw response under work/calls/.
// Providers: 'claude' (claude -p, lean flags proven in P-04b; never --bare, never an API key) and
// 'codex' (codex exec, ChatGPT login, sealed read-only cwd). Rate/usage-limit errors back off and retry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(KIT, '../..');
export const X1 = path.join(REPO, 'campaigns', 'x1-spec-study');
export const WORK = path.join(KIT, 'work');
export const RECEIPT = path.join(KIT, 'receipt');
export const CALLS = path.join(WORK, 'calls');
export const TOKENS = path.join(RECEIPT, 'tokens.jsonl');
export const EMPTY_CWD = path.join(WORK, 'empty-cwd');
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const shaFile = (p) => sha(fs.readFileSync(p));
export const now = () => new Date().toISOString();
export const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); };
export const appendJsonl = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + '\n'); };

const COMMON = ['--output-format', 'json', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome', '--setting-sources', '', '--max-budget-usd', '2'];
const CHILD_ENV = { ...process.env }; delete CHILD_ENV.CLAUDE_EFFORT; delete CHILD_ENV.ANTHROPIC_API_KEY; delete CHILD_ENV.ANTHROPIC_AUTH_TOKEN;
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) if (process.env[k]) { console.error(`refusing to run: ${k} is set (DEC-65: subscription only)`); process.exit(2); }
const LIMIT_RE = /rate.?limit|usage.?limit|limit reached|out of (extra )?usage|too many requests|\b429\b|overloaded|capacity|quota|resets at/i;
const BACKOFF_S = [60, 300, 900, 1800];
let callSeq = 0;
export const CODEX_MODEL = 'gpt-6.1-sol'; // the model named in ~/.codex/config.toml at freeze time
export const CODEX_NO_TOOLS = '\n\n## Working rules for this run\n\nAnswer from the prompt and your own knowledge only. Do not run commands, do not search the web, do not call any tool; the directory you are in is empty on purpose. Write your answer directly as your final message.\n';
export const budget = { hardStop: Number(process.env.LOOP1_HARD_STOP_TOKENS || 12_000_000), target: 8_000_000 };

export function totalsSoFar() {
  if (!fs.existsSync(TOKENS)) return { total: 0, byProvider: {}, byStage: {}, calls: 0 };
  const out = { total: 0, byProvider: {}, byStage: {}, calls: 0 };
  for (const l of fs.readFileSync(TOKENS, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); out.calls++; out.total += r.total || 0;
    out.byProvider[r.provider] = (out.byProvider[r.provider] || 0) + (r.total || 0);
    out.byStage[r.stage] = (out.byStage[r.stage] || 0) + (r.total || 0);
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Run a process with stdin text; resolve {code, out, err, wall_ms}. */
function run(cmd, argv, { cwd, env, stdin, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(cmd, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 'timeout' : code, out, err, wall_ms: Number(process.hrtime.bigint() - t0) / 1e6 }); });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

/**
 * One metered Claude turn. meta: {stage, arm, request, rep, tag}. opts: {model, effort, timeoutMs, maxRetries}.
 * Returns {text, usage, model, callId, wall_ms, limitEvents}. Throws after retries on a persistent failure.
 */
export async function callClaude(prompt, meta, opts = {}) {
  fs.mkdirSync(CALLS, { recursive: true }); fs.mkdirSync(EMPTY_CWD, { recursive: true });
  const argv = ['-p', ...COMMON]; if (opts.model) argv.push('--model', opts.model); if (opts.effort) argv.push('--effort', opts.effort);
  const callId = `${meta.stage}-${meta.arm || 'na'}-${meta.request || 'na'}-${meta.rep ?? 0}-${meta.tag || 't'}-${String(++callSeq).padStart(4, '0')}-${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(CALLS, `${callId}.prompt.md`), prompt);
  const limitEvents = []; let retries = 0; let last = null;
  const maxRetries = opts.maxRetries ?? 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await run('claude', argv, { cwd: EMPTY_CWD, env: CHILD_ENV, stdin: prompt, timeoutMs: opts.timeoutMs ?? 900_000 });
    let j = null; try { j = JSON.parse(r.out); } catch {}
    const text = j?.result ?? '';
    const errText = `${j?.is_error ? text : ''}\n${r.err}`;
    const isLimit = LIMIT_RE.test(errText) || (j?.api_error_status && [429, 529].includes(j.api_error_status));
    fs.writeFileSync(path.join(CALLS, `${callId}.attempt${attempt}.json`), JSON.stringify({ argv, code: r.code, wall_ms: r.wall_ms, stderr: r.err.slice(0, 4000), response: j ?? r.out.slice(0, 4000) }, null, 2));
    const u = j?.usage || {};
    const rec = { at: now(), callId, attempt, stage: meta.stage, arm: meta.arm ?? null, request: meta.request ?? null, rep: meta.rep ?? null, tag: meta.tag ?? null, provider: 'claude',
      model: j?.modelUsage ? Object.keys(j.modelUsage).join('+') : (opts.model ?? 'default'), effort: opts.effort ?? 'default',
      input: u.input_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_creation: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0, thinking: u.output_tokens_details?.thinking_tokens ?? 0,
      total: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0),
      wall_ms: Math.round(r.wall_ms), api_ms: j?.duration_api_ms ?? null, ttft_ms: j?.ttft_ms ?? null, exit: r.code, is_error: Boolean(j?.is_error) || r.code !== 0 || !j, limit_event: isLimit, cost_usd_list: j?.total_cost_usd ?? null, stop_reason: j?.stop_reason ?? null, num_turns: j?.num_turns ?? null };
    appendJsonl(TOKENS, rec);
    last = { rec, r, j, text };
    if (!rec.is_error && text) {
      const tot = totalsSoFar(); if (tot.total > budget.hardStop) { console.error(`HARD STOP: ${tot.total} tokens > ${budget.hardStop}`); process.exit(3); }
      return { text, usage: u, model: rec.model, callId, wall_ms: r.wall_ms, limitEvents, retries, cost: rec.cost_usd_list };
    }
    if (isLimit) { const s = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)]; limitEvents.push({ at: now(), attempt, backoff_s: s, note: errText.slice(0, 300) }); appendJsonl(path.join(RECEIPT, 'limit-events.jsonl'), { callId, ...limitEvents.at(-1) }); console.error(`[limit] ${callId}: backing off ${s}s`); await sleep(s * 1000); retries++; continue; }
    if (attempt < Math.min(1, maxRetries)) { retries++; await sleep(5000); continue; }
    break;
  }
  const e = new Error(`claude call failed: ${callId}: exit=${last?.r?.code} err=${(last?.r?.err || '').slice(0, 300)} result=${(last?.text || '').slice(0, 300)}`); e.callId = callId; e.last = last; throw e;
}

/** One metered Codex turn (ChatGPT login). cwd is a sealed read-only directory the caller prepares. */
export async function callCodex(prompt, meta, opts = {}) {
  fs.mkdirSync(CALLS, { recursive: true });
  const callId = `${meta.stage}-${meta.arm || 'na'}-${meta.request || 'na'}-${meta.rep ?? 0}-${meta.tag || 't'}-${String(++callSeq).padStart(4, '0')}-${Date.now().toString(36)}`;
  const outFile = path.join(CALLS, `${callId}.last.md`);
  fs.writeFileSync(path.join(CALLS, `${callId}.prompt.md`), prompt);
  const cwd = opts.cwd || EMPTY_CWD; fs.mkdirSync(cwd, { recursive: true });
  // Codex protocol v1.1 (2026-10-18): the user config is ignored (no MCP servers or plugins), web search is disabled and the
  // model is named explicitly, so a sealed oracle turn is one model round over the prompt alone; prompts also carry a
  // no-tools working rule. Measured: a five-request criteria batch fell from 150-410k to ~21k metered tokens.
  const argv = ['exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '--json', '-o', outFile, '--ignore-user-config', '-m', opts.model || CODEX_MODEL, '-c', `model_reasoning_effort="${opts.reasoning || 'high'}"`, '-c', 'web_search="disabled"', '--cd', cwd];
  argv.push('-');
  const limitEvents = []; let retries = 0; let last = null;
  for (let attempt = 0; attempt <= (opts.maxRetries ?? 4); attempt++) {
    const r = await run('codex', argv, { cwd, env: CHILD_ENV, stdin: prompt, timeoutMs: opts.timeoutMs ?? 1_200_000 });
    let usage = null, model = opts.model || CODEX_MODEL; const events = [];
    for (const l of r.out.split('\n').filter(Boolean)) { try { const e = JSON.parse(l); events.push(e); if (e.type === 'turn.completed') usage = e.usage; if (e.type === 'thread.started' && e.model) model = e.model; } catch {} }
    const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    const errText = `${r.err}\n${events.filter((e) => e.type === 'error' || e.type === 'turn.failed').map((e) => JSON.stringify(e)).join('\n')}`;
    const isLimit = LIMIT_RE.test(errText);
    fs.writeFileSync(path.join(CALLS, `${callId}.attempt${attempt}.json`), JSON.stringify({ argv, code: r.code, wall_ms: r.wall_ms, stderr: r.err.slice(0, 4000), events }, null, 2));
    const rec = { at: now(), callId, attempt, stage: meta.stage, arm: meta.arm ?? null, request: meta.request ?? null, rep: meta.rep ?? null, tag: meta.tag ?? null, provider: 'codex', model, effort: opts.reasoning || 'high',
      input: (usage?.input_tokens ?? 0) - (usage?.cached_input_tokens ?? 0), cache_read: usage?.cached_input_tokens ?? 0, cache_creation: usage?.cache_write_input_tokens ?? 0, output: usage?.output_tokens ?? 0, thinking: usage?.reasoning_output_tokens ?? 0,
      total: (usage?.input_tokens ?? 0) + (usage?.cache_write_input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      wall_ms: Math.round(r.wall_ms), api_ms: null, ttft_ms: null, exit: r.code, is_error: r.code !== 0 || !usage || !text, limit_event: isLimit, cost_usd_list: null, stop_reason: null, num_turns: null };
    appendJsonl(TOKENS, rec);
    last = { rec, r, text };
    if (!rec.is_error) return { text, usage, model, callId, wall_ms: r.wall_ms, limitEvents, retries };
    if (isLimit) { const s = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)]; limitEvents.push({ at: now(), attempt, backoff_s: s, note: errText.slice(0, 300) }); appendJsonl(path.join(RECEIPT, 'limit-events.jsonl'), { callId, ...limitEvents.at(-1) }); console.error(`[limit] ${callId}: backing off ${s}s`); await sleep(s * 1000); retries++; continue; }
    if (attempt < 1) { retries++; await sleep(5000); continue; }
    break;
  }
  const e = new Error(`codex call failed: ${callId}: exit=${last?.r?.code} err=${(last?.r?.err || '').slice(0, 300)}`); e.callId = callId; throw e;
}

/** Bounded-concurrency map preserving order; errors are returned as {error} so one failure does not kill a block. */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e.message || e), callId: e.callId ?? null }; console.error(`[pool] item ${k} failed: ${String(e.message || e).slice(0, 200)}`); } } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Parse "=== FILE: name ===" ... "=== END FILE ===" blocks (code fences inside are stripped). */
export function parseFiles(text) {
  const files = {};
  const re = /^[=\-]{3,}\s*FILE:\s*([^\s=\-][^\n]*?)\s*[=\-]{3,}\s*\n([\s\S]*?)^[=\-]{3,}\s*END FILE\s*[=\-]{3,}/gm;
  let m; while ((m = re.exec(text))) {
    let body = m[2];
    const fence = body.match(/^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n\s*```\s*$/);
    if (fence) body = fence[1] + '\n';
    files[m[1].trim()] = body.replace(/\s+$/, '') + '\n';
  }
  return files;
}

/** Extract the first JSON object/array from free text (fenced or bare). */
export function parseJsonLoose(text) {
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  const cands = [fence?.[1], text];
  for (const c of cands) { if (!c) continue; const s = c.indexOf('{'), a = c.indexOf('['); const start = (s < 0) ? a : (a < 0 ? s : Math.min(s, a)); if (start < 0) continue;
    for (let end = c.length; end > start; end--) { const ch = c[end - 1]; if (ch !== '}' && ch !== ']') continue; try { return JSON.parse(c.slice(start, end)); } catch {} } }
  return null;
}

export function requestText(id) {
  const t = fs.readFileSync(path.join(X1, 'work', 'pool', `${id}.md`), 'utf8');
  const m = t.match(/## The request, in the requester's words\s*\n\n> ?([\s\S]*?)\n\n## /);
  const role = (t.match(/\|\s*Requester\s*\|\s*([^|]+?)\s*\|/) || [])[1] || 'unknown';
  const inputs = (t.match(/## Authoritative inputs the requester named\s*\n\n([\s\S]*?)\n\n## /) || [])[1] || '';
  const examples = (t.match(/## Examples the requester gave, if any\s*\n\n([\s\S]*?)\n\n## /) || [])[1] || '';
  return { id, text: m ? m[1].trim().replace(/^"|"$/g, '') : '(request text not found)', role: role.trim(), inputs: inputs.trim(), examples: examples.trim() };
}
