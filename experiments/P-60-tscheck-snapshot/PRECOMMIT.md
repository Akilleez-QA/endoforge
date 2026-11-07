# P-60 a cheaper type check in the contained cohort: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. Amendments go below with a new digest appended to `receipt/precommit.sha256`; the first digest stays.

Question: P-58 moved the type check into the contained cohort and reached 380–516 accepted attempts per second at width 16, short of 700, at 45 ms CPU per accepted attempt in its worse round. Its diagnosis: every check instantiates tsrs afresh and processes `lib.d.ts` again, and per-check CPU grows from 16.5 ms alone to 25–31 ms at 16 wide. Can the host make each check do less work, with no change to tsrs, and does that reach 700 per second at width 16 without costing more CPU or memory per accepted attempt than the alternatives?

The goal is speed and resource pressure: accepted per second, CPU-seconds per accepted attempt, peak RSS per active attempt, attempts in flight. Containment isn't the question.

## What the feasibility spike found (not a measurement for any bar)

Single runs and short loops on Node 26.13.0, load 3–12, while designing:

- **tsrs 0.22's module** (`tsrs.wasm`, sha256 `264cd33d…`, from `@tsrs/wasm@0.22.0-ts7.1.0-beta`, pinned in `tools/tscheck/pin.mjs`, source `github.com/oxc-project/tsrs`, `crates/tsrs_wasm`) exports only `memory`, `tsrs_input`, `tsrs_output`, `tsrs_output_len` and `tsrs_run`. There's no start function and no `_initialize`. It has one mutable global (the shadow-stack pointer, initial value 80 MiB, not exported), a fixed table (2,105 entries, minimum = maximum) and 966 data segments. `lib.d.ts` is embedded; the host file system is asked only for the project's files.
- **A post-lib snapshot is not reachable from the host.** `lib.d.ts` is processed inside the single `tsrs_run` call, after the project's sources are read. A host can copy linear memory there, from inside an import, but it can't capture or resume the engine's call stack, so there's no state "after lib, before the project" to restart from. The only safe points are call boundaries: after instantiation and after `tsrs_run` returns.
- **Calling `tsrs_run` again on one instance works** and gives the same diagnostics and emit, but it isn't faster than a fresh instance (no cache survives a run) and linear memory grows by about 5 MiB per run, so state leaks between runs. Restoring the instance's post-instantiation memory image between runs makes reuse equivalent to a fresh instance by construction: the shadow-stack pointer is back at its initial value after any normal return, the table never changes, and the image covers every non-zero byte of the initial memory (80.0–84.8 MiB) plus zeros up to the initial size (92.8 MiB). Memory above the initial size, grown by earlier runs, is never referenced again by the restored allocator. The stack region below 80 MiB is dead between calls. Restore takes 0.16 ms; instantiation takes 3.2 ms. A check on a reused instance took 14.4 ms against 17.1 ms fresh, alone.
- **Most of a check is checking `lib.d.ts`.** With `noLib` (diagnostic only, not usable) a check took 1.3–1.4 ms. With `skipDefaultLibCheck` it took 6.3 ms, but that is unsound: a global-scope candidate `interface Iterator<T> { next(): number }` has its only diagnostic in `lib.es2015.generator.d.ts`, so skipping lib checks turns a refusal into a pass. It's rejected and not measured.
- **tsrs's incremental build info is the sound version of that.** A host-owned baseline (one clean check of the route's own project with the kernel `export {};`, made in each Worker before it reports ready) gives build info whose `lib.d.ts` diagnostics the compiler reuses only when the candidate doesn't change the global scope; a global-scope candidate makes every file affected, so lib is checked again. On 22 global-scope adversarial kernels, full and baseline-seeded checks reported identical diagnostics, including the `Iterator` case, while `skipDefaultLibCheck` reported different diagnostics on 13 of them and a different verdict on one. A seeded check with emit took 6.2–7.3 ms against 13.4–14.4 ms full. Build info is still never taken from a candidate: the baseline is made by the host from a fixed source, and a candidate whose files equal the baseline's gets a full check (otherwise the compiler would emit nothing).
- In bare checking loops at width 16 (threads, 60 checks each, load 11–12): fresh 422–464 checks per second at 27–29 ms CPU each, reused instance 554–566 at 24 ms.

## Arms

All arms use one supervised `shared-reuse` cohort process (`--permission`, reused Workers, fresh guest context per run), P-58's route, Node 26.13.0.

| Arm | Placement | tsrs instance | Build info |
|---|---|---|---|
| `supervisor` | supervisor main thread (P-54) | fresh per check | none (full check) |
| `fused` | the guest's Worker (P-58 default) | fresh per check | none (full check) |
| `fused-reuse` | the guest's Worker | one per Worker, memory image restored before each check | none (full check) |
| `fused-reuse-base` | the guest's Worker | as `fused-reuse` | host baseline seeded |
| `sibling-reuse-base` | checker Workers in the cohort | as `fused-reuse` | host baseline seeded |

An instance is discarded and replaced after a trap, a `proc_exit`, any exception, 1,000 runs, or linear memory more than 256 MiB above its initial size. The check code is `check-core.mjs` in every arm; scoring stays on the supervisor.

## Workload and procedure

P-58's route workload unchanged: the 20 P-15 scalar needs, tests from the AssemblyScript build, 2,000 ms run deadline, widths 1, 8, 16 and 32, closed loop, `max(400, 40 × width)` attempts after a warm-up of `width`, arms interleaved within each width, the whole sweep twice. The acceptance figure for a row is the lower of the two rounds' accepted per second and the higher of the two rounds' CPU and RSS. CPU is user plus system time of the supervisor and the cohort process over the measured span, divided by accepted attempts. Peak RSS is sampled every 20 ms over the cohort plus the supervisor, divided by width.

A row is **loaded** if the 1-minute load average exceeds 16 at its start or end; a loaded row is reported but isn't an acceptance figure. A row starts only when load is at most 16 (waiting up to 30 minutes, then recorded as loaded). Heavy runs go through `HEAVY_SLOTS=4 heavy-run`. Two other lanes may be measuring on this machine; the load at each row's start and end is in the receipts.

## Bars, fixed now

Bars 1–3 are judged on the arm the decision rule picks, at width 16.

1. **Throughput.** At least **700 accepted per second** at width 16, unloaded, worse round.
2. **CPU.** CPU per accepted attempt at width 16 **no higher than the same-session `supervisor` arm's** (each arm's higher round).
3. **Memory.** Peak RSS (cohort plus supervisor) per active attempt at width 16 at most **49.1 MiB**, P-58's `fused` figure.
4. **Parity.** Zero verdict differences, including emitted artifact digests, between each new arm and the same-session `fused` arm (fresh instances), and against `supervisor`, on:
   - P-58's 80-candidate parity corpus (20 needs as they are, with a planted type error, with a wrong result, and the 20 whole kernels);
   - an adversarial set: the 22 global-scope kernels from the spike plus `/// <reference lib="dom" />`, `/// <reference no-default-lib="true"/>` and `/// <reference types="node" />` kernels, each as a script and as a module; a kernel equal to the baseline source; a check that traps (50,000-deep parentheses) followed by ordinary checks in the same Worker; a project large enough to grow linear memory past the 256 MiB discard limit followed by ordinary checks; and the whole parity corpus run in three shuffled orders through a single Worker (width 1) so each check follows a different predecessor;
   - a unit test where every run's dead stack region and the region above the initial memory size are filled with `0xA5` just before `tsrs_run`, which must not change any diagnostic or emitted byte.

   A verdict is the receipt's `status`, `reason`, `passed`, `total`, the first five diagnostics (file, line, column, code) and the emitted artifact digests.
5. **Fatal.** P-58's bar 5, unchanged, at width 16 for each new arm: a checker Worker that dies during a check (heap limit) loses only that attempt, recorded `outcome_unknown`, and every neighbour completes; killing the cohort with 16 attempts in flight records exactly those 16 `outcome_unknown`, none is dispatched again, and queued attempts each run once on the replacement.

## Predictions

- `fused-reuse`: 450–620 accepted per second at width 16, about 10–20% above `fused`, at 10–20% less CPU per accepted attempt. It misses bar 1.
- `fused-reuse-base`: 750–1,100 accepted per second at width 16, about half `fused`'s CPU per accepted attempt, and below `supervisor`'s. I give bar 1 about two-to-one odds.
- `sibling-reuse-base`: within 10% of `fused-reuse-base` on throughput, more memory per active attempt.
- Memory: a resident instance per Worker keeps about 15–25 MiB touched, against P-58's fresh instances that the collector frees late. I expect 35–60 MiB per active attempt at width 16, so bar 3 is about even odds.
- Parity: zero differences. Fatal: held.

## Decision rule

A new arm's options become the route default (`createContainedRoute`'s `checker` defaults) only if that arm holds bars 4 and 5 and, at width 16 against the same-session `fused` arm, has at least its accepted per second (worse rounds) and at most its CPU per accepted attempt (higher rounds). Among arms that qualify, the one with the higher accepted per second wins; within 10% of each other, the lower peak RSS per active attempt. A miss on bars 1, 2 or 3 alone doesn't block the switch, since the comparison is with the current default; it's reported as a miss and nothing is retuned to meet it. Placement (`fused` or `sibling`) stays as P-58 and Craig set it unless a `sibling` arm wins by the same rule. Otherwise the defaults stay fresh, full checks. Every arm stays selectable.

## Receipts

`experiments/P-60-tscheck-snapshot/receipt/`: the raw rows per round (`route-*.json`), parity and adversarial diffs (`parity-*.json`), the fatal runs (`fatal-*.json`), and this file's digest in `precommit.sha256`.

## Amendment 1 (2026-11-07, after round 1, before measuring the arms it adds)

Round 1 put the reused-instance arms at 138–182 MiB peak RSS per active attempt at width 16, against 51 MiB for `fused`. An off-acceptance spike found why: a restored allocator can only grow linear memory, never reuse what earlier runs grew, so each reused run touches about 3 MiB of new pages (46 new non-zero 64 KiB pages per run, RSS up 3 MiB per check), and an instance holds them until it's 256 MiB above its initial size. Every guest Worker, spares included, holds one. The original arms, bars and rounds 1–2 stand as frozen and are reported as measured.

Two arms are added, defined now, before either is measured:

| Arm | Placement | tsrs instance | Build info |
|---|---|---|---|
| `fused-base` | the guest's Worker | fresh per check | host baseline seeded |
| `fused-reuse16-base` | the guest's Worker | reused, but discarded once linear memory is more than 16 MiB above its initial size | host baseline seeded |

Procedure: rounds 3 and 4 run all seven arms, interleaved, at widths 1, 8, 16 and 32, as above. Parity (bar 4) and fatal (bar 5) are run for the two new arms as for the others. For the original five arms the acceptance figure is the worst of rounds 1–4; for the new arms, the worse of rounds 3–4. The decision rule is applied to rounds 3–4 for every arm, so all comparisons with `fused` are same-session.

One tightening of the decision rule: an arm qualifies for the default only if, in addition to the conditions above, its peak RSS per active attempt at width 16 is at most **1.5×** the same-session `fused` arm's. Bars 1–5 are unchanged.
