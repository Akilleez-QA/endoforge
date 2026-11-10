# P-70 amendment 1: the clustered bootstrap collapsed repeated draws

Written 2026-11-09 after the round-8 backfill review (R9). [PRECOMMIT.md](PRECOMMIT.md) and [RESULT.md](RESULT.md) are unchanged. [P-71](../P-71-oracle-round2/) reuses this analysis and has the same defect.

## What was wrong

[analyze.mjs](analyze.mjs) resampled specifications with replacement but then measured spec-level false flags by grouping the resample on each row's original hash. A specification drawn twice therefore counted once, so each resample held fewer specifications than the data. That understated the spec-level interval. With 100 specifications and 1 flagged, the upper bound came out at 1.72% where it should be 3.00%. P-71 clusters by need and has the same problem: with 10 needs of 10 specifications and 1 flagged, it gave 2.00% where it should be 3.00%.

## Fix

Each drawn copy of a cluster now carries a draw tag, and the spec-level share counts specifications per draw. P-70 and P-71 share one resampler (`bootstrap`). The random draw sequence is unchanged, so every row-level figure (recall, test-level false flags, abstention, verified share, recall by class) comes out exactly as before. Only `falseFlagSpecs` and the paired `difference.falseFlagSpecs` intervals move. [analyze.test.mjs](analyze.test.mjs) reproduces the 1.72% against 3.00% case, checks that every resample holds as many specifications as the data, and checks that row-level intervals are identical to the old ones.

## Regeneration

The per-row results are kept outside git, with their hashes in [receipt/outside-git.sha256](receipt/outside-git.sha256). [reanalyze.mjs](reanalyze.mjs) refuses any rows file whose sha256 is not the recorded one for that receipt. It then rewrites the receipt's `analysis.json` and prints every changed figure, old and new:

```sh
node experiments/P-70-oracle-injected/reanalyze.mjs <p70-heldout/rows.json> P-70-oracle-injected/receipt/heldout <p70-dev/rows.json> P-70-oracle-injected/receipt/dev
```

**Status: regenerated 2026-11-09** by the coordinator with `reanalyze.mjs` from the hash-checked rows. Held-out spec-level false flags, upper bound: after the fix 2.21% → 2.57%, before 2.82% → 3.27%; paired difference upper bound 0.36 → 0.47 points; dev upper bounds 2.59% → 3.66%. B1 (upper bound ≤ 2%) was missed and is still missed, so the verdict and `limits.oracle` staying off are unchanged. Recall and abstention figures are unchanged.

Only B1 reads a spec-level figure. Every other bar uses row-level figures, which do not change. B1 was already missed at 2.21%. The corrected bound is expected to be wider (the 100-specification case goes from 1.72% to 3.00%), but the regenerated figure is the record.
