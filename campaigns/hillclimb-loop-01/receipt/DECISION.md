# Loop 1 decision (2026-10-18)

Label: **Recorded (probe)**, agent judgements of agent outputs; one machine, one day; n = 20 per set; no replication beyond the A/A pair. Precommit: `PRECOMMIT.md` sha256 `e4588d35502491fdaf97e373d72dcd6a2d31b51c643c98f2f36c0179f2b5b2b0` (hashed before any noise-floor run; `precommit.sha256`). Every number below is in `analysis.json`, `noise-floor.json`, `forecasts-scored.json`, `consumer-use.json`, `canary-dryrun.jsonl`, `tokens-summary.json`; request text stays in git-ignored `work/`.

## Verdict: not adopted; no evidence at this n; two guardrails breached; D-02 lost at this n

The challenger E (all-new bundle plus the D-02 repair cycle) did not move clean promotion against the incumbent A (factory v2 plus low effort, single-shot form) on the 20 working requests: 1 of 20 clean under the median panel rule for both, the same request (C-003) in both, 0 improved and 0 worsened (paired bootstrap 95 % interval on the difference [0, 0]). The sealed set replicates that: 1 of 20 for A, B and E (C-001 in all three), 0 improved, 0 worsened. The acceptance rule (paired gain >= +6 of 20) is not met; the result is **no evidence at this n**, not "worse". Two pre-registered guardrails were breached by the bundle, which rejects it as a bundle: median per-request wall on the critical path 188 s against 51 s (3.7x; bound 2.0x) on the working set and 159 s against 52 s (3.0x) on the sealed set; tokens per request 98.8k against 19.3k (5.1x; bound 3.0x) and 93.5k against 20.8k (4.5x). The incumbent is unchanged. D-02 (one bounded repair) is recorded as lost at this n: E minus B is +1 of 20 on the working set (C-003) and 0 on the sealed set; the repair triggered on 18/20 and 15/20 artefacts, both reviewers accepted the repaired artefact on 4/18 and 0/15, and no repaired artefact became panel-clean.

## The ruler is at the floor, and that is the loop's main finding

| Set | Arm | Gated (G1-G7) | Promoted | Clean, median rule | Clean, lenient (none not-usable) | Clean, strict (all three) | Panel median clean / with-change / not-usable |
|---|---|---|---|---|---|---|---|
| development, inc-low r1 | A | 20 | 17 | 4 | 4 | 0 | 4 / 6 / 10 |
| development, inc-low r2 | A | 20 | 17 | 3 | 5 | 0 | 3 / 6 / 11 |
| working | A | 20 | 18 | 1 | 1 | 0 | 1 / 8 / 11 |
| working | B | 20 | 19 | 0 | 2 | 0 | 0 / 6 / 14 |
| working | E | 20 | 19 | 1 | 1 | 0 | 1 / 3 / 16 |
| sealed | A | 18 | 16 | 1 | 2 | 0 | 1 / 4 / 13 |
| sealed | B | 20 | 15 | 1 | 1 | 0 | 1 / 6 / 13 |
| sealed | E | 19 | 17 | 1 | 1 | 0 | 1 / 7 / 10 |

Three facts, all Recorded (probe):

1. **The median-clean rate on fresh requests is 0-1 of 20 for every arm**, against 3-4 of 20 on the development set with the same incumbent and the same panel. A +6 of 20 gain cannot be read from a base of 1; the metric has no resolution here. The strict rule is 0 of 20 everywhere (the Opus reviewer called 1 of 60 working-set artefacts clean and the Codex technician 2 of 60, with almost no middle level: 2 usable-with-change of 60).
2. **The ordinal reading points the other way on the two sets.** On the working set the panel's median level fell for 7 requests and rose for 3 from A to E (sign test p = 0.34; mean level 1.6 to 1.8 on a 0-2 scale); on the sealed set it rose for 7 and fell for 4 (p = 0.55; 1.9 to 1.7). Read together: noise around no effect, with the working-set reasons (per request in `analysis.json`) naming interfaces that answer a narrower or different question than the one asked (C-008: computes superheat where a diagnosis was asked; C-024: asks the person to classify their own topic; CC-019: asks for the current rather than the highest liquid temperature) and reference data that the reviewer frame checked and found off (CC-034: 2 F cold at 15 psig).
3. **Inter-oracle within-one agreement fell below the pre-registered 80 % for one pair on the working set** (Sonnet-Codex 45/60 = 75 %; Sonnet-Opus 52/60; Opus-Codex 58/60) and held on the sealed set (48/57, 54/57, 56/57) and the development set (38-39/40). Kappa on the clean/not-clean split is 0.00-0.05 on the working set: the raters agree that almost nothing is clean, and on nothing else. The two-Claude majority the critic warned about is visible: Opus and Codex agree on not-usable far more often than either agrees with Sonnet on clean.

The precommitted rule (scoring briefs v2, after canary attempt 1) derives the verdict from Q1-Q3 and makes any "no" not-usable; the canary replay passed 3/3 under it and the three known-clean fillers moved from clean to usable-with-change for two raters. That rule was in force for every scored artefact of every arm, so the paired contrast is fair; but it, together with a working set in which 8 of 20 requests are owner process rules rather than technician calculations, puts the base rate at the floor. Loop 2's first job is the ruler (below), run side by side with this one on the same artefacts, as the method requires for a ruler change.

## What else loop 1 established

- **Noise floor (H2, F01).** Two identical incumbent runs: clean 4 and 3 of 20, |delta| = 1 (prediction: <= 3), per-request clean agreement 17/20, gated 20/20 both, promoted 17/17; wall median 46 s; 18.2k tokens per run. The prediction held; no resize.
- **Gate yield.** The incumbent gated 20/20 on the first round on the development set (twice) and the working set, 18/20 on the sealed set (C-002 failed G4 after four rounds; C-017's worker output could not be parsed). The all-new B gated 20/20 and 20/20 with Sonnet candidates (18 first candidate, 1 second, 1 Opus escalation on the working set); G8 (stated ranges enforced) passed 20/20 working and 19/20 sealed for B. Determinism and bounded-time guardrails: 0 failures.
- **Cost.** Incumbent 19-21k tokens and 51-52 s per request; B 33k and 29-39 s (faster than the incumbent on its own, with 2.5 x the spec cost in front of it); E's full path 94-99k tokens and 159-188 s. Tokens per clean promotion: A 386k, E 1.98M on the working set. Loop total 10.92M metered tokens (Claude 7.33M, Codex 3.58M; 737 calls; 0 rate-limit events; 1 call error), over the 8M target and under the 12M hard stop; `tokens-summary.json` has every stage. The overruns: Codex criteria written with web search before protocol v1.1 (1.3M, archived), the deviation critic (0.75M), scoring (2.1M over three sets).
- **Canaries.** Attempt 1 under scoring briefs v1 failed (CC-009 3/3, C-006 2/3, CC-011 1/3); the slow-loop revision to v2 was recorded (`oracle-protocol-revisions.jsonl`) and attempt 2 passed 3/3 with no filler false-rejected.
- **Criteria audit.** Five sheets scored 2, 1, 1, 2, 1 of 2 for executable anchoring (mean 1.4; F27 missed); every fix named was a missing source or tolerance.
- **Contract-stage persona.** Revised the stub on 17/20 working and 16/20 sealed requests before any code; the revisions did not translate into panel-clean artefacts.
- **Consumer use (agent-corroborated, five E promotions, Sonnet technician frame, 23 recorded calls, `consumer-use.json`).** Answered the question: 1 yes (CC-029), 3 partly (C-022, CC-034, CC-024), 1 no (CC-020, a capability that only refuses); would use on the job 2/5; the assumption acceptable 5/5. The technicians' changes repeat the panel's: refusals that do not name the input at fault, impossible results returned without a word (a negative superheat, a negative non-condensable pressure), assumption text that does not follow the inputs, a P-T fit 2-9 F off a published chart. This is the claim ceiling of the loop: agent-corroborated use; no person used anything.
- **Forecasts.** 20 scored, mean Brier 0.219 (coin-flipping is 0.25); 7 unobservable (stage corners and the default-effort arm carried forward). Right: the noise floor (F01, F02), gate pass (F12, F13), the hard stop (F16), persona-reject vs panel (F18), the critic's pick (F19), repair frequency (F24). Wrong: the whole-stack gain (F03), canary first-attempt (F09), within-one agreement (F10), cost and wall guardrails (F14, F21), the 8M target (F15), the sealed gain (F17), G8 removing a clean artefact (F20), D-02's own gain (F23, F25), B over A (F26), the audit (F27).

## Guardrails against their bounds

| Guardrail | Bound | Working set | Sealed set | Holds |
|---|---|---|---|---|
| G1-G7 pass count, E vs A | >= A - 3 | 20 vs 20 | 19 vs 18 | yes |
| G5 determinism, G6 bounded time | 100 % of gated | 0 failures | 0 failures | yes |
| Median wall per request, E critical path vs A | <= 2.0x | 188 vs 51 s | 159 vs 52 s | **no** |
| Tokens per request, E vs A | <= 3.0x | 98.8k vs 19.3k | 93.5k vs 20.8k | **no** |
| Canary recall | 3/3 | 3/3 (attempt 2) | | yes |
| Inter-oracle within-one, every pair | >= 80 % | 75 % (Sonnet-Codex) | 84-98 % | **no on the working set** |

## Deviations: merged or lost

- D-02 (fix, do not ship with a to-do list): **lost at this n** (above). Its measured cost and resolution rate are the receipt loop 2 should price it from; the critic's forecast (+4.5 of 20) was wrong by its own win rule.
- No deviation is merged into the spec; `docs/coverage/EDITION-3-ERRATA.md` is unchanged by loop 1. The method moves to v2.3 for its own procedure (the oracle tool surface, the verdict rule, single-shot metered workers as the incumbent's form, the budget rule, the floor finding), not for a won deviation.
- Carried forward, ranked (`deviations.md`): the ruler work below; D-09 decision-stable defaults; the stage corners and the S x G interaction; the default-effort arm; D-12, D-10, D-11, D-06, D-04, D-08, D-01, D-05.

## What loop 2 should do first (hypotheses, not decisions)

1. **The ruler, side by side.** Re-score the 120 working and sealed artefacts (already rendered and keyed under `work/oracle/`) under candidate rulers against the v2 ruler on the same sheets: the ordinal paired median level as a co-primary; a rule that distinguishes "not usable for this request" from "wrong default"; a request-kind stratification (owner process rules against technician calculations). Replay the canaries for each. Adopt a ruler only if it keeps canary recall 3/3 and gives a development-set base rate the A/A floor can discriminate at n = 20.
2. **The pool.** 8 of the 20 working requests and 8 of the 20 sealed are owner process rules that no numeric kernel answers; the incumbent's only clean items on fresh requests are unit and property conversions. Either the factory refuses such requests honestly and the metric counts refusals as a separate outcome, or the pool is stratified before the next contrast.
3. **Cost before capability.** The bundle's cost is its own disqualifier; B alone (no repair, no output persona) ran at 29-39 s and 33k tokens with the same gate yield as the incumbent, which is the cheap configuration to put against the incumbent next, once the ruler can read it.

## Honesty record

Results recorded as they fell (`runs.jsonl`, `scores-*.jsonl`, `tokens.jsonl` append-only); no best-of-N (the first passing candidate was selected by fixed order; every run counts; the two sealed incumbent failures and the one ungated repair are in the denominators); no optimiser agent read anything under `work/oracle/` or `work/canaries/`; the sealed 20 were generated once and scored once, after the precommit hash and without any tuning in between; the briefs and kit libraries did not change after the hash except the analysis script (`bin/step7-analyse.mjs`), which reads receipts and changes no verdict; the forecasts were written before the first noise-floor run and scored by code (`bin/forecasts-score.mjs`).
