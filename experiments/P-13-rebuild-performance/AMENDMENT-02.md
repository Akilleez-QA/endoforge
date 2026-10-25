# P-13 attempt 02 — setup network amendment

**Proposed, before attempt 02 measurements, 18 October 2026.** Attempt 01 failed during `npm ci` before any dependency comparison, replay or timing. Docker's default bridge endpoint could not attach because `docker0` does not exist. Original scripts, precommit, setup failure and work are preserved under `attempts/01/`.

Use explicit `docker build --network=host` for the trusted npm dependency setup only. No credentials or agent code are supplied to that step. Do not repair or modify the host daemon/network. All measured workloads remain offline under the original P-13 rules. Attempts get separate paths; refusal to rerun an existing attempt happens before any writes. This is a setup correction, not a change to acceptance criteria. Archive-only source recovery remains P-11's separate responsibility.
