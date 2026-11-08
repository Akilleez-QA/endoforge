# P-60 a cheaper type check in the contained cohort: result

Status: **Recorded (probe)**, 2026-11-07, Node 26.13.0, on a shared desktop with two other lanes measuring. Precommit: [PRECOMMIT.md](PRECOMMIT.md), committed and pushed at 15:12 EST (7ec2efe) before any acceptance measurement; Amendment 1, which adds two arms and tightens the decision rule, was pushed at 15:23 (aceb6bb) after round 1 and before either new arm was measured. Digests are in `receipt/precommit.sha256`. Raw rows: [receipt/](receipt/). The 1-minute load ran from 7.1 to 17.4; loaded rows (above 16) are marked and aren't acceptance figures.

**At width 16 the new default, `fused` with a reused tsrs instance (discarded after 16 MiB of growth) and a host-owned incremental baseline, reaches 649 accepted attempts per second in its worse round (702 in the better), against 443–510 for P-58's fresh `fused` arm in the same session. It uses 23.6 ms of CPU per accepted attempt against 36.9 for fresh `fused` and 32.0 for `supervisor`, at 65.7 MiB peak RSS per active attempt (46.1 for fresh `fused`). It misses the 700 per second bar and the 49.1 MiB memory bar, and holds parity and fatal.** It became the route default under the precommitted rule.

A post-lib memory snapshot isn't possible from the host. What made each check cheaper: restoring a reused instance from its post-instantiation image (about 3 ms of instantiation saved per check, exact by construction), and seeding each check with build info from a clean host-owned check of the same project, so tsrs reuses `lib.d.ts`'s diagnostics instead of checking the library again. That was about 8 of a check's 14 ms. A check alone went from 17.3–17.7 ms to 7.5–7.9 ms.

## Speed and resources

Workload: P-58's, unchanged. Rows run `max(400, 40 × width)` attempts in a closed loop, so the attempts in flight equal the width. CPU is supervisor plus cohort, per accepted attempt. "RSS/active" is peak cohort plus supervisor RSS divided by width; about 280–310 MiB of the supervisor is the harness (the AssemblyScript compiler), which is why width 1 is large. Cells are rounds 1 / 2 / 3 / 4; the two new arms exist only in rounds 3–4. **Bold** is the acceptance figure: the original arms' worst unloaded round of 1–4, the new arms' worse of 3–4. `L` marks a loaded row.

Width 16:

| Arm | Accepted per s | CPU ms per accepted | RSS/active MiB | Cohort-only RSS/active | Check p50 ms |
|---|---|---|---|---|---|
| `supervisor` | **42.5** / 52.5 / 60.6 / 61.4 | **53.7** / 39.5 / 32.0 / 31.1 | 39.3 / 39.2 / **40.9** / 40.4 | 20.7–21.5 | 64–95 |
| `fused` (fresh, P-58) | 289.3 / **279.5** / 443.2 / 509.9 | 49.8 / **53.3** / 36.9 / 33.1 | **51.1** / 47.6 / 46.0 / 46.1 | 26–34 | 29–54 |
| `fused-reuse` | **427.3** / 465.0 / 571.9 / 655.7 | **32.9** / 30.1 / 29.1 / 26.1 | 182.0 / 181.6 / 181.4 / **183.1** | 163–164 | 20–29 |
| `fused-reuse-base` | 596.8 L / **641.3** / 693.7 / 798.2 | 24.0 L / **23.1** / 23.0 / 22.2 | 138.1 L / 139.5 / **143.7** / 139.9 | 119–125 | 16–19 |
| `sibling-reuse-base` | 657.0 / **627.7** / 710.6 / 829.1 | 23.6 / **24.2** / 23.2 / 21.6 | 145.3 / **146.8** / 145.8 / 146.6 | 126–129 | 16–18 |
| `fused-base` | **563.9** / 651.8 | **29.5** / 25.6 | 50.2 / **50.9** | 31 | 22–25 |
| `fused-reuse16-base` (new default) | **649.4** / 702.1 | **23.6** / 21.4 | 65.3 / **65.7** | 46 | 18–19 |

Widths 1, 8 and 32, accepted per second (CPU ms per accepted), rounds 3 / 4:

| Arm | Width 1 | Width 8 | Width 32 |
|---|---|---|---|
| `supervisor` | 53.4 / 53.1 (37.0 / 36.8) | 60.8 / 57.2 (31.7 / 34.2) | 57.6 / 61.3 (35.0 / 31.6) |
| `fused` | 52.4 / 51.3 (25.1 / 25.4) | 315.6 / 320.3 (30.1 / 29.6) | 355.5 / 315.8 (45.9 / 50.1) |
| `fused-reuse` | 63.5 / 64.5 (18.5 / 18.1) | 405.4 / 402.6 (22.3 / 22.3) | 430.6 / 357.0 (39.6 / 39.3) |
| `fused-reuse-base` | 132.9 / 127.8 (9.7 / 10.1) | 696.0 / 645.1 (13.8 / 15.0) | 536.4 / 451.5 L (29.3 / 28.0) |
| `sibling-reuse-base` | 130.1 / 132.5 (9.8 / 9.6) | 689.0 / 657.8 (13.7 / 14.2) | 559.9 / 345.1 L (30.1 / 34.9) |
| `fused-base` | 83.6 / 86.6 (17.9 / 17.0) | 460.7 / 457.0 (21.5 / 22.2) | 513.6 / 166.7 L (32.7 / 65.5) |
| `fused-reuse16-base` | 109.3 / 105.5 (11.9 / 12.3) | 517.7 / 522.9 (16.5 / 17.0) | 584.3 / 463.0 L (28.7 / 32.4) |

RSS per active attempt for `fused-reuse16-base`: 425–428 MiB at width 1 (harness-dominated), 92.7 at 8, 61–62 at 32. Every attempt in every row was accepted and no cohort restarted.

What the tables say:

- **The baseline is the main lever.** Seeding the check with host build info halves check time at width 1 (17.5 → 6–8 ms) and doubles width-1 throughput. Reuse alone gives 15–30%.
- **Reuse costs memory the way it was first built.** A restored allocator can only grow linear memory, so each reused run touches about 3 MiB of new pages, and with a 256 MiB discard limit every Worker, spares included, kept up to that much resident: 138–183 MiB per active attempt at width 16. Discarding at 16 MiB (`fused-reuse16-base`) brings it to 65.7 and keeps most of the speed (649 against 694 for the 256 MiB version in the same round).
- **Width 32 still falls** from width 16 in every cohort arm, as in P-58 (16 cores, `heavy-run` caps the slice near 18). Several round-4 width-32 rows were loaded.
- **Round-to-round spread is large.** Fresh `fused` at width 16 ran 279–510 across the four rounds (P-58 recorded 380–516). Rounds 1–2 ran at load 10–16 with other lanes measuring, rounds 3–4 at 7–11.

## How the cheaper check works

- **Instance reuse** (`tools/tscheck/tsrs-reuse.mjs`). tsrs 0.22 has no start function, one mutable global (the shadow-stack pointer, not exported) and a fixed table. A reusing `runTsc` keeps one instance per Worker and, before each check after the first, restores linear memory from the module's post-instantiation image: every non-zero byte (80.0–84.8 MiB) and zeros up to the initial size (92.8 MiB). After a normal return the stack pointer is back at its initial value. Memory below 80 MiB (the stack) is dead between calls, and memory above the initial size, grown by earlier runs, is unreachable from the restored allocator. The instance is discarded after a trap, a `proc_exit`, any exception, 1,000 runs, or 16 MiB of growth above its initial size. To reuse the pinned `core.js` unmodified, the cohort gets its text (digest-checked) with its one private `prepare` exported; the transformation refuses a core without exactly one.
- **Host baseline** (`createBaseline` and `runCheck(…, { baseline })` in `check-core.mjs`). Each checking Worker runs one clean check of the route's own project with the kernel `export {};` at boot and keeps the build info. Each candidate check is seeded with it and emits. tsrs then reuses the library's (empty) diagnostics unless the candidate changes the global scope, in which case it checks every file again. The baseline is used only for the same root, the same tsconfig and the same set of file names, and not when every file equals the baseline's (the compiler would emit nothing). Build info from a candidate is still never accepted.
- **Not used:** `skipDefaultLibCheck`. It saves as much time, but a global-scope kernel `interface Iterator<T> { next(): number }` has its only diagnostic in `lib.es2015.generator.d.ts`, so skipping library checks turns that refusal into a pass. 13 of the 50 global-scope candidates (25 kernels, each as a script and a module) report diagnostics inside the library.

## Is it sound, and how that was shown

| Check | Result |
|---|---|
| Parity, 132 candidates (P-58's 80 plus 50 global-scope kernels as script and module, a kernel equal to the baseline, a 12,000-member union that grows memory to 418 MiB), width 8, each new arm vs fresh `fused` and vs `supervisor` | 0 differences in status, reason, passed, total, first five diagnostics or emitted digests, for all five new arms (`receipt/parity-26.13.0.json`, `parity-amendment1-26.13.0.json`). 43 accepted, 65 `typescript`, 24 `tests` in every arm |
| A trap (50,000-deep parentheses) then the 132 candidates in three shuffled orders through one cohort at width 1, vs fresh `fused` | 0 differences in 15 sequences of 133 checks. The trap is `outcome_unknown` / `checker_error` in every cohort arm |
| Unit tests (`tools/tscheck/test/tsrs-reuse.test.mjs`) | reused vs fresh in three orders; the dead stack and the region above the initial size filled with `0xA5` before every run, with no change in any diagnostic or emitted byte (filling 64 KiB of the restored region instead fails the test); trap and growth discards; baseline vs full check on the corpus, the baseline source and all 50 global-scope kernels |
| Route tests (`tools/tscheck/test/cohort-check.test.mjs`) | the same verdicts for reuse, baseline, both, and sibling, against fresh `fused`, over the P-58 test corpus plus the global-scope kernels; heap death and cohort kill for every configuration |

The soundness of the baseline rests on tsrs's incremental invalidation (a port of TypeScript 7's): the parity set includes every global-scope kernel I could build that puts diagnostics in the library, and they all matched, but that's evidence, not proof. Reuse is exact by construction, as above, and the poison test checks the one assumption (that dead memory isn't read).

## Bars

Judged on `fused-reuse16-base`, the arm the rule picked, at width 16.

| # | Bar | Measured (acceptance figure) | |
|---|---|---|---|
| 1 | ≥ 700 accepted/s, unloaded, worse round | 649.4 (round 4: 702.1) | **missed** |
| 2 | CPU per accepted ≤ same-session `supervisor` | 23.6 ms against 32.0 (rounds 3–4) | **met** |
| 3 | Peak RSS per active ≤ 49.1 MiB | 65.7 MiB (fresh `fused` in the same rounds: 46.1) | **missed** |
| 4 | Zero verdict and emit differences vs fresh instances on parity plus adversarial | 0 of 132 at width 8, 0 in 15 sequences of 133, unit poison test clean | **met** |
| 5 | Fatal as P-58 | 3 of 3 heap breaches: breacher `outcome_unknown` / `checker_lost` / `ERR_WORKER_OUT_OF_MEMORY`, 31 of 31 neighbours completed, 32 dispatches for 32 admissions, no restart. 3 of 3 kills: exactly 16 `outcome_unknown` (`cohort_exit`), 16 queued completed once on one replacement, 32 dispatches | **met** |

The original arms, on their worst unloaded round of 1–4: none reached 700 (best: `fused-reuse-base` 641.3, `sibling-reuse-base` 627.7); all met bar 2 against `supervisor`'s 53.7 ms in those rounds (and against its 32.0 in rounds 3–4); all missed bar 3 at 144–183 MiB; all held bars 4 and 5. `fused-base` (fresh instance plus baseline): 563.9, 29.5 ms, 50.9 MiB, bars 4 and 5 held.

Fatal recovery is slower: from the kill to the first result on the replacement took 589–695 ms, against P-58's 378–473, because each new Worker makes its baseline check before it reports ready.

Predictions: `fused-reuse` landed in its predicted band (427–656). The baseline arms landed at 628–829, inside my 750–1,100 band only in the better rounds; I gave bar 1 two-to-one odds and it missed. Memory came in far over my 35–60 MiB prediction until the growth limit was bounded; I hadn't anticipated the allocator only growing.

## Decision

Applied to rounds 3–4 at width 16 against fresh `fused` (443.2 per second, 36.9 ms, 46.1 MiB, so at most 69.2 MiB under the amendment's 1.5× tightening): `fused-reuse16-base` (649.4, 23.6 ms, 65.7 MiB) and `fused-base` (563.9, 29.5 ms, 50.9 MiB) qualify; `fused-reuse`, `fused-reuse-base` and `sibling-reuse-base` fail on memory (144–183 MiB). The faster qualifier by more than 10% is `fused-reuse16-base`, so **the route default is now `check: 'fused'` with `checker: { reuse: true, incremental: true }`, and `reuse: true` means a 16 MiB growth limit.** Bars 1 and 3 are misses, reported and not retuned. Fresh full checks stay selectable with `checker: { reuse: false, incremental: false }`; `supervisor` is unchanged.

## What changed in the code

- `tools/tscheck/tsrs-reuse.mjs`: `exposePrepare`, `memoryImage`, `restoreImage`, `createReusingRunTsc` (`growthMb` 16, `maxRuns` 1,000 by default).
- `tools/tscheck/check-core.mjs`: `createBaseline` and a `baseline` option for `runCheck`; build info passed by a caller still can't be combined with emit.
- `tools/tscheck/cohort-check.mjs`, `cohort-preparer.mjs`: `reuse` and `baseline` options for both cohort placements.
- `tools/tscheck/contained-route.mjs`: `checker.reuse` and `checker.incremental`, both on by default for cohort placements; `BASELINE` is the baseline kernel.
- `experiments/P-58-cohort-typecheck/bench.mjs` now passes fresh-check options explicitly, so it still measures what P-58 measured.
- Tests: `tools/tscheck/test/tsrs-reuse.test.mjs` (7), `global-scope-kernels.mjs`, and the new configurations in `cohort-check.test.mjs`.

## Not shown or unverified

- Acceptance runs are Node 26.13.0 only; Node 22.23.3 ran the test suites, not the bench.
- Two other lanes were measuring; rounds 1–2 ran at load 10–16, and several width-32 rows were loaded. Fresh `fused` itself varied 279–510 at width 16 across the rounds.
- One workload of small scalar needs. A bigger project grows memory faster, so a 16 MiB limit discards more often there; that wasn't measured.
- The baseline's soundness depends on tsrs's incremental invalidation; the evidence is the adversarial set and P-49's 220 comparisons, not a proof.
- In the route only one tsrs build (0.22.0-ts7.1.0-beta) was examined; the reuse code refuses a core whose private `prepare` it can't find, but a new tsrs with start functions, extra mutable globals or a growable table would need this analysis again.
- Spare guest Workers each build a baseline and hold an instance, so idle cohort memory is higher than with fresh checks.
