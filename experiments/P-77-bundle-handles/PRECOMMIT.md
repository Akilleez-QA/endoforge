# P-77 handles, not payloads: the frozen bundle's implementation files cross as digests, on top of P-76: precommit

Label: **Proposed** procedure, frozen 2026-11-17 before any acceptance measurement. Round 4 of the climb loop: the objective is plumbing speed, with correctness as a light guard. **No model calls and no spending.** The model is P-73's in-process stand-in (arm A) at zero latency. Every process runs with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` and `OPENAI_API_KEY` unset, and the harness asserts that at start.

This round stacks on P-76 (draft PR #178, kept, branch `climb-r3-ledger-writer`), not on main.

## Question

P-76 measured 56.5 needs/s at width 64 and named the cells as the next ceiling: 12 cells fully occupied, 71% of their time doing cell work, 264 ms of wait per need. It named the data movement as the lever. Each need moves the frozen bundle, about 420 KB of hex of which 412 KB is the 14 runtime files of `core/runtime/x1`, through every boundary: cell → host (`admit` host call), host → writer (`admit` request), writer → host (the `encoded` echo), host → cell (the host-call reply), and host → cell again inside the next job's `admission`. The cell and the host then hash and JSON-parse the whole of it at every verification. If the implementation files cross only as SHA-256 digests and the writer fills them from the repository files it already reads for `frozen_drift`, does width-64 throughput rise?

## What the pilots showed (profile before choosing)

- **Bytes per need** (`bytes` plan, width 1, 134 needs each arm): writer requests and answers 985 KB → 182 KB; `admit` 419 KB → 17 KB each way; job messages host → cell 557 KB → 98 KB, of which `admission` 479 KB → 20 KB.
- **Writer replay** (400 requests captured from a P-76 width-64 row, converted to digests, replayed through P-77's writer code with P-76's `x1` files): row digests identical, answers identical after the frame is assembled back into P-76's `encoded`, writer CPU 2.88 → 2.79 ms per request. A first version that elided the files with string search cost 4.0 ms per request; it was replaced by a re-encode of the parsed bundle before any acceptance row.
- **Width-64 pilot rows** (single 25 s rows, machine shared): P-76 50.4, 62.3, 54.4 needs/s; P-77 59.3, 64.6, 53.2 (the last pair started at load 9.4 and 2.0). The machine is CPU-bound in every row: `top` shows 85–95% of the 12 cores busy, node at 8–9 cores and the four writers at about 1.5.
- **The harness's CPU per need was wrong in P-73–P-76**: it summed live processes only, so a cell retired after 256 jobs (every ~18 s at width 64) took its CPU with it, and width-1 rows showed negative CPU. This harness keeps each pid's last-seen CPU, sampled each second, by role (host, cells, writers).

## Lever (one commit)

1. **The cell sends digests** (`core/runtime/x1/loop-port.mjs`): the `admit` host call carries the three oracle files and `implementation`, the SHA-256 of each of the 14 runtime files, computed once at cell start. The host forwards it (`loop.mjs`).
2. **The writer fills from the repository and refuses payloads** (`tools/x1_loop.py`): `admitted_files` refuses an admit whose `files` holds any implementation file ("implementation files travel as digests, not payloads"), refuses a digest for a name outside `IMPLEMENTATION_FILES`, checks each digest against the repository file and builds the same `files` as before, so the frozen record and every row are byte-identical.
3. **The writer answers with a frame, not the echo**: `admission(record)` returns `{ identity, digest, frame, elided }`, where `frame` is the canonical encoding of the record data with the content's implementation files that equal the repository's blanked. `admit` (fresh, existing and resume) and `revise` use it. `frozen_drift` reads the same repository files through one helper.
4. **One verification, from the frame** (`verifyFromMemory`): the cell (and the host at commit) puts its own copy of each elided file back into the frame, checks `evr:sha256(encoded) = identity` and `sha256(content) = freeze.digest` with incremental hashes over the pieces, and parses only the small frame. Integrity stays verifiable where the bundle is read; a wrong elision, an unknown name or a changed frame fails `frozen identity changed`.

The ban "no implementation payload in `admit`" ships as an enforced check: the writer refuses it, and `tools/test_x1_handles.py` pins the refusal, the digest check, row identity and an answer under 32 KB with no `encoded`. A loop test pins the frame in the cell.

Unchanged: the gates, the freeze rule, the frozen record and its identity, every validation on append, the chain check on read, the journal's `F_FULLFSYNC` per group commit, SQLite's sync settings, the decision file syncs, P-75's re-run and P-76's four writers. Behaviour that changes on purpose: a cell whose runtime files differ from the repository was frozen and then rejected at commit as `frozen_drift`; now the writer refuses its `admit`.

## Arms and procedure

- **P-76**: `origin/climb-r3-ledger-writer` (556c78c) in its own detached worktree, with this folder's harness copied in, untracked.
- **P-77**: this branch.

Harness (the oracle): P-76's `run.mjs` with three changes: a `row <w64|w1> <rep>` plan that runs one acceptance row per host process (P-76's finding: its paired fixed-seconds plan let a faster arm exceed its per-process need cap), CPU by role that survives cell retirement, and job bytes in the `bytes` plan. Row settings are P-76's: width 64 with 12 process cells, 25 s with 6 s warm-up; width 1, 25 s with 5 s warm-up. A process stays under about 1,800 needs.

Order: four repeats, interleaved, P-76 first in each: `w64` P-76, `w64` P-77, `w1` P-76, `w1` P-77, then the next repeat. Before each row the harness waits until the 1-minute load is at or below 4 (up to 10 minutes) and records it. After the repeats, `bytes` runs once per arm.

Replay (`rows.py`): one capture of writer requests from a P-76 `capture` row (width 64, 20 s), replayed through each arm's writer three times. The P-77 arm replays the capture converted to digests, through P-77's writer code with P-76's `x1` files (the bundle holds those files, so the rows can be identical only with the same files). It reports CPU per request, bytes, the row digest, the raw answer digest and the answer digest after each frame is assembled back into an `encoded` and checked against its identity.

## Predictions

| Quantity | P-76 (expected) | P-77 predicted |
|---|---|---|
| needs/s, width 64 | 50–62 | **+2% to +8%** |
| Bytes per need, writer requests + answers | ~985 KB | **≤ 200 KB** |
| Bytes per need, host → cell job messages | ~560 KB | **≤ 110 KB** |
| `freeze` bucket per need, width 64 (the cell held on `admit`) | 50–66 ms | **−5% to −20%** |
| Cell CPU per need, width 64 | ~140 ms | **−3% to −12%** |
| Host ELU, width 64, per need served | ~0.50 at ~56/s | lower per need |
| Wall per need, width 1 | 76–79 ms | **within ±3%** |
| Writer CPU per request, replay | ~2.9 ms | −0% to −10%; rows identical, assembled answers identical |
| Ledger bytes on disk per need | unchanged | unchanged (rows identical) |
| Binding stage after the lever | cells and the 12 cores | still the cells and the cores |

## Oracle and bars

- **Keep** if all of these hold:
  - needs/s at width 64 rises at least 3% on the mean, with Welch's t across the 4 + 4 repeats at p < 0.05;
  - width 1 doesn't regress more than 3%;
  - bytes per need through the writer fall at least 70%;
  - correctness holds:
    - every row has `wrongVerdicts` = 0 and `errors` = 0, and the same set of outcome classes as P-76;
    - the replay's row digests are identical between arms, and P-77's assembled answers are identical to P-76's answers;
    - `make -k test`, run one file at a time with `--test-timeout=120000` and a hard 600 s cap per file, shows no failure on P-77 that P-76 doesn't also show. `core/runtime/test/isolate-host-call.test.mjs` is excluded on both arms (it hangs on macOS, `ps --ppid`);
    - `make check` passes.
- Reconciliation (unattributed share) must stay under 5% of wall in every row.

## Stop rules

- Stop before a row if the 1-minute load is above 16, memory pressure is critical, swap is over 8 GB, or free disk is under 20 GB. (Swap was 6.3 GB of 7 GB at precommit.)
- Load above 4 at the start of a row: wait, as stated above. A row that ends with the load above 16 is re-run once and labelled.
- No real model call can happen: the credential variables are asserted unset, and the stand-in is in-process.

## What a miss means

- **Bytes fall but throughput doesn't clear the bar:** `failed`, not kept. The data movement was not the cells' cost; the next ceiling is named from CPU by role.
- **Throughput clears the bar:** kept.
- **Any wrong verdict, new error, new outcome class, digest difference or new test failure:** `failed_with_test_concern`, not kept.

## Limits known now

- One shared desktop machine with 12 cores; the rows push the load to 8–14 themselves, and single pilot rows of the same arm differ by up to 20%. The predicted effect is near the noise, so the bar may miss with a real gain underneath.
- The frame and the row identity hold only while the frozen content is the writer's canonical encoding; `validate_frozen` already requires that.
