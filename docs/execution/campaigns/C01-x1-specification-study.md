# C01 — E3 X1: specification study (agent specifier)

> Reconstructed 2026-10-17. The original C01 was not available; this draft is rebuilt from
> Edition 3 (§3, §6, §10, §15), R14 X1, R15 (RISK-11, RISK-12, RISK-25) and R16 (DEC-42). Content follows Edition 3 where the editions differ.
> Redone 2026-10-17 (later the same day) for an agent specifier per DEC-71, after the dark-factory pilot ran on the primary 20; see `docs/execution/CRITIQUE-2026-10-17-reconcile.md`.

**Status: Draft — not registered. Piloted.** No precommit hash exists for a registered run; no named author or reviewer; no campaign id. One pilot of this design ran on 2026-10-17 on the frozen primary 20 and is reported in §16 as **Pilot (not a registered result)**. Its numbers may narrow this draft (DEC-64); they decide nothing here.

## Purpose

This record drafts the precommit for Edition 3's first experiment: can real requests at the "too small for a project" scale be turned into a checkable acceptance contract quickly enough for generative applications to have a market now [E3 §3, §15]? Under DEC-71 the specifier is not a person: one fresh agent per request writes the contract and its executable tests, a second blind agent classifies the seeded half, and the person's role is the confirmation Edition 3 §6 describes, now applied to the one question each contract records. It needs no engineering and starts on day one (Stage 1).

## Summary

- Twenty real requests, frozen before the study (DEC-66); one fresh agent per request writes and times the acceptance contract and its executable tests, blind to every other request; a second fresh agent classifies the seeded half blind to timings and to rater 1's judgments; the person confirms or corrects the recorded question [DEC-71; R14 X1].
- One primary metric: the fraction of requests whose contract is rubric-complete in under ten minutes of the agent's own working time. Kill: under 20 % [E3 §15]. The three bands of DP-6 (below 10 % kill; 10–35 % extend to 60; above 35 % pass) are unchanged.
- What X1 now decides: whether an agent specifier can turn this request class into contracts at all, and how thin a residual to design for. What it hands to X2: the contracts and their frozen tests as the seed task set, with the rater-disagreement rule tightened first (C02 §6).
- Two R19 secondaries stay (clustering for popularity skew, structural-versus-parametric residuals), with the rule that clustering needs a defined procedure before it informs R19 §2.5 (pilot: 15 clusters by one rater, 4 families by another).
- The pilot (§16): 20/20 contracts complete under 600 s (median 95 s, p95 147 s); 20/20 underdetermined by rater 1, 9/10 by the blind rater; 19 of 20 kernels gated. **Pilot (not a registered result).** Registration still requires what §17 lists.

## Record header

| Field | Content |
|---|---|
| Record | C01 |
| Status | Draft — not registered; piloted 2026-10-17 (§16) |
| Stage | 1 (parallel with Stage 0) |
| Work packages | WP07 (study kit, `campaigns/x1-spec-study/`); WP01 only for hashing the precommit (a manual SHA-256 is acceptable until WP01 lands) |
| Risk or decision addressed | RISK-11 (specification cost swamps value), RISK-25 (underdetermined requests), RISK-12 (review throughput); DEC-42 (two products, separate evidence bars); DEC-71 (agent specifier) |
| What cannot be known yet | The named author and reviewer; the registration date; whether a registered run reproduces the pilot's completeness under a fresh seed or a fresh model version. The share of underdetermined requests was 20/20 in the pilot; whether that holds on the reserve 40 (almost all chatbot calculations, L-09) is unknown |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c01-x1-spec-study-<UTC>-<6 hex>`; TBD at registration. The pilot had none |
| Label | `official` |
| Experiment | E3 X1 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the rubric, the kit or the agent brief [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`). The pilot's freeze (`receipt/freeze.json`, seed 20261017) precedes its first contract and may be reused if nothing in the pool or rubric changes |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | What fraction of real small requests can a fresh agent turn into a rubric-complete acceptance contract with executable tests in under ten minutes of its own working time? It decides whether generative applications have a market now under an agent specifier, and how thin a residual to design for |
| Hypothesis and predicted observable | Design assumption under test (Proposed): at least 20 % of frozen real requests are specifiable in under ten minutes. Observable: per-request agent working time (kit timer) and rubric classification by rater 1, checked by rater 2 on the blind half |
| Strongest rival | Specification cost dominates: most small requests are ambiguous or underdetermined, so a contract cannot be written without a round trip to the requester. Under an agent specifier the rival takes a second form: the agent writes a complete-looking contract fast by assuming the missing fact, so completeness is high while the contract answers a question nobody asked. The underdetermined share, the rater-2 disagreement on completeness and the persona verdicts (C02 §6) are the readings that separate the two |
| Claim-ladder rung | None directly. It conditions rung 4 (a generated capability completes a real person's task) by deciding whether Stage 4 targets generative applications at all [E3 §17]. The pilot moved no rung: no person used a capability |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Fraction specifiable in under ten minutes = requests whose agent-written contract meets the frozen rubric's completeness criteria (observable, authoritative inputs, at least one executable test per required behaviour, failure meaning, permitted effects) within 600 s of the agent's recorded working time, including its start-up and tool overhead ÷ requests in the frozen set |
| Decision rule | Three bands at n = 20, read on the point estimate (DP-6): (1) below 10 %, that is 0 or 1 of 20, kill (§9); 0 of 20 is also decidable on the bound (upper 16.8 %), 1 of 20 is a point-estimate decision (interval 0.1–24.9 %). (2) 10–35 %, that is 2–7 of 20, extend to 60 requests from the same frozen pool, then decide at 60 on the point estimate against 20 %: below 20 % kill, at or above 20 % pass. (3) Above 35 %, that is 8 or more of 20, pass (lower bound 19.1 % at 8 of 20, 23.1 % at 9 of 20). The two-sided 95 % Clopper–Pearson interval is always reported; any decision whose interval straddles 20 % is labelled "point-estimate decision" in the receipt. **What X1 decides:** whether Stage 4 targets generative applications (the kill or pass), and the residual thickness to design for (secondary). **What X1 hands to X2 rather than deciding:** whether the contracts are the capabilities the people wanted. Completeness is rater 1's self-report checked by one blind agent; it is not correctness. The pilot found every contract complete and every request underdetermined, so the primary cannot separate "specifiable" from "specifiable only with an assumption"; that separation is C02's grading and the persona stage (WP28). What it cannot decide at either n: a market size, the ambiguity share with any precision (a secondary), or anything about synthesized evaluators (C02) |
| Secondary metrics | Fraction satisfiable by composing existing capabilities; residual size (number of residual assertions, counted under the §5 rule); distribution of working times (capped at 30 min); fraction classified underdetermined; Cohen's κ between the two raters on the blind half, with the note that κ is uninformative when one rater has no variance (pilot: 10/10 complete, κ = 1 by construction), so per-field raw agreement is reported alongside; the fraction of contracts whose recorded question the person confirms unchanged. From R19 §3 (descriptive, Proposed): (i) popularity skew: the frozen requests clustered by contract similarity by rater 2 reading contracts alone, under a written clustering procedure fixed at freeze (the pilot's two readings, 15 clusters and 4 families, differ because none was written); (ii) each residual classified structural or parametric, reporting the structural share (R19 §2.3). At n = 20 both are readings, not estimates with useful intervals |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| A — Agent specifier (DEC-71) | Rater 1: one fresh Claude agent per request (model and version pinned at freeze), which starts the kit timer itself, reads the request only after starting, writes the contract and its executable tests in one pass under `factory/README.md`, freezes them by hash and stops. Rater 2: a second fresh agent, blind to timings and to rater 1's judgments, classifies the seeded half. Person: confirms or corrects the recorded question for every contract, blind to timings; may adjudicate rater disagreements. No person writes a contract | Kit `receipt/kit.sha256`; rubric `receipt/freeze.json` `rubricSha256`; agent brief (`factory/README.md`) SHA-256 TBD at freeze; model identifier and version at freeze | Fresh context per request; no agent sees another request or contract | One agent process per request; concurrent agents write to per-id folders under `work/factory/<id>/` | Working seconds from the kit's start/stop events; tokens per agent recorded where the harness reports them |

Control arm: none. Null arm: none. The human-specifier arm of the earlier draft is withdrawn (DEC-71); a human arm, if ever wanted, is a separate record.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | The rubric: `receipt/freeze.json` `rubricSha256` (frozen 2026-10-17); re-frozen at registration if the residual-counting rule below changes the rubric text |
| Synthesized residual | Each contract's executable tests, frozen by hash before any kernel exists (`work/factory/<id>/frozen.sha256`); they are the seed residuals C02 grades |
| Acceptance boundary | The frozen rubric: a contract is complete when it names the observable, the authoritative inputs, at least one executable acceptance test per required behaviour, the failure meaning, and any permitted effects. **Residual-counting rule (tightened after the pilot):** a residual assertion is one executable test row that constrains the observable; assumption-pin rows (tests that only fix the stated assumption) and boundary rows (tests that only establish a trap or refusal at the domain edge) are counted separately and not in the residual size. The pilot's raters counted differently on 7 of 10 blind items because this rule was absent |
| Independent validator | Rater 2, a fresh agent blind to timings and to rater 1's judgments, classifies the seeded half; the person checks every recorded question |
| Parity rule | Rater disagreements are reported per field (complete, underdetermined, composable, shape, residual count) and adjudicated by the person; the primary uses rater 1's verdicts, the adjudicated verdicts are a sensitivity analysis. A completeness disagreement on the blind half above 2 of 10 is a reason to stop and re-freeze the rubric before reading the primary |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | **Frozen 2026-10-17** (DEC-66): 60 requests in `campaigns/x1-spec-study/work/pool/` (private), digests in `receipt/pool.sha256`; `receipt/freeze.sha256` = `df0684d68ece4e25d3d54b483dc1b71b3d2bc6d7de727cf598cea3290cb823dd`; seed 20261017; primary 20, reserve 40, blind half of 10. Composition and vouching: `receipt/vouching.md`, `LESSONS-LOG.md` L-09. Inclusion rules: `RUBRIC.md`; exclusions: `receipt/excluded.md`. The reserve is almost entirely chatbot calculation requests, so an extended set's composition differs from the primary's and the analysis reports both sets separately |
| Public fixtures | The frozen request pool (private where requests contain customer data; digest only in the receipt; DEC-68) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One request |
| Planned n | 20; 60 if the extension rule fires |
| Power calculation | Two-sided 95 % Clopper–Pearson: 0/20 gives an upper bound of 16.8 %; 9/20 gives a lower bound of 23.1 %; outcomes 1–8 of 20 do not separate from 20 %. At 60, 12/60 gives 10.8–32.3 % (Derived, R14 X1). The design accepts that X1 is a coarse screen. The pilot's 20/20 gives a lower bound of 83.2 % (Derived from `receipt/summary.json`; Pilot (not a registered result)) |
| Minimum samples | 20 requests; the blind half is 10 requests (30 after extension) |
| Randomisation | Order of contract writing randomised per seed; blind-half selection seeded; seed 20261017 (DEC-66) unless the pool changes |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Not applicable: this campaign makes no machine-timing claim. Agent working seconds are reported as recorded, with the host load noted (the pilot ran under load from P-04b, so its seconds are upper bounds, L-12) |
| Steady-state rule | Not applicable: this campaign makes no machine-timing claim |
| Warm-up | Not applicable: this campaign makes no machine-timing claim |
| Placement | Not applicable: this campaign makes no machine-timing claim |
| Quiet gate | Not applicable: this campaign makes no machine-timing claim |
| Calibration | Not applicable (no instrument timing). The kit timer is checked against a wall clock before the study; the agent's own start/stop events are the record |
| Accounting cross-check | Not applicable: this campaign makes no machine-timing claim |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | All requests processed. A requester who cannot be reached is not a reason to drop a request: it is classified underdetermined and the contract records the question. A model version change mid-run stops the run (restart is a new campaign). Voids (a start before the agent design is settled, or a re-run under a changed protocol) are counted and reported, never silently dropped (pilot: 4) |
| Kill criterion | Under 20 % specifiable in ten minutes [E3 §15], read through the §3 bands: 0–1 of 20 at n = 20, or a point estimate below 20 % at n = 60 after extension. The agent substrate is then the product; generative applications move to research. Stage 4 then runs the agent-substrate variant only |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | The agents' host; no measured compute claim |
| Model | About 75–83k tokens per request agent (Pilot (not a registered result), L-12), so about 1.6M tokens for 20 plus the blind rater; through the subscription CLI (DEC-65), no dollar figure |
| People | Confirmation of 20 recorded questions and adjudication of blind-half disagreements: about 1–2 person-hours (Estimated). The earlier 12–20 person-hours for hand-written contracts no longer applies |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Not performance-relevant. Recorded at registration: the model identity and version of the request agents and the blind rater, the agent brief and kit hashes, the analysis-script hash, and the repository head (dirty tree refused).

## 12. Artifact identity

Request pool (`receipt/pool.sha256`, `receipt/freeze.sha256`); rubric; agent brief (`factory/README.md`); kit (`receipt/kit.sha256`); analysis script (WP07); all hashed into the precommit.

## 13. Failure meaning

A kill means generative applications are not viable now at this scale with agent-written contracts. It does not mean the agent substrate fails, nor that later models or a thicker invariant library could not change the answer. A pass does not establish that the contracts are correct (C02), that the harness is trustworthy (C03), or that a capability helps anyone (rung 4). Delivery state (study completed) and outcome state (criterion met or not) are reported separately.

## 14. Monitoring and rollback

The study lead checks that every contract and test file was hashed before any kernel was generated and that no agent's inputs name another request. Requests containing customer data stay in a private root; the receipt carries digests only [RECEIPT §4; DEC-68].

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | Predictions: this record. Calibration receipt: not applicable (no instrument timing). Evaluator (rubric): `receipt/freeze.json` `rubricSha256`. Workload: `receipt/freeze.sha256` df0684d6… (frozen 2026-10-17); kit `receipt/kit.sha256` |
| Approvals | Person approving the precommit (and the residual, where one exists): TBD at registration |
| Chain rule | Every evaluation request and the summary cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## 16. Pilot (not a registered result), 2026-10-17

One run of this design, extended end to end into kernels and gates by the owner's direction (the dark factory: discover need → create code → promote candidate), on the frozen primary 20. Every number is **Pilot (not a registered result)** and, where it came from a receipt, **Recorded (probe)**. Sources: `campaigns/x1-spec-study/receipt/summary.json`, `receipt/factory-summary.json`, `receipt/notes.md`, `receipt/persona-review-summary.md`; L-11 to L-14.

| Reading | Value | What it is |
|---|---|---|
| Rubric-complete in under 600 s | 20 of 20 (lower 95 % bound 83.2 %; band "above 35 %") | Rater 1 self-report; the primary as this draft defines it |
| Working seconds per request | median 95 s, p95 147 s, range 57–162 s (first run); median 97 s after two re-runs | Agent's own time including start-up, under host load |
| Underdetermined | 20 of 20 (rater 1); 9 of 10 (rater 2, blind half) | Every contract records an assumption and a question |
| Composable | 17 of 20 | Rater 1 |
| Residual assertions | median 6, range 3–16 | Counted without the §5 rule; rater 2 counted higher on 7 of 10 |
| Blind-half agreement | complete 10/10 (κ = 1, no variance); underdetermined 9/10; composable 8/10; shape 5/10 | Per field |
| Structural share | 9 of 20 | Rater 1 |
| Clusters | 15 (coordinator, one pass) vs 4 families (rater 2 from contracts alone) | No procedure was written; rater-dependent |
| Kernels gated (G1–G7) | 19 of 20; 18 first-run gate passes; 2 needed one compile repair | `factory/gate.mjs`; CC-001 self-rejected on a test-format defect (JSON cannot carry NaN) |
| Promotion under the final rule | 3 promoted (CC-014, CC-025, CC-036); 15 promoted pending one named change; 1 gated but persona-rejected (CC-011); 1 gate-rejected (CC-001) | Promoted = gated and persona-accepted (WP28) |
| Persona verdicts | 41 over 19 capabilities: 16 accept, 24 accept-with-change, 1 reject (after re-runs; 14/25/2 before) | Proxy for the person's confirmation; one agent, backfilled per id |
| Voids | 4 | 2 on C-019 before the agent design was settled; 1 each for the C-006 and CC-011 re-runs |
| Delivered | 19 kernels to refrigeration-ai, branch `claude/endoforge-capabilities`, commit `abb90cc0` (unmerged; predates G7 and the glue) | 232 frozen tests pass through the app's loader; no technician has used one |

What the pilot narrows (DEC-64): the specification stage is minutes for an agent specifier, so RISK-11 is not where the difficulty is; the normal product is a capability plus the one question (RISK-25 is the common case, not the exception); the test format is part of evaluator totality (L-04); clustering needs a written procedure. What it does not show: a registered C01 result; correctness of any contract beyond self-report, one blind agent and one persona agent; rung 4 (no person used a capability); behaviour on the reserve 40.

## 17. What registration still requires

1. A named author and reviewer, neither of whom wrote the rubric, the kit or the agent brief, and a campaign id, recorded before the first measured job.
2. The §5 residual-counting rule written into `RUBRIC.md` and re-frozen; the clustering procedure written and hashed.
3. A fresh run under the registered precommit: the pilot's folders are evidence of the design, not of the result. If the pool, rubric, kit and model version are unchanged, the same freeze may be cited, but every contract is written again by fresh agents.
4. The person's confirmation of each recorded question, recorded per id (the pilot substituted a persona agent).
5. A second blind rater that is fresh per id, not one agent across the half, if κ is to be read.
6. The rung-4 path is outside C01: one technician using one delivered capability through the app, with consent and a hashed task statement (DP-4), after the glue and the two re-run kernels are re-delivered.

## Edition 3 alignment

- New in Edition 3: Edition 2 had no specification study; it assumed the request could be specified [E3 §2, §15].
- Edition 3 gives n = 20 without power; this record adopts R14's extension rule, written as three bands (DP-6), rather than changing Edition 3's threshold.
- Edition 3 §6 puts specification on a synthesized evaluator and confirmation on the person; DEC-71 applies that to X1 itself, so the human specifier of the first draft is withdrawn. Edition 3 §3's worry that specification cost swamps value is, for an agent specifier, not supported by the pilot; the cost moved to confirmation (the question) and to persona-level correctness (Edition 4 input, `CRITIQUE-2026-10-17-reconcile.md`).
- R19 §3 proposes two X1 additions (popularity clustering, structural-versus-parametric residuals); they enter as secondaries only. R19 §2.1 now has a home in a work package (WP28, Stage 4) because the pilot measured 20/20 underdetermined.

## Open questions

- Who are the author and reviewer, and can both be independent of the kit and brief? (WP07)
- Should composable requests count as specifiable when the composition is not yet in a library? This record counts them by their contract, and reports composability separately.
- Does the completeness rate hold on the reserve 40, which are chatbot calculations rather than owner or technician requests? Only the extension rule would show it.
- Is one persona agent an acceptable stand-in for the person's confirmation in a registered run? This record says no (§17 item 4); the plan keeps persona review as the promotion gate, not as X1's confirmation.

## Sources

- Edition 3 §3, §6, §10, §15 (`sources/text/Endoforge-Edition-3.txt`).
- R14 X1; R15 RISK-11, RISK-12, RISK-25; R16 DEC-42, DEC-64, DEC-65, DEC-66, DEC-68, DEC-71; R19 §2.1, §2.3, §2.5, §3.
- `docs/templates/CAMPAIGN-PRECOMMIT.md`; `docs/execution/WORK-PACKAGES.md` WP07, WP28, WP29; `docs/execution/LESSONS-LOG.md` L-09, L-11 to L-14.
- `campaigns/x1-spec-study/receipt/{summary.json,factory-summary.json,notes.md,persona-review-summary.md,freeze.json}`; `campaigns/x1-spec-study/factory/README.md`.
- `docs/execution/CRITIQUE-2026-10-17-reconcile.md`.
