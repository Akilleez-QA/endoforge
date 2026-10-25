# P-04b bare-api-model-term — RESULT

**Status: complete for the subscription arms, 2026-10-17.** Label for every number below:
**Recorded (probe)**. One day, one shared desktop, one login, no quiet gate, no replication.

The probe was precommitted for the bare Messages API and amended twice (`PRECOMMIT.md`, three hashes in
`receipt/precommit.sha256`). What ran, in order:

| Arm set | Status |
|---|---|
| API arms `opus-low`, `opus-medium`, `sonnet-off`, `sonnet-medium` (original precommit) | **not run: user chose subscription only.** No API key existed on the Main-rig when the probe was built; the user then decided not to use the API at all. USD 0.00 API spend. |
| `cli-bare` (`claude -p --bare`, original precommit) | **ran, 0/3 model turns.** `--bare` reads no OAuth or keychain credential, so every run failed before any request with `Not logged in`, 0 tokens, ≈1 s wall (`receipt/raw-cli-bare-keygated/`, `receipt/summary-cli-bare-keygated.json`). |
| Subscription arms `S1-lean`, `S2-lean-low`, `S3-lean-sonnet`, `S4-lean-sysprompt` (amendment 1) | **ran, 48/48 turns succeeded**, 45/48 kernels passed `asc --noEmit` (`receipt/raw/`, `receipt/summary.json`, `receipt/arm-status.json`). |

The subscription runs are personal evaluation use of the unmodified `claude` 2.1.299 binary under the
user's own login: 48 measured turns plus one smoke turn, no API key in the environment (asserted by
`run.mjs` and recorded in `receipt/env-before.json` `api_key_assertion`; for the first invocation,
from the live processes in `receipt/api-key-assertion.json`). No rate- or usage-limit error occurred.
The CLI's `total_cost_usd` is reported at list price for comparison with P-04 only; the subscription has
no dollar meter (sum over 48 turns: **$7.83 list**; it was not billed as such).

## Configuration (subscription arms)

- `claude -p --output-format json|stream-json --no-session-persistence --tools "" --strict-mcp-config
  --mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-chrome --setting-sources ""
  --max-budget-usd 2`, prompt on stdin, `CLAUDE_EFFORT` removed from the child environment, cwd
  `/tmp/claude-1000/p04b-empty-cwd` (empty; no `CLAUDE.md`/`AGENTS.md` in it or any ancestor, checked by
  the runner). `S2` adds `--effort low`; `S3` adds `--model claude-sonnet-5-5`; `S4` adds
  `--system-prompt "You write AssemblyScript. Output only code."`.
- Prompts byte-identical to P-04 (`receipt/prompt.sha256`: `prompt.txt` `8b015a52…8279`,
  `prompt-variant.txt` `559eb751…5283`). Per arm: A 3 sequential, B 3 variant, C 4 concurrent, D 2
  streaming (`--verbose --include-partial-messages`); 12 turns per arm.
- Gate: probe-local AssemblyScript 0.28.20, `asc <kernel> --runtime stub --noEmit`, exit code only.
- Host: AMD Ryzen 9 7950X (32 threads), 125 GiB, kernel 7.2.5-3-omarchy, Node 26.8.1, repo commit
  `890d2ab`. Load average 16.1 / 28.4 / 30.1 at the resumed start, 3.7 / 6.1 / 18.3 at the end (the
  desktop went quiet during the run; the first two turns ran at load ≈36).
- Provenance of the first two turns: the first invocation (`node run.mjs`, 13:48 local) was orphaned by a
  host-session restart. It completed `S1-lean-A-1` (log line present) and `S1-lean-A-2` (receipt written at
  17:54:40 Z; its log line was lost when the orphan died), then exited. The resumed invocation started at
  17:54:41 Z, kept both receipts unchanged (`resume` in `receipt/env-before.json`), and ran the other 46
  turns. The two kept samples are sequential with the rest and overlap nothing.

## Per-arm summary

n = 12 successful turns per arm. Values are min / **median** / max. wall = hrtime around the CLI
process; api = `duration_api_ms`; out = `output_tokens` (includes thinking); think =
`output_tokens_details.thinking_tokens`; vis = out − think; ctx = `input_tokens` + `cache_read_input_tokens`
+ `cache_creation_input_tokens`; USD = `total_cost_usd` at list (informational).

| Arm | model | wall s | api s | out | think | vis | tok/s wall | ctx tokens | kernel lines | asc pass | USD list |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-lean (default effort) | opus-5-5 | 76.8 / **90.6** / 122.4 | 72.5 / 85.5 / 118.3 | 8,523 / **10,007** / 13,521 | 5,266 / **6,447** / 9,490 | 3,257 / **3,532** / 4,278 | 103.8 / 111.8 / 113.3 | 7,173 / **7,176** / 7,207 | 156 / 173 / 224 | 12/12 | 0.176 / 0.213 / 0.318 |
| S2-lean-low (`--effort low`) | opus-5-5 | 46.4 / **56.4** / 68.4 | 41.7 / 51.4 / 62.8 | 4,740 / **5,921** / 7,176 | 1,554 / **2,306** / 3,913 | 3,163 / **3,510** / 4,118 | 99.3 / 105.0 / 107.8 | 7,171 / **7,175** / 7,214 | 131 / 149 / 191 | 12/12 | 0.100 / 0.124 / 0.149 |
| S3-lean-sonnet | sonnet-5-5 | 57.0 / **65.6** / 97.5 | 52.0 / 60.1 / 94.1 | 7,655 / **9,090** / 14,253 | 4,227 / **5,798** / 10,181 | 3,084 / **3,385** / 4,129 | 134.2 / 141.9 / 147.4 | 7,176 / **7,178** / 7,210 | 160 / 173 / 240 | 11/12 | 0.079 / 0.097 / 0.145 |
| S4-lean-sysprompt | opus-5-5 | 56.7 / **80.2** / 120.4 | 53.4 / 75.6 / 115.1 | 5,525 / **9,091** / 13,222 | 4,379 / **5,441** / 8,232 | 21 / **3,605** / 4,990 | 97.4 / 112.3 / 115.1 | 5,070 / **5,073** / 5,104 | 1 / 168 / 244 | 10/12 | 0.116 / 0.187 / 0.270 |
| P-04 (reference: `claude -p`, MCP + settings loaded, effort medium) | opus-5-5 | 71.7 / **93.9** / 123.0 | — / 86.9 / — | 7,225 / **8,971** / 12,951 | 3,788 / **4,903** / 9,128 | 3,168 / **3,507** / 5,006 | 92.3 / 102.9 / 110.3 | **453,290–468,214** | 137 / 168 / 234 | 13/13 | 0.263 / 0.364 / 0.534 |

Per-run figures: `receipt/raw/<arm>-<phase>-<n>.json`; the run log `receipt/run-stdout-*.log`.

## Findings

### 1. Context: 7.2k tokens per turn, about 63–65× less than P-04

Every lean turn carried **7,171–7,214 tokens** of input in all classes (`input_tokens` is always 2; the
rest is cache read or cache creation). P-04's harness turns carried 453,290–468,214. The reduction is
**≈ 63–65×** (Derived: 453,290 / 7,207 = 62.9; 468,214 / 7,173 = 65.3). The flags that did it:
`--strict-mcp-config --mcp-config '{"mcpServers":{}}'` (no MCP tool schemas), `--setting-sources ""`
(no user settings or plugins), `--tools ""`, `--disable-slash-commands`, `--no-chrome`, and an empty cwd.
Replacing the CLI's own system prompt (S4) removed a further **2,103 tokens** (7,176 → 5,073; Derived),
which matches the 2,147-token cache read seen on every `B-1` turn (§3): the CLI's default system prompt
in this mode is ≈2.1k tokens. The remaining ≈5.07k in S4 is the 2.6k-token prompt (bytes/4 estimate;
no token counter was available) plus ≈2.4k that the CLI still adds around a `-p` user turn with a minimal
system prompt; its composition was not inspected.

### 2. The model turn itself did not get faster by removing the harness

S1 (same model, effort not forced; the CLI reports `claude-opus-5-5`) took **wall median 90.6 s**,
output median 10,007 tokens (thinking 6,447, visible 3,532), against P-04's 93.9 s, 8,971 (4,903 /
3,507). Removing ≈460k cached context tokens changed wall by about 3 s and the output not at all.
**The P-04 turn time is generation, not context**: visible code is ≈3.5k tokens (≈170 lines for a
request of "about 100"), thinking is 1.5–2.7× the visible code, and decode runs at 110–120 tok/s on
`duration_api_ms`. Edition 3 §2's "≈1,000 tokens, 5–10 s" is off by ≈3.5× on visible tokens and ≈9–10×
on time in every Opus arm, and that is now shown to be a property of the model and prompt, not of the
CLI's context.

### 3. Effort is the lever: `--effort low` gives a 56 s turn with the same visible code

S2 (`--effort low`): wall **median 56.4 s** (46.4–68.4), output 5,921 (thinking 2,306, visible 3,510),
12/12 kernels pass `asc`, kernel length 131–191 lines. Against S1: thinking −64 %, wall −38 %, visible
code unchanged (3,510 vs 3,532 median; Derived). TTFT to the first visible token fell from 60.6 / 93.1 s
(S1 D-1/D-2) to **23.5 / 40.7 s**. This is the first number the project has for the cheapest hosted turn
on this prompt; it is still 5–7× Edition 3 §2's estimate, and the type-gate pass rate did not drop.

### 4. Sonnet 5.5 at default effort: 65.6 s, 142 tok/s, one `asc` failure

S3: wall median **65.6 s** (57.0–97.5), output 9,090 (thinking 5,798, visible 3,385), overall 142 tok/s
wall and visible-only decode **194 tok/s** after TTFT (S1/S2/S4 Opus: 131–139). TTFT 47.9 / 48.9 s. 11/12
kernels passed; `S3-C-2` failed with `TS2315: Type 'load' is not generic` (the kernel defines its own
`load()` and the file also uses AssemblyScript's builtin `load<T>`). On this prompt Sonnet is ≈28 % faster
than Opus-default and ≈16 % slower than Opus-low, at list price about half of Opus-default.

### 5. Prompt caching through the CLI: the whole user turn is one cache block; the 2.6k prefix is not reusable on its own

- Cold turn of an arm (`A-1`; `S3-A-1` and `S4-A-1`/`B-1` too): cache read 0–535, creation ≈5.1–6.6k.
- Identical repeat (`A-2`, `A-3`, every C and D turn): cache read 6,647, creation ≈525 (the CLI's
  per-turn tail). Caching is engaged and stable, also under four concurrent turns (all four C turns of
  each arm read 6,647).
- **Variant last line (`B-1`)**: cache read **2,147**, creation 5,057 (S1 and S3). Only the system prompt
  was served from cache; the shared 10.2 KB prefix of the user message was rewritten. With the minimal
  system prompt (S4 `B-1`) cache read was **0**. So the CLI places no cache breakpoint inside the user
  turn: the ≈2.6k-token "SDK context" is cached only as part of an identical whole message. `B-2`/`B-3`
  then read 6,678 (the variant became its own cached block). The caches are per model: S3 started cold.
- Consequence for R09 §9 and Edition 3 §10's "warm SDK context": through this CLI the prefix is reusable
  only across byte-identical user turns. Reuse across *different requests* that share the context needs
  either the context in the system prompt (`--system-prompt-file`; not tested) or a bare API call with an
  explicit breakpoint, which the user has ruled out for now.

### 6. Four parallel candidates cost about one slow turn in wall time, on the subscription

| Arm | batch wall s | per-turn wall s | aggregate tok/s |
|---|---|---|---|
| S1 | **94.8** | 77.7–92.7 | 407 |
| S2 | **69.8** | 46.4–68.4 | 315 |
| S3 | **70.3** | 58.9–69.5 | 502 |
| S4 | **96.5** | 56.7–96.0 | 351 |

0 errors, no rate-limit event, cache reads intact under concurrency. Edition 3 §10's "four candidates
cost close to one in time" holds through this path too; the batch is bounded by its slowest member.

### 7. TTFT is thinking time; the stream starts in 1–2 s

Streaming turns (two per arm): first event at 0.9–1.9 s, `message_start` at 2.1–4.7 s, first
`thinking_delta` at 2.8–5.1 s, first visible `text_delta` at **60.6 / 93.1 s (S1), 23.5 / 40.7 s (S2),
48.9 / 47.9 s (S3), 58.2 / 50.0 s (S4)**. Everything between the first thinking delta and the first text
delta is thinking. Visible-only decode after TTFT: Opus 131–139 tok/s, Sonnet 194–195 tok/s (Derived,
visible tokens / (wall − TTFT)). Compared with P-04 (TTFT 44.9–59.2 s, CLI start 2–3 s), the lean
configuration starts streaming ≈1 s sooner and is otherwise the same shape.

### 8. Type-gate yield: 45/48, with two shadowing errors and one degenerate turn

- `S3-lean-sonnet-C-2` and `S4-lean-sysprompt-B-3`: `TS2315: Type 'load' is not generic` — a
  user-defined `function load(...)` alongside a use of the builtin `load<u8>()` (3 errors each). Real
  AssemblyScript type errors a repair round would catch; the kernels are otherwise 153–160 lines.
- `S4-lean-sysprompt-C-4`: the model's entire visible output was one line,
  `import { NaN as _unused } from "./nan_shim";` (21 visible tokens after 5,504 thinking tokens, no code
  fence). A degenerate turn, not a gate artefact: the request was for a kernel and none came. It occurred
  under the minimal system prompt arm and under four-way concurrency; one occurrence in 48 turns.
- All 24 S1/S2 kernels and 11/12 of S3 passed. The gate remains a parse/type check only.

### 9. List-price cost (informational)

Median `total_cost_usd` at list: S1 0.213, S2 0.124, S3 0.097, S4 0.187 per turn (P-04 cached 0.364;
cold 3.96). The lean arms' cold turns cost 0.32 (S1-A-1), not ~4, because there is no 470k cache write.
On the subscription none of this is billed per turn; the figures matter only as the API-price shadow of
the same turns.

## What this probe does not show

- Anything about a bare Messages API call. The API arms were not run (user decision). The lean CLI
  turn is the nearest measured thing: 7.2k context, of which ≈2.1k is the CLI's system prompt and ≈2.4k
  is CLI scaffolding around the user turn whose composition was not inspected.
- Whether the ≈2.6k-token prompt can be served from cache across different requests: through this CLI it
  cannot (§5); through the API with a breakpoint, unknown.
- Numbers on a quiet machine: load average fell from 36 to 4 during the run; wall includes whatever that
  cost the CLI process. `duration_api_ms` was 3–6 s under wall in every turn.
- The subscription's 5-hour and weekly limits: no limit was hit in 49 turns; where the limit sits is not
  measured.
- `--bare` with a key: the harness-context question for `--bare` is moot here, since the lean flag set
  reaches 7.2k without it.
- First-pass yield in Edition 3's sense: `asc --noEmit` only; no T1–T6, no behavioural evaluator, no
  execution, no Wasmtime.
- Local inference: nothing (as P-04).
- Statistical claims: n = 12 per arm, one lifetime; no CI; medians and ranges only.

## Interpretation

For the hosted path on the subscription as the project can script it today, one model turn against the
2.6k-token SDK context is: **Opus 5.5 default ≈ 91 s, 10k output tokens (6.4k thinking + 3.5k code),
7.2k context; Opus 5.5 at `--effort low` ≈ 56 s, 5.9k tokens (2.3k + 3.5k), same context and the same
type-gate yield; Sonnet 5.5 ≈ 66 s, 9.1k tokens.** P-04's ≈470k-token harness context is removable with
flags (63–65× less input), but removing it does not shorten the turn: the time is thinking and
over-long output, and effort is the control. Edition 3 §2's "≈1,000 tokens, 5–10 s" stays Estimated and
is not met by any arm; the closest is Opus-low at ≈3.5k visible tokens and ≈56 s. R09 §10's hosted
term T_h should be re-based on ≈55–95 s per turn depending on effort, and the "warm SDK context"
lever, as reached through this CLI, works only for byte-identical turns. X5's hosted side now has two
operating points (default and low effort) and a Sonnet comparison; its local side is still untouched.

## Files

- `PRECOMMIT.md` with amendments 1 and 2; `receipt/precommit.sha256` (three lines: original
  `3e39b010…`, amendment 1 `caba2c98…`, amendment 2 `b7f236d2…`).
- `prompt-prefix.txt`, `prompt.txt`, `prompt-variant.txt`; `receipt/prompt.sha256`.
- `setup.sh` (AssemblyScript 0.28.20 probe-local; the SDK 0.135.0 install from the original precommit is
  present but unused), `run.mjs`; `receipt/deps.txt`.
- `receipt/env-before.json`, `env-after.json`, `api-key-assertion.json`, `arm-status.json`,
  `summary.json`, `smoke-lean-flags.json`, `run-stdout.log`; `receipt/raw/<arm>-<phase>-<n>.json` and
  `.cli-output.txt` (48 turns); `kernels/<run>.ts` (48, three of which fail the gate).
- `receipt/raw-cli-bare-keygated/`, `summary-cli-bare-keygated.json`, `env-*-cli-bare-keygated.json`,
  `run-stdout-cli-bare-keygated.log`: the key-gated `--bare` arm.
