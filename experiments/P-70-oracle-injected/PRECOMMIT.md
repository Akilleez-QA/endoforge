# P-70 oracle on injected wrong values: certain labels, fresh held-out specifications

Label: **Proposed** procedure, written 2026-11-08 before any acceptance measurement. Its SHA-256 is in [receipt/precommit.sha256](receipt/precommit.sha256), and [run.mjs](run.mjs) refuses to run when the file differs. Amendments are separate commits before the measurements they affect.

## Question

P-69's formula oracle (`core/runtime/x1/oracle.mjs`, behind `limits.oracle`, off by default) missed two bars: it flagged 3 of 177 pristine specifications, and its held-out catch rate was 3 of 12, where 9 of the 12 labels came from sibling kernels with different contracts (weak labels). The parser has since been changed to abstain on conditional, piecewise and conflicting rules (commit `43752c6`; abstentions are a counted `abstained` status, never a pass). On specifications the parser has never seen, with labels that are certain, how often does the oracle wrongly flag a correct frozen value, how often does it catch a wrong one, and how often does it abstain?

## Corpus and split (fixed now, built by [corpus.mjs](corpus.mjs))

- Pool: every promoted specification in the P-32, P-33, P-34, P-35, P-36, P-37, P-38, P-39 and P-41 receipts (`base-r*` and `cand-r*` runs): 2,177. Excluded by exact (CONTRACT.md, tests.json) hash: P-42's `cand-r*` set (P-69's pristine set, whose three false flags the fix was written against) and P-69's 587-specification offline corpus (the parser's development data). No pool specification matched either (0 excluded), and there were 0 duplicates.
- At most 30 specifications per need (21 needs: 20 P-21 needs and `add`), chosen by SHA-256 order of `P-70:70:cap:<spec hash>`: 630.
- Split by seed 70: a specification is `dev` when the first 32 bits of SHA-256(`P-70:70:split:<spec hash>`) / 2^32 < 0.3, otherwise `heldout`. **dev 194, held-out 436.** Manifests (SHA-256 of the newline-joined sorted spec hashes): dev `5c647ba8b96e5cd2198a6f0706bca31501b0a42e934613b4889441aff260eaf3`, held-out `4fc1ca9a861e7a4ce9fe2f64d289d3cbce6b3745540b5470b7a729316c8cdb57`. The corpus file stays outside git; its SHA-256 is `308d42f4a62ff05bea4d5d135030e9296a6fbdfe662f33c5885d565ca60328f2` (recorded in `receipt/outside-git.sha256`).
- The parser fix was written and committed before this pool was opened, so both splits are held out from it. The dev split was used only to smoke the harness (3 specifications, mutation output inspected, no oracle verdict counted). Bars below are read on the held-out split only; the dev split is reported alongside.

## Labels (certain by construction, [mutate.mjs](mutate.mjs))

The truth function is each specification's own promoted kernel (its compiled wasm from the ledger, fresh instance per call). A specification whose kernel fails any of its own frozen tests here is excluded and counted.

- **Pristine:** every frozen test of a held-out specification, unchanged. Each passes its promoted kernel.
- **Injected:** for each specification and each class below, one eligible test chosen by SHA-256 order, with exactly one test changed, so up to five injected items per specification. A numeric mutation is eligible only when the new value differs from both the kernel's value and the literal by more than 2 × max(tol, 1e-9 × max(1, |value|)), so it is certainly outside tolerance.
  1. `sign`: expect negated (kernel value nonzero).
  2. `scale`: expect × 1000, ÷ 1000, × 3.6 or ÷ 3.6 (unit slips: k-prefix, km/h vs m/s, kWh vs MJ), one per test by hash.
  3. `rounding`: expect rounded to four significant figures, then the last digit moved by one.
  4. `swap`: expect replaced by the kernel's value with the first two numeric arguments swapped (eligible only when that differs).
  5. `boundary`: at a test whose argument has a neighbour (±1 for an integer argument, ±1e-6 relative otherwise) on the other side of the kernel's trap edge: a value test claims a trap, or a trap test claims the neighbour's value; or, at a piecewise jump (the change does not shrink when the step shrinks tenfold), the value test takes the other branch's value.

Label = injected or pristine; nothing depends on a sibling kernel or on a model.

## Measured (offline, no model calls)

[run.mjs](run.mjs) runs the oracle in offline mode (`reference: false`: these specifications have no `reference.js`; formula and ranges only) at two versions on identical inputs: **before** = `oracle.mjs` at `f97da96` (P-69 as merged) and **after** = this branch. [analyze.mjs](analyze.mjs) reports, with a bootstrap 95% percentile interval clustered by specification (10,000 resamples, seed 70):

- **False-flag rate, spec level:** share of pristine specifications with at least one test `flagged` or `corrected` (the unit that costs a specification turn).
- **False-flag rate, test level:** flagged or corrected pristine tests / pristine tests.
- **Recall:** injected items whose mutated test is `flagged` or `corrected` / injected items; and per class.
- **Abstention:** `abstained` pristine tests / pristine tests, and `abstained` injected items / injected items. Abstained and unverified items count as missed, never as caught.
- Coverage (verified share of pristine tests) and the paired after − before difference in recall and spec-level false flags.

## Bars for a later default flip (tighten, never loosen)

Required, all on the held-out split, **after** version:
- **B1:** spec-level false-flag rate, upper 95% bound ≤ 2%.
- **B2:** recall on injected items ≥ 50% (point) with lower 95% bound ≥ 40%.
- **B3:** abstained pristine tests, upper 95% bound ≤ 10%.

Secondary: **S1** test-level false-flag rate, upper 95% bound ≤ 0.5%.

Rationale, fixed before measuring: a false flag costs one extra specification turn; a missed wrong value costs about six failing repair turns (P-56, P-66), and wrong values appear in a few percent of specifications. B1 keeps the cost on good specifications small next to that. B2 asks the oracle to catch at least half of plausible typed-value errors before it is the default, not just to be harmless. B3 keeps abstention from becoming a large silent bucket.

## Predictions

1. B1 met: after ≤ 1% of held-out specs flagged; before higher than after on the same specs.
2. Recall is limited by coverage, not by detection: about 35–55% overall after. `boundary` lowest, since a value test that claims a trap inside every parsed range has no formula reading; trap-to-value boundary items are caught only through a parsed range. `sign`, `scale` and `swap` close to the share of value tests the formula covers; `rounding` slightly lower.
3. **B2 likely missed.** B3 met (abstention ≤ 5% of pristine tests).
4. After − before recall within ±5 points: the fix trades a little coverage for fewer false flags.

## Decision rule

The default stays off in this change regardless of outcome. If B1, B2 and B3 are all met, the result recommends flipping `agentLimits.oracle` to true in a separate change; any miss means it stays off and the miss is reported, not retuned on these data.

## Stop conditions

None needed for cost: no model calls, no network, no API keys. A harness error stops the run; it is fixed in a commit and the run repeated in full, with the error disclosed.
