# Next-50 execution — 18 October 2026

The controlled local runner now passes with **Codex + local Qwen**. Claude Code CLI is disabled. [Run one manifest](../../tools/factory_campaign/README.md), inspect [the live CLI receipt](control/cli-qualification-summary.json), or read [the comparison decision](DECISION.md).

The frozen comparison completed 6/6 A/A executions, 3/3 development requests per arm and 2/2 synthetic holdouts per arm, with fresh holdout agent consumers. It found no completion improvement; keep the incumbent. One holdout writer arithmetic error was independently resolved before generation, with original outputs and raw disagreement preserved. Resolver wiring and finalization recovery are explicit protocol implementation deviations.

An encrypted actual partly completed campaign checkpoint resumed its pending offline consumer stage on the distinct fieldops host with matching module/publication hashes and idempotent reuse. No credentials or model weights moved, and no remote model authentication was needed for that pending stage.

## Evidence

- `control/`: baseline, policy amendments, budgets, manifests, qualification packets, decision and dependency-aware item statuses.
- `quality/`: typed contracts, references, executable evals, mutation/canary controls and actual two-family development qualification.
- `runtime/`: owned attempts, fences, fault recovery, CPU/memory/process/output bounds and hosted/local provider routes.
- `portability/`: authenticated encrypted archives, pinned toolchain bootstrap and actual second-host stage resume.
- `measurements/`: reviewable generated artifacts, frozen suites, model metadata, A/A/paired/holdout results and original failed holdout writer outputs.
- `audit/`: independent decision review, historical criterion inventories, exact semantic/interface counterexamples and source identity checks.
- `work/`: private raw stage payloads and immutable attempts, ignored by Git.

The original 50-item acceptance ledger remains explicit. The independent audit is complete:42 items qualify, six are implemented but dependency-unqualified, and historical conversion/replay remain partial. Source-line coverage is81 executable and620 applicable uncovered; a few numeric checks do not establish full legacy request validity. No historical sealed request is relabelled fresh. No application merge, deployment or whole-stack quality improvement is claimed.
