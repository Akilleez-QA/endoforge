# P-75 the commit-time re-run off the supervisor's event loop: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 2 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

## Question

P-74 (draft PR #176, failed and reverted) moved time out of the ledger writer and saw it reappear as cell wait while the supervisor's event loop rose from 0.66 to 0.85 utilisation. It named the host event loop as the next ceiling. Does taking the largest piece of host work off that loop lift width-64 throughput?

## What the pilots showed (profile before choosing)

Pilots on `origin/main` (18819c8), 20 s rows at width 64, one `--cpu-prof` profile of the host:

- **The harness, not EndoForge, put a 21-layer WASM guard on the host.** P-50's `buildCorpus` calls `installWasmLimit` once per kernel, inside the measuring process, so the host's `WebAssembly.Module` and `Instance` were wrapped 21 times. A production supervisor never installs that guard. In the P-73/P-74 harness, the guard's `rewrite`, `instance` and `take` were about 40% of the host's non-idle CPU, all inside the commit-time re-run. It is also the likely cause of the open re-run disagreement after 4–5k needs: the guard's `activeFlags` set never shrinks, and each stacked layer scans it on every instantiation.
- **With the corpus built in a child process** (same corpus digest, `3d4322be…`), the host runs as a production supervisor does. Then, on main, host ELU at width 64 is about 0.46, not 0.63–0.9. Throughput is 49.5–50.8 needs/s (load 1–12 from the row itself), against about 45 with the in-process build.
- **The commit-time re-run is still the largest host item** after that fix: `checkAtCommit` → `runGates` is about 35% of non-idle host CPU. About half of it is one G8 sentence regex (`nonFiniteExpectation`), and the rest is instantiation and the test loop. Next come the bundle's JSON both ways in the ledger bridge (about 8%), `verifyFromMemory` re-hashing and re-parsing the 430 KB admission at every commit (about 8%), and harness overhead (`ps` sampling, `rmSync`, about 13%).
- **Lever pilot (one row per arm).** The re-run on two worker threads gave host ELU 0.35–0.36 against main's 0.46–0.47, with throughput 50.5–51.5 against 49.5–50.8. With the in-process guard, it gave 51.1 against 45.3, because the worker threads don't inherit the guard.

So once the harness artifact is removed, the host loop is not saturated at width 64. This lever is expected to cut host ELU clearly, but to move throughput only a little. It is run because it is the round's named ceiling, and because the result decides whether the host loop or something else binds.

## Lever

`core/runtime/x1/rerun.mjs` (new, about 50 lines): `rerunGates(content)` runs `runGates(JSON.parse(content))` on one of `RERUN_THREADS = 2` worker threads. `RERUN_THREADS` is a constant, not a knob. The thread returns only `{ promotable, shape }`, the two facts `checkAtCommit` compares. The threads are created lazily and never hold the process open. A thread that dies or errors answers `null`, which `checkAtCommit` treats as disagreement and refuses, the same as a `runGates` exception today. `checkAtCommit` awaits `rerunGates` instead of calling `runGates` inline. The synthesized-evaluator path, the comparison, the refusal text and the ledger request are unchanged.

Unchanged: the gates (the same `gates.mjs` runs on the thread), the freeze rule, the comparison rule, every ledger validation and durability setting. `rerun.mjs` is a supervisor file like `loop.mjs`, so it is not in the frozen implementation lists, and the frozen bundle bytes don't change.

## Arms and procedure

- **main**: `origin/main` (18819c8) in its own detached worktree, with this folder's harness copied in, untracked.
- **P-75**: this branch.

Harness: P-74's `run.mjs` with these changes:
- the corpus is built in a child process by default (`corpusBuild: child`, and `hostWasmGuard` is recorded and must be `false`). `P75_CORPUS=inprocess` reproduces the P-73/P-74 host for the `guard` plan;
- the writer RSS filter matches `Python` as well as `python`;
- plan `guard <rep>` runs one width-64 row with the in-process build;
- plan `bytes` runs one width-1 row of 10 s that sums the JSON bytes of every ledger request and answer by action.

Interleaved order per repeat: main `climb`, P-75 `climb`, main `guard`, P-75 `guard`. That is three repeats, each a fresh host process per plan, so each process handles under 1,300 needs. `climb <rep>` runs `w64` (width 64, 12 process cells, 25 s with 6 s warm-up), then `w1` (width 1, 25 s with 5 s warm-up). After the repeats, `bytes` runs once per arm. Before each plan, the harness waits until the 1-minute load is at or below 4 (up to 10 minutes) and records it.

## Predictions

| Quantity | main (expected) | P-75 predicted |
|---|---|---|
| Host ELU, width 64, child-built corpus | 0.42–0.50 | **≤ main − 0.07** |
| needs/s, width 64, child-built corpus | 48–52 | **+0% to +5%** |
| Wall per need, width 1 (ms) | 85–100 | **within ±3%** |
| Ledger bytes per need (`bytes` plan: sent + answered, all actions) | ~1.1 MB (430 KB admit up, 430 KB back, plus park and commit) | **unchanged** within 1% (this lever doesn't touch payloads) |
| Host ELU, width 64, in-process guard (`guard`) | 0.55–0.70 | **≤ 0.42** |
| needs/s, width 64, in-process guard | 43–47 | **+8% or more** against main `guard` |
| Tree RSS, width 64 | — | within +10% (two worker threads) |
| Binding stage at width 64 after the lever | — | not the host loop: the ledger writer or the cells, judged from the buckets and utilisations |

## Oracle and bars

- **Keep** if all of these hold:
  - needs/s at width 64 with the child-built corpus rises at least 3% on the mean, with Welch's t across the 3 + 3 repeats at p < 0.05;
  - host ELU at width 64 falls by at least 0.05;
  - width 1 doesn't regress more than 3%;
  - correctness holds:
    - every row has `wrongVerdicts` = 0 and `errors` = 0;
    - every row has the same set of outcome classes as main;
    - no row shows the re-run disagreement problem unless main's paired row does too;
    - `make test`, run one file at a time with a hard cap per file, shows no failure on P-75 that main doesn't also show. `core/runtime/test/isolate-host-call.test.mjs` is excluded on both arms, because it hangs on macOS on main (`ps --ppid`).
- The `guard` rows are reported, but they don't decide the keep. They measure the harness artifact and how much of P-74's diagnosis it explains.
- Reconciliation (unattributed share) must stay under 5% of wall in every row.

## Stop rules

- Stop before a row if the 1-minute load is above 16, memory pressure is critical, swap is over 8 GB, or free disk is under 20 GB.
- Load above 4 at the start of a plan: wait, as stated above. A row that ends with the load above 16 is re-run once and labelled.
- No real model call can happen: the credential variables are asserted unset, and the stand-in is in-process.

## What a miss means

- **ELU falls but throughput doesn't move (the expected case if it misses):** the host loop is not binding with a production-like host. Then P-74's "host binds" diagnosis was mostly the harness's stacked guard. The lever is **not kept** (`failed`), and the next ceiling is named from the buckets: the writer, which P-74's sharding addresses, or the cells.
- **Throughput rises past the bar:** kept. The next ceiling is named the same way.
- **Any wrong verdict, new error, new outcome class or new test failure:** `failed_with_test_concern`, not kept.

## Limits known now

- One shared desktop machine. The rows themselves push the load to about 12, because 12 cells run on 12 cores. The start-of-row load gate covers only the other workloads.
- The pilots are single rows. The predictions above are wide for that reason.
