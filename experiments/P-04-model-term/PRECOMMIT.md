# P-04 model-term — precommit

Written 2026-10-17 before the first measurement. Hash in `receipt/precommit.sha256`.

## Question

What is one model turn like for this project — wall time, output tokens, tokens per second,
and the effect of prompt caching — against a fixed "SDK context" prompt, using the hosted
model reachable from this machine through the Claude Code CLI (`claude -p`)? Is a local arm
possible on this machine today?

## Unknown de-risked

- Edition 3 §10, final lever: "Measure the one term never measured. A model turn against the
  actual SDK context with prompt caching. Every recorded number in this project is model-free."
- Edition 3 §15 Experiment 5 (first half): "One model turn against the actual SDK context with
  prompt caching." The second half (four-way batched local generation on a unified-memory
  machine, compilation concurrent) is out of scope: no local runtime, no unified-memory host.
- Edition 3 §2 evidence-label table, the worked "Estimated" example: "A 100-line kernel is
  about 1,000 tokens, 5–10 s to generate." This probe tests whether that holds here.
- Edition 3 §10 table: "20–25 s with four parallel candidates" (novel/determinate). Phase C
  looks at the hosted-API shape of "four parallel candidates".
- R09 §9 (prompt-cache residency, Estimated: TTFT "from seconds to tens of milliseconds") and
  R09 §10 (X5 derivation, which takes T_h = 5–10 s as the hosted term).
- The experiments README table assigns this probe E3-12; E3-12 in `EDITION-3-ERRATA.md` is
  about X2 library passes, not the model term. The relevant errata entries are E3-20 (unlabelled
  numbers in §10) and E3-25 (decode estimates). This mismatch is noted, not resolved, here.

## Arms

- **Hosted**: `claude` CLI 2.1.299 in print mode, `--output-format json`, prompt from
  `prompt.txt` (byte-identical across runs; hash in `receipt/prompt.sha256`), `--tools ""` so no
  tool calls occur, `--no-session-persistence`. Model: whatever the CLI reports in
  `modelUsage` (recorded per run; `MODEL` env may force one via `--model`).
- **Local**: not available on 2026-10-17. No local LLM runtime installed, no GGUF on disk
  (verified by the caller), RTX 4080 present but unused. Nothing is downloaded or installed.
  RESULT.md records the exact command that would run it.

## Procedure (run.mjs, in order)

- A. 5 sequential runs of `prompt.txt`.
- B. 3 sequential runs of `prompt-variant.txt` (identical prefix, different last line) to see
  whether the shared prefix is served from cache (`cache_read_input_tokens > 0`).
- C. 4 runs of `prompt.txt` launched concurrently (`Promise.all`), wall measured for the batch
  and per child.
- D. 3 runs of `prompt.txt` with `--output-format stream-json --verbose --include-partial-messages`
  to measure time-to-first-token (first `content_block_delta` with text) and time-to-first-event.
- For every run that returns code, save it to `kernels/<run>.ts` and run `asc --noEmit` from the
  probe-local AssemblyScript (pinned in `setup.sh`). Record exit code only; this is a parse/typecheck
  gate, not a correctness gate.

## Metrics (per run)

Wall (hrtime around the child process, ms), `duration_ms`, `duration_api_ms`, `input_tokens`,
`output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `total_cost_usd`,
model id, `is_error`, `stop_reason`. Derived: tok/s = output_tokens / (wall s); also
output_tokens / (duration_api_ms/1000). Gap = input_tokens + cache_read + cache_creation minus the
prompt's own token count (approximated as bytes/4 since the CLI does not expose a token counter).
Summaries: median, p95, min, max, n. Load average before and after.

## What counts as a bad sign

- Hosted wall for a ~100-line kernel far outside 5–10 s (either direction) → E3 §2 estimate does
  not hold for this configuration.
- `cache_read_input_tokens == 0` on all B runs → prefix caching is not observable through this
  CLI; the "warm SDK context" lever cannot be measured this way.
- Parallel-4 batch wall ≈ 4× single wall → hosted API, as reached here, serialises candidates.
- Generated code fails `asc` on most runs → first-pass yield for AssemblyScript is low, as E3 §5
  suspects ("below TypeScript until measured").

## Stop rule

Stop after D, or earlier if the CLI returns `is_error` on three consecutive runs (record them and
stop; do not retry indefinitely). Total hosted calls ≤ 15. Cost cap: `--max-budget-usd 2` per run.
Nothing outside `experiments/P-04-model-term/` is written. No commit.
