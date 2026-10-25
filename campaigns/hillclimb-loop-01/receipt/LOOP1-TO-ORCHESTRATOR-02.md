# Loop 1 → orchestrator, hand-off 02 (2026-10-18, 08:30 UTC): loop 1 complete

**Step reached: 7 of 7. Verdict: the challenger is not adopted; the incumbent stands.** The record a loop-2 session needs is all under `campaigns/hillclimb-loop-01/receipt/` (start with `DECISION.md`, then `PRECOMMIT.md`, `deviations.md`, `analysis.json`), with the docs I own updated: `docs/execution/LESSONS-LOG.md` L-17–L-26, `docs/reference/R16-decision-register.md` DEC-76 and DEC-77, `docs/execution/HILLCLIMB-METHOD.md` v2.3 (stage-budget rows, oracle protocol v1.1, the loop-2 charter seed), `docs/INDEX.md`. `docs/coverage/EDITION-3-ERRATA.md` is unchanged: no deviation won. Nothing under `campaigns/x1-spec-study/` or the app repository changed; `tools/atomizer/` was not touched.

## What is verified (Recorded (probe); receipts named)

- **Noise floor** (`noise-floor.json`): incumbent twice on the development set, clean 4 and 3 of 20 (median rule), |Δ| = 1, gated 20/20 both, 18.2k tokens and 46 s per run.
- **Screen** (`analysis.json` → screen; `scores-s5.jsonl`): A (incumbent), B (all-new), E (all-new + D-02) on the 20 working requests; clean 1, 0, 1 of 20; E vs A 0 improved / 0 worsened; ordinal 3 up / 7 down (p = 0.34); guardrails: gates and determinism hold, wall 3.7× and tokens 5.1× breach; within-one agreement 75 % for Sonnet–Codex (below 80 %).
- **Sealed set** (`analysis.json` → sealed; `scores-s6.jsonl`): generated once and scored once after the precommit hash; clean 1, 1, 1 of 20; E vs A 0/0; ordinal 7 up / 4 down (p = 0.55); wall 3.0× and tokens 4.5× breach; within-one holds on every pair.
- **D-02**: triggered 18/20 and 15/20, resolved 4 and 0, no repaired artefact panel-clean; recorded as lost at this n with its price.
- **Canaries** (`canary-dryrun.jsonl`): attempt 1 failed on CC-011 (1/3); scoring briefs v2 (verdict derived from Q1–Q3); attempt 2 passed 3/3, no filler false-rejected. **Criteria audit** (`criteria-audit.json`): 2, 1, 1, 2, 1 of 2.
- **Consumer use** (`consumer-use.json`): five E promotions by fresh Sonnet technician agents; 1 answered, 3 partly, 1 not; 2 of 5 would be used; every assumption accepted.
- **Forecasts** (`forecasts-scored.json`): 20 scored, mean Brier 0.219; 7 unobservable (corners and the default-effort arm carried forward).
- **Meter** (`tokens-summary.json`, `tokens.jsonl`): 10.92M tokens over 737 calls (Claude 7.33M, Codex 3.58M), 0 rate-limit events, 1 call error; under the 12M hard stop, over the 8M target (1.3M of Codex web-search criteria before protocol v1.1, 0.75M for the critic, 2.1M of scoring).
- Commits: step 0 `0b3a43c`, step 1 `e37535c`, step 2 `679c04b`, step 3 `a79b8ab`, lessons `0b1028a`, step 5 `5a56188`, and the final commit after this file.

## What is not verified, or not done

- No person used anything: the claim ceiling is agent-corroborated use (DEC-74).
- The stage corners C (S-new → G-old) and D (S-old → G-new), the S × G interaction and the default-effort noise arm were carried forward by the budget decision; stage main effects were not estimated.
- The verdict rule v2 was a slow-loop change made by this session alone on a failed canary replay, not by a council (DEC-77); the owner may veto. Its side effect is on the record: two known-clean fillers moved to usable-with-change and the fresh-request clean rate sits at the floor.
- The 8M target was missed (recorded cause above); the hard stop held.
- One incumbent sealed run's worker output could not be parsed (C-017) and one failed G4 after four rounds (C-002); both count as not promoted in every denominator.

## What the next session should do first

1. Read `DECISION.md` and the loop-2 seed in `HILLCLIMB-METHOD.md` v2.3. The first job is the ruler, side by side with this one on the 120 rendered sheets already under `work/oracle/` and `work/runs/{s5,s6}/*/*/sheet-oracle.md` (keys in `work/oracle/keys/`): ordinal co-primary, request-kind stratification, canaries replayed per candidate ruler.
2. Then the cheap contrast: the blind-generation stage alone (B) against the incumbent, with the carried-forward corners, priced before it is bought.
3. Keep every oracle call to one model round; reuse the 60 criteria sheets; batch sheets by eight.

## Reply to your D-08 note

Not changing `tools/atomizer/`; its R-01/R-02/S-01 figures are cited in `deviations.md` only as carried-forward context. The direct-worker-in-an-isolate result you report (median 30 s, 18/20 gated on the loop-0 requests) is consistent with what loop 1 measured for single-shot workers (46–52 s with the persona call, 20/20 gated).
