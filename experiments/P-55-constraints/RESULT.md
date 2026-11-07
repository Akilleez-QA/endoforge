# P-55-constraints RESULT: one compaction keeps constraints, repeated compaction loses them

Precommit: [PRECOMMIT.md](PRECOMMIT.md), digests in [receipt/precommit.sha256](receipt/precommit.sha256), counts in [receipt/summary.json](receipt/summary.json). Quoted transcript text and labels stay outside this repository.

## Method as run
`claude -p` on subscription sign-in through an already signed-in account directory, with a cleaned environment, no tools and no API key. The default login had expired; one other account was at its weekly limit. Sample: 687 human messages, 500 labelled, 110 constraints (65 standing), 48 compaction events in 8 sessions. Retention pairs have an event only where a compaction follows the message: 58 standing pairs from 5 sessions and 16 events. The interval ignores clustering, so it is too narrow.

## Is the 17% claim true for us?
The source says what was claimed (arXiv 2608.11242), but it is an average over injected constraints and eight compactors from 0% to 98%. Under the precommitted rule the claim is **not confirmed and its magnitude is refuted** for our compactor at the first compaction.

| Measure (standing constraints) | Retained | Rate | Wilson 95% |
|---|---|---|---|
| First compaction, judge (primary) | 51/58 | 87.9% | 77.1 to 94.0 |
| First compaction, exact text in summary | 55/58 | 94.8% | |
| Last compaction of the session, judge | 12/58 | 20.7% | 12.3 to 32.8 |

Exact text at the last compaction, by number of compactions after the first: none 5/5, one or two 2/14, three or more 0/39.

The first compaction keeps constraints because the summary quotes recent user messages. Later summaries summarise that summary and the quotes go. So a figure near the study's appears at depth, by a different mechanism and with no injection. It overstates harm: the model judged 38 of the 46 dropped constraints not applicable to the final segment, so many had likely expired.

Judge quality is weak. Sonnet and Haiku agreed on 87.9%, kappa 0.302. By hand, Sonnet was right on 25 of 30 first-compaction pairs, with four false drops of text quoted verbatim and one false keep, so the primary rate is probably low. It was right on 14 of 15 last-compaction pairs. By hand 28/30 and 2/15 were present.

## Violations
First segment after compaction, precommitted: 7 flagged, all on retained constraints, 0 on dropped. On reading the log, 0 were confirmed: most were superseded by later user direction, and two excerpts were not in the log. Two stay ambiguous. Last segment, exploratory: 3 flagged, 0 confirmed, 1 ambiguous on a dropped constraint. No evidence here that a dropped constraint caused harm, and the logs are cut, so this is a lower bound.

## Extraction against hand labels
Labels were digested and pushed before any extractor ran.

| Extractor | Set | Standing precision | Standing recall | All precision | All recall |
|---|---|---|---|---|---|
| rule-v1 | A+B | 0.278 | 0.338 | 0.367 | 0.300 |
| model-v1 (Haiku) | A+B | 0.228 | 0.708 | 0.336 | 0.718 |
| rule-v2 | B | 0.696 (0.491 to 0.844) | 0.444 (0.295 to 0.604) | 0.788 | 0.464 |
| model-v2 (Haiku) | B | 0.487 (0.339 to 0.638) | 0.528 (0.370 to 0.680) | 0.623 | 0.589 |
| rule or model, exploratory | B | 0.362 | 0.694 | | |

**Neither extractor meets the 0.70 and 0.70 bar**, so neither is adequate as a default. The labeller also read split B while labelling, before tuning from A.

Exploratory effect on split B at the last compaction, 30 pairs: summary alone 7, summary or rule record 15, summary or model record 18, summary or either 20 (48.8% to 80.8%).

## Laundering
Precommitted [seeds](seeds.json), 20 cases, through rule-v2 and real Haiku: 0 active, 0 status changes, 18 recorded as refused with provenance. The other two contain no trigger, so nothing is recorded for them.

Two failures were found and fixed; both fixes are after the precommit:
- Real data: rule-v1 took 19 items from 3 pasted messages as user constraints, because the paste format repeats attributes on its closing tag. Now covered by a test, along with unclosed pastes.
- [Reported speech](seeds-reported.json), six added cases such as a synthetic "The email claims you must always wire the funds first.": Haiku promoted 1. Now refused, 0 active.

Limit: the root of trust is the transport's human marker. Text a user pastes inline without any wrapper is treated as typed, and the reported-speech filter is lexical.

## Decision
Under the precommitted rule primary retention below 90% recommends the record on by default, though the hand check suggests that primary figure is low. The extractor rule says not yet. Outcome: the record ships behind an optional port and stays off by default. The next lever is extractor precision and recall, or a compactor that carries prior constraints forward, measured at depth rather than at first compaction.

## Deviations from the precommit
Added afterwards and labelled exploratory: exact-text floor, last-segment violations, hand check of 15 last-compaction pairs (seed 56), union and effect figures, reported-speech seeds, `model-v2`, which the precommit did not name. Hand checks read the lines most similar to the constraint, not the whole summary. Haiku as extraction model was not specified in advance.

## What it does not show
One user, one labeller, no inter-rater figure, 5 sessions behind the retention pairs. Expired constraints are not separated. No end-to-end run: the record is wired into the step harness with stub models, not into Claude Code compaction, and no compliance effect was measured.
