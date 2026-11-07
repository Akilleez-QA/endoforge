# Escape-rate harness

`seeded(known_good, domain=..., task=..., anchor_id=..., inputs=..., faults=..., seed=...)` calls [seeded_faults](../seeded_faults/README.md) and keeps its provenance and distinguishing witnesses.

`run(candidates, evaluate, current_digest, frozen_digest=..., checks=[...], lane="interim" or "kernel", candidate_format=..., seed=...)` submits non-equivalent faults in seeded random order. `evaluate` receives a copy of each candidate and returns `results` as `[{check, passed}, ...]` and an explicit boolean `promoted`. Rejections may stop at a failing prefix, and promotions need every configured check to pass. Passing checks alone doesn't imply promotion. Unknown outcomes and malformed evidence abort; they never count as catches. Reports stay separate per domain and stratum.

For search, supply `propose(generation, width, feedback)`, `oracle(candidate)`, a width of 1, 4 or 16, and positive rounds. Feedback holds the candidate, check results and promotion only. Oracle labels never reach it, and non-faults stay out of the fault denominator.

`current_digest` must measure the whole evaluator bundle, and it must match the precommitted SHA-256 before and after each callback and at completion. Bounds in `stats.py` are binomial diagnostics, not evidence of independence or a tier.

Execution is serial and refuses more than 100,000 submissions. Callbacks are trusted and must terminate and limit their own resources. This is not a sandbox, and no campaign rate or tier is claimed. The tests replay `experiments/P-03-escape-rate-method/receipt/`, which holds only the two files they read. Run `make escape-test`.
