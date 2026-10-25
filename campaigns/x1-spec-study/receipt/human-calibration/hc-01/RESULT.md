# hc-01 result: three sealed oracles on ten blind loop-0 sheets (2026-10-17)

Label: **Recorded (probe)**, agent judgements of agent outputs; n = 10 items; one day; no replication. The persona level is the loop-0 persona-review proxy (`receipt/factory-summary.json`), the thing being calibrated. The owner's form was never filled (hash `744377e38c5f426c` unchanged); the owner removed the human step (DEC-74).

## Raters

| Rater | Model, frame | Read | Wall | Tokens |
|---|---|---|---|---|
| oracle-sonnet | Claude Sonnet 5.5, field technician (Agent tool) | ten sheets + its form | 12.6 min | ~179k (agent total) |
| oracle-opus | Claude Opus 5.5, engineering reviewer (Agent tool) | ten sheets + its form | 16.7 min | ~180k (agent total) |
| oracle-codex | Codex CLI 0.162.1, GPT-6.1 (`gpt-6.1-sol`, reasoning effort medium), field technician, same brief text as oracle-sonnet; `codex exec -s read-only --ephemeral` from a sealed directory holding only the sheets and the blank form | ten sheets + form | 41 s | 87,264 in (68,096 cached), 2,304 out (645 reasoning) |

## Verdicts (Q4) by item

| Item | Id | Persona | oracle-sonnet | oracle-opus | oracle-codex |
|---|---|---|---|---|---|
| 1 | CC-007 | with-change | usable-with-change | usable-with-change | clean |
| 2 | CC-036 | clean | clean | clean | clean |
| 3 | CC-014 | clean | clean | clean | clean |
| 4 | CC-009 | with-change | usable-with-change | clean | not-usable |
| 5 | CC-027 | with-change | usable-with-change | not-usable | not-usable |
| 6 | C-016 | with-change | usable-with-change | usable-with-change | not-usable |
| 7 | CC-025 | clean | clean | clean | clean |
| 8 | CC-011 | not-usable | not-usable | not-usable | not-usable |
| 9 | CC-013 | with-change | clean | usable-with-change | not-usable |
| 10 | C-006 | with-change | usable-with-change | clean | not-usable |

## Pre-registered measures (exact Clopper–Pearson 95 % intervals)

| Measure | oracle-sonnet | oracle-opus | oracle-codex |
|---|---|---|---|
| Exact agreement with the persona level | 9/10 [0.55, 1.00] | 7/10 [0.35, 0.93] | 4/10 [0.12, 0.74] |
| Within one level | 10/10 [0.69, 1.00] | 10/10 [0.69, 1.00] | 10/10 [0.69, 1.00] |
| Persona false-accept as seen by the oracle (persona promoted, oracle not-usable) | 0/9 [0.00, 0.34] | 1/9 [0.00, 0.48] | 5/9 [0.21, 0.86] |
| Persona-rejected item (CC-011) caught | yes | yes | yes |

| Pair | Exact | Within one |
|---|---|---|
| oracle-sonnet vs oracle-opus | 6/10 [0.26, 0.88] | 10/10 [0.69, 1.00] |
| oracle-sonnet vs oracle-codex | 4/10 [0.12, 0.74] | 9/10 [0.55, 1.00] |
| oracle-opus vs oracle-codex | 5/10 [0.19, 0.81] | 8/10 [0.44, 0.97] |

## Post hoc (not pre-registered): the clean / not-clean split

The primary loop metric is *clean promotion*, so the binary split matters more than three-level agreement. Agreement on clean-versus-not: persona–sonnet 9/10, persona–opus 8/10, persona–codex 9/10, sonnet–opus 7/10, sonnet–codex 8/10, opus–codex 7/10.

Persona-clean set: ['CC-014', 'CC-025', 'CC-036']. Panel strict rule (all three clean): ['CC-014', 'CC-025', 'CC-036']. Panel median rule: ['CC-014', 'CC-025', 'CC-036']. The sets coincide: every rater, on either model family, finds exactly the same 3 of ten clean as returned.

Where the raters differ is the middle: `usable-with-change` against `not-usable`. oracle-codex never used the middle level (four clean, six not-usable); oracle-opus called CC-027 not usable where the persona and oracle-sonnet named one change; oracle-opus called CC-009 and C-006 clean where the others named a change. A capability shipped `promoted-pending-change` is one about which independent judges disagree whether it is usable at all: the case for deviation D-02 (fix, do not ship with a to-do list).

## The reasons given (Q5) where the raters disagree

| Item | Id | oracle-sonnet | oracle-opus | oracle-codex |
|---|---|---|---|---|
| 1 | CC-007 | ask for pump flow (gpm) and evaporator load (tons) with the refrigerant, in field units, instead of kg/s, kw, kj/kg or outlet vapor quality, which i c | treat the designation as a frick overfeed evaporator, not a compressor, and ask for its design recirculation rate from the frick selection/submittal ( |  |
| 4 | CC-009 | show where the 0.80 bottom-feed fill comes from (iiar table or oem) next to the 530.6 lb, since the whole figure rests on it. | n/a | the 530.6 lb answer assumes refrigerant, liquid fill and an evaporating condition before resolving conflicting field readings. |
| 5 | CC-027 | ask which stage the 20 f was read in; 2-stage units usually read higher subcooling in low stage, so compare it to the chart target for the charging st | calls 20 f high/overcharge without asking whether the two-stage unit was in high stage or checking superheat, and its note wrongly lists a starving tx | an invented 10 f target cannot establish whether this unit's 20 f subcooling is abnormal or diagnose its cause. |
| 6 | C-016 | when no expected confirmer is recorded, show 'unassigned' instead of naming the owner, so the label never states an expectation the record does not ho | with no expected confirmer recorded, show 'unassigned - no confirmer recorded' rather than naming the owner as the confirmer. | naming the owner without evidence can falsely identify who is expected to confirm. |
| 9 | CC-013 | n/a | correct the 'typical hvac meters read rh over ice' claim: meters and weather data give rh over water, so a meter reading means a -18.3 f frost point,  | assuming a field meter reports rh over ice can give the wrong dew point; establish its rh basis first. |
| 10 | C-006 | ask the equipment class before giving any figure, instead of leading with 494 g for an unspecified 'system' (household and older units at 150 g, and r | n/a | defaulting an unidentified propane system to a 494 g allowance is unsafe; its nameplate charge and applicable listing must govern. |

## Forecasts scored (registered before any verdict was read; `receipt/notes.md`)

| Forecast | p | Outcome | Brier |
|---|---|---|---|
| P(inter-oracle exact agreement on hc-01 >= 6/10) = 0.5 | 0.5 | 1 | 0.25 |
| P(both Claude oracles catch the persona-rejected item) = 0.7 | 0.7 | 1 | 0.09 |

Mean Brier 0.170 over 2 forecasts (0 is perfect; 0.25 is coin-flipping).

## What this does and does not establish

- Established (agent-corroborated, n = 10): the loop-0 persona proxy is not contradicted on the clean/not-clean split by three blind raters on two model families; the one capability the persona rejected (CC-011) is rejected by all three; no rater called clean anything the persona had rejected.
- Not established: that any person would use these capabilities (no human verdict exists); that the panel would agree on a fresh set (n = 10; intervals above); that the three-level scale is reliable across families (cross-family exact agreement 4–5/10 against 6/10 within Claude).
- For loop 1: (1) use the strict or the median panel-clean rule as the primary metric; both were unanimous here; (2) keep a cross-family oracle on the panel, and raise Codex's reasoning effort (`-c model_reasoning_effort="high"`) in the canary dry-run, since 645 reasoning tokens in 41 s is a shallower read than the Claude raters' 12–17 minutes, though its reasons were specific (the propane default called unsafe; the invented 10 F subcooling target); (3) count `promoted-pending-change` as unresolved, not as promoted (D-02); (4) canary sheets must carry the triggering call: the CC-009 range-guard defect was not visible from its sheet and no rater named it.

## Correction (2026-10-18)

The sentence "every rater, on either model family, finds exactly the same 3 of ten clean" is wrong. Only the panel rules agree: the median and the strict rule both give CC-014, CC-025 and CC-036. Individually the raters called 4 (oracle-sonnet: items 2, 3, 7, 9), 5 (oracle-opus: 2, 3, 4, 7, 10) and 4 (oracle-codex: 1, 2, 3, 7) clean. Found by the independent Codex audit (`docs/audits/AUDIT-2026-10-18-codex.md`, item 8).
