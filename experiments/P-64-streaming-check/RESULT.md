# P-64 working while the model writes: result

Status: **Recorded (probe)**, 2026-11-07, 18:05–19:45 EST, Claude Code 2.1.319, Node v26.13.0, `sonnet` at `low` effort, one subscription account. Precommit: [PRECOMMIT.md](PRECOMMIT.md), hash chain in [receipt/precommit.sha256](receipt/precommit.sha256) (`78fc4ca4…` original, `eb7f49f6…` amendment 1, which every replay checked).

**The strongest rival holds: the tail after the model's last token was 1.6% of candidate latency at p50 before any change, so streaming can't move end-to-end latency much. Starting the check while the reply streams cut the tail by 61% on H and 70% on the P-57 workload, and end-to-end latency by 1.1% and 0.45%. Bar 2 (15%) is missed, as predicted. Early refusal works, with zero false refusals: it stopped 4 of 9 failing H turns and all 127 failing seeded mutants before the model finished, about 3 s and 760 output tokens earlier each. Speculation stayed inside its waste budget and gained nothing: in every hedged run either the current path won or neither path passed.**

Two facts from the diagnostic decide what is possible:

- **On today's transport the code doesn't stream.** The reply is the input of the CLI's `StructuredOutput` tool. Without fine-grained tool streaming, the whole input arrives in the last 5–11 ms of the turn, so nothing can act on it early.
- **`CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1` makes the code stream.** This is a CLI environment setting, not a credential. With it, `kernel.ts` closed 2.8 s before the last token at p50 (33 implementation turns; 3.6 s at p95), because the model writes the kernel before the glue. Every result below depends on this setting.

## Bars

| Bar | Result | Value |
|---|---|---|
| 1 Tail drops ≥ 50% at p50 | **Met** | Per candidate: H 474 → 185 ms (−61%); P-57 workload 304 → 91 ms (−70%). Unloaded runs only: H 313 → 137 ms (−56%, 12 runs); P-57 284 → 85 ms (−70%, 57 candidates). Per turn: 55 → 20 ms on H, 60 → 18 ms on P-57. |
| 2 End-to-end latency drops ≥ 15% at p50 | **Missed** | H 26.86 → 26.55 s (−1.1%); P-57 workload 55.04 → 54.79 s (−0.45%). Before the change the tail was 1.6% (H) and 0.5% (P-57) of latency at p50. |
| 3 Zero verdict differences | **Met** | Replayed loop verdicts matched the recording in 30 of 30 runs. Streaming and non-streaming check verdicts matched on all 69 checked H turns. Request digests mismatched only after a failed check, as amendment 1 allows. P-57: 105 of 105 matched the corpus expectation, with 0 differences over 225 turns. Seeded: 0 differences over 140 mutants. False refusals: 0 of 4 on H; 0 of 127 seeded, and none of the 13 mutants that passed (equivalent mutants) was refused. All 4 cancelled or losing hedge attempts are in the receipt. |
| 4 (b) early refusal | **Reported** | H: 4 of 9 failing turns (44%) refused before the last token, saving 2.6–3.5 s each (p50 3.0 s, 21% of the turn) and about 780 output tokens at p50, 4,525 in total. The 5 turns not refused are H08-r2's later turns, which didn't edit `kernel.ts`. Seeded: 127 of 127 failing mutants (100%) refused early, every operator at 100%, saving p50 2.79 s (34% of the turn; range 1.5–3.7 s) and about 760 tokens at p50, 109,000 in total. |
| 5 (c) waste ≤ 0.25 per useful model-second | **Met, with no gain** | Fail-triggered hedge: 72.8 s wasted against 752.8 s useful, 0.097. It fired in 4 runs. In the 3 H05 runs the current path's repair passed 12–14 s before the hedge would have, because the fresh attempt also failed its first implementation turn and needed a repair. In H08-r2 neither path passed (the hedge ended `inconclusive` at the call limit). Failing-run latency was unchanged. Always-hedge, a lower bound counted only from the current turn's first output: 0.249. |

## Measures

Receipts: [analysis](receipt/replay/analysis.json), replay rows ([H](receipt/replay/h-rows.jsonl.gz), [seeded](receipt/replay/seeded-rows.jsonl.gz), [P-57](receipt/replay/p57-rows.jsonl.gz)), recorded streams ([main](receipt/record/streams.jsonl.gz), [hedges](receipt/record/hedge-streams.jsonl.gz)), [recording rows](receipt/record/rows.jsonl), [calls](receipt/record/calls.json), [auth checks](receipt/record/auth.jsonl), [diagnostic](receipt/diagnostic/).

Per turn on H, from the 70 replayed turns (p50 / p95, ms):

- Last token to the `result` event: 17.5 / 27.
- Last token to process exit: 39.8 / 59.5.
- Non-streaming check after exit (worker, compile from scratch, implementation turns only): 199 / 343.
- Tail before: 55 / 365.
- Tail after: 20 / 41. Most of what remains is the wait for the `result` event, since the check finishes inside the 2.8 s gap between the kernel closing and the glue closing.

Per candidate, about 126 ms at p50 doesn't depend on streaming: freeze, the final residual gates and the commit, plus the job crossings, estimated as the loop's non-model time minus the per-turn checks. It is identical in both columns and is most of the "after" figure. The loop's own measured tail (its non-model time plus the exit lag) matched the harness's "before" at p50 on H (474 ms) and on P-57 (304 ms).

## Predictions

1. Tail before 90–250 ms per turn: **failed**, 55 ms. Spec turns and turns with no edits have almost no check, which pulls the median down; implementation turns with a fresh compile were 199 ms. Tail after 5–40 ms: **held**, 20 ms. Candidate tail −50 to −80%: **held**, −61% and −70%.
2. End-to-end −0.3 to −2%: **held**, −1.1% and −0.45%.
3. Zero verdict differences and false refusals: **held**. No reply edited `kernel.ts` twice.
4. (b) 40–85% of failing H turns: **held**, 44%. Saving 1–3 s per refused turn: **failed** by a hair, p50 3.0 s (3,006 ms). Seeded 70–95% (amendment 1): **failed** high, 100%. Every seeded operator breaks a glue-independent gate (tests, compile, exports, non-finite probe) in a kernel that is complete before the glue. End-to-end p50 gain from (b) under 1%: **held**, 0, since the p50 run has no failing turn.
5. Fail-triggered waste 0.02–0.25: **held**, 0.097. Gain under 5% on failing runs and 0 at p50: **held**, 0 on both. Always-hedge waste 0.7–1.0: **failed**, 0.25 as a lower bound. 30 of the 39 implementation turns passed, and a cancelled hedge costs only the time from first output to exit, not the specification turn or the thinking before it.
6. Calls under 180: **held**, 91 (9 diagnostic, 70 recording, 12 hedge). Recording 60–110: **held**, 70. Hedges 10–50: **held**, 12.

## Decision, as fixed

- **(a)**: bar 1 met and bar 2 missed. The tail is gone, but it was never the span. The transport change behind it (fine-grained tool streaming, and reading the `result` event instead of waiting for exit) is a cheap follow-up and isn't adopted here. Reading `result` alone saves about 20 ms per turn without any streaming.
- **(b)**: recommended as a follow-up loop change. It refused at least 40% of failing turns (44% H, 100% seeded) with zero false refusals, saving at least 1 s each (about 3 s). The replay doesn't show what the next live turn does with a truncated reply in its conversation; that needs its own precommit. A refinement seen in H08-r2, not retuned here: a turn that doesn't edit `kernel.ts` keeps a kernel already known to fail, so it could be refused at its first tool token.
- **(c)**: not recommended. It met the budget but gained no latency on this workload.

## Strongest rival

"The tail after the last token is already small after P-57/P-59/P-60, so streaming buys little; the model's own generation is the span." **Discriminated, and it holds.** The tail was measured before any change, at 1.6% of latency on H (p50) and 0.5% on the P-57 workload. Removing 60–70% of it moved end-to-end latency by 1.1% and 0.45%. The only levers that save seconds act on what the model is still writing, not on the work after it: stopping a doomed call (b) saves about 3 s per failing turn. As P-56 found, most failures came from frozen tests (G4) or contract probes (G8) that no repair or fresh attempt can fix quickly. That is why the hedge didn't help.

## What this does not show

- **Loaded runs.** 18 of 30 H replay runs and 48 of 105 P-57 candidates ran above load 16 from other lanes' work. Unloaded-only figures are in the bar 1 row and agree within a few points. The seeded arm had none above 16. The recording ran at load 8–16.
- **Streaming effect on generation speed.** Whether fine-grained tool streaming changes the model's speed isn't measured. Every recording used it; the non-streaming path in the replay reads the same streams at exit.
- **The P-57 workload's streams are synthesized** from recorded H profiles with the scripted replies as text. The profiles made turns longer than P-57's 2–4 s stubs, which makes the tail's share smaller.
- **The pre-checker is a worker thread** with the pinned compiler and the same `runGates`, not the workcell. Its compile time stands in for the cell's.
- **The hedge's specification turns were replayed** instantly from the recording, so its model time is the implementation path only. Four hedged runs is a small sample.
- **Seeded faults are five simple operators**, not P-51's corpus.
- **One account, one model, one day.** `claude -p` was spawned per turn, not a warm lane. A killed call's token accounting isn't tested, since no live call was stopped early.
- **Commits.** The H replay ran at `c8b7a88`. The seeded and P-57 arms ran at `50c23b3`, after `origin/main` (#109, #110) was merged; the merge didn't touch the loop's turn path.
