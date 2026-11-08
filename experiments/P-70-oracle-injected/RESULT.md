# P-70 oracle on injected wrong values: result

Status: **Recorded**, 2026-11-08. Precommit [PRECOMMIT.md](PRECOMMIT.md), sha256 `bdd7d50a…` in [receipt/precommit.sha256](receipt/precommit.sha256), pushed at 11:53 EST (`4b88661`) before any verdict was measured. Held-out and dev runs at 11:53–11:54 EST, Node v26.13.0, offline, no model calls.

**On 428 fresh held-out specifications with certain labels, the parser fix (abstain on conditional, piecewise and conflicting rules) lowers spec-level false flags from 1.87% to 1.40% and abstains on 5.9% of pristine tests, at no measurable cost in recall (41.8% against 42.1%). It misses two of the three required bars for a default flip: the false-flag upper bound is 2.21% (bar 2%) and recall is 41.8% with lower bound 37.9% (bar 50% / 40%). `limits.oracle` stays off by default.**

## Bars (held-out, after version)

| Bar | Measured | 95% interval (clustered by spec) | Verdict |
|---|---|---|---|
| **B1** spec-level false flags, upper bound ≤ 2% | **1.40%** (6 of 428 specs) | 0.38 – **2.21%** | **missed** |
| **B2** recall ≥ 50%, lower bound ≥ 40% | **41.76%** (781 of 1,870) | **37.85** – 45.68% | **missed** |
| **B3** abstained pristine tests, upper bound ≤ 10% | **5.89%** (446 of 7,574) | 4.35 – 7.55% | **met** |
| S1 test-level false flags, upper bound ≤ 0.5% | 0.20% (15 of 7,574) | 0.05 – 0.38% | met |

Decision rule: B1 and B2 missed, so the default stays off and nothing is retuned on these data.

## Before and after, same inputs

Before = `oracle.mjs` at `f97da96` (P-69 as merged); after = this branch (`43752c6`). Held-out split, 436 specifications drawn, 8 excluded because their kernel fails one to three of its own frozen tests on this machine (all P-36/P-37 CC-013, CC-025, CC-002, CC-036), leaving 428 specifications, 7,574 pristine tests and 1,870 injected items.

| Metric | Before | After | After − before (paired) |
|---|---|---|---|
| Spec-level false flags | 1.87% [0.75, 2.82] (8 specs) | 1.40% [0.38, 2.21] (6 specs) | −0.47 [−1.12, 0.36] |
| Test-level false flags | 0.25% [0.09, 0.45] (19) | 0.20% [0.05, 0.38] (15) | |
| Recall | 42.09% [38.20, 45.95] (787) | 41.76% [37.85, 45.68] (781) | −0.32 [−1.21, 0.43] |
| Abstained, pristine tests | — (no such status) | 5.89% [4.35, 7.55] | |
| Abstained, injected items | — | 8.50% [6.20, 11.03] (159) | |
| Verified, pristine tests | 27.71% | 27.69% | |

Recall by class (after; before differs by at most 1.5 points in any class):

| Class | Items | Recall | Interval | Misses: unverified / abstained |
|---|---|---|---|---|
| sign | 413 | 51.57% | 46.73 – 56.42 | 161 / 39 |
| scale (×/÷ 1000, ×/÷ 3.6) | 413 | 51.09% | 46.25 – 55.69 | 162 / 40 |
| rounding (4 figures, last digit ±1) | 413 | 48.43% | 43.58 – 53.03 | 173 / 40 |
| swap (first two arguments) | 205 | 45.85% | 39.02 – 52.68 | 90 / 21 |
| boundary | 426 | 14.79% | 11.50 – 18.08 | 337 / 19, and 7 verified |

Boundary splits as predicted: a value test that claims a trap was caught **0 of 270** times (the oracle has no reading for a trap claim inside every parsed range), a trap test that claims its neighbour's value **63 of 156** (40%, through parsed ranges). The piecewise-jump subclass produced no items in this corpus. Seven trap-to-value items were marked `verified`: the formula holds at the trap point (for example a product with a zero factor) and no range was parsed for that bound, so the oracle trusted the formula over the contract's trap. That changes no frozen test, but `verified` there is wrong.

Dev split (191 of 194 specifications, 827 injected, reported, not a bar): false-flag specs 1.57% [0, 2.59] before and after (3 specs); recall 37.73% [32.21, 43.42] both; abstained pristine 8.84% [5.70, 12.25] (over the 10% bar's upper bound there). Receipts: [receipt/heldout](receipt/heldout), [receipt/dev](receipt/dev); the per-row files stay outside git, hashes in [receipt/outside-git.sha256](receipt/outside-git.sha256).

## What the fix removed, and what is left

Before → after on held-out pristine tests: 7 flags removed (P-35 CC-001, P-34 CC-026, P-36 C-012, now `abstained` as conditional or piecewise rules) and **3 flags added, all in one new false-flag specification** (P-38 C-007, below). Net 8 → 6 specifications. On P-69's own sets (in-sample, where the rules were checked): P-42's 177 pristine kernels all promote with 0 flags (was 174 and 7 flags), and the 587-specification offline corpus still catches 12 of 12 known wrong values with false flags 16 → 7 of 8,475.

The 6 held-out specifications still flagged after the fix (15 tests):
- **5 are the piecewise shape in a form the guard pattern does not read**: "unit 0 uses `(temperature - 32) * 5 / 9`; unit 1 is identity", "Unit 0 returns value; unit 1 returns value * 9 / 5", "unit 0 returns target; unit 1 returns target / 1.8". The condition is a bare `<parameter> <literal>` with no if/when/for, so the conversion branch is applied to the identity case (P-32 CC-026, P-35 CC-026, P-38 CC-026, P-38 C-007, P-34 CC-001).
- **P-38 C-007 is new in the after version.** The old parser read "unit 1 returns value * 9 / 5. Show 2 decimal places." as one piece and rejected it only because the trailing prose contained a digit. The new clause split ends the piece at the full stop, so the branch parses cleanly and is applied to unit 0. Same root cause as the other four; the split exposed it. Three of this specification's injected items count as caught through the same wrong reading.
- 1 (P-32 CC-022, a zero-drop test) is not diagnosed here.

Recall is bounded by coverage: of the 1,444 value-class items (sign, scale, rounding, swap), 40.6% are missed as `unverified` (no formula reading at all) and 9.7% as `abstained`. The formula verifies only 27.7% of pristine tests on these older specifications, which were written without the oracle's `name = expression` prompt line, against 45% on P-69's corpus.

## Predictions

1. B1 met, after ≤ 1%: **failed** (1.40%, upper bound 2.21%). Before higher than after: **held** (1.87%).
2. Recall 35–55%, boundary lowest, value-test classes near formula coverage, rounding slightly lower: **held** (41.8%; boundary 14.8%; rounding 48.4% against sign 51.6%).
3. B2 likely missed: **held** (missed). B3 met with abstention ≤ 5%: **met but above 5%** (5.89%).
4. After − before recall within ±5 points: **held** (−0.32).

## What a later default flip needs

- Read `<parameter> <literal> (uses|returns|is) …` as a guard, the shape behind 5 of the 6 remaining false flags; measure it on a fresh split, not this one.
- Recall needs coverage more than detection: with `limits.oracle` on, the specification prompt asks for a `name = expression` line and a `reference.js`, which these older specifications lack. An injected-value run on oracle-arm specifications (with `reference.js`) is the measurement that matches the default-on setting.
- A trap claim inside the domain is invisible to formula and ranges; only `reference.js` can see it.

## Unverified

- Labels are certain relative to each promoted kernel; where a kernel disagrees with its own contract (the 7 `verified` boundary items), the label follows the kernel.
- One machine, Node v26.13.0 only for the measurement (the test suite also runs on Node 22.23.3). 8 specifications were excluded because their kernels fail some of their own frozen tests here; why was not investigated.
- Intervals cluster by specification, not by need (21 needs); specifications of one need are not independent.
