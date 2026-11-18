# P-83 gate-scans: the non-finite reading reads each contract sentence once, on top of P-82: precommit

Label: **Proposed** procedure, frozen 2026-11-18 before any acceptance measurement of the lever. Round 10 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-82 (draft PR #184, kept), at `climb-r9-release-successor` c1aea68.

## Step 1: the floors (measured before this precommit)

`floor.mjs` runs the 21 corpus kernels in one warm process, with no isolation, no cell and no ledger: `compile` is the same `asc.main` call with `x1Flags` (`-O3`, stub runtime) that a cell makes; `gate` is `runGates` on the same files a cell checks. Medians of rounds 2–9 (rounds 0–1 warm the JIT). Receipts: `receipt/floors/`.

| Bucket | Floor per call | Calls per need | Floor per need | Width 1 (P-82) | ÷ floor | Width 64 (P-82) | ÷ floor |
|---|---|---|---|---|---|---|---|
| `compile` | 20.4 ms | 1 | 20.4 ms | 24.8 ms | **1.22×** | 78.6 ms | **3.85×** |
| `gate` | 2.79 ms | 2 (the implementation check, then the evaluator's residual) | 5.6 ms | 7.4 ms | **1.33×** | 25.6 ms | **4.6×** |

- The floor is the same with the WASM guard installed, with the cell's heap flags and with the permission model (20.3–20.5 ms and 2.7–3.0 ms). Under `taskpolicy -b` (efficiency cores, background clamp) it is 135 ms and 21 ms.
- At width 1 both buckets are near their floors. At width 64 their wall is 3.9–4.6× the floor, while CPU per need is 1.74× width 1: most of the wall is waiting for a core and running on efficiency cores.
- So the stop rule's floor condition is not met (`compile` is 42% of width-1 wall and 3.85× its floor at width 64), but the distance at width 64 is the machine's contention, which lowers only with less CPU per need.

## Step 2: choosing the lever

**(a) Pool size from the machine, measured first** (exploratory, `receipt/explore-sizing/`, 2 rows per count at width 64, each row started at load ≤ 4, on P-82):

| Cells | needs/s | Cell service per job | Cell jobs/s | Cores | CPU per need | Tree RSS |
|---|---|---|---|---|---|---|
| 8 | 79.5, 79.6 | 29.4 ms | ~250 | 9.5 | 119 ms | 4.6–5.2 GB |
| 10 | 80.3, 80.6 | 36.1 ms | ~253 | 10.1 | 125 ms | 4.6–5.0 GB |
| 12 (P-82) | 80.6, 80.7 | 44.3 ms | ~254 | 10.3 | 128 ms | 5.0–5.7 GB |
| 14 | 81.3, 82.7 | 50.0 ms | ~258 | 10.5 | 127 ms | 5.2–5.3 GB |

Throughput is flat in the cell count (8 → 14: +3%, within two rows' noise of each other). Each added cell lengthens every job's service time in proportion, so the cells' total job rate stays at about 250 per second. The machine's capacity binds, not the slot count: fewer cells don't win, and more cells gain under 3%. A count derived from measured cores can't move needs/s by +3%. **Predicted gain: 0 to +2%. Not chosen.**

**(b) A V8 startup snapshot of the loaded compiler.** P-81 split a replacement's ~2 CPU-s into process start (40 ms), compiler load (235 ms), the primer (283 ms), and cold JIT on the first real kernels (most of the rest). A snapshot can hold only the JS heap: the binaryen WebAssembly module can't be snapshotted, and lazily compiled code is dropped. The cell code is ESM, which `--build-snapshot` doesn't load. An upper bound is the 235 ms load, about 2.5 ms CPU per need at width 64 (21.5 starts per 25 s window, 80 needs/s). **Predicted gain: ≤ +2%. Not chosen.**

**(c) Cut gate CPU without changing outputs: chosen.** A CPU profile of the cells at width 1 (`receipt/floors/profile-w1-p82*.txt`, 255 needs) shows `nonFiniteExpectation` (`core/runtime/x1/contract.mjs`) at 961 ms, more than half of `runGates` (1,784 ms). One regular expression in it (`promises`) is 891 ms by itself. The function reads the shared contract sentences once per export: a corpus contract has 13 exports and a 1,949-character line, so the same sentences pass the same six non-global regular expressions 13 times. Measured in `floor.mjs`, the prototype cuts it from 1.6 ms to 0.075 ms per call and the gate floor from 2.79 to 1.37 ms.

## Lever (one commit)

- `core/runtime/x1/contract.mjs`:
  - `nonFiniteExpectation` reads each distinct sentence once per call. It keeps three flags per sentence (`permitted`, `trap`, `finite`), each the exact expression the per-export test used. Each export's answer still checks them in the same order: `permitted`, `trap`, `excluded`, `finite`, then `silent`. All of the expressions are non-global (`test` is stateless), so reading a sentence once gives the same answer as reading it 13 times.
  - `glueFindings` computes the whole-contract stated precision at most once per call, not once for each export with no block of its own.
- `core/runtime/test/x1-contract.test.mjs`: a test that pins `nonFiniteExpectation` to the per-export reading over 400 seeded contracts.
- `sources/SHA256SUMS` regenerated.

Not changed: every gate and what it decides, the regular expressions themselves, the freeze rule and its checks, the frozen record, durability, REQ-ISO-016 (`retireAfterJobs` 256), the cell count (12), isolation and permissions, P-75 to P-82's levers. No new option.

Equivalence already checked on the prototype (`receipt/floors/`): `nonFiniteExpectation` agrees on all 20,046 cases (42 corpus contracts with and without the capability block, the repository's contract files, and 20,000 seeded contracts). `runGates` results on the 42 corpus cases are identical apart from wall-time fields. Compiled WebAssembly digests are identical for all 18 kernels that compile (the lever does not touch compilation).

## Predictions (P-82 arm = c1aea68; P-83 arm = this branch's lever commit)

The model: needs/s at width 64 is set by the machine's capacity (the flat sweep above), so it rises in proportion as CPU per need falls.
- **CPU saved per need:**
  - 1.42 ms per gate run at floor speed;
  - about 2.86 runs per need: two in the cell, plus the commit-time re-run on a supervisor worker for the 86% of needs whose report claims a pass;
  - that is about 4.1 ms at floor speed, and about 7 ms at width 64's 1.74× contention, out of 131 ms.
- **Throughput at width 64: +3% to +6%.**
- All CPU per need at width 64: −3% to −7%.
- `gate` wall per need: width 64 25.6 → 12–18 ms; width 1 7.4 → 4.0–5.5 ms.
- `compile` per need: unchanged at width 1 (±5%); at width 64 it may fall a little, since there is less contention.
- **Width 1: wall per need −3% to −7%** (59.5 ms), because the gate runs are on the need's path. Bar: not worse than +3%.
- Tree RSS: unchanged (±5%). **needs/s per GB must not fall.**
- Writers: unchanged requests, so utilisation can rise slightly with throughput; it should stay ≤ 0.95 mean.
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- **Keep only if all of these hold:**
  - width-64 needs/s rises by at least +3%, with **Welch p < 0.05** over 4 + 4 interleaved rows;
  - width-1 wall per need is not worse than +3%;
  - needs/s per GB (mean needs/s ÷ mean tree RSS) does not fall;
  - the correctness guard below holds;
  - GitHub CI (Linux: lint, test (22), test (26), coverage) is green on the PR.
- **A round that deletes code at equal speed is also a win.** This lever adds about 11 lines, so it can't win that way.
- **Correctness guard:**
  - `wrongVerdicts` = 0 and `errors` = 0 on every row, with the same outcome classes on both arms;
  - **request stream:** a width-1 capture row on each arm (`capture1`, `stream.py`). For the needs both rows completed, every `admit`, `park` and `commit` request is identical after the usual substitutions: the row's directory; wall-time fields, cell pids and the evaluator digest in `commit`. `contract.mjs` is one of the 14 frozen implementation files, so its digest and the frozen identity derived from the record differ by construction, and they are mapped;
  - the equivalence checks above (`nonFiniteExpectation`, `runGates`, compiled digests), re-run on the lever commit;
  - the new test passes, and so does the guard's rewrite pin (`isolate-wasm-rewrite.test.mjs`);
  - `make check` and `make lint` pass, including the no-comments check;
  - `make -k test`, one command per file on both arms, with `isolate-host-call.test.mjs` excluded on both (it hangs on macOS): no failure on P-83 that P-82 does not have;
  - `core/runtime/test/loop-crash.test.mjs`, run 4 times on each arm: no more failures on P-83 than on P-82. The counts are reported.

## Procedure

- **Harness:** P-82's `run.mjs`, unchanged apart from its location (it checks this PRECOMMIT's digest). `summarize.py` is P-82's, for the two arms. `stream.py` is P-82's, with `contract.mjs`'s two digests mapped. `floor.mjs` is new: the step-1 floor. Each arm runs the same `run.mjs` from its own tree; the P-82 arm runs from an uncommitted copy in a worktree at c1aea68.
- **Reference machine:** Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2.
- **Rows:** `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3. The order per rep is w64 P-82, w64 P-83, w1 P-82, w1 P-83. One row per process. A row waits for load ≤ 4 (up to 10 minutes), and re-runs at once if it ends above 16.
- **Safety caps**, checked before every row: stop if load stays above 16, memory pressure is critical, swap exceeds 7 GB (the round starts at about 5.1 GB), or free disk falls below 20 GB.

## Stop and rollback

- If the request stream differs, any equivalence check fails, or any row has a wrong verdict or an error: stop and revert.
- If `loop-crash.test.mjs` fails more often on P-83 than on P-82: record `failed_with_test_concern`, and revert unless the failure is shown to be unrelated.
- If the keep bar fails: record `failed` in RESULT.md and the PR, and revert the lever on the branch.
