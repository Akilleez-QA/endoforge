# Recorded pre-freeze resolution implementation deviation

The first holdout freeze rejected a Qwen example-table arithmetic error. Original writer outputs, failed bundle and attempted freeze are retained. No holdout generator had started; arms, prompts, requests, domains and tolerances remain frozen. The independent holdout reference was sealed before either writer ran.

N13 already specifies independent disagreement resolution. Its source-backed resolver existed but the new batch orchestration had not called it. Wiring that resolver after observing this error is an implementation deviation, recorded here before proceeding. It is not an untouched-protocol claim.

General rule for both holdout requests: validate every procedural and explicit value against the sealed reference and every refusal against the typed finite domain. Any wrong procedure, domain/unit change, unresolvable conflict or missing independent source remains a failed-eval outcome. A wrong explicit value may be resolved only if a conflicting writer value uniquely agrees with the sealed reference through the existing provider resolver. Preserve the original; create a new resolved eval version and source/evidence record before generation. Do not rerun writers, change model prompts, adjust tolerances or pass candidate code into resolution. Both frozen arms use identical resolved suites.

Report raw writer disagreement separately from resolved validity. This incident constrains generalization and adoption claims even if final generated candidates pass. No production adoption follows this tiny synthetic experiment.
