# P-71 amendment 1: the clustered bootstrap collapsed repeated draws

Written 2026-11-09 after the round-8 backfill review (R9). [PRECOMMIT.md](PRECOMMIT.md) and [RESULT.md](RESULT.md) are unchanged. The defect and the fix are described in [P-70 amendment 1](../P-70-oracle-injected/AMENDMENT.md). P-71 imports P-70's `summarize`, so its spec-clustered figures had the same defect.

P-71's need-clustered bootstrap had it too. When a need was drawn twice, the spec-level share counted that need's specifications once. [analyze.mjs](analyze.mjs) now uses P-70's draw-tagged resampler with P-71's seed (71). The draw sequence is unchanged, so need-clustered row-level figures stay exactly as they were. [analyze.test.mjs](analyze.test.mjs) covers a case of 10 needs, 10 specifications each, 1 flagged: the upper bound was 2.00% and is now 3.00%.

## Regeneration

**Status: regenerated 2026-11-09** by the coordinator with `reanalyze.mjs` from the hash-checked rows. Held-out spec-level false flags after the round-2 parser: upper bound 5.46% → 6.00%; paired difference upper bound 3.15 → 3.70 points; by-need upper bound 6.08% → 7.20%. B1 (upper bound ≤ 2%) was missed and is still missed; B2, B3 and S1 do not use these intervals. The verdicts and `limits.oracle` staying off are unchanged.

```sh
node experiments/P-70-oracle-injected/reanalyze.mjs <p71-heldout/rows.json> P-71-oracle-round2/receipt/heldout <p70-dev/rows.json> P-71-oracle-round2/receipt/dev <p70-heldout-comparison/rows.json> P-71-oracle-round2/receipt/p70-heldout-comparison
```

B1 is the only bar that reads a spec-level figure. It was missed on held-out (upper bound 5.46% spec-clustered, 6.08% need-clustered). On dev it was met with no flagged specification, and a share of zero stays zero under any resampling.
