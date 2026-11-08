# P-69 formula oracle: result

Status: **Recorded**, 2026-11-08. Precommit [PRECOMMIT.md](PRECOMMIT.md), sha256 `3f456d80…` in [receipt/precommit.sha256](receipt/precommit.sha256), pushed at 04:05:41 EST (`aa848f1`) before any acceptance measurement. Offline and pristine runs 04:05; live run 04:24–04:34 EST, Claude Code with `claude-sonnet-5-5` at low effort, Node v26.13.0, one subscription account.

**The oracle catches every known wrong frozen value (12 of 12) with 0.19% false flags, and in a paired re-run it cut failed candidates per promoted candidate from 0.22 to 0.04 (ratio 0.16, 95% interval 0 to 0.65). But it refused 3 of the 177 pristine specifications (bar: 0), and on fresh specifications its offline mode caught only 3 of the 12 values the precommitted labels call wrong. Under the decision rule it ships behind `limits.oracle`, off by default.**

## Bars

| Bar | Measured | Interval | Verdict |
|---|---|---|---|
| **Primary:** known wrong frozen values caught ≥ 80% | **12 / 12** (10 specs of 10): 10 by the contract formula, 1 by the validity range, 1 by the 1e-9 relative tolerance floor | Clopper-Pearson 73.5–100% | **met** (in-sample, see below) |
| 1. False flags ≤ 2% of correct tests | offline **16 / 8,475 (0.19%)**; fresh `base` specs **2 / 536 (0.37%)** | 0.11–0.31%; 0.05–1.34% | **met** |
| 2. Zero verdict regressions, 177 pristine kernels | **3 regressions** (174 / 177 promote) | 0.35–4.87% | **missed** |
| 3. ≤ 5 ms per need at freeze (p95) | offline quiet **p95 1.82 ms** (p50 0.63, max 10.5); in situ **p95 3.18 ms** (p50 1.47, max 3.77, loaded) | | **met** at p95; the offline max exceeds 5 ms |
| 4. ≥ 50% fewer failed candidates per promoted (exploratory) | `oracle` **0.036** (2 / 56) vs `base` **0.222** (12 / 54): ratio **0.16** | paired bootstrap 0 – 0.65 | point **met**; interval includes 0.65, so not confirmed |
| 5. Held-out catch on fresh `base` specs (≥ 80% since ≥ 5 wrong) | **3 / 12** (25%): 3 / 3 by H reference labels, 0 / 9 by sibling-kernel labels | | **missed** as labelled; see below |

Exact counts are over fixed sets, so bars 1, 2, primary and 5 have no sampling error beyond the interval shown for the rate. Only bar 4 is sampled. One primary bar was named, so no Holm correction.

## What the oracle caught, and how

Offline ([receipt/offline.json](receipt/offline.json)), every wrong value in the ten known failures:

| Run | Wrong literal | Value the contract gives | Mechanism |
|---|---|---|---|
| P-56 main CC-036 sonnet-low | 8.314471 | 8.314337 | formula |
| P-56 main CC-002 sonnet-low | 56.44 | 56.944 | formula (four-step Magnus) |
| P-56 main CC-025 opus-low | 8.31433695548919 (tol 1e-9) | 8.3143369508 | tolerance floor: off by 4.7e-9, inside 1e-9 relative, so the frozen test accepts the true value |
| P-56 pilot CC-036 sonnet-medium | 1,341,102.2 | 1,341,022.1 | formula |
| P-56 pilot H08 sonnet-medium | 0.818129086872342 | 0.818123086872342 | formula |
| P-66 H02 samples 0, 2 (×2), 5 (×2) | 4645.434102; 8.0273114633, 464.5449524; 8.027313421449, 2322.71704 | 4645.4368; 8.0273148, 464.5437; 8.0273148, 4645.437 | formula |
| P-66 H08 sample 3 | a value at diameter 12 | trap (range 0 < d ≤ 6) | range |
| P-66 H08 sample 5 | 19,634,954 | 19,634.954 | formula |

**This is in-sample.** The parser was developed on this corpus (false flags 353 → 16 over seven rounds), as the precommit disclosed. The held-out evidence is the live run.

## Live re-run, paired ([receipt/main](receipt/main))

8 needs × 7 reps × 2 arms = 112 runs, all completed; every run is **loaded** (load above 16 at start or end, 15–25 throughout), which affects only times.

| Arm | Promoted | Failed candidates | Per promoted | Calls | Calls per promoted | Held-out escapes |
|---|---|---|---|---|---|---|
| `base` | 54 / 56 | 12 | 0.222 | 123 | 2.28 | 0 |
| `oracle` | **56 / 56** | 2 | **0.036** | 118 | 2.11 | 0 |
| `rival` (derived from `base`) | 54 / 56 | 4 | 0.074 | 115 | 2.13 | 0 |

- Both `base` failures were wrong frozen values, each repeated identically for six checks: H02 rep 4 froze 8.0273134211 and 2.32271973 (true 8.0273148 and 2.3227184), and H08 rep 4 froze a value at a 12-inch bore that its own contract range traps. The offline oracle flags all three, by formula and range, on specifications it had never seen.
- `oracle`'s two failed candidates were ordinary code repairs that then promoted (CC-002 rep 6, CC-013 rep 4).
- In the `oracle` arm nothing needed correcting at freeze (0 corrected, 0 flagged at freeze; 495 tests verified by two sources, 68 unverified). One run (H02 rep 4, the same slot where `base` failed) took a second specification turn, which is how a flagged test comes back; the problem text isn't recorded, so that is the likely but unconfirmed mechanism. The rest of the effect is the prompt: asked to write `reference.js` and one formula line, the model froze no wrong H value in 56 specifications against `base`'s 3 in 56.
- Ratio intervals: `oracle`/`base` 0.16 [0, 0.65]; `rival`/`base` 0.33 exactly (derived, so no sampling between them).

**Correction disclosed:** analyze.mjs first compared whole failure objects, which carry per-test timings, so the rival never stopped and showed 0.222. The precommit defines the rival by the failure summary; the fix compares failing gates and each failing test's name, expect and got (`analyze.mjs`, commit after the run). Reported figure: 0.074.

## Strongest rival

Stop after two identical failures saves 8 of `base`'s 12 failed candidates (ratio 0.33) and 8 calls, but promotes nothing extra: 54, the same as `base`. The oracle saves 10 and promotes 56. On these 56 pairs the oracle wins on both counts, but the promotion difference is 2 runs, which this sample can't separate from chance. The two compose: the rival bounds the cost of any wrong value the oracle can't see (68 unverified tests in the `oracle` arm).

## The misses

**Pristine (bar 2).** All three regressions are flags, not wrong corrections: a pristine specification would have gone back for one more specification turn, not frozen a wrong value.
- `cand-r2/CC-007`: the prose sentence "R = 1 means all delivered refrigerant evaporates" parsed as an assignment and overrode the formula `R = circulatedKgPerS / evaporatedKgPerS`.
- `cand-r4/CC-026`: a piecewise rule, "for scale 0, F = temperature; for scale 1, F = temperature * 9 / 5 + 32", read without its condition.
- `cand-r5/C-012`: a conditional domain, "when isName = 1, entityOrdinal must be in [1, 1000000]", applied to the isName = 0 case.

**Held-out catch (bar 5).** The 3 H-labelled wrong values were all caught. The other 9 come from R needs, labelled wrong because at least two promoted sibling kernels disagreed with the literal. The oracle verified 4 of those 9 against the specification's own contract formula, and the run's own kernel passed all 9: the siblings implement other specifications with different conventions (CC-013, CC-036). The precommitted label counts them, so the bar is missed. The sibling label is not a good oracle for open-ended R needs.

Neither miss is retuned here. Each cause is a parser rule (prose assignments followed by "means", conditional "for/when … ," clauses), which would be a new labelled row against a fresh pristine run.

## Predictions

1. Offline 12 / 12, 16 false flags: **held** exactly.
2. Pristine 0 regressions: **failed** (3).
3. Offline p95 under 2 ms and in-situ under 5 ms: **held** (1.82, 3.18).
4. `base` freezes 2–8 wrong values and loses 1–6 runs; `oracle` at most 1; ratio ≤ 0.5: **held** (3 H values, 2 runs; 0; 0.16).
5. Rival cuts 30–60% and never raises promotions: **cut 67%, outside the range; promotions unchanged, held**.
6. ≥ 90% of corrections true: **untestable**, there were none.
7. Calls 230–300: **held**, 241.

## Account and budget

**241 model calls** of 300, every one on the subscription login: 17 `claude auth status` checks passed (`loggedIn` true, `authMethod` `claude.ai`), every init reported `apiKeySource: none` and `claude-sonnet-5-5`, and the runner refused to start with any API credential variable set. The smoke stage used the P-56 fake CLI and made no model calls.

## Loaded or unverified

- All 112 live runs are loaded; times there are not acceptance figures. The offline quiet timing is one rep at PSI 0.73 and load 15.8.
- The text of the one `oracle` spec bounce wasn't recorded.
- The offline corpus is in-sample; the live run has 56 pairs, so bar 4 can't distinguish a 50% from a 90% reduction.

## Decision

Primary and bars 1 and 3 met, bar 4's point estimate met, bars 2 and 5 missed. **The oracle ships behind `limits.oracle`, off by default.** `agentLimits` is unchanged.
