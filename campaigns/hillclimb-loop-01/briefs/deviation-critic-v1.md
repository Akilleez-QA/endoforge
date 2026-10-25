# Deviation critic for loop 1 of the Endoforge factory hill-climb, v1

You are a fresh, independent critic from a different model family than the one that wrote the specification. You will not run any experiment; you propose what the loop should try. Read the files in your working directory (they are everything you may use):

- `SPEC-Endoforge-Edition-3.txt`: the specification (treat it as the incumbent hypothesis, not as law).
- `EDITION-3-ERRATA.md`: known inconsistencies in the spec.
- `HILLCLIMB-METHOD.md`: the method of the loop, including the seven seed deviations D-01 to D-07 and the honesty rules.
- `factory-README.md`: the factory protocol as run in loop 0.
- `LESSONS-LOG.md`: operational lessons L-01 to L-16.
- `loop0-factory-summary.json`, `loop0-persona-review-summary.md`, `loop0-hc-01-RESULT.md`, `loop0-freeze.json`: what loop 0 produced and how it was judged.
- `P-04b-RESULT.md`: measured model-turn costs through the subscription CLI.
- `LOOP1-DESIGN-DRAFT.md`: what the loop-1 session intends to run, with its budget.

## Your task

Propose **at least seven materially distinct deviations from the specification** (the seven seeds D-01 to D-07 are candidates you may keep, sharpen, merge or reject; add at least three of your own that the seeds miss). For each deviation give, in this order:

1. **Id and title.**
2. **What the spec says** (cite the section or the protocol line).
3. **What the data says** (cite the loop-0 receipt, lesson or probe; quote the number).
4. **The change**, stated as something a program or a brief can implement.
5. **Predicted effect on the objective** (clean promotion on fresh real requests as judged by a sealed consumer panel, per total cost), with a direction, a size in points of 20 requests, and your probability that it moves the metric by at least that much.
6. **Cost** in model turns or tokens per request, relative to the design draft.
7. **One-loop test**: how loop 1 could test it as an arm or a factor with 20 requests and three sealed oracles, and what result would count as a win against the noise floor (two identical runs of 20 differ by 20 points 23 % of the time).

Then **rank all proposals by expected gain per cost** and state which one you would put into loop 1 if only one fits the budget, and why. Finally, in a section called **Blind spots**, name what you think the specification and the design draft get wrong that no deviation above fixes.

Write it as Markdown. Be specific and quantitative; prefer a sharp claim you could be wrong about to a safe generality. Do not propose anything that lets the agents being optimised read the oracle, the sealed set or the canaries, or that adopts on a score those agents can read; those are the fixed honesty rules.
