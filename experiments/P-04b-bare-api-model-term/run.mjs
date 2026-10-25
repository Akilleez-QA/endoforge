#!/usr/bin/env node
// P-04b runner (amendment 1): one model turn against the P-04 prompt through the logged-in Claude Code
// CLI with the leanest context its flags allow. The original API arms were dropped by the user
// (subscription only); the key-gated `cli-bare` arm's receipts are in receipt/raw-cli-bare-keygated/.
// Idempotent per (arm, run): receipt/raw/<arm>-<phase>-<n>.json is overwritten; summary.json is recomputed
// from everything in receipt/raw. Network use: the model turns only.
// Usage: node run.mjs                                  (all arms, phases A B C D)
//        ARMS=S1-lean PHASES=A node run.mjs             (subset)
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RECEIPT = path.join(DIR, 'receipt');
const RAW = path.join(RECEIPT, 'raw');
const KERNELS = path.join(DIR, 'kernels');
mkdirSync(RAW, { recursive: true });
mkdirSync(KERNELS, { recursive: true });

const sha = (s) => createHash('sha256').update(s).digest('hex');
const PROMPT = readFileSync(path.join(DIR, 'prompt.txt'), 'utf8');
const PROMPT_VARIANT = readFileSync(path.join(DIR, 'prompt-variant.txt'), 'utf8');
const PHASES = (process.env.PHASES || 'A,B,C,D').split(',');
const MAX_TURNS_PER_ARM = 15;
const MAX_ERRORS_PER_ARM = 2;

// Empty working directory with no CLAUDE.md/AGENTS.md in it or any ancestor, so no project context loads.
const CWD = process.env.PROBE_CWD || path.join(os.tmpdir(), `claude-${process.getuid()}`, 'p04b-empty-cwd');
mkdirSync(CWD, { recursive: true });
for (const f of ['CLAUDE.md', 'AGENTS.md']) { let d = CWD; while (true) { if (existsSync(path.join(d, f))) throw new Error(`${f} found at ${d}; cwd is not clean`); const up = path.dirname(d); if (up === d) break; d = up; } }

const COMMON = ['--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-chrome', '--setting-sources', '', '--max-budget-usd', '2'];
const ARMS = {
  'S1-lean': { extra: [] },
  'S2-lean-low': { extra: ['--effort', 'low'] },
  'S3-lean-sonnet': { extra: ['--model', 'claude-sonnet-5-5'] },
  'S4-lean-sysprompt': { extra: ['--system-prompt', 'You write AssemblyScript. Output only code.'] },
};
const ARM_ORDER = (process.env.ARMS || Object.keys(ARMS).join(',')).split(',');
const CHILD_ENV = { ...process.env }; delete CHILD_ENV.CLAUDE_EFFORT;
// Amendment 2: billing must be the subscription. In -p mode an API key, when present, is always used.
const KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const keyAssertion = { at: new Date().toISOString(), checked: KEY_VARS, present: KEY_VARS.filter((k) => process.env[k] !== undefined), rule: 'refuse to run if any is set (subscription-only decision, PRECOMMIT amendment 2)' };
if (keyAssertion.present.length) { console.error('refusing to run: ' + keyAssertion.present.join(',') + ' set; the user chose subscription billing only'); process.exit(2); }
// Resume: a run whose receipt exists and succeeded is kept, not repeated.
const RESUME = process.env.RESUME !== '0';
const USAGE_LIMIT_RE = /rate.?limit|usage.?limit|limit reached|out of (extra )?usage|too many requests|429|overloaded/i;

// Precommit: the last line of receipt/precommit.sha256 must match the current PRECOMMIT.md.
const precommitFile = path.join(RECEIPT, 'precommit.sha256');
const precommitNow = sha(readFileSync(path.join(DIR, 'PRECOMMIT.md')));
if (!existsSync(precommitFile)) throw new Error('receipt/precommit.sha256 missing: hash PRECOMMIT.md before measuring');
const recorded = readFileSync(precommitFile, 'utf8').trim().split('\n').pop().split(/\s+/)[0];
if (recorded !== precommitNow) throw new Error(`PRECOMMIT.md changed after hashing: recorded ${recorded.slice(0, 12)}, now ${precommitNow.slice(0, 12)}`);
writeFileSync(path.join(RECEIPT, 'prompt.sha256'), [['prompt.txt', PROMPT], ['prompt-variant.txt', PROMPT_VARIANT]].map(([n, s]) => `${sha(s)}  ${n}`).join('\n') + '\n');

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
function pkgVersion(p) { const f = path.join(DIR, 'node_modules', p, 'package.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).version : null; }
function envSnapshot(label) {
  return {
    label, at: new Date().toISOString(), kernel: os.release(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    loadavg: os.loadavg(), mem_total_bytes: os.totalmem(), mem_free_bytes: os.freemem(), node: process.version,
    claude_cli: sh('claude --version'), git_commit: sh(`git -C ${DIR} rev-parse HEAD`), tctl: sh('sensors 2>/dev/null | grep -m1 -i tctl') || null,
    asc_version: pkgVersion('assemblyscript'), probe_cwd: CWD, cwd_listing: readdirSync(CWD),
    child_env_claude_effort: 'removed', api_key_assertion: keyAssertion, resume: RESUME, host_claude_effort: process.env.CLAUDE_EFFORT ?? null, common_flags: COMMON,
    hashes: { 'run.mjs': sha(readFileSync(path.join(DIR, 'run.mjs'))), 'PRECOMMIT.md': precommitNow, 'prompt.txt': sha(PROMPT), 'prompt-variant.txt': sha(PROMPT_VARIANT) },
    arms: ARM_ORDER, phases: PHASES,
  };
}

function stripFences(s) { const m = s.match(/```[a-zA-Z]*\n([\s\S]*?)```/); return (m ? m[1] : s).replace(/\s+$/, '') + '\n'; }
function ascGate(id, code) {
  const asc = path.join(DIR, 'node_modules', '.bin', 'asc');
  if (!existsSync(asc)) return { status: 'not checked', reason: 'asc not installed (run setup.sh)' };
  const file = path.join(KERNELS, id + '.ts'); writeFileSync(file, code);
  const lines = code.split('\n').length - 1;
  try { execSync(`"${asc}" "${file}" --runtime stub --noEmit`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); return { status: 'pass', lines }; }
  catch (e) { const msg = (e.stderr || e.stdout || String(e)).toString(); return { status: 'fail', lines, first_error: msg.split('\n').find((l) => /ERROR|error/.test(l)) || msg.slice(0, 200), error_count: (msg.match(/ERROR/g) || []).length }; }
}

function args(arm, format) { return ['-p', '--output-format', format, ...COMMON, ...ARMS[arm].extra]; }

function record(arm, id, prompt, argv, wall_ms, j, exit_code, stderr, text, extra = {}) {
  const u = j?.usage || {};
  const total_in = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const out = u.output_tokens ?? null, think = u.output_tokens_details?.thinking_tokens ?? null;
  const r = {
    id, arm, at: new Date().toISOString(), argv, cwd: CWD, prompt_sha256: sha(prompt), prompt_bytes: Buffer.byteLength(prompt),
    exit_code, is_error: j?.is_error ?? true, subtype: j?.subtype ?? null, terminal_reason: j?.terminal_reason ?? null, stop_reason: j?.stop_reason ?? null,
    model_ids: j?.modelUsage ? Object.keys(j.modelUsage) : [], model_usage: j?.modelUsage ?? null,
    wall_ms: +wall_ms.toFixed(1), duration_ms: j?.duration_ms ?? null, duration_api_ms: j?.duration_api_ms ?? null, num_turns: j?.num_turns ?? null,
    usage: u, thinking_tokens: think, visible_tokens: out != null && think != null ? out - think : null,
    context_size_tokens: total_in, total_cost_usd_list: j?.total_cost_usd ?? null,
    tok_s_wall: out && wall_ms ? +(out / (wall_ms / 1000)).toFixed(2) : null, tok_s_api: out && j?.duration_api_ms ? +(out / (j.duration_api_ms / 1000)).toFixed(2) : null,
    result_chars: text.length, result_head: text.slice(0, 160), stderr_head: stderr.slice(0, 400), ...extra,
  };
  r.asc_gate = !r.is_error && text ? ascGate(id, stripFences(text)) : { status: 'not checked', reason: r.is_error ? 'run errored' : 'no result text' };
  writeFileSync(path.join(RAW, id + '.json'), JSON.stringify(r, null, 2));
  console.error(`${id}: wall=${r.wall_ms}ms api=${r.duration_api_ms} out=${out} think=${think} in=${u.input_tokens} cr=${u.cache_read_input_tokens} cc=${u.cache_creation_input_tokens} ctx=${total_in} usd=${r.total_cost_usd_list} err=${r.is_error} model=${r.model_ids.join(',')} asc=${r.asc_gate.status}${r.is_error ? ' :: ' + (j?.result ?? stderr).slice(0, 120) : ''}`);
  return r;
}

function runJson(arm, id, prompt) {
  return new Promise((resolve) => {
    if (RESUME && existsSync(path.join(RAW, id + '.json'))) { const prev = JSON.parse(readFileSync(path.join(RAW, id + '.json'), 'utf8')); if (!prev.is_error) { console.error(`${id}: kept from earlier invocation (resume)`); prev.resumed = true; return resolve(prev); } }
    const argv = args(arm, 'json');
    const t0 = process.hrtime.bigint();
    const child = spawn('claude', argv, { cwd: CWD, env: CHILD_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const wall_ms = Number(process.hrtime.bigint() - t0) / 1e6;
      let j = null; try { j = JSON.parse(out); } catch { }
      writeFileSync(path.join(RAW, id + '.cli-output.txt'), out);
      resolve(record(arm, id, prompt, argv, wall_ms, j, code, err, j?.result ?? ''));
    });
    child.stdin.end(prompt);
  });
}

function runStream(arm, id, prompt) {
  return new Promise((resolve) => {
    if (RESUME && existsSync(path.join(RAW, id + '.json'))) { const prev = JSON.parse(readFileSync(path.join(RAW, id + '.json'), 'utf8')); if (!prev.is_error) { console.error(`${id}: kept from earlier invocation (resume)`); prev.resumed = true; return resolve(prev); } }
    const argv = [...args(arm, 'stream-json'), '--verbose', '--include-partial-messages'];
    const t0 = process.hrtime.bigint(); const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const child = spawn('claude', argv, { cwd: CWD, env: CHILD_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', text = '', result = null, raw = '';
    const t = { first_event_ms: null, message_start_ms: null, first_thinking_delta_ms: null, first_text_delta_ms: null, first_assistant_ms: null, event_count: 0, event_types: new Set() };
    child.stdout.on('data', (d) => {
      buf += d; raw += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const now = +ms().toFixed(1); t.event_count++; t.event_types.add(ev.type + (ev.event?.type ? ':' + ev.event.type : ''));
        if (t.first_event_ms === null) t.first_event_ms = now;
        if (ev.type === 'stream_event') {
          if (ev.event?.type === 'message_start' && t.message_start_ms === null) t.message_start_ms = now;
          if (ev.event?.type === 'content_block_delta') {
            if (ev.event.delta?.type === 'thinking_delta' && t.first_thinking_delta_ms === null) t.first_thinking_delta_ms = now;
            if (ev.event.delta?.type === 'text_delta') { if (t.first_text_delta_ms === null) t.first_text_delta_ms = now; text += ev.event.delta.text; }
          }
        }
        if (ev.type === 'assistant' && t.first_assistant_ms === null) t.first_assistant_ms = now;
        if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const wall_ms = ms();
      writeFileSync(path.join(RAW, id + '.cli-output.txt'), raw);
      const timing = { ...t, event_types: [...t.event_types] };
      const r = record(arm, id, prompt, argv, wall_ms, result, code, err, text || (result?.result ?? ''), { stream_timing: timing });
      if (t.first_text_delta_ms !== null) {
        if (r.visible_tokens) r.decode_visible_tok_s = +(r.visible_tokens / ((wall_ms - t.first_text_delta_ms) / 1000)).toFixed(2);
        if (r.usage.output_tokens) r.decode_all_output_tok_s = +(r.usage.output_tokens / ((wall_ms - t.first_text_delta_ms) / 1000)).toFixed(2);
        writeFileSync(path.join(RAW, id + '.json'), JSON.stringify(r, null, 2));
      }
      resolve(r);
    });
    child.stdin.end(prompt);
  });
}

function stats(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)];
  return { n: v.length, min: v[0], median: q(0.5), p95: q(0.95), max: v[v.length - 1] };
}
function summarise(before, after, parallel) {
  const all = readdirSync(RAW).filter((f) => /^S\d-[a-z-]+-[ABCD]-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(RAW, f), 'utf8')));
  const byArm = {}; for (const r of all) (byArm[r.arm] ||= []).push(r);
  const ok = (rs) => rs.filter((r) => !r.is_error);
  const ph = (rs, P) => ok(rs).filter((r) => r.id.includes(`-${P}-`));
  const armSummary = (rs) => ({
    runs: rs.length, errors: rs.filter((r) => r.is_error).length, model_ids: [...new Set(rs.flatMap((r) => r.model_ids))],
    all_ok: { wall_ms: stats(ok(rs).map((r) => r.wall_ms)), duration_api_ms: stats(ok(rs).map((r) => r.duration_api_ms)), output_tokens: stats(ok(rs).map((r) => r.usage.output_tokens)), thinking_tokens: stats(ok(rs).map((r) => r.thinking_tokens)), visible_tokens: stats(ok(rs).map((r) => r.visible_tokens)), tok_s_wall: stats(ok(rs).map((r) => r.tok_s_wall)), tok_s_api: stats(ok(rs).map((r) => r.tok_s_api)), input_tokens: stats(ok(rs).map((r) => r.usage.input_tokens)), cache_read: stats(ok(rs).map((r) => r.usage.cache_read_input_tokens)), cache_creation: stats(ok(rs).map((r) => r.usage.cache_creation_input_tokens)), context_size_tokens: stats(ok(rs).map((r) => r.context_size_tokens)), cost_usd_list: stats(ok(rs).map((r) => r.total_cost_usd_list)), kernel_lines: stats(ok(rs).map((r) => r.asc_gate?.lines)) },
    A_sequential: { wall_ms: stats(ph(rs, 'A').map((r) => r.wall_ms)), output_tokens: stats(ph(rs, 'A').map((r) => r.usage.output_tokens)), cache_read: ph(rs, 'A').map((r) => r.usage.cache_read_input_tokens), cache_creation: ph(rs, 'A').map((r) => r.usage.cache_creation_input_tokens) },
    B_variant: { wall_ms: stats(ph(rs, 'B').map((r) => r.wall_ms)), cache_read: ph(rs, 'B').map((r) => r.usage.cache_read_input_tokens), cache_creation: ph(rs, 'B').map((r) => r.usage.cache_creation_input_tokens) },
    C_parallel4: { per_call_wall_ms: ph(rs, 'C').map((r) => r.wall_ms), cache_read: ph(rs, 'C').map((r) => r.usage.cache_read_input_tokens), errors: rs.filter((r) => r.id.includes('-C-') && r.is_error).length },
    D_stream: { ttft_first_text_delta_ms: stats(ph(rs, 'D').map((r) => r.stream_timing?.first_text_delta_ms)), first_thinking_delta_ms: stats(ph(rs, 'D').map((r) => r.stream_timing?.first_thinking_delta_ms)), first_event_ms: stats(ph(rs, 'D').map((r) => r.stream_timing?.first_event_ms)), message_start_ms: stats(ph(rs, 'D').map((r) => r.stream_timing?.message_start_ms)), decode_visible_tok_s: stats(ph(rs, 'D').map((r) => r.decode_visible_tok_s)), decode_all_output_tok_s: stats(ph(rs, 'D').map((r) => r.decode_all_output_tok_s)) },
    asc_gate: Object.fromEntries(rs.map((r) => [r.id, r.asc_gate?.status])),
    errors_detail: rs.filter((r) => r.is_error).map((r) => ({ id: r.id, subtype: r.subtype, result_head: r.result_head, stderr_head: r.stderr_head })),
  });
  const summary = {
    probe: 'P-04b-bare-api-model-term (amendment 1: subscription arms)', at: after.at, cli: before.claude_cli, probe_cwd: CWD,
    p04_reference_context_tokens: { min: 453290, max: 468214, note: 'P-04 phases A/B-1,2/D cache_read + cache_creation (RESULT.md §2)' },
    arms: Object.fromEntries(Object.entries(byArm).map(([k, v]) => [k, armSummary(v)])),
    C_parallel4_batch: parallel, load_before: before.loadavg, load_after: after.loadavg,
    usage_fields_seen: all.find((r) => r.usage && Object.keys(r.usage).length) ? Object.keys(all.find((r) => r.usage && Object.keys(r.usage).length).usage) : null,
    total_cost_usd_list_sum: +all.reduce((s, r) => s + (r.total_cost_usd_list || 0), 0).toFixed(4),
  };
  writeFileSync(path.join(RECEIPT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.error('summary written to receipt/summary.json');
}

async function main() {
  const before = envSnapshot('before');
  writeFileSync(path.join(RECEIPT, 'env-before.json'), JSON.stringify(before, null, 2));
  const parallel = existsSync(path.join(RECEIPT, 'summary.json')) ? (JSON.parse(readFileSync(path.join(RECEIPT, 'summary.json'), 'utf8')).C_parallel4_batch || {}) : {};
  let notLoggedIn = false;
  for (const arm of ARM_ORDER) {
    if (!ARMS[arm]) throw new Error('unknown arm ' + arm);
    if (notLoggedIn) { console.error(`skipping ${arm}: CLI not logged in`); continue; }
    let errors = 0, turns = 0, stop = false;
    let usageLimit = false;
    const guard = (r) => { turns++; if (r.is_error) errors++; if (/Not logged in/.test(r.result_head)) notLoggedIn = true; if (r.is_error && USAGE_LIMIT_RE.test((r.result_head || '') + ' ' + (r.stderr_head || ''))) usageLimit = true; stop = errors >= MAX_ERRORS_PER_ARM || turns >= MAX_TURNS_PER_ARM || notLoggedIn || usageLimit; if (stop) console.error(`stop ${arm}: errors=${errors} turns=${turns} notLoggedIn=${notLoggedIn} usageLimit=${usageLimit}`); return stop; };
    const armStatus = () => { const f = path.join(RECEIPT, 'arm-status.json'); const st = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; st[arm] = { at: new Date().toISOString(), turns, errors, status: usageLimit ? 'stopped: usage limit' : notLoggedIn ? 'stopped: not logged in' : errors >= MAX_ERRORS_PER_ARM ? 'stopped: two errors' : 'complete' }; writeFileSync(f, JSON.stringify(st, null, 2)); };
    if (PHASES.includes('A')) for (let i = 1; i <= 3 && !stop; i++) guard(await runJson(arm, `${arm}-A-${i}`, PROMPT));
    if (PHASES.includes('B')) for (let i = 1; i <= 3 && !stop; i++) guard(await runJson(arm, `${arm}-B-${i}`, PROMPT_VARIANT));
    if (PHASES.includes('C') && !stop && turns + 4 <= MAX_TURNS_PER_ARM) {
      const t0 = process.hrtime.bigint();
      const rs = await Promise.all([1, 2, 3, 4].map((i) => runJson(arm, `${arm}-C-${i}`, PROMPT)));
      const batch_wall_ms = Number(process.hrtime.bigint() - t0) / 1e6;
      parallel[arm] = { batch_wall_ms: +batch_wall_ms.toFixed(1), per_call_wall_ms: rs.map((r) => r.wall_ms), per_call_output_tokens: rs.map((r) => r.usage.output_tokens), per_call_cache_read: rs.map((r) => r.usage.cache_read_input_tokens), errors: rs.filter((r) => r.is_error).length, aggregate_tok_s_wall: +(rs.reduce((s, r) => s + (r.usage.output_tokens || 0), 0) / (batch_wall_ms / 1000)).toFixed(2) };
      rs.forEach(guard);
    }
    if (PHASES.includes('D')) for (let i = 1; i <= 2 && !stop; i++) guard(await runStream(arm, `${arm}-D-${i}`, PROMPT));
    armStatus();
  }
  const after = envSnapshot('after');
  writeFileSync(path.join(RECEIPT, 'env-after.json'), JSON.stringify(after, null, 2));
  summarise(before, after, parallel);
}
main().catch((e) => { console.error(e); process.exit(1); });
