#!/usr/bin/env node
// P-04 model-term runner. Idempotent: every invocation writes a fresh receipt/raw/<phase>-<n>.json
// (overwriting) and recomputes receipt/summary.json. Network use is the hosted model call only.
// Usage: node run.mjs            (phases A B C D)
//        PHASES=A,C node run.mjs  (subset)
//        MODEL=<id> node run.mjs  (pass --model; default: CLI default, recorded from modelUsage)
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, 'receipt', 'raw');
const KERNELS = path.join(DIR, 'kernels');
mkdirSync(RAW, { recursive: true });
mkdirSync(KERNELS, { recursive: true });

const PROMPT = readFileSync(path.join(DIR, 'prompt.txt'), 'utf8');
const PROMPT_VARIANT = readFileSync(path.join(DIR, 'prompt-variant.txt'), 'utf8');
const MODEL = process.env.MODEL || '';
const PHASES = (process.env.PHASES || 'A,B,C,D').split(',');
const BUDGET = process.env.BUDGET_USD || '2';
const sha = (s) => createHash('sha256').update(s).digest('hex');

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
function envSnapshot(label) {
  const mem = os.totalmem(), free = os.freemem();
  return {
    label, at: new Date().toISOString(),
    kernel: os.release(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    loadavg: os.loadavg(), mem_total_bytes: mem, mem_free_bytes: free,
    node: process.version, claude_cli: sh('claude --version'),
    git_commit: sh(`git -C ${DIR} rev-parse HEAD`) || 'not a git repository',
    tctl: sh("sensors 2>/dev/null | grep -m1 -i tctl") || null,
    hashes: {
      'run.mjs': sha(readFileSync(path.join(DIR, 'run.mjs'))),
      'prompt.txt': sha(PROMPT), 'prompt-variant.txt': sha(PROMPT_VARIANT),
      'PRECOMMIT.md': sha(readFileSync(path.join(DIR, 'PRECOMMIT.md'))),
    },
    asc_version: existsSync(path.join(DIR, 'node_modules/assemblyscript/package.json'))
      ? JSON.parse(readFileSync(path.join(DIR, 'node_modules/assemblyscript/package.json'), 'utf8')).version : null,
    model_flag: MODEL || '(cli default)',
  };
}

function baseArgs(format) {
  const a = ['-p', '--output-format', format, '--no-session-persistence', '--tools', '', '--max-budget-usd', BUDGET];
  if (MODEL) a.push('--model', MODEL);
  return a;
}

// One hosted call in json mode. Prompt is passed on stdin to keep argv small and identical.
function runJson(prompt, id) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn('claude', baseArgs('json'), { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const wall_ms = Number(process.hrtime.bigint() - t0) / 1e6;
      let j = null; try { j = JSON.parse(out); } catch { }
      const r = record(id, prompt, wall_ms, j, code, err, out);
      resolve(r);
    });
    child.stdin.end(prompt);
  });
}

// One hosted call in stream-json mode; measures time to first event, first assistant text delta, result.
function runStream(prompt, id) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const args = baseArgs('stream-json'); args.push('--verbose', '--include-partial-messages');
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', text = '', first_event_ms = null, first_text_ms = null, first_assistant_ms = null, result = null;
    const events = [];
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const t = ms();
        if (first_event_ms === null) first_event_ms = t;
        events.push({ t_ms: +t.toFixed(1), type: ev.type, subtype: ev.subtype, event_type: ev.event?.type, delta_type: ev.event?.delta?.type });
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          if (first_text_ms === null) first_text_ms = t;
          text += ev.event.delta.text;
        }
        if (ev.type === 'assistant' && first_assistant_ms === null) first_assistant_ms = t;
        if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const wall_ms = ms();
      const r = record(id, prompt, wall_ms, result, code, err, text || (result?.result ?? ''));
      r.ttft = { first_event_ms, first_assistant_ms, first_text_delta_ms: first_text_ms, event_count: events.length, event_types: [...new Set(events.map((e) => e.type + (e.event_type ? ':' + e.event_type : '')))] };
      r.events_head = events.slice(0, 12);
      if (first_text_ms !== null && r.usage.output_tokens) r.decode_tok_s = +(r.usage.output_tokens / ((wall_ms - first_text_ms) / 1000)).toFixed(2);
      writeFileSync(path.join(RAW, id + '.json'), JSON.stringify(r, null, 2));
      resolve(r);
    });
    child.stdin.end(prompt);
  });
}

function stripFences(s) {
  const m = s.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m ? m[1] : s).replace(/\s+$/, '') + '\n';
}

function ascGate(id, code) {
  const asc = path.join(DIR, 'node_modules', '.bin', 'asc');
  if (!existsSync(asc)) return { status: 'not checked', reason: 'asc not installed (run setup.sh)' };
  const file = path.join(KERNELS, id + '.ts');
  writeFileSync(file, code);
  try {
    execSync(`"${asc}" "${file}" --runtime stub --noEmit`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    return { status: 'pass', lines: code.split('\n').length - 1 };
  } catch (e) {
    const msg = (e.stderr || e.stdout || String(e)).toString();
    return { status: 'fail', lines: code.split('\n').length - 1, first_error: msg.split('\n').find((l) => /ERROR|error/.test(l)) || msg.slice(0, 200), error_count: (msg.match(/ERROR/g) || []).length };
  }
}

function record(id, prompt, wall_ms, j, exit_code, stderr, rawOut) {
  const u = j?.usage || {};
  const out_tok = u.output_tokens ?? 0;
  const prompt_bytes = Buffer.byteLength(prompt);
  const prompt_tok_est = Math.round(prompt_bytes / 4);
  const total_in = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const r = {
    id, at: new Date().toISOString(), prompt_sha256: sha(prompt), prompt_bytes, prompt_tok_est_bytes_div_4: prompt_tok_est,
    exit_code, is_error: j?.is_error ?? true, subtype: j?.subtype ?? null, stop_reason: j?.stop_reason ?? null,
    model_ids: j?.modelUsage ? Object.keys(j.modelUsage) : [],
    wall_ms: +wall_ms.toFixed(1), duration_ms: j?.duration_ms ?? null, duration_api_ms: j?.duration_api_ms ?? null,
    usage: {
      input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
      cache_read_input_tokens: u.cache_read_input_tokens ?? null, cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
      cache_creation: u.cache_creation ?? null, thinking_tokens: u.output_tokens_details?.thinking_tokens ?? null, service_tier: u.service_tier ?? null,
    },
    total_input_tokens_all_classes: total_in, input_gap_vs_prompt_est: total_in ? total_in - prompt_tok_est : null,
    total_cost_usd: j?.total_cost_usd ?? null, num_turns: j?.num_turns ?? null,
    tok_s_wall: out_tok && wall_ms ? +(out_tok / (wall_ms / 1000)).toFixed(2) : null,
    tok_s_api: out_tok && j?.duration_api_ms ? +(out_tok / (j.duration_api_ms / 1000)).toFixed(2) : null,
    result_chars: (j?.result ?? '').length, result_head: (j?.result ?? '').slice(0, 160),
    stderr_head: stderr.slice(0, 400), json_fields: j ? Object.keys(j) : null, usage_fields: j?.usage ? Object.keys(j.usage) : null,
  };
  if (!r.is_error && j?.result) r.asc_gate = ascGate(id, stripFences(j.result));
  else r.asc_gate = { status: 'not checked', reason: r.is_error ? 'run errored' : 'no result text' };
  writeFileSync(path.join(RAW, id + '.json'), JSON.stringify(r, null, 2));
  writeFileSync(path.join(RAW, id + '.cli-output.txt'), typeof rawOut === 'string' ? rawOut : '');
  console.error(`${id}: wall=${r.wall_ms}ms out=${r.usage.output_tokens} in=${r.usage.input_tokens} cr=${r.usage.cache_read_input_tokens} cc=${r.usage.cache_creation_input_tokens} err=${r.is_error} model=${r.model_ids.join(',')} asc=${r.asc_gate.status}`);
  return r;
}

function stats(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)];
  return { n: v.length, min: v[0], median: q(0.5), p95: q(0.95), max: v[v.length - 1] };
}

async function main() {
  const before = envSnapshot('before');
  writeFileSync(path.join(DIR, 'receipt', 'env-before.json'), JSON.stringify(before, null, 2));
  const all = { A: [], B: [], C: [], D: [] };
  let consecutiveErrors = 0;
  const guard = (r) => { consecutiveErrors = r.is_error ? consecutiveErrors + 1 : 0; return consecutiveErrors >= 3; };

  if (PHASES.includes('A')) for (let i = 1; i <= 5; i++) { const r = await runJson(PROMPT, `A-seq-${i}`); all.A.push(r); if (guard(r)) { console.error('stop rule: 3 consecutive errors'); break; } }
  if (PHASES.includes('B') && consecutiveErrors < 3) for (let i = 1; i <= 3; i++) { const r = await runJson(PROMPT_VARIANT, `B-variant-${i}`); all.B.push(r); if (guard(r)) { console.error('stop rule'); break; } }
  let parallel = null;
  if (PHASES.includes('C') && consecutiveErrors < 3) {
    const t0 = process.hrtime.bigint();
    const rs = await Promise.all([1, 2, 3, 4].map((i) => runJson(PROMPT, `C-par-${i}`)));
    const batch_wall_ms = Number(process.hrtime.bigint() - t0) / 1e6;
    all.C = rs;
    parallel = { batch_wall_ms: +batch_wall_ms.toFixed(1), per_child_wall_ms: rs.map((r) => r.wall_ms), per_child_output_tokens: rs.map((r) => r.usage.output_tokens), errors: rs.filter((r) => r.is_error).length, aggregate_tok_s_wall: +(rs.reduce((s, r) => s + (r.usage.output_tokens || 0), 0) / (batch_wall_ms / 1000)).toFixed(2) };
    rs.forEach(guard);
  }
  if (PHASES.includes('D') && consecutiveErrors < 3) for (let i = 1; i <= 3; i++) { const r = await runStream(PROMPT, `D-stream-${i}`); all.D.push(r); if (guard(r)) { console.error('stop rule'); break; } }

  const after = envSnapshot('after');
  writeFileSync(path.join(DIR, 'receipt', 'env-after.json'), JSON.stringify(after, null, 2));
  const ok = (rs) => rs.filter((r) => !r.is_error);
  const summary = {
    probe: 'P-04-model-term', at: after.at, model_ids: [...new Set(Object.values(all).flat().flatMap((r) => r.model_ids))],
    cli: before.claude_cli, counts: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { runs: v.length, errors: v.filter((r) => r.is_error).length }])),
    A_sequential: { wall_ms: stats(ok(all.A).map((r) => r.wall_ms)), output_tokens: stats(ok(all.A).map((r) => r.usage.output_tokens)), tok_s_wall: stats(ok(all.A).map((r) => r.tok_s_wall)), tok_s_api: stats(ok(all.A).map((r) => r.tok_s_api)), input_tokens: stats(ok(all.A).map((r) => r.usage.input_tokens)), cache_read: stats(ok(all.A).map((r) => r.usage.cache_read_input_tokens)), cache_creation: stats(ok(all.A).map((r) => r.usage.cache_creation_input_tokens)), cost_usd: stats(ok(all.A).map((r) => r.total_cost_usd)), input_gap_vs_prompt_est: stats(ok(all.A).map((r) => r.input_gap_vs_prompt_est)) },
    B_variant: { wall_ms: stats(ok(all.B).map((r) => r.wall_ms)), cache_read: stats(ok(all.B).map((r) => r.usage.cache_read_input_tokens)), cache_creation: stats(ok(all.B).map((r) => r.usage.cache_creation_input_tokens)), output_tokens: stats(ok(all.B).map((r) => r.usage.output_tokens)), tok_s_wall: stats(ok(all.B).map((r) => r.tok_s_wall)) },
    C_parallel4: parallel,
    D_stream: { ttft_first_text_delta_ms: stats(ok(all.D).map((r) => r.ttft?.first_text_delta_ms)), first_event_ms: stats(ok(all.D).map((r) => r.ttft?.first_event_ms)), wall_ms: stats(ok(all.D).map((r) => r.wall_ms)), decode_tok_s_after_first_token: stats(ok(all.D).map((r) => r.decode_tok_s)), cache_read: stats(ok(all.D).map((r) => r.usage.cache_read_input_tokens)) },
    asc_gate: Object.fromEntries(Object.values(all).flat().map((r) => [r.id, r.asc_gate?.status])),
    errors: Object.values(all).flat().filter((r) => r.is_error).map((r) => ({ id: r.id, result_head: r.result_head, exit_code: r.exit_code })),
    load_before: before.loadavg, load_after: after.loadavg,
    json_fields_seen: Object.values(all).flat().find((r) => r.json_fields)?.json_fields ?? null,
    usage_fields_seen: Object.values(all).flat().find((r) => r.usage_fields)?.usage_fields ?? null,
  };
  writeFileSync(path.join(DIR, 'receipt', 'summary.json'), JSON.stringify(summary, null, 2));
  console.error('summary written to receipt/summary.json');
}
main();
