# P-53 result: library v0

Precommit: `PRECOMMIT.md` (56b2f60b…), committed before any lookup. The first run's numbers stand in `receipt/first-run/summary.json`. `AMENDMENT-1.md` tightened the gate after reading them, so the second run, in `receipt/second-run/summary.json`, is post-hoc.

**On the shipped configuration, a lookup served 3 of 118 P-21 held-out needs (2.5%) and 45 of 59 add needs (76%). False hits were 0 of 5,493 where a need's tests carried the difference, and 5 of 1,958 on declared near-misses, all five degenerate. It also served 93 of 313 needs (30%) whose frozen files say exactly what the kernel's own say while a seeded fault lies hidden, 16 of them with a witness inside the declared range. That class can't reach 0 without a stronger evaluator, so activation stays off.** A hit saves about 15 s of a 48.6 s median need, not the whole need, because the specification turn still runs.

This is a probe, not C12, and moves no rung.

## Hit rate
Leave one run out, six runs, with no model call. Each cell is hits over needs.

| Key, gate | P-21 first | P-21 second | Add first | Add second |
|---|---|---|---|---|
| **contract, full (shipped)** | 4 / 118 | **3 / 118** | 51 / 59 | **45 / 59** |
| contract, mutants | 4 | 3 | 51 | 51 |
| contract, none | 4 | 4 | 51 | 51 |
| interface, full | 5 | 5 | 54 | 48 |
| interface, none | 12 | 12 | 54 | 54 |
| normalized prose | 0 | 0 | 0 | 0 |

Shipped P-21 hits come from two of twenty needs. Independent readings of a need rarely agree on exports, ranges and numerals: 114 of 118 P-21 needs had no contract match. The add need's 76% is one need asked 59 times, and it should not be read as a general rate. No need hit a shipped key with two fingerprint classes.

Natural disagreement: 0 across 222 comparisons of served kernel against the need's own promoted kernel, on the probe grid at 1e-9. That covers the four key and gate cells checked, not all of the domain.

## False hits

| Arm | What differs | First run, shipped | Second run, shipped | Second, contract key, no gate |
|---|---|---|---|---|
| A declared, excluding the five below | Stated unit, rounding, boundary, sign, constant | 0 / 1,953 | 0 / 1,953 | 0 / 1,953 |
| A degenerate | See below | 5 / 5 | 5 / 5 | 5 / 5 |
| M mutant tests the kernel fails | Tests carry the fault | 0 / 5,493 | 0 / 5,493 | 0 / 5,493 |
| B hidden intent | Nothing frozen differs | 149 / 313 | 93 / 313 | 301 / 313 (12 lost to cell failures) |
| C prose only | One English sentence | 266 / 354 | 228 / 354 | 354 / 354 |

The precommit counts all of these, so arm A is 5 and the requirement of 0 was missed. Reading the five: three add a "sign reversed" sentence to kernels that return only 0 or trap on the probe grid; two restate the literal 0.000000000000 scaled by 1.002, which is still 0. None changes behaviour on the grid. `near-miss.mjs` is hashed and left as written.

Under the `interface` key, arm A has real false hits: 96 of 177 blind constant restatements were served in the second run. Numerals in the key are what stop them.

Arm B in the second run, shipped:

| Fault visible | Served / cases |
|---|---|
| Inside the declared range (84 are rounding) | 16 / 92 |
| Outside it, on finite inputs | 22 / 102 |
| Only on NaN or infinity | 55 / 119 |

All 16 in-range cases are rounding, such as an inner single-precision step, that the wasm mutants and tests didn't expose. An arm B need's frozen files say what the kernel's own say, so serving it isn't a wrong answer to anything the need states, but it is the fault P-51 measured, now inherited with no generation to blame.

Arm C is the key's stated limit. If only English differs, nothing here reads it.

## Cost
Warm path, one cell, journal on, 177 needs, second pass, second run:

| Outcome | p50 | p95 | Max |
|---|---|---|---|
| Pass (114) | 50 ms | 761 ms | 1,967 ms |
| Refused (63) | 683 ms | 4,583 ms | 6,129 ms |
| Miss (177) | 0.54 ms | 1.5 ms | 2.4 ms |

First-run pass was 75 ms p50 and 487 ms p95, on a loaded machine in both runs, so treat the differences as noise. Warm-path spawns were 0, with Python counted through a `PATH` shim across threads, a test on the cell's import graph, and no journal crossing on a miss. Each verdict makes one `fsync`.

| Generation path | Value |
|---|---|
| Recorded P-42 total, p50 / p95 | 48.6 s / 68.6 s |
| Specification turn, p50 | 29.9 s (still runs on a hit) |
| Implementation turn, p50 | 14.6 s (skipped on a hit) |
| Everything not a model turn, p50 | 0.97 s (skipped apart from freeze) |
| Replayed process count per need | 12: 9 Python, 2 model client, 1 compiler |

Memory per entry: 13.4 KiB of main-thread heap after GC, 8.8 KiB serialized, 57 KiB of process RSS growth. Cells cost extra and aren't divided here.

## Predictions

| # | Prediction | Result |
|---|---|---|
| 1 | 177 admitted on current digests | Held: 177, 51 flagged duplicates |
| 2 | Shipped P-21 at most 5%, add at most 40% | P-21 held at 3.4%; add failed at 86% |
| 3 | Interface, no gate: P-21 5–30%, add at least 70% | Held: 10.2%, 91.5% |
| 4 | Arm A 0 | Failed: 5, all degenerate |
| 5 | Arm M 0 | Held |
| 6 | Arm B at most 1%, no gate at least 80% | First half failed badly at 47.6%; second half held at 100% |
| 7 | Arm C above 0, at most self-hit | Held: 133 per sentence of a self-hit 133 |
| 8 | No natural disagreement | Held |
| 9 | Pass p50 at most 50 ms, p95 at most 200 ms; miss p50 at most 1 ms; no spawns | Pass timing failed at 75 and 487 ms; miss and spawns held |
| 10 | At least 6 spawns; implementation p50 at least 15 s | Spawns held only in the second run, since the first run's replay was broken; 14.6 s narrowly failed |
| 11 | At most 32 KiB per entry | Held on heap, as stated |
| 12 | No invalid or unsupported mutants | Held |

Amendment: arm M 0 and arm A unchanged held. In-range arm B at most 10% failed at 17.4%. "Non-finite stays largely served" is 46%, weaker than I said. Lower hit rates held, and p50 at most 150 ms and the spawn counts held.

## Defects found
- The first run's replayed generation path was invalid: its compiler shim lost its environment and none of the five promoted. Fixed before the second run.
- The spawn hook doesn't reach pool cells, so the `PATH` shim counts those.
- Cells ran out of heap (`ERR_WORKER_OUT_OF_MEMORY`) on 13 second-run cases; the first run's 5 `cell_failed` cases weren't labelled. They refuse and get replaced, so this is sound, but it costs hits. The cause isn't established.

## Not shown
Reuse under real intent; a real need through `capabilityFromContract` (needs here use their glue as a stand-in, written after freeze); lifetime economics; tenant isolation; other hosts. Timing wasn't on a quiet machine. Receipts first-run 366fc3936467… and second-run 335e1b1d060f….
