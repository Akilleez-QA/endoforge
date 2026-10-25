# P-04b bare-api-model-term — precommit

Written 2026-10-17 before the first measurement. Hash in `receipt/precommit.sha256` (written by
`run.mjs` on its first invocation and verified on every later one).

## Question

What is one model turn like against the P-04 "SDK context" prompt when the only context is that
prompt — a direct Anthropic Messages API call with the probe-local SDK, no harness, no tool schemas,
no settings — and how does that differ from the Claude Code CLI turn P-04 measured (≈470k cached
context tokens, thinking on, ~94 s, ~9k output tokens, $0.36 per cached turn)? Is `claude -p --bare`
a usable middle arm, and what context does it carry?

## Unknown de-risked

- P-04 RESULT.md §2 and "What this probe does not show": every P-04 number is a CLI-harness number,
  and "a bare Messages API call with the same 2,600-token prompt would have ~1/180 of the input and
  a different cost and TTFT profile". WP24a (`docs/execution/WORK-PACKAGES.md`) needs this before
  X5 (C05) can be registered against a hosted baseline.
- Edition 3 §2 worked Estimated example ("a 100-line kernel is about 1,000 tokens, 5–10 s") and
  §10's hosted term; errata E3-20 and E3-25. R09 §10 takes T_h = 5–10 s.
- Whether the prompt's own ~2.6k-token prefix is served from cache at all (the minimum cacheable
  prefix is model-dependent; a 2.6k prefix may be below it — that outcome is a finding, not a failure).

## Arms

All API arms use `@anthropic-ai/sdk` 0.135.0 (pinned in `setup.sh`, hashes in `receipt/deps.txt`),
`client.messages.create` / `.stream`, `max_tokens 16000`, no `system`, no `tools`, default sampling.
The prompt is sent as one user message of two text blocks: `prompt-prefix.txt` (10,219 B, with
`cache_control: {type: "ephemeral"}`) followed by the last line, so that bytes sent equal
`prompt.txt` / `prompt-variant.txt` exactly (verified: both files start with the prefix). Input token
counts come from `messages.countTokens` (free) rather than bytes/4.

| Arm | Model | Thinking setting | Why |
|---|---|---|---|
| `opus-low` | `claude-opus-5-5` | `output_config.effort: "low"`, `thinking` omitted | "Thinking off" is not available on this model (`{type:"disabled"}` and `budget_tokens` are rejected with 400 — Upstream, claude-api skill cached 2026-10-06). `low` effort is the least thinking the model offers. |
| `opus-medium` | `claude-opus-5-5` | `output_config.effort: "medium"`, `thinking` omitted (adaptive) | The CLI default P-04 inherited (`CLAUDE_EFFORT=medium`), so this arm is the closest like-for-like with P-04. A fixed `budget_tokens` cannot be set on this model; effort is the only control. |
| `sonnet-off` | `claude-sonnet-5-5` | `thinking: {type: "between_tools"}` (no tools in the request, so no thinking occurs) | The only thinking-off setting Sonnet 5.5 accepts. |
| `sonnet-medium` | `claude-sonnet-5-5` | `output_config.effort: "medium"`, adaptive | Comparison model at the same effort as `opus-medium`. |
| `cli-bare` | CLI 2.1.299 `claude -p --bare --output-format json --no-session-persistence --tools "" --max-budget-usd 2` | inherited (no `--effort`) | Third arm: does `--bare` drop the ~466k-token harness context P-04 saw? Records input + cache_read + cache_creation as the context size. 3 sequential runs only. |

Arms run in the order listed; the budget rule below may truncate later arms.

## Procedure (`run.mjs`, per API arm, in order)

- A. 5 sequential calls with `prompt.txt`.
- B. 3 sequential calls with `prompt-variant.txt` (same prefix, different last line): does
  `cache_read_input_tokens` > 0 for the shared prefix?
- C. 4 calls with `prompt.txt` launched concurrently (`Promise.all`); batch wall and per-call wall.
- D. 3 streaming calls with `prompt.txt` (`messages.stream`): time to `message_start`, first
  `content_block_start` of each type, first `thinking_delta`, first `text_delta`, `message_stop`.
- For every call that returns text, strip code fences, save to `kernels/<arm>-<run>.ts`, and run the
  probe-local `asc --runtime stub --noEmit` (AssemblyScript 0.28.20). Exit code only: a parse and
  type-check gate, not a correctness gate.
- `cli-bare`: 3 sequential json-mode runs, prompt on stdin, same record shape as P-04.

## Metrics (per call)

Wall (hrtime around the request, ms); `usage.input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.*`,
`output_tokens_details.thinking_tokens`, `service_tier`; `stop_reason`; model id from the response;
`request-id` header where exposed. Derived: visible tokens = output − thinking; tok/s = output /
wall s; for D: TTFT = first `text_delta` ms, decode tok/s = visible tokens / (wall − TTFT); cost per
the price table below. Input token count of the prompt per model from `countTokens`. Summaries:
median, p95, min, max, n. Environment before/after (`receipt/env-before.json`, `env-after.json`).

Price table (Upstream, claude-api skill cache 2026-10-06, first-party list, USD per million tokens):
Opus 5.5 input 4.00, output 20.00, cache read 0.20, 5-minute cache write 5.00 (1.25× input);
Sonnet 5.5 input 2.00, output 10.00, cache read 0.20, cache write 2.50. Thinking tokens are billed
as output. Cost is **Derived** from these and the returned usage, not read from a bill.

## Budget

Total API spend for this probe is capped at **USD 5.00**, counted in `receipt/budget.json` (one line
per call, cumulative). Before every call the runner checks `spent + estimate ≤ 5.00`, where the
estimate is the median cost of completed calls in the same arm, or a prior of 0.25 (Opus) / 0.12
(Sonnet) before any; phase C requires 4× the estimate. If the check fails the arm stops and later
arms are skipped; what ran is reported. The CLI arm is outside this count (it is billed to the CLI
login, reported as `total_cost_usd` at list, and capped per run at 2.00 as in P-04).

## What counts as a bad sign

- Bare-API wall for the same prompt still ≫ 10 s at low effort → the E3 §2 "5–10 s" figure is not
  about thinking or the harness; it is about generation length for this prompt.
- `cache_read_input_tokens == 0` on every B call → the 2.6k prefix is below the cacheable minimum or
  caching is not engaged; the "warm SDK context" lever needs a longer context to be measurable.
- Parallel-4 batch wall ≈ 4× single → concurrency is serialised at this key's rate limit.
- `asc` failures on most calls at low effort → first-pass syntactic yield depends on thinking.
- `cli-bare` context ≈ 470k → `--bare` does not remove the harness context; the CLI is not a usable
  bare arm.

## Stop rule

Stop after the last arm's phase D, or earlier when: the budget rule fails; the API returns an error
on three consecutive calls in an arm (record, skip to next arm); or no credential is available (then
nothing runs and RESULT.md says so). Total API calls ≤ 60. Nothing outside
`experiments/P-04b-bare-api-model-term/` is written by the runner. No commit by the runner.

---

## Amendment 1 (2026-10-17, before any subscription-arm measurement)

The original precommit above hashes to `3e39b0104349d5a7b52b9a279626068a8f0b71180d81ec291be7bedcd37b731c`
(`receipt/precommit.sha256`, first line; kept). After its `cli-bare` arm showed that `--bare` is
key-gated, the user decided **not to use the API: subscription only**. The four API arms (`opus-low`,
`opus-medium`, `sonnet-off`, `sonnet-medium`) are dropped permanently and recorded as **not run: user
chose subscription only**. Everything below replaces the "Arms", "Procedure", "Budget" and "Stop rule"
sections for the measurement that follows; the question, unknown, metrics, price table and bad-sign list
stand, except that cost is the CLI's `total_cost_usd` at list price (informational: the subscription has
no dollar meter).

### Subscription arms (logged-in `claude -p`, CLI 2.1.299)

Common flags, chosen from `claude -p --help` to give the leanest context the CLI allows:
`-p --output-format json|stream-json --no-session-persistence --tools "" --strict-mcp-config
--mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-chrome --setting-sources ""
--max-budget-usd 2`. Prompt on stdin. The child runs with `CLAUDE_EFFORT` removed from its environment
(P-04 inherited `medium`) in an **empty working directory under the session scratchpad** with no
`CLAUDE.md`/`AGENTS.md` in it or any ancestor, so no project context loads. One smoke turn with the prompt
"Reply with the single word ok." (not counted; `receipt/smoke-lean-flags.json`) showed these flags are
accepted and carried 3,236 input tokens in all classes (535 cache read, 2,699 cache creation, 2 uncached).

| Arm | Extra flags | Why |
|---|---|---|
| `S1-lean` | none (CLI default model and effort) | Leanest context the CLI allows; the arm that answers "how much of P-04's ~466k was removable" |
| `S2-lean-low` | `--effort low` | Thinking at the lowest effort the CLI offers |
| `S3-lean-sonnet` | `--model claude-sonnet-5-5` | Comparison model, same context |
| `S4-lean-sysprompt` | `--system-prompt "You write AssemblyScript. Output only code."` | Does replacing the CLI's own system prompt shrink the context further |

### Procedure (per arm, in order; `run.mjs`)

A. 3 sequential `prompt.txt`; B. 3 sequential `prompt-variant.txt`; C. 4 concurrent `prompt.txt`
(`Promise.all`); D. 2 `prompt.txt` with `--output-format stream-json --verbose --include-partial-messages`
for TTFT. 12 turns per arm, 48 in all. Same `asc` gate. Record `usage.*` including `cache_read_input_tokens`,
`cache_creation_input_tokens`, `output_tokens_details.thinking_tokens`, `modelUsage`, `total_cost_usd`.
Context size per turn = input + cache_read + cache_creation, compared with P-04's 453k–468k.

### Budget and stop rule

No dollar meter: cap **15 turns per arm** (12 planned); `--max-budget-usd 2` per turn as in P-04, reported
not enforced by the subscription. Stop an arm when two of its runs have errored (any `is_error`), then
continue with the next arm. Stop entirely if `claude` reports not logged in. Nothing outside this
directory is written except the empty scratch cwd.

---

## Amendment 2 (2026-10-17, after one subscription turn: `S1-lean-A-1`)

Added at the starting session's request after a documentation check, with one turn already recorded
(kept; its receipt is unchanged). Amendment 1 hashes to
`caba2c985c0b304a0bef85b3e4a44af30fbea5fd20e791ee048a14b75b69736d` (kept as the second line of
`receipt/precommit.sha256`).

- **Billing assertion.** In `-p` mode the CLI always uses `ANTHROPIC_API_KEY` when present, which would
  move billing to the API against the user's decision. `run.mjs` now refuses to start if
  `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, and records the check in `receipt/env-before.json`
  (`api_key_assertion`). For the first invocation the same fact was recorded from the live processes in
  `receipt/api-key-assertion.json`.
- **Usage-limit stop.** All `-p` turns draw on the subscription's 5-hour and weekly limits. If a run
  errors with a rate-limit or usage-limit message, the arm stops, is recorded as `stopped: usage limit`
  in `receipt/arm-status.json`, and is not retried.
- **Resume.** After an interruption the runner keeps any run whose receipt exists and succeeded
  (`resumed: true` in memory only; the receipt file is not rewritten) and continues with the next run.
  The first invocation was killed by a host-session restart after `S1-lean-A-1`.
- Use: personal evaluation use of the unmodified `claude` binary under the user's own login; a few
  dozen turns in total (≤ 60).
