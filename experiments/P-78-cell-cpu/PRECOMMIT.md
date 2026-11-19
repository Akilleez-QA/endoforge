# P-78 cell CPU: measure where it goes, then make a cell start cheap (the guard's rewrite copies bytes once), on top of P-77: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 5 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-77 (draft PR #179, kept, branch `climb-r4-bundle-handles`), not on main.

## Question

P-77 measured 64.2 needs/s at width 64 and named the 12 cores, through the cells, as the next ceiling: cell CPU per need 124 ms at width 64 against about 85 ms at width 1. It guessed that cell retirement (`retireAfterJobs = 256`, REQ-ISO-016) was the largest remaining cost, but did not measure it. This round measures first, then pulls one lever.

## What the profile showed (exploratory, before this precommit)

All rows below ran on P-77's code (an unchanged worktree of `climb-r4-bundle-handles`) with this folder's harness, one row per process, load ≤ 4 at row start. They are diagnostics, not acceptance rows. Receipts: `receipt/explore-p77/`, `receipt/profile/`.

| Row (P-77 code) | needs/s | wall per need | cell CPU per need | cell spawns in window |
|---|---|---|---|---|
| width 1, as shipped (2 rows) | 13.3, 12.5 | 76.2, 81.1 ms | 81.9, 97.4 ms | 3, 3 |
| width 1, retirement off (diagnostic only) | 16.2, 16.1 | 62.0, 61.9 ms | 64.6, 63.0 ms | 0 |
| width 64, as shipped (2 rows) | 62.9, 63.2 | — | 126.1, 122.7 ms | 13, 13 |
| width 64, retirement off (diagnostic only) | 88.0, 87.1 | — | 84.5, 87.7 ms | 0 |
| width 12, retirement off | 76.1 | 156.5 ms | 90.5 ms | 0 |

- **Retirement is the largest single cost in the cells.** Turning it off (a diagnostic override, never a shipped setting) removes 38 ms of the 124 ms of cell CPU per need at width 64 (31%) and lifts throughput 63 → 88 needs/s (+39%), at which point the four ledger writers saturate (net 0.98). At width 1 it removes 26 ms of cell CPU and 17 ms of wall per need (the `crossing` bucket falls 21 → 4 ms: jobs wait on a warming cell). Each replacement costs about 3.5 CPU-seconds at width 64 (13 spawns per ~1,200 needs) and about 2 at width 1.
- **Without retirement, contention inflates the per-job work only 1.35×** (cell CPU 86 ms at width 64 against 64 ms at width 1), not P-77's 1.5×: a third of P-77's inflation was retirement under contention.
- **Where a new cell's CPU goes** (`--cpu-prof` per cell; profiled cells ran without the permission model, which blocks profile writes). A cell start on an idle machine takes 1.64 CPU-s and 1.05 s wall (`warm.mjs`); its main thread is busy 1.05 s, of which **the WASM guard's rewrite of the 8.9 MB pinned compiler module takes 0.54 s and GC 0.13 s**, JS parse 0.06 s, primers about 0.2 s, and V8's background WASM compile the rest. At width 64, in the first 6 s of each cell's life, the rewrite (`isolate-wasm.mjs`: `rewrite`, `take`, `vector`) takes **1.57 s of main-thread CPU per cell plus about 0.4 s of GC**: the largest category in a cell's whole profile (27% of main-thread time), ahead of the compiler itself (19%). `receipt/profile/timeline.txt` has it by cell age.
- The rewrite is a pure function of the module bytes, but it builds every section as a JavaScript array of numbers (`Array.from`, spread, one `push` per byte of the code section) and copies the module several times. A version that copies unchanged bytes through as views and concatenates once produces **byte-identical output** for all 21 modules a warm cell compiles (the compiler, the primers and the 17 P-15 kernels: sequence digest `5fdee89d…` on both, `ident.mjs`), and a cell's warm-up falls from 914 to 290 ms wall on an idle machine.
- QoS `background` on a width-1 cell (to see Efficiency-core cost) gave 412 ms of cell CPU per need: macOS throttles background work far beyond the E-core speed ratio, so it is not a usable E-core measure and is not used below.

## Lever (one commit)

**The guard's rewrite copies each byte once** (`core/runtime/isolate-wasm.mjs`). The reader returns views instead of arrays; sections stay `Uint8Array`s; each function body is scanned with a 256-entry opcode table (the same admitted opcodes and immediates, the same refusals, in the same order) and copied through as views around each rewritten `memory.grow`; output is concatenated once. Validation, the trusted and tooling digest checks, the memory caps, the helper bodies, the breach flags and every refusal are unchanged, and the bytes handed to `WebAssembly.compile` are identical.

Ship the check: `core/runtime/test/isolate-wasm-rewrite.test.mjs` pins the digest of the rewritten compiler module and of the whole sequence a warm cell compiles to what the pre-P-78 rewrite produced (traced under REQ-ISO-008).

Not changed: `retireAfterJobs` (256) and REQ-ISO-016, process isolation and the permission flags, the gates, the freeze rule, the frozen record and its identity (`isolate-wasm.mjs` is not an x1 implementation file), the ledger, P-75's re-run, P-76's four writers, P-77's handles.

## Predictions (P-77 arm = `climb-r4-bundle-handles` at 5d7b84f; P-78 arm = this branch)

- Cell CPU per need at width 64: **−8% to −20%** (the rewrite and its GC are about 2 CPU-s of each ~3.5 CPU-s replacement; 13 replacements per ~1,200 needs ≈ 20 ms of 124).
- Throughput at width 64: **+8% to +20%**. The four writers (0.76–0.80 in P-77) saturate near 85–88 needs/s, which caps the gain.
- Wall per need at width 1: **−2% to −8%**.
- Correctness: identical outcome classes and proportions, 0 wrong verdicts, 0 errors.

## Oracle and keep bar

- Keep only if width-64 needs/s rises by **≥ 5% with Welch p < 0.05** over 4 + 4 interleaved rows, cell CPU per need falls, and width 1 is not worse than −3% (wall +3%).
- Correctness: `wrongVerdicts` = 0 and `errors` = 0 on every row; the same outcome classes in both arms; the rewrite test passes; `make check` passes; `make -k test`, one command per file on both arms excluding `isolate-host-call.test.mjs` (hangs on macOS), shows no failure on P-78 that P-77 doesn't have. The writer, the rows and the frozen record are unchanged by construction (no writer or x1 file changes), so replay is not re-run; the rewrite's byte identity is the content oracle.

## Procedure

- Same harness as P-77 (`run.mjs`, copied, with exploratory `diag` and `stamp explore` additions that acceptance rows do not use), reference machine (Apple M6, 12 cores, 16 GiB, Node v26.13.1).
- `run.mjs <out> <stamp> row <w64|w1> <rep>`, reps 0–3, order per rep: w64 P-77, w64 P-78, w1 P-77, w1 P-78. One row per process; a row waits for load ≤ 4 (up to 10 minutes) and re-runs at once if it ends above 16.
- Safety caps: stop if load stays above 16, memory pressure is critical, swap exceeds 8 GB or free disk falls below 20 GB.

## Stop and rollback

- If the rewrite's output differs on any module, or any row has a wrong verdict or error: stop, revert.
- If the keep bar fails: record `failed` in RESULT.md and the PR, revert the lever on the branch.
