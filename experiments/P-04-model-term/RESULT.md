# P-04 model-term — RESULT

**Status: complete (hosted arm), 2026-10-17.** First measured model turn in the project. Label for
every number below: **Recorded (probe)**. Run on a loaded shared desktop, one provider, one day,
through the Claude Code CLI harness, not the raw API. Local arm not available (see below).

First attempt at 13:04 local was blocked by an expired standalone-CLI OAuth session; the user ran
`claude login` and the coordinator reran `node run.mjs` (17:09–17:28 UTC; `receipt/run-stdout.log`,
exit 0). All figures are from that rerun. Prompt hashes unchanged (`receipt/prompt.sha256`), precommit
hash verified (`receipt/precommit.sha256`).

## Configuration

- CLI `claude` 2.1.299, `-p --output-format json|stream-json --no-session-persistence --tools "" --max-budget-usd 2`,
  prompt on stdin, no `--model` flag; model reported in `modelUsage`: **`claude-opus-5-5`**
  (`contextWindow` 1,000,000, `maxOutputTokens` 128,000, `costBasis: "list"`, `service_tier: standard`).
- Prompt: `prompt.txt` 10,390 B (≈2,600 tokens at bytes/4); `prompt-variant.txt` differs only in the last line.
- Thinking was on. `claude -p --help` has no flag that disables thinking; it has `--effort <level>`,
  which was **not** passed. The child inherited the host session's `CLAUDE_EFFORT=medium`; `MAX_THINKING_TOKENS`
  was unset. Thinking tokens are reported per run (`usage.output_tokens_details.thinking_tokens`).
- `--bare` was **not** used, so user-level settings and the user's MCP servers loaded (12 configured: Claude Docs,
  Gmail, Drive, Calendar, blender, rea, rea-quarantine connected; Box, Netlify, Notion, Vercel, Figma need auth).
- Host: AMD Ryzen 9 7950X (32 threads), 125 GiB, kernel 7.2.5-3-omarchy, Node 26.8.1, repo commit `cdb5d3c`.
  Load average before 12.08 / 13.27 / 14.91, after **24.24 / 35.75 / 31.07** (the desktop got busier
  during the run); Tctl 76.9 → 77.4 °C. No quiet gate.

## Per-run table

wall = hrtime around the child process; api = `duration_api_ms`; out = `output_tokens` (includes thinking);
think = thinking tokens; vis = out − think; tok/s = out / wall; in = `input_tokens`; cr/cc = cache read /
cache creation input tokens (all creation was `ephemeral_1h`); asc = `asc --runtime stub --noEmit`.
For the two error runs the top-level `usage` is zeroed by the CLI; A-seq-1's figures are taken from its
`modelUsage` block (the stream runner saved only text for D-stream-1, so its split is not recoverable).

| Run | status | wall s | api s | out | think | vis | tok/s | in | cr | cc | USD | asc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A-seq-1 | error_max_budget_usd | 95.9 | — | 9,499* | 6,236* | 3,263* | — | 2* | 0* | 471,261* | 3.960 | not checked |
| A-seq-2 | ok | 76.1 | 71.1 | 7,829 | 4,444 | 3,385 | 102.9 | 2 | 453,290 | 18,003 | 0.391 | pass (161 lines) |
| A-seq-3 | ok | 117.4 | 112.1 | 12,951 | 8,642 | 4,309 | 110.3 | 2 | 453,290 | 18,045 | 0.494 | pass (203) |
| A-seq-4 | ok | 73.3 | 67.5 | 7,818 | 4,549 | 3,269 | 106.7 | 2 | 468,183 | 3,150 | 0.275 | pass (148) |
| A-seq-5 | ok | 84.0 | 78.2 | 7,999 | 4,550 | 3,449 | 95.3 | 2 | 468,183 | 3,156 | 0.279 | pass (137) |
| B-variant-1 | ok | 97.1 | 86.9 | 8,962 | 4,864 | 4,098 | 92.3 | 2 | 453,290 | 18,075 | 0.415 | pass (194) |
| B-variant-2 | ok | 93.9 | 87.0 | 8,971 | 4,903 | 4,068 | 95.5 | 2 | 468,214 | 3,155 | 0.298 | pass (202) |
| B-variant-3 | ok | 118.6 | 111.7 | 12,668 | 7,662 | 5,006 | 106.8 | 2 | 0 | 35,035 | 0.534 | pass (234) |
| C-par-1 | ok | 99.3 | 90.3 | 10,838 | 7,670 | 3,168 | 109.2 | 2 | 9,108 | 18,161 | 0.364 | pass (146) |
| C-par-2 | ok | 123.0 | 114.1 | 12,635 | 9,128 | 3,507 | 102.7 | 2 | 17,050 | 17,955 | 0.400 | pass (175) |
| C-par-3 | ok | 107.2 | 96.6 | 11,028 | 7,071 | 3,957 | 102.9 | 2 | 17,050 | 17,954 | 0.368 | pass (185) |
| C-par-4 | ok | 91.5 | 79.9 | 9,805 | 6,342 | 3,463 | 107.1 | 2 | 9,108 | 18,157 | 0.343 | pass (165) |
| D-stream-1 | error_max_budget_usd | 82.3 | — | — | — | — | — | — | — | — | 2.371 | not checked (159 lines emitted) |
| D-stream-2 | ok | 71.7 | 64.5 | 7,225 | 3,788 | 3,437 | 100.8 | 2 | 468,183 | 3,151 | 0.263 | pass (168) |
| D-stream-3 | ok | 78.2 | 72.9 | 8,528 | 4,823 | 3,705 | 109.0 | 2 | 468,183 | 3,150 | 0.289 | pass (168) |

\* from `modelUsage`, since `usage` is zeroed on error.

Summaries over the 13 successful runs (n = 13): wall min 71.7 / median 93.9 / max 123.0 s; output tokens
7,225 / 8,971 / 12,951; thinking 3,788 / 4,903 / 9,128; visible 3,168 / 3,507 / 5,006; tok/s (wall, all
output) 92.3 / 102.9 / 110.3; cost 0.263 / 0.364 / 0.534 USD; kernel length 137 / 168 / 234 lines.
Phase A alone (n = 4): wall median 76.1 s, p95 117.4 s. `receipt/summary.json` has per-phase stats.

## Findings

### 1. 13 of 15 runs succeeded; two tripped the cost cap

`run.mjs` passes `--max-budget-usd 2` on every call (precommit stop rule, "cost cap: 2 per run").
A-seq-1 and D-stream-1 ended with `subtype: error_max_budget_usd`, `is_error: true`, exit 1, after
costing **$3.96** and **$2.37**. A-seq-1's `modelUsage` shows why: `cacheReadInputTokens 0`,
`cacheCreationInputTokens 471,261` — it was the cold call that wrote the whole ~470k-token context to the
cache at cache-write price, and the budget check fired after the turn had already been billed. Every
successful run instead read 453k–468k from cache and wrote 3k–18k. D-stream-1 (first stream-mode call
after the four parallel runs, which had themselves written fresh cache entries) cost 9× its cached
siblings ($0.26–0.29), consistent with another large cache write; it did emit a 159-line kernel before
the budget error, but the CLI zeroed its usage and the runner did not gate it. The cap did not prevent
the spend; it only labelled the run. A cold turn of this harness costs about $4 at list price.

### 2. The measured turn is a Claude Code CLI turn, not a bare API call

Every run is `num_turns: 1` and `input_tokens: 2`, yet total input (read + creation) is ≈468,700
tokens in phases A, B-1/2 and D — against a prompt of ≈2,600 tokens. **Input gap ≈ 466,000 tokens**
(`input_gap_vs_prompt_est` 468,697–468,746). That is the CLI's own context: system prompt, settings,
and — the only plausible source of ~435k of it — the tool schemas of the user's 12 configured MCP
servers (the `rea` servers alone expose several hundred tools). Supporting evidence from the receipt:
in B-variant-3 and all four C-par runs total input was only 24,700–35,000 tokens (B-3: cr 0, cc 35,035;
C: cr 9k–17k, cc ≈18k), i.e. the large block was absent from those calls, presumably because MCP
servers did not connect in time under four concurrent launches; those runs were no faster (99–123 s),
so the cached context costs little time but it is not stable call to call. Consequences: (a) the
"SDK context" this probe set out to cache is a rounding error next to the harness context; (b) prompt
caching **was** observable (`cache_read_input_tokens` > 0 on 11 of 13 successful runs, phase B-1/2
read the same 453k/468k block with a different last line, so the shared prefix was served from cache),
but what was cached was the harness, not the prompt; (c) a bare Messages API call with the same
2,600-token prompt would have ~1/180 of the input and a different cost and TTFT profile. This
measurement is of the tool the project would actually script today, not of the model in isolation.

### 3. Output is 7–13k tokens, about half thinking; E3's "≈1,000 tokens, 5–10 s" does not hold here

Per turn: output 7,225–12,951 tokens, of which thinking 3,788–9,128 (median 4,903; the brief's "≈4.4k" is
the phase-A typical value, not a constant) and visible code 3,168–5,006 (median 3,507). Kernels ran
137–234 lines (median 168) for a request of "about 100 lines", i.e. about 21 visible tokens per line
of dense AssemblyScript with host `declare`s. Wall 72–123 s, median 94 s. Edition 3 §2's worked
Estimated example ("a 100-line kernel is about 1,000 tokens, 5–10 s to generate") is off by about
3.5× on visible tokens, 8–13× on total tokens, and roughly 10× on time in this configuration. Why:
thinking (half the tokens, and all of the time before the first visible token, §4), verbosity beyond
"only code" (every kernel over-delivered on length, though none contained prose — all 13 passed `asc`),
and the harness (470k-token context, CLI startup ≈2–3 s). Output rate including thinking was 92–110
tok/s wall, 102–116 tok/s on `duration_api_ms`. R09 §10's derivation, which takes T_h = 5–10 s for the
hosted term, should be re-based on ~75–120 s per turn for this harness if hosted means "`claude -p` as
configured on this desktop".

### 4. Time to first token is ~45–51 s; first stream event ~2–3 s; the gap is thinking

Phase D (`--output-format stream-json --verbose --include-partial-messages`), 2 successful runs plus the
budget-error run which still streamed: first event (`system/init`) at 2.14 / 2.82 / 2.95 s; first
`content_block_delta` with `text_delta` at **44.9 / 51.1 / 59.2 s** (D-2, D-3, D-1). Nothing visible is
emitted between `message_start` (~5 s) and the first text delta; the CLI's `system/thinking_tokens`
status event appears in that window. Decode after the first visible token: the receipt's `decode_tok_s`
field (269 / 314 tok/s) divides **all** output tokens by the post-TTFT time and overstates, because the
thinking tokens were produced before TTFT; visible-only decode is 3,437 / (71.7 − 44.9) = **128 tok/s**
and 3,705 / (78.2 − 51.1) = **137 tok/s**. R09 §9's "tens of milliseconds" TTFT with a resident cache is
about the prefix; here the prefix was cached and TTFT was still ~45 s, all of it generation (thinking).

### 5. Four parallel candidates cost about one in wall time

Phase C: four `claude -p` children launched by `Promise.all`; batch wall **124.1 s**, per-child
91.5 / 99.3 / 107.2 / 123.0 s, 0 errors, aggregate 357 tok/s. Sequential single turns in phase A took
73–117 s. So four candidates finished in roughly the time of one slow single turn — Edition 3 §10's
"four candidates cost close to one in time" holds here, but through a hosted API's concurrency, not
through batched decode on one machine, and on the day of measurement without hitting a rate limit
(two `rate_limit_event`s appeared in the D stream, content not inspected). The parallel runs also lost
the large cached block (§2), which did not slow them.

### 6. 13/13 generated kernels passed the `asc --noEmit` gate

Every successful run's output, with fences stripped, type-checked under AssemblyScript 0.28.20
`--runtime stub --noEmit`: 13 pass, 0 fail (`kernels/*.ts`, 137–234 lines). This is a parse/typecheck
gate only: no interaction test, no host import, no execution, no Wasmtime. It does not measure
first-pass yield against the behavioural evaluator; it does show that the AssemblyScript route did not
produce syntactically or type-invalid code in 13 attempts with this model.

### 7. Cost

Successful turns $0.263–0.534 (median $0.364; cheap ones are the fully cached 3k-creation runs, dear ones
the 18–35k-creation runs with the longest thinking). Two budget-error turns $3.96 + $2.37. **Total probe
spend: $11.04** over 15 calls (sum of `total_cost_usd`; $4.71 over the 13 successes), at `costBasis: list`.

### 8. Load

Load average rose from 12.1 to 24.2 (1-min) during the 19-minute run on 32 threads; the machine was in
ordinary interactive use. Wall figures include whatever that cost the CLI process; `duration_api_ms` was
5–11 s shorter than wall in every run (CLI startup, MCP connection, teardown).

## Local arm: not available on 2026-10-17

No local LLM runtime installed, no GGUF on disk (verified), RTX 4080 present but unused; nothing
downloaded or installed. The command that would run it, given a runtime and a model:

```
llama-server -m /path/to/model.gguf -ngl 99 -c 16384 --parallel 4 --port 8080 &
curl -s http://127.0.0.1:8080/completion -d "$(jq -Rs '{prompt: ., n_predict: 1500, cache_prompt: true, temperature: 0}' prompt.txt)"
```

`timings.predicted_per_second` and `timings.prompt_ms` are the local analogues of tok/s and TTFT.
The second half of E3 X5 (four-way batched local decode on unified memory, compilation concurrent) is
untouched.

## What this probe does not show

- Anything about the raw Messages API: all numbers are through the Claude Code CLI with a ~470k-token
  harness context (settings, system prompt, the user's MCP tool schemas), `--bare` not used, `--tools ""`.
  Input tokens, cost, TTFT and probably wall would differ for a direct API call with the 2,600-token prompt.
- One provider (first-party), one model (`claude-opus-5-5`, CLI default, not pinned), one day, 13 turns,
  standard tier. Rates are not a bound on the API or the model; no CI is claimed.
- The effect of the prompt's own prefix caching. The cache behaviour observed is the harness's; the
  CLI's caching policy is inferred from `usage` fields, not documented here. Cache presence was unstable
  under concurrency (§2).
- Thinking was on at the inherited `CLAUDE_EFFORT=medium`; `--effort` was not passed and no flag disables
  thinking in `claude -p --help`. Numbers with thinking off or at another effort are unknown.
- Local inference, unified memory, batched decode, the RTX 4080: nothing.
- First-pass yield in Edition 3's sense: the `asc` gate is a type check, not the behavioural evaluator, and
  the kernels were not run against T1–T6.
- Whether the measured 72–123 s is representative of a quiet machine: load average 12–36 during the run.
- Whether E3 §10's 20 s floor / 2–3 min realistic figure for a whole novel request holds: this is one turn,
  no repair round, no evaluator synthesis, no compile in the loop.

## Interpretation

For the hosted path as it actually exists on this desktop today, one model turn against a fixed
~2,600-token SDK context is **about 90 s wall, ~9k output tokens of which ~5k are thinking and ~3.5k are
code, ~100 tok/s overall, TTFT ~45–50 s, $0.26–0.53 cached or ~$4 cold**, and the shared prefix is served
from cache when it is present. Edition 3 §2's "≈1,000 tokens, 5–10 s" is not what this configuration
does; the difference is thinking, over-long output, and the harness, not model decode speed (visible-code
decode was 128–137 tok/s). Edition 3's parallel-candidates claim holds in wall terms through the hosted
API (4 for the price of ~1.3 single turns in time, 4× in money). Every one of the 13 kernels type-checked,
which is a weak but real first data point for the AssemblyScript route's syntactic yield. The X5 question
(local versus hosted) remains open; this fixes the hosted side of the comparison to ~75–120 s per turn
through this CLI, and shows that any future hosted arm must choose deliberately between "the CLI as the
project would script it" and "the API with only the SDK context", because they are not the same measurement.

Note for the experiments README: its table cites E3-12 for P-04, but E3-12 concerns X2 library passes;
the errata that touch this probe's claims are E3-20 (unlabelled §10 numbers) and E3-25 (decode estimates).

## Files

- `PRECOMMIT.md` (sha256 `275f1dd5…e7f3a`, `receipt/precommit.sha256`, written before the first run; unchanged).
- `prompt-prefix.txt`, `prompt.txt` (10,390 B, `8b015a52…8279`), `prompt-variant.txt` (10,500 B, `559eb751…5283`);
  `receipt/prompt.sha256`. The two prompts differ only in the last line.
- `setup.sh` (assemblyscript 0.28.20, probe-local from the npm offline cache; `receipt/deps.txt`), `run.mjs`.
- `receipt/env-before.json`, `receipt/env-after.json`, `receipt/summary.json`, `receipt/run-stdout.log`,
  `receipt/raw/<run>.json` and `<run>.cli-output.txt` (15 runs).
- `kernels/<run>.ts` — 13 generated kernels that passed the gate.
