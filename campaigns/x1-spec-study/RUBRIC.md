# X1 classification rubric (C01 §5, frozen at `x1 freeze`)

This rubric is hashed into `receipt/freeze.json`. Changing it after the freeze invalidates the study; `x1 verify` will fail.

## Inclusion (decided before collection)

A request is in scope when all of these hold:

1. A person actually asked for it, in their own words, while doing their work (Field OS users or the author's own work). Requests written to fit the study are excluded.
2. It is at the "too small for a project" scale: the requester would not open a ticket, hire a developer or buy software for it, but would use the capability if it existed [E3 §1].
3. It asks for behaviour (a calculation, comparison, transformation, check, view with logic, export rule), not for information the requester could look up.
4. It is recorded on `templates/REQUEST.md` with the authoritative inputs the requester named, before any contract is attempted.

Record every excluded request and the rule that excluded it in `receipt/excluded.md` (ids only, no content).

## Rater 1: the specifier

Rater 1 writes the acceptance contract on `templates/CONTRACT.md` with the timer running (`x1 start … stop`). Working time is the sum of running intervals; pause for interruptions. No model assistance. Domain knowledge is allowed. The requester may not be consulted during the timed interval; if the contract cannot be written without asking, stop the timer, mark the request underdetermined, and record what would have to be asked.

After stopping, rater 1 classifies (`x1 classify <id> --rater 1 …`):

| Field | Rule |
|---|---|
| `--complete y\|n` | **y** only when the contract names all five: (1) the observable the requester will judge; (2) the authoritative inputs and which one wins on conflict; (3) at least one executable acceptance test per required behaviour, concrete enough that a second person could run it by hand on an example; (4) what a failure means (wrong answer, refusal, or ask); (5) the effects permitted, if any. Missing any one → **n**. |
| `--composable y\|n` | **y** when every required behaviour could be met by composing capabilities that already exist in the host (Field OS or the library) with at most binding and parameter changes, as judged from the contract, whether or not the composition is built. |
| `--residual N` | The number of acceptance assertions in the contract that are specific to this request (not universal gates, not domain invariants already in the invariant list). Count the assertions, not the sentences. |
| `--underdetermined y\|n` | **y** when a required behaviour cannot be fixed without a fact the request and its named inputs do not contain (unit basis, tie-break, missing-value rule, ownership). Record the question that would resolve it in the contract's "Open" section. |
| `--shape structural\|parametric` | **structural** when the residual needs a program shape that no other request in the pool shares (a new kind of join, state machine, or algorithm); **parametric** when it is a shape already seen in the pool with different constants, fields, units or bindings. Rater 1 assigns this after all 20 contracts exist, in one pass. |
| `--cluster <label>` | A short label naming the shape (for example `unit-join`, `threshold-alert`, `export-rule`). Requests that would reuse one another's contract skeleton get the same label. Assigned in the same pass as shape. |

The primary metric counts a request as **specifiable** when `complete` is **y** and working time is ≤ 600 s. The 1,800 s cap stops the timer; a capped request is complete only if the contract was complete at the cap.

## Rater 2: the blind classifier

Rater 2 receives `work/blind/` (the request and the contract for the seeded half) and nothing else: no timings, no rater-1 classifications, no conversation with rater 1 about the items. Rater 2 classifies the same fields with `--rater 2`. Cohen's κ is computed on `complete`; disagreements on any field are listed in `receipt/summary.json` and adjudicated by a third person, whose verdicts are a sensitivity analysis, not the primary.

## What this rubric does not decide

Whether the contract is *correct* (that is C02's question), whether a capability built against it would help (rung 4), or anything about synthesized evaluators. It decides only whether a person could write a checkable contract in the time allowed.
