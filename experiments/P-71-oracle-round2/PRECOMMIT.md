# P-71 oracle round 2: fresh held-out specifications, same injected-value labels

Label: **Proposed** procedure, written 2026-11-08 before any measurement on the new held-out split. Its SHA-256 is in [receipt/precommit.sha256](receipt/precommit.sha256), and [run.mjs](run.mjs) refuses to run when the file differs. Amendments are separate commits before the measurements they affect.

## Question

P-70 measured the formula oracle (`core/runtime/x1/oracle.mjs`, behind `limits.oracle`, off by default) on 428 held-out specifications with certain labels and missed two bars: spec-level false flags 1.40% (upper bound 2.21%, bar 2%) and recall 41.8% (lower bound 37.9%, bar 50% / 40%). This branch changes the parser: bare piecewise rules ("unit 0 returns value; unit 1 ...") are guards and guarded branches are evaluated per call; ranges are scoped to each export and read more layouts; more formula shapes are read; a trap claimed inside a complete stated domain is compared with the formula; and a formula agreement just past a bound the parser could not attribute is abstained, not verified. On specifications that neither P-70 nor this development has seen, do the changes meet P-70's bars?

## Development data (what the changes were written against)

- P-70's dev split (194 specifications, 191 measurable), P-69's 587-specification offline corpus (12 known wrong values) and P-42's 177 pristine kernels. All three are in-sample for this branch and are not evidence here.
- P-70's held-out split was not used for tuning. It was opened once, as the lane brief asked, to read the one undiagnosed P-70 false flag (P-32 CC-022: a range from one export applied to another export with the same parameter name); that fix is tested on a synthetic contract and was checked on the dev split. P-70's held-out split is re-measured below **for comparison only**, labelled as such, and is not a bar.

## Corpus and split (fixed now, built by [corpus.mjs](corpus.mjs))

- Pool: the same 2,177 promoted specifications as P-70 (P-32, P-33, P-34, P-35, P-36, P-37, P-38, P-39, P-41 `base-r*` and `cand-r*` receipts), with P-70's exclusions (P-42 `cand-r*` and P-69's offline corpus; 0 matched). Removed in addition: all 630 specifications P-70 drew (dev and held-out), identified by rebuilding P-70's corpus with its own code; its dev and held-out manifests reproduce exactly.
- From the remaining 1,547, at most 30 per need by SHA-256 order of `P-71:71:cap:<spec hash>` (seed 71). Every drawn specification is held out; there is no dev part. **571 specifications**: 30 for 18 needs, C-012 20, CC-025 10, CC-036 1 (the pool is exhausted for the last three).
- Manifest (SHA-256 of the newline-joined sorted spec hashes): `7f042b11ebded5262f9f232c7763d8a4fdf743107efab54ffac73b4b1019edd8`. The corpus file stays outside git; its SHA-256 is `2993b208f191ff992729bad8f10dbf041c65898a43c63c304060350acf1d36b4`.
- No oracle verdict on any of these specifications was computed before this file was committed and pushed.

## Labels

Unchanged from P-70 ([../P-70-oracle-injected/mutate.mjs](../P-70-oracle-injected/mutate.mjs)): the truth function is each specification's promoted kernel (compiled wasm from the ledger, fresh instance per call); a specification whose kernel fails any of its own frozen tests is excluded and counted. Pristine = every frozen test unchanged. Injected = per specification and class (`sign`, `scale`, `rounding`, `swap`, `boundary`), one eligible test chosen by SHA-256 order with exactly one test changed, the same eligibility and certainty margins as P-70.

## Measured (offline, no model calls)

[run.mjs](run.mjs) runs P-70's `measure` (formula and ranges only, `reference: false`) at two versions on identical inputs: **before** = `oracle.mjs` at `d4d7efa` (main, P-70's "after") and **after** = this branch. [analyze.mjs](analyze.mjs) reports P-70's metrics with a bootstrap 95% percentile interval clustered by specification (10,000 resamples, seed 70) and, alongside, clustered by need (21 needs, 10,000 resamples, seed 71):

- spec-level false-flag rate (pristine specifications with any test `flagged` or `corrected`);
- test-level false-flag rate;
- recall on injected items (`flagged` or `corrected`), overall and per class; abstained and unverified items count as missed;
- abstained pristine tests and abstained injected items; verified pristine tests;
- the paired after − before difference in recall and spec-level false flags.

## Bars (the same as P-70; tighten, never loosen)

Required, on the P-71 held-out split, **after** version, specification-clustered intervals:
- **B1:** spec-level false-flag rate, upper 95% bound ≤ 2%.
- **B2:** recall ≥ 50% (point) with lower 95% bound ≥ 40%.
- **B3:** abstained pristine tests, upper 95% bound ≤ 10%.

Secondary: **S1** test-level false-flag rate, upper 95% bound ≤ 0.5%; **S2** recall per value class (`sign`, `scale`, `rounding`, `swap`) each ≥ 50% (point); **S3** `boundary` recall ≥ 30% (point). The need-clustered intervals are reported for B1–B3 and S1 as a robustness check; they are not additional required bars, but any bar that holds by specification and fails by need is reported as such.

## Predictions

From the dev split (recall 51.6%, false-flag specifications 0%, abstained pristine 6.9%, boundary 39.8%, swap 47.1%) and P-70's held-out running about 4 points above its dev split:

1. B1 met: false-flag specifications ≤ 1%, upper bound ≤ 2%. Before (main) about 1.4%, as in P-70.
2. B2 met: recall 50–58%, lower bound ≥ 40%. After − before recall +8 to +16 points.
3. B3 met: abstained pristine 4–8%. S1 met.
4. S2 missed for `swap` (point below 50%), met for the other three; S3 met (boundary 30–45%).
5. Need-clustered intervals wider than specification-clustered ones; B2's need-clustered lower bound may fall below 40%.

## Decision rule

The default stays off in this change regardless of outcome. If B1, B2 and B3 are all met, the result recommends flipping `agentLimits.oracle` to true as a separate decision for Craig; any miss means it stays off and the miss is reported, not retuned on these data.

## Stop conditions

None needed for cost: no model calls, no network, no API keys. A harness error stops the run; it is fixed in a commit and the run repeated in full, with the error disclosed.
