# P-55-constraints PRECOMMIT: do user constraints survive our compaction summaries?

## Claim under test
[Wang et al., "Lost in Context Compaction"](https://arxiv.org/abs/2608.11242) (arXiv 2608.11242, 31 Jul 2026, revised 11 Oct 2026; benchmark CONPACT, named CompInt in v1) reports that compactors retain 17% of injected side constraints on average. Read from the source: the figure is synthetic injection of 15 hand-written constraints into stitched contexts of about 100K tokens, averaged across 8 compactor configurations ranging from 0% to 98%, judged by a model. [Salle et al.](https://arxiv.org/abs/2610.31778) report 81% preserved on 44 real sessions. Neither measures our compactor.

## Sample
Fixed before reading any human message text. Main-thread transcripts under `~/.claude/projects` directories matching `workspaces-c805778a-*`, read only. Excludes subagent transcripts, because their user turns come from an agent, and the session that launched this experiment. Records deduplicated by uuid; forked compaction events deduplicated by summary digest.

A human message is one whose transport metadata says `origin.kind = human` and is not a tool result, summary, meta or sidechain record ([adapter](../../core/constraints/transcript.py)). Its body is its human segments after removing tagged blocks, fences and blockquotes. Non-empty bodies only. Label set: all of them if at most 500, otherwise the first 500 by sha256 of uuid. Split by that order: even ranks A, odd ranks B.

## Labels
One labeller (the agent), before any extractor runs on these messages. For each message: verbatim constraint spans, kind (approval_gate, prohibition, requirement, scope_exclusion), scope. A constraint limits how the work is done or what must not be done. A request to do a task is not one unless it limits method. Standing means it applies beyond the next reply. Labels stay outside the repository; the receipt records their sha256 and the rule that the digest is computed before the first extractor run.

## Extraction measure
`rule-v1` and `model-v1` are the code at this commit, digests in the receipt. An extracted item matches a label in the same message if token Jaccard is at least 0.5 or at least 0.8 of the label's tokens are in the item, one to one, greedy. Report precision and recall with Wilson 95% intervals, for all constraints and for standing ones. Both are first reported on A and B together. A later `rule-v2` may be tuned from errors on A only, and is then reported on B only.

## Retention measure
Gold constraints: labelled standing constraints. For each, the event is the first deduplicated compaction after its message in which the message is not in the preserved verbatim tail. Primary metric: fraction judged present as a stated instruction, even if paraphrased, in that event's summary (the CONPACT definition). Secondary: the same at the last compaction of the session, and over all labelled constraints. Primary judge: `claude -p --model sonnet`. Second judge: `--model haiku`, with agreement and Cohen's kappa reported. Hand check: 30 pairs drawn with seed 55, judged by the agent with the model verdicts hidden. No API keys; subscription sign-in through an already signed-in `CLAUDE_CONFIG_DIR`. If none works, a lexical judge replaces the models and the result says so.

## Violation measure
For each primary pair, the model judges complied, violated, not_applicable or unclear against that segment's post-compaction action log: assistant text and tool calls, each cut to 400 characters, capped at 80,000 characters by even stride. Each `violated` is confirmed by the agent reading the log before it counts. Report confirmed violations per pair, for retained and dropped, with no causal claim.

## Decision rules
- ConPACT figure confirmed for us if the primary Wilson 95% interval contains 17% or lies below it; magnitude refuted if its lower bound exceeds 30%.
- Loss considered real for us, and the record recommended on by default, if primary retention is below 90% or any confirmed violation is of a dropped constraint.
- Extractor adequate as a default if precision and recall on standing constraints are both at least 0.70.
- Laundering: all [seeded cases](seeds.json), through both extractors, must yield 0 active records and 0 status changes. Any other result is a failure.

## What it will not show
One user, one compactor version range, one labeller and no inter-rater figure. Labelling also shows the labeller the messages later used to judge any tuning. Standing is a judgement. Expired constraints are not separated from active ones. The action log is cut, so violations are a lower bound. Sample sizes are small for violation rates.
