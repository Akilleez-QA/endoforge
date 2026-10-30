# EF-04 notes

Scope: WP03 Main-rig inventory and WP01 noise/quiet-gate subset, authorized by the user's EF-04 worker packet. All files belong to this worker; no fan-out, paid generation, system configuration changes, or isolation stress tests.

Sources: `docs/execution/WORK-PACKAGES.md` WP01(e), WP03(a–d), and `docs/templates/HARDWARE-QUALIFICATION.md`. The jobs board has no hardware-specific job; this packet supplies direct demand for measurement infrastructure.

Reuse reviewed: isolate-factory-lab `tools/env-control/lib/gate.mjs` and `noise-baseline` (read-only source). Preserve predeclared thresholds, gate refusal evidence, pinned/unpinned samples, CV and p95/median. Do not run the old checkout. This smaller probe uses Python kernels and cannot substitute for C1–C7 or sustained thermal qualification.

Findings: Git metadata is outside the writable worktree; fetch/rebase cannot write locks. Cost: one failed synchronization attempt. Publication remains blocked by the environment, not by code. Python jsonschema and gitleaks are absent. Use a stdlib declarative record schema and validate its exact field types without adding dependencies.

Critical path: schema → bounded read-only collection → validator and mutation tests → publication. Qualification is limited to inventory and diagnostic jitter: controller visibility or configured limits never prove isolation enforcement.

Iteration 1: seven validator tests passed; real read-only collection completed with both quiet gates passing and 120 samples. First test-file write used a root-relative path from the area folder and failed before writing (one failed test invocation); corrected to area-relative paths. Version probing found `systemd` is not on PATH; use the installed `systemctl --version` interface. The first receipt is retained unchanged; recollect after the collector fix. The validator now rejects nonpositive capacities and source changes before reuse.

Final review: failed records must remain inspectable but cannot pass current-environment admission; added that refusal and its regression check. Recollected into receipt-current without changing earlier evidence. Eight tests pass, 120 current samples completed, both current quiet gates passed. make check: zero failures, 12 existing warnings. Staging is blocked: index.lock is on a read-only filesystem. No commit, push or PR was attempted after staging failed. Remaining gap: the packet has no coordinator JOB/card receipt; the direct worker request supplied execution authority, and no fan-out was launched.
