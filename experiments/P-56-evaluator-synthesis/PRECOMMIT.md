# P-56 evaluator synthesis: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any synthesized evaluator has judged a mutant. This is a probe and decides nothing under DEC-64. Design: [evaluator-synthesis.md](../../docs/architecture/evaluator-synthesis.md).

## Question

If every task gets an evaluator synthesized before its kernel exists (a need sheet from the need alone, a binding from that sheet and the frozen contract, reusable invariants, host-generated vectors, fixed meta-gates M1 to M5), how far do the escapes P-52 left fall, and does every pristine kernel still promote?

## Inputs

- Corpus: P-51's 177 promoted kernels (`cand-r1` to `cand-r6` of P-42), its `prep` rows (`mutants.jsonl`, `baselines.json`) unchanged, and P-51's harness (`experiments/P-51-escape-rate/` from `origin/escape-rate-probe`) copied unmodified into the run tree. The need for each kernel is the admitted input in its own P-42 ledger.
- Model: `claude -p` through `SpawnClaudeTransport`, model `sonnet`, one logged-in subscription account, no API key. Per kernel: two independent need sheets and two bindings (sessions `need-0`, `need-1`, `binding-0`, `binding-1`), 708 calls. One retry per failed call. Replies are recorded once (`record.mjs`) and replayed into the harness by `replay-provider.mjs`, which serves a binding only when its request is byte-identical to the recorded one. Sources and recordings stay outside git, hashes in the receipt.
- Tree: this branch at the commit that adds this file, gates and rules unchanged from `real-gates` 2e996a4.

## Development split

Code and prompts were developed on `cand-r1` pristine kernels only: 29 kernels synthesized and judged, 29 passed at both widths, every export qualified. No mutant row has been judged by a synthesized evaluator. Those dev recordings are discarded; all 177 are recorded afresh for the run. Nothing in `synth/` changes after the first corpus run; a later change would be a new, labelled row with both figures.

## Arms

Each through `node experiments/P-51-escape-rate/run.mjs`, `P51_ARMS=control,sampled,glue`, width 14, thread isolation, `ENDOFORGE_CODEX_TERSE=scalar` as the harness sets, under `HEAVY_SLOTS=4 heavy-run`, started only with load average under 20.

- **S1**: `ENDOFORGE_SYNTH=1`, width 1 (member 0).
- **S2** (headline): `ENDOFORGE_SYNTH=1`, `ENDOFORGE_SYNTH_WIDTH=2`, a check counts only where both members agree.
- **S0** (baseline, same tree, synthesis off): derived from S1's rows, not run separately. A row escapes under S0 if it promoted under S1 or was refused with every gate passing and no ledger decision (`caught: gates_passed_decision_refused`, `decision: null`), which is the synthesized evaluator's refusal and nothing else on this path.

Cross-check: `offline.mjs` builds the same evaluators from the recordings without the pool and judges every row. For rows S0 lets through, its refuse set must equal the pipeline's.

## Measures

Escape counts per arm and cohort, per class and op, with P-51's Clopper-Pearson and bootstrap (`stats.mjs`, unmodified). Pristine promotions. Qualified exports per member, M1 to M5 failures, dropped declarations. Glue checks that couldn't judge for an unknown unit. Model tokens and wall per call, the stage's non-model time per candidate (compile and judge), all with load average recorded and labelled loaded above 16.

## Predictions

| # | Prediction | Failure means |
|---|---|---|
| 1 | S0 matches P-52 run C within 10 rows: about 280 of 7,883 sampled P-21, 295 of 799 glue | The tree moved; S0 is the baseline either way |
| 2 | At least 90% of exports qualified for member 0 | Meta-gates or bindings are weaker than dev suggested |
| 3 | S1 sampled P-21 escapes 50 to 120 | Reference or vectors weaker (above) or stronger (below) than expected |
| 4 | S2 sampled P-21 escapes 55 to 130, and at least S1's | Agreement filtering costs nothing, or more than expected |
| 5 | The 29 non-finite-only escapes stay: synthesis doesn't probe NaN or infinity | Something else sees them |
| 6 | Rounding escapes (107 under P-52) fall to at most 40 in S1 | Non-round vectors don't expose them |
| 7 | S1 glue escapes 80 to 170 of 799; S2 90 to 190 | Unit parsing covers more or less than expected |
| 8 | S1 pristine: at least 172 of 177 promote. S2: at least 175 | Contract ambiguity reaches pristine kernels more than dev showed |
| 9 | Pipeline and offline refuse sets agree on every S0 escape row | The stage behaves differently in the pipeline |
| 10 | Stage non-model time per candidate at most 1.5 s at p50 in S1, loaded | The sandbox and mutation costs more than expected |

## Bar

S2: **177 of 177 pristine promote**, sampled P-21 escapes at most half of S0's, and glue escapes at most half of S0's. All three, or the bar isn't met. A pristine refusal is reported with its reason and not tuned away.

## Not claimed

No searched rate, no tier, no correlated-arm result: the binding reads the same contract as the kernel, so a misread contract is outside this. Seeded faults aren't model faults. The confirmation is the task contract, not a person. Recorded replies are one sample of one model.
