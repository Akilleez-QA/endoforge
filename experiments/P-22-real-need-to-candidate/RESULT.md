# P-22 status: real measurement pending

No real Codex measurement was run in the implementation sandbox. The harness
and local qualification decision issuer are implemented. POODO is an instruction
package without an intake/approval API; the issuer is in EndoForge and exposes the
interface that POODO can call. It grants local qualification only, not activation.

The first sandbox smoke run completed all 60 records and promoted 60/60 using
explicitly labelled Codex and compiler test doubles. The two twenty-request and
two ten-addition cohorts each ran at concurrency ten. No warmups, retries or
exclusions were used. Generated files and receipts remained outside the checkout.
Fake latency is not a measurement of synthesis and is deliberately not tabulated.

`make pipeline-test` passed locally, including both thread/process promotion,
actual failing glue, wrong receipt hash, all seven individually failed gate
verdicts in otherwise passing-shaped evidence, and corrupted hash-chain refusal.
Full suite results are recorded in the verification matrix. The real measurement
must preserve all failures and report stage sample counts and promotion counts,
as fixed by the precommit. The README gives the command; no real outcome is claimed.

A second fake run also read all twenty actual need-file locations and completed
60/60. Real AssemblyScript 0.28.20 with the fake generator promoted in both modes.
`make isolate-test` passed; normal/optimized full-suite attempts timed out at the
unchanged evaluator tests (exit 124). No full-suite pass is claimed.
