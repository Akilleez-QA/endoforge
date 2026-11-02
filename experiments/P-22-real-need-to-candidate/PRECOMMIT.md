# P-22: real need to candidate, prospective protocol

Written and hashed before harness validation or measurement. No real Codex run
is permitted in the implementation sandbox. Smoke results must be labelled as
test doubles; they cannot answer the synthesis latency question.

Run the twenty P-21 requests in their fixed order: C-015 CC-036 CC-011 CC-014
CC-025 CC-027 C-007 C-019 CC-002 C-016 CC-001 CC-007 C-012 C-005 CC-026
CC-022 C-010 C-006 CC-013 CC-009. Read each from the supplied needs root at
`<id>/atoms/direct/in/need/NEED.md`. Then run ten independently generated copies
of P-19's integer add(a,b) need on [-10,10], including its six exact examples.
Repeat both cohorts in thread and process modes, in that order. Each cohort has
concurrency ten and uses the mode's retained size-ten pool. No warmups, retries,
exclusions or silent substitution. A fresh external output directory is required.

Pipeline: read need, two Codex sessions with durable freeze before implementation,
supervisor AssemblyScript 0.28.20 compile, real pool evaluator/G1–G7, linked ledger
receipt, local EndoForge promotion policy. POODO has no callable approval API;
the local decision interface is for a future POODO caller. Scope is qualification,
not activation, deployment, or autonomous POODO reasoning. Generated tests are not
independent domain oracles. Freeze prevents editing them after implementation.

Record milliseconds for read, generate, freeze, compile, gate, ledger, promote and
total for every run. Gate includes pool queue/startup, evaluator frozen checks and
both evaluation rounds. Ledger includes candidate registration plus pool receipt
preflight/append, including their serialization waits. Freeze includes oracle
admission and durable registration. Promote includes chain replay and decision
persistence. Total also includes intervening orchestration. Timing stages do not
overlap within one request. Retain every failure with unavailable stages null.

Record per-mode/cohort wall time, successful promotions, all per-run verdicts and
nearest-rank p50/p95 of each available stage (with sample counts). Hold the shared
benchmark lock externally. Record runtime/source/precommit identities; keep full
ledgers, candidates and decisions outside the repository. Do not retain client
transcripts or account paths. Success requires 60 completed records and every
promoted candidate backed by both passing evaluation rounds and a verified chain.
There is no precommitted speed threshold; report observed latency and failure
counts regardless of outcome. Fake runs validate wiring only. No real measurement
or comparison with P-19/P-21 may be claimed from those smoke results.
