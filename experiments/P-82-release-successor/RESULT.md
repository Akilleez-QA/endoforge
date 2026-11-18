# P-82 release-successor: the freeze releases the cell, and a retiring cell's successor warms as a standby with one primer round, on top of P-78: result

Status: **kept** (every keep bar met, including GitHub Linux CI on PR #184 at 5ca4000: lint, test (22), test (26), coverage, rust-lane and secret-scan green), 2026-11-18. Reference machine: Apple M6 Mac mini, 12 cores (2 Super, 4 Performance, 6 Efficiency), 16 GiB, Node v26.13.1, Python 3.15.2. Stand-in model only (arm A, zero latency): **no model calls, no tokens**, and the credential variables are asserted unset. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (ed4f3aa) before any measurement of the lever.

- **Lever measured:** ea3625c, pushed before the acceptance rows; every P-82 receipt names it. It is P-80's 10c0cac and P-81's 6af4a68 re-applied on 48cd38f, with only `sources/SHA256SUMS` regenerated.
- **Base arm:** P-78 at 48cd38f, which is `climb-r5-cell-cpu` with the CI fixes merged, and equal in tree to `main` after #178–#180.
- **Single-lever arms (exploratory):** uncommitted worktrees at 48cd38f with one lever's diff applied each, so their receipts read 48cd38f.
- **Receipts:**
  - acceptance rows: `receipt/accept-p78/` and `receipt/accept-p82/` (`row-{w64,w1}-{0..3}.json`);
  - single-lever rows: `receipt/explore-p80/` and `receipt/explore-p81/` (`row-w64-{0..3}.json`);
  - `receipt/summary.json` (`summarize.py`);
  - `receipt/stream.json` (`stream.py`), with the capture rows in `receipt/guard-p78/` and `receipt/guard-p82/`;
  - test runs: `receipt/tests-p78.json`, `receipt/tests-p82.json` and `receipt/reruns.json`.

**Width-64 throughput rose 5.8%**, from 76.3 to 80.7 needs/s (Welch t = 8.5, df ≈ 5.5, **p ≈ 0.0002**). That is inside the predicted +5% to +10%. **Width 1 fell 7.3%**, from 64.1 to 59.5 ms per need (t = −8.1, p ≈ 0.0003), inside the predicted −4% to −10%.

Needs/s per GB rose from 15.4 to 17.0. The request stream is identical, there were 0 wrong verdicts, and there is no new test failure.

## Predictions against measurement

The rows ran 4 + 4 interleaved, one row per host process, each started at load ≤ 4. The order per rep was w64 P-78, w64 P-82, w64 P-80 only, w64 P-81 only, w1 P-78, w1 P-82.

| Quantity | P-78 | P-82 | Predicted | Verdict |
|---|---|---|---|---|
| needs/s, width 64 | 76.88, 76.71, 75.57, 75.95 (**76.3**) | 81.03, 81.65, 79.63, 80.64 (**80.7**) | +5% to +10% (bar ≥ +3%, p < 0.05) | **met** (+5.8%, t = 8.5, p ≈ 0.0002) |
| Cell net / gross utilisation, width 64 | 0.639 / 0.998 | 0.937 / 0.937 | net ≥ 0.90 | met |
| Cell queue wait, width 64 | 188 ms | 114 ms | — | −40% |
| Cores by role, width 64 | 9.69 (cells 8.00) | 10.56 (cells 8.68) | 10.5–11 | met |
| All CPU per need, width 64 (host + cells + writers) | 127.0 ms (cells 104.8) | 130.8 ms (cells 107.6) | within +6% | met (+3.0%) |
| Wall per need, width 1 | 64.5, 63.0, 65.1, 63.8 (**64.1 ms**) | 59.0, 60.1, 58.7, 60.0 (**59.5 ms**) | −4% to −10% (bar ≤ +3%) | **met** (−7.3%, t = −8.1, p ≈ 0.0003) |
| `crossing` per need, width 1 | 9.3 ms | 4.0 ms | — | at P-78's no-replacement value (4.1 ms) |
| CPU per need, width 1 (cells) | 76.2 ms (62.9) | 75.1 ms (61.6) | — | −1.4% |
| Tree RSS (window end), width 64 | 4.97 GB | 4.76 GB | may rise | fell; sampled peak 5.43 → 5.82 GB (+7%) |
| needs/s per GB, width 64 | 15.36 | 16.98 | must not fall | **met** (+10.6%; per sampled-peak GB 14.06 → 13.87, −1.3%) |
| Ledger stage utilisation, width 64 | 0.889 (0.874–0.912) | 0.871 (0.846–0.886) | ≤ 0.95 mean | met: not past saturation |
| Writer CPU per need, width 64 | 14.6 ms (1.11 cores) | 15.3 ms (1.24 cores) | not up more than +10% | met (+4.8%) |
| Stage verdict, width 64 | `ledger (saturated)` × 4 | `cell (saturated)` × 4 | — | the binding stage moved back to the cells |

- **Load above 16 during one row.** The P-82 arm's `w64-r2` ended above 16 twice: first at 79.64, then at 79.63 on its automatic re-run. That load came from the row's own 12 cells and 4 writers (nothing else was busy on the machine). The receipt keeps the re-run, which started at load 12.8 because the harness re-runs a loaded row straight away (P-77's finding). The P-80-only arm's `w64-r1` did the same (79.71, then 79.60). Under release the 1-minute load average ends near 14–20 where P-78 ends near 8–10, because cells now run instead of block. The harness waited for load ≤ 16 before each row, and the next row started at load ≤ 4.
- **Per GB.** The precommitted measure (mean needs/s ÷ mean window-end tree RSS) rose. The window-end sample is noisy: one P-78 row read 5.73 GB. The sampled peak rose by about one cell in twelve, which is the standby, and per sampled-peak GB fell 1.3%. Both are recorded here; the keep bar uses the precommitted measure.

## Decomposition (exploratory, not acceptance; width 64)

| Arm | needs/s (4 rows) | Change on P-78 | Welch t, p | Cell net | Cores | CPU per need (cells) | Ledger utilisation |
|---|---|---|---|---|---|---|---|
| P-78 | 76.3 | — | — | 0.64 | 9.69 | 127.0 (104.8) | 0.889 |
| P-80 only (release) | 79.46, 79.60, 79.13, 80.18 (**79.6**) | +4.3% | 8.7, ≈ 0.0002 | 0.94 | 10.59 | 133.0 (109.8) | 0.825 |
| P-81 only (successor + 1 primer) | 78.53, 78.15, 77.70, 76.62 (**77.8**) | +1.9% | 2.8, ≈ 0.03 | 0.62 | 9.42 | 121.2 (99.1) | 0.909 |
| P-82 (both) | **80.7** | +5.8% | 8.5, ≈ 0.0002 | 0.94 | 10.56 | 130.8 (107.6) | 0.871 |

- **The levers add, with no measurable interaction.** The interaction (combined − P-80 − P-81 + P-78) is −0.33 ± 0.70 needs/s, or −0.4% of base. The sum of the single gains is +6.2%, against +5.8% measured.
- **Each lever acts on a different resource, as the hypothesis said.**
  - Release frees the slot: net utilisation goes from 0.64 to 0.94. It costs CPU through contention: CPU per need +4.8%, `compile` wall 52 → 74 ms.
  - The successor and primer cut CPU (cells −5.4%, all −4.6% per need) but leave the slot held on `admit` (net 0.62).
  - Together, release turns the slot into running work, and the successor's CPU cut pays for part of release's contention. CPU per need ends at +3.0% against P-78, below release's +4.8%.
- **In this round P-80 alone gave +4.3% at p ≈ 0.0002.** In round 7 it gave +3.8% at p ≈ 0.058. Its four rows here are tight (79.1–80.2). Round 7's P-78 arm had one low row and a wider spread (73.4–78.1), against 75.6–76.9 here. This is an exploratory arm, and the result does not depend on it.

## Correctness guard

- **Rows:** every row on every arm has `wrongVerdicts` = 0 and `errors` = 0. Both acceptance arms show the same two outcome classes, `true/true/passed/-` and `false/false/failed/-`, at 14.1–14.3% failed in every row.
- **Request stream** (`stream.py`, width-1 capture rows, `stream.json`): for the 189 needs both rows completed, all 189 `admit`, 216 `park` and 189 `commit` requests are identical across arms, with 0 differing.
  - `admit` and `park` are compared byte for byte after the row directory and the `loop-port.mjs` digest are mapped. That file is one of the 14 frozen implementation files, and both levers change it.
  - `commit` is compared after the timing fields are also dropped.
- **Test suite** (`make -k test`): run one command per file on both arms, with `--test-timeout=120000` under a 600 s alarm, and `isolate-host-call.test.mjs` excluded on both (it hangs on macOS).
  - **No failure on P-82 that P-78 does not have.** P-82 has 42 failing commands and 118 named failing tests; all are pre-existing failures that P-78 also has.
  - P-78 shows two more failing commands, both artifacts of the measurement setup: `experiment_id.py check` and `test_allocations_are_complete` fail there because the P-78 worktree held an uncommitted copy of this experiment's folder, which is not in that tree's `ALLOCATED`.
  - The pre-existing failures include `isolate-pool`'s bridge-death and prewarm cases, `ledger-writer`'s SIGKILL `half_frame` case, `loop-agent`, `loop-count`, `loop-review`, `isolate-limits`, `tscheck` and the gap targets.
  - Both new tests pass on P-82: `the freeze holds no cell under release, and holds it under hold` (`loop-waits.test.mjs`), and `the successor of a retiring cell warms as a standby, ...` (`isolate-flags.test.mjs`). So does the guard's rewrite pin (`isolate-wasm-rewrite.test.mjs`).
- **`loop-crash.test.mjs`** was run 4 times on each arm (`reruns.json`). The random-kill case (`bridge and supervisor kills at random times never yield a promotion without its evidence`) failed 2 of 4 on P-78 and 2 of 4 on P-82, in the same runs. In the suite run it passed on both arms. Counting both, that is 2 of 5 on each arm. It is the same timing flake as P-79 to P-81, and it is no more frequent on the lever.
- `make check` and `make lint` pass on the lever.
- **Not changed:**
  - `retireAfterJobs` (256) and REQ-ISO-016: no cell ran more than 256 jobs, and a standby ran none before taking its slot;
  - `hold`, the freeze rule and its checks, the frozen record, the rows and park as its own checkpoint;
  - durability: every answer still follows its frame's `F_FULLFSYNC`;
  - process isolation and the permission flags, the guard, the gates, and P-75 to P-78's levers.

## Floors against observed (zero latency)

Width 1, per need (P-78 wall 64.1 ms; P-82's 59.5 ms in brackets):

| Bucket | Share of wall (P-82) | P-78 | Physical floor | Distance (P-82) |
|---|---|---|---|---|
| `compile` | 42% | 24.5 ms (24.8) | not measured (AssemblyScript `-O3` through binaryen) | **unknown** |
| `crossing` | 7% | 9.3 ms (4.0) | 0.06 ms of IPC; 4.1 ms with no cell replacements (P-78) | ~65× IPC; **1.0×** no-replacement |
| `ledger` + `freeze` | 33% | 19.7 ms (19.9) | about 11 ms (3.14 requests × 3.5 ms unbatched `F_FULLFSYNC`, P-79) | **1.8×** |
| `gate` + `promote` | 18% | 10.4 ms (10.5) | not measured | **unknown** |

Width 64, throughput resources:

| Resource | P-78 | P-82 | Floor | Distance (P-82) |
|---|---|---|---|---|
| Cell slots | gross 0.998, net 0.64; 188 ms queue wait | gross 0.937, net 0.937; 114 ms queue wait | — | **binding** (`cell (saturated)`) |
| Machine CPU | 9.7 cores, 127 ms per need | 10.6 cores, 131 ms per need | 75 ms per need (width-1 CPU per need, P-82 arm) | **1.74×** |
| Cell CPU per need | 105 ms | 108 ms | 62 ms (width 1) | **1.75×** |
| Ledger writers | 0.889 in flight, 14.6 ms CPU per need | 0.871 in flight, 15.3 ms CPU per need | 11.4 ms CPU per need (replay, P-79) | 1.34× CPU; not saturated |

**Stop rule not met.** `compile` and `gate` + `promote` have no measured floor, and machine CPU per need at width 64 is 1.74× its width-1 value.

## Next binding ceiling

1. **The cells, now doing work 0.94 of the time, and through them the machine's CPU.** The machine runs 10.6 of 12 cores, 6 of which are efficiency cores. Cell CPU per need at width 64 is 1.75× width 1 (108 against 62 ms). The jobs' own wall times show the contention: `compile` is 78.6 ms per need against 51.8 ms on P-78 (+52%), and `gate` is 25.6 against 15.6 ms (+64%).
   - The largest removable item is still replacement: 21.5 cell starts per window, about 2 CPU-s each under load (P-81).
   - What is left there is structural. One option is fewer replacements, which needs the owner's decision on REQ-ISO-016's interval. Another is a lighter cell start, such as a V8 startup snapshot of the loaded compiler JS.
2. **`freeze` and `ledger` wall per need doubled at width 64:** 56 → 119 ms and 78 → 161 ms. The admit now waits outside any cell, so the time no longer holds a slot. The writers' in-flight utilisation fell (0.87), and their CPU per need rose 5%. They are latency-bound on `F_FULLFSYNC` batches, not CPU-bound. At width 64 this queueing is off the slot path. It still bounds per-need latency, and it would bind again if the cells got faster.
3. **Measure the `compile` floor** (a warm `asc.main` on the corpus kernels in one process), so the stop rule can be decided.

## Code delta

- **Product:** +68 −46 lines across `core/runtime/isolate-pool.mjs`, `core/runtime/x1/loop-port.mjs` and `core/runtime/x1/loop.mjs`, plus two tests, a test update, trace entries and doc lines. It is the union of P-80's and P-81's measured commits. No new option, no new process kind, and no new language crossing. After the measurement, one comment line in `isolate-pool.mjs` (on `successorLeadJobs`) was dropped because `make lint`'s no-comments check refuses it (a separate commit, no behaviour change).
- **Experiment tools:**
  - `run.mjs` and `exit-on-term.mjs` are P-81's, unchanged;
  - `stream.py` is P-81's, with the lever's `loop-port.mjs` digest;
  - `summarize.py` is P-81's, extended to the two single-lever arms, the interaction, writer utilisation, tree RSS and per GB.

## Receipts and how to reproduce

- `run.mjs <out> <stamp> row <w64|w1> <rep>` runs one acceptance row; `run.mjs <out> <stamp> capture1` runs a width-1 capture row.
- `summarize.py` builds the acceptance table, the decomposition and the interaction, with Welch t and p.
- `stream.py <capture P-78> <capture P-82>` compares the request streams.
