# Next-50 execution controls

**Proposed, 18 October 2026; frozen before this run's model measurements.** This executes the N01–N50 backlog under its original acceptance conditions. Implementation may advance in parallel, but dependency-gated items are not declared qualified before their prerequisites pass.

## Scope and stop rules

- All model use is through existing subscription CLIs. No API key, paid provider substitution, production deployment, application merge or global Docker/network reconfiguration.
- Global model-turn ceiling: 60. Soft token budget 750,000; hard ceiling 1,500,000 reported input+output tokens including separately reported cache reads/creation when not already included by a provider. Usage semantics differ by CLI; retain raw values and avoid double-counting known totals. List-price estimates are not bills. Quality lane reserves at most 12 turns, network qualification 2, integration/comparison/consumers the remaining turns.
- Max model concurrency 2, per-turn wall deadline 180 seconds, bounded retries at most one on protocol/transient errors. Limit responses are not quality failures: retain state, back off and stop bounded execution if the subscription window remains unavailable. Never switch to API billing.
- Do not alter P-09–P-13 receipts, frozen candidates or application repositories. New attempts get new IDs/directories, and failures remain visible.
- Respect N20 (eval qualification) and N42 (whole-runner qualification) before broad new model runs. The small development qualification packet is allowed to establish those gates. Frozen old artefact replays do not count as new generation.
- No claim of all 50 completion without individual acceptance evidence. If a dependency or external facility is unavailable, mark blocked with evidence and continue independent work. Do not substitute same-host isolation for a different-host restore.

## Outcomes and denominators (N10)

Every request receives a terminal category: completed-valid, failed-eval, failed-runtime, underdetermined, unsupported, subscription-deferred or evidence-invalid. Full-request completion denominator is all assigned requests, with unsupported/underdetermined reported separately rather than discarded. Artefact pass rate denominator is routed, executable candidates; report both numerator and failures before/after repair. Reuse and generation are separate paths.

Measure task completion from actual returned values/refusals and executable request assertions, not a post-hoc model grade. Track clarifications (new required input), retries, valid frozen-eval challenges, mutation failures, canary recall, known-good false rejection, stage wall time, tokens, maximum configured and observed resources, and cleanup outcomes. A model saying success is not a verifier receipt.

## Experimental boundaries

This document freezes execution safety/measurement rules, not the later comparative design. N45 will separately freeze arms, request allocation, thresholds, forecasts and a genuinely unexposed holdout before N46–N48. Independently generated synthetic holdout can qualify a synthetic-domain claim only; it is not fresh evidence about real refrigeration requests. Previously sealed historical data remains development/exposed.

The bounded comparison may end with no evidence rather than an adopted improvement. An unsupported request remains a counted stratum. Cross-host recovery, no-LAN model egress and power-loss durability each require their own evidence, not inference from a passing local computation.
