# P-71 oracle round 2: result

Status: **Recorded**, 2026-11-08. Precommit [PRECOMMIT.md](PRECOMMIT.md), sha256 `793b9a7b…` in [receipt/precommit.sha256](receipt/precommit.sha256), pushed at 18:38 EST (`97f4a23`) before any verdict on the new split was computed. Held-out run at 18:39 EST, Node v26.13.0, offline, no model calls.

**On 567 fresh held-out specifications with certain labels, the round-2 parser raises recall from 38.3% to 48.6% (+10.3 points, interval 8.4–12.3) and verified pristine tests from 26.2% to 44.7%, but it also raises spec-level false flags from 2.29% to 4.23% (+1.94 points, interval 0.80–3.15). It misses B1 (false flags, upper bound 5.46% against 2%) and B2 (recall 48.6% against 50%; its lower bound 45.3% clears 40%), meets B3 (abstention 6.7%, upper bound 8.1%), and misses S1. `limits.oracle` stays off by default; nothing is retuned on these data.**

## Bars (P-71 held-out, after version)

| Bar | Measured | 95% interval by specification | By need (21 clusters) | Verdict |
|---|---|---|---|---|
| **B1** spec-level false flags, upper bound ≤ 2% | **4.23%** (24 of 567 specs) | 3.00 – **5.46%** | 2.13 – 6.08% | **missed** |
| **B2** recall ≥ 50%, lower bound ≥ 40% | **48.64%** (1,216 of 2,500) | 45.28 – 51.99% | 39.98 – 57.18% | **missed** (point) |
| **B3** abstained pristine tests, upper bound ≤ 10% | **6.71%** (708 of 10,558) | 5.37 – 8.11% | 3.52 – 10.46% | **met** (by need: upper 10.46%) |
| S1 test-level false flags, upper bound ≤ 0.5% | 0.79% (83 of 10,558) | 0.41 – 1.25% | 0.27 – 1.44% | missed |
| S2 value classes each ≥ 50% | sign 54.1%, scale 53.9%, rounding 53.9%, swap 54.0% | | | met |
| S3 boundary ≥ 30% | 30.34% | 26.63 – 34.22% | 23.05 – 39.02% | met (point) |

Decision rule: B1 and B2 missed, so the default stays off and the misses are reported, not retuned on these data.

## Before and after, same inputs

Before = `oracle.mjs` at `d4d7efa` (main, P-70's after version); after = this branch. 571 specifications drawn, 4 excluded because their kernel fails some of its own frozen tests (P-37 CC-013 ×2, P-37 C-010 ×2), leaving 567 specifications, 10,558 pristine tests and 2,500 injected items.

| Metric | Before | After | After − before (paired) |
|---|---|---|---|
| Spec-level false flags | 2.29% [1.38, 3.17] (13 specs) | 4.23% [3.00, 5.46] (24 specs) | +1.94 [0.80, 3.15] |
| Test-level false flags | 0.31% [0.15, 0.49] (33) | 0.79% [0.41, 1.25] (83) | |
| Recall | 38.32% [35.09, 41.63] (958) | 48.64% [45.28, 51.99] (1,216) | +10.32 [8.39, 12.29] |
| Abstained, pristine tests | 6.93% [5.56, 8.37] | 6.71% [5.37, 8.11] | |
| Abstained, injected items | 10.28% [8.18, 12.47] | 7.76% [5.95, 9.66] | |
| Verified, pristine tests | 26.24% | 44.73% | |

Recall by class:

| Class | Items | Before | After | After interval | Misses after: unverified / abstained / verified |
|---|---|---|---|---|---|
| sign | 545 | 46.79% | 54.13% | 49.91 – 58.35 | 198 / 52 / 0 |
| scale | 545 | 46.61% | 53.94% | 49.72 – 58.17 | 203 / 48 / 0 |
| rounding | 545 | 46.61% | 53.94% | 49.72 – 58.17 | 202 / 49 / 0 |
| swap | 298 | 44.97% | 54.03% | 48.32 – 59.73 | 107 / 29 / 1 |
| boundary | 567 | 10.76% | 30.34% | 26.63 – 34.22 | 366 / 16 / 13 |

Boundary after: a value test that claims a trap is now caught 68 of 388 times (P-70: 0 of 270), through the complete-domain check; a trap test that claims its neighbour's value 102 of 177 times. 13 boundary items are still marked `verified`: 7 trap tests that claim a value (the formula holds at the trap point and the bound is stated in words the parser does not tie to a parameter) and 6 value tests that claim a trap, which a wrongly read range "confirms" (the same root cause as the range false flags below).

## Why B1 got worse (diagnosed, not fixed on these data)

Of the 24 false-flag specifications after, 7 were already flagged before (P-32 CC-011 ×3 and four CC-026 contracts) and 17 are new. By mechanism of the new ones:
- **Range, 9 specifications (most of the regression).** The new range layouts misread three shapes absent from the development data: a Unicode minus sign ("−100 through 200 °F") is not part of the number pattern, so the interval reads as 100 through 200 (P-39 CC-027 ×15 tests, P-38 CC-027 ×8, P-41 CC-027 ×5); a single-parameter export took a range whose sentence names another variable ("daysAgo must be an integer in [0, 3650]" applied to `anchorMs`, P-38 C-010); and similar subject slips in C-012, CC-001, CC-011 and CC-026 contracts.
- **Complete-domain trap check, 4 specifications, 1 test each.** The export traps on a computed quantity described in words ("computed dew temperature below bound"), which the extra-condition cues did not catch.
- **Formula, 3 specifications; range and formula, 1.**

On the development data (P-70's dev split, P-69's offline corpus, P-42's pristine kernels) the same code flagged 0, 6 and 0: the development shapes did not contain these cases. That is the cost of a parser grown against one split: the new readings added more true catches than false ones, but not few enough false ones for B1.

## P-70 held-out, re-measured (comparison only, not a bar)

P-70's 428 held-out specifications are spent for tuning (this branch's development did not use them, except to read P-32 CC-022 as the lane brief asked), so this is a comparison, not evidence for a bar.

| Metric | Main (`d4d7efa`) | This branch | After − before |
|---|---|---|---|
| Spec-level false flags | 1.40% [0.38, 2.21] (6 specs) | 2.57% [1.45, 3.68] (11 specs) | +1.17 [0.00, 2.25] |
| Test-level false flags | 0.20% | 0.29% | |
| Recall | 41.76% [37.85, 45.68] | 51.18% [47.10, 55.30] | +9.41 [7.10, 11.80] |
| Abstained, pristine tests | 5.89% | 5.20% | |
| Verified, pristine tests | 27.69% | 45.35% | |
| Recall by class (sign / scale / rounding / swap / boundary) | 51.6 / 51.1 / 48.4 / 45.9 / 14.8 | 55.9 / 56.7 / 54.7 / 55.1 / 35.9 | |

Of P-70's 6 false-flag specifications, 3 are fixed (P-32 CC-022, P-38 C-007, P-34 CC-001) and 3 CC-026 specifications remain: in two the bare rule is preceded by other words ("Converts the supplied temperature to Celsius: unit 0 uses …", "Convert unit 0 using `…`"), which the bare-guard pattern does not reach (it allows only a label of at most 20 characters before the guard, and the new "using" lead-in then reads the conversion as unconditional), and one is flagged by a range. 8 specifications are newly flagged (C-016 ×4, CC-001 ×2, C-010, C-012), the same families as on P-71.

## Development split (in-sample, reported for completeness)

P-70's dev split, 191 measurable specifications (development data, so not evidence): false-flag specifications 1.57% → 0%, recall 37.73% → 51.63% [45.77, 57.57], abstained pristine 8.84% → 6.92%, verified pristine 25.6% → 45.9%, boundary 13.6% → 39.8%. In-sample checks: P-69's offline corpus still catches 12 of 12 known wrong values with false flags 7 → 6 of 8,475; P-42's 177 pristine kernels all promote with 0 flags. The gap between 0% on the dev split and 4.23% on P-71 is the overfitting this split exists to expose.

## Predictions

1. B1 met, false-flag specifications ≤ 1%: **failed** (4.23%, upper bound 5.46%). Before about 1.4%: **failed** (2.29% on this split).
2. B2 met, recall 50–58%, after − before +8 to +16 points: **failed on the bar** (48.6%), **held on the difference** (+10.3).
3. B3 met, abstention 4–8%; S1 met: **B3 held** (6.7%), **S1 failed** (0.79%).
4. S2 missed for swap: **failed** (swap 54.0%, all four value classes met); S3 met: **held** (30.3%, at the line).
5. Need-clustered intervals wider, B2's need-clustered lower bound may fall below 40%: **held** (39.98%).

## What a later default flip needs

- Make the bare guard match after a lead-in ("Converts …: unit 0 uses", "Convert unit 0 using"), the remaining P-70 shape.
- Fix the three range shapes above (Unicode minus in every interval form; no implicit subject when the sentence names another variable; no complete-domain verdict when a computed quantity has a stated bound), each with a failing test first, using P-71's held-out split as development data from now on (it is spent), and measure on a new split. The remaining unused pool has 976 promoted specifications (capped above 30 per need in both P-70 and P-71), so another need-balanced split of up to about 400 exists.
- Recall is near the bar: four value classes are above 50% and boundary is at 30%. The largest remaining recall bucket is still tests the formula never reads (unverified: 1,076 of 2,500 injected items).

## Unverified

- Labels are certain relative to each promoted kernel; where a kernel disagrees with its own contract, the label follows the kernel.
- One machine; measurements on Node v26.13.0 only (the test suite also runs on Node 22.23.3).
- The 4 excluded P-71 specifications and the 8 P-70 ones fail their own frozen tests because the frozen expectations differ from the selected compiled kernel by digit-level amounts (for example kW to hp 8.3143369551… against the kernel's 8.3143369554… at tol 1e-12, and dew points from different Magnus constants); all are P-36/P-37 `cand-r*` specifications, and the one checked (P-37 cand-r5 CC-025) has `promotion.json` decision `refuse` while its thread row says `promoted: true`. The selection follows the thread row, as in P-70; which record is authoritative was not settled.
