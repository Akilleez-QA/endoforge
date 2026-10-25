# Prior work

Endoforge did not start from nothing. This file points at the earlier work on this machine. None of it is copied here; it stays where it is, and anything reused is brought over deliberately and recorded in a decision (R16).

## Isolate factory lab (14 Oct 2026)

`~/Work/isolate-factory-lab` — the test lab for the original In-Isolate Software Factory design (white paper v1.0). Local repository, no remote. `main` at `a95a4925f2b9899375482432600a5515f090c93f`.

What it contains:

- A zero-dependency Node 26 harness with fail-closed campaign specs, a precommit hash chain, content-addressed receipt sets (`harness/verify-receipts.mjs`), a verified-only report and replication comparison (`Makefile`).
- A frozen evaluator (`evaluator/FROZEN.json`), oracles and ten workloads (`w-check-*`, `w-contain`, `w-exec`, `w-search`, `w-ui`).
- Adapters for checkers (tsc-rs WASM and native, TS7), executors (QuickJS fresh/reused, bwrap, isolated-vm, native function) and a renderer.
- `uihill/`: a generative-UI hill-climbing loop with gates, instruments and a renderer.
- Calibration (C1–C7), conformance, metamorphic, fault-injection and end-to-end tests.
- `docs/PREDICTIONS.md` (pre-registered P1–P12), `docs/END-STATE-AND-TEST-PLAN.md`, and two critiques.

State: its README says "No results yet." Receipts exist only for a smoke run, two noise baselines, an executor QA probe and a containment smoke. The pre-campaign critique's must-fix items (for example M1, M2) are not all resolved on `main`. Six branches are unmerged; the notable ones are `feat/fastloop` (head-to-head table, 15 commits ahead), `feat/measure` (pilot report, 1 of 8 blocks) and `fix/uihill-02`. Worktrees live under `~/Work/isolate-factory-lab-wt/`; the tsc-rs 0.7.0 source and builds are in `~/Work/isolate-factory-lab-cache/`.

Relation to Edition 3: Edition 3 removes the QuickJS nested interpreter and the per-candidate virtual filesystem guest, which much of the lab measures. The campaign machinery, calibration and fault tests carry forward. See R13.

## Field OS Worker Fabric (8 Oct 2026)

The only recorded evidence Edition 3 cites (§14, §18).

- Repository `Akilleez-QA/field-ops`, commit `58d6826b2ac66d7d7ca7edd2f2e1bd869b5abe18` (8 Oct 2026). Local checkouts: `~/Work/field-ops`, `~/Work/field-ops-github-review`, `~/Work/field-ops-fabric-w3w4` (at `d4fa3fa`).
- Spec: `docs/specs/FIELD-OS-WORKER-FABRIC-V1.md`; decision `docs/decisions/0019-supervised-worker-fabric.md`.
- Receipts: `docs/receipts/FIELD-OS-WORKER-FABRIC-V1-DESIGN-RECEIPT.md`, `FIELD-OS-WORKER-FABRIC-W1W2-20261008.md`, `FIELD-OS-WORKER-FABRIC-W3W4-20261008.md` (the W3/W4 receipt is in `field-ops-github-review`).
- Code: `src/fieldops/worker_fabric*.py`, `tools/worker-fabric/`.
- Test-bed run exports: `~/.local/state/fieldops-testbed/runs/`.

## POODO

`~/LOCAL LLM/poodo` — the reasoning and orchestration skill whose precommit record and claim states Edition 3 adopts (§8). Edition 3 treats it as proposer discipline and a receipt schema, never as an evaluator.

## Not available

The Edition 2 engineering library (`05_Engineering_Reference`: R01–R18, 32 work packages, 18 campaign records, coverage map) and the original Mononoke study package were produced in a ChatGPT conversation and are not on this machine. `docs/` reconstructs them; the Mononoke study was redone from source.
