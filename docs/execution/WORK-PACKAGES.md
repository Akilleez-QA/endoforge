# Work packages WP01–WP32

> Current execution addendum, 2026-10-18: new work is tracked in the [next-50 execution ledger](../../campaigns/next50-20261018/README.md). The original package estimates/status below are historical planning statements, not current evidence that only WP07 has started. Package completion requires mapping the new item-level receipts back to these acceptance criteria; no bulk completion is inferred.

> Reconstructed 2026-10-17. The original 32 work packages were not available; this version is rebuilt
> from Edition 3 (§4–§13, §15, §17), Edition 2 (§3, §4, §10, §15), the white paper (pp. 20–22),
> R03–R14 of this library, the isolate-factory-lab repository at `a95a492` and its worktrees, and the
> Field OS worker-fabric code at `58d6826`. Content follows Edition 3 where the editions differ.
> Redone 2026-10-17 (later the same day) for WP07, WP08, WP24, WP28 and WP29 after the probes and the X1 pilot; see `docs/execution/CRITIQUE-2026-10-17-reconcile.md`.

## Purpose

This document breaks the vertical slice of `EXECUTION-PLAN.md` into 32 work packages. Each has a purpose, inputs, deliverables, testable acceptance criteria, dependencies, linked experiments and campaigns, an estimate, and the lab or Field OS assets it reuses, by exact path. Every package, criterion and estimate is **Proposed** or **Estimated**. WP07's kit is built and was used by the X1 pilot (`campaigns/x1-spec-study/`); no other package has started.

## Summary

- Seven groups, in Edition 3's order: measurement plane (WP01–WP06), specification evidence (WP07–WP08), harness and escape rate (WP09–WP12), kernel substrate and its experiments (WP13–WP25), the narrow whole cycle (WP26–WP30), the library (WP31), and documentation (WP32).
- Acceptance criteria are written as checks a reviewer can run or read off a receipt. "Receipt" means a receipt set that the verifier accepts (`docs/templates/RECEIPT.md`).
- The lab's measurement plane is reused almost whole; its candidate path (QuickJS guests, per-candidate VFS) is not [R13 §3, §4].
- Estimates are person-days for one engineer with model access (**Estimated**). They sum to 130–207 days (Derived). R13 §2 carries the same stage figures.
- Packages marked **Stage 6+ / optional** (WP20 and the live-revision half of WP28) are not on the path to rung 4 and no X1–X6 experiment needs them; they stay in the count of 32 but are not started before Stage 6 unless a decision point (`EXECUTION-PLAN.md` §7.1) pulls one forward. WP29 (legibility) left that list on 2026-10-17: the persona review of the pilot found the five presentation rules decide usability, and they are enforceable as a gate on the glue without touching a frozen kernel (L-13, L-14).
- Promotion means gated **and** persona-accepted (WP28); the product of a request is a capability plus its recorded question (WP28, WP29); R19 §2.1's disagreement loop is a Stage 4 deliverable of WP28.

## Conventions in this document

Path prefixes, as in R12 §1:

- `LAB/` = `~/Work/isolate-factory-lab/` at `main` = `a95a492`.
- `LAB-WT/` = `~/Work/isolate-factory-lab-wt/` (worktrees: `fastloop` = `feat/fastloop` @ `f70fa25`, `measure` = `feat/measure` @ `a22ff3f`).
- `LAB@scoped:` and `LAB@deferred:` = files on the unmerged branches `wip/precampaign-scoped` (`cc9ccfe`) and `wip/precampaign-deferred` (`007bcd5`).
- `FO-REV/` = `~/Work/field-ops-github-review/` (worker-fabric files as at `58d6826`).

"Stage" refers to `EXECUTION-PLAN.md` §2.

## Index

| ID | Title | Group | Stage | Estimate (days, Estimated) |
|---|---|---|---|---|
| WP01 | Campaign runner port | A Measurement plane | 0 | 3–5 |
| WP02 | Lab must-fix carry-over | A | 0 | 5–8 |
| WP03 | Hardware qualification records | A | 0 (Main-rig); 3 (unified-memory host) | 2–4 |
| WP04 | Ledger v0: the R11 records | A | 0 | 4–6 |
| WP05 | Provenance and license fields | A | 0 | 1–2 |
| WP06 | Frozen evaluator store and hash-into-ledger | A | 0 | 2–3 |
| WP07 | X1 specification study kit (agent specifier; built, piloted) | B Specification evidence | 1 | 2–4 |
| WP08 | X2 evaluator error-rate study kit | B | 1 | 8–12 |
| WP09 | Universal gates and evaluator engine | C Harness and escape rate | 2 | 4–6 |
| WP10 | Invariant library v0 (both X3 domains) | C | 2 | 5–8 |
| WP11 | Seeded-fault generator and known-good implementations | C | 2 | 7–11 |
| WP12 | Escape-rate harness (sampled and searched) | C | 2 | 3–5 |
| WP13 | Kernel contract and WIT interface | D Kernel substrate | 3 | 3–5 |
| WP14 | Wasmtime local-lane workcell | D | 3 | 5–8 |
| WP15 | Broker and declared imports | D | 3 | 3–4 |
| WP16 | Resource enforcement and external watchdog | D | 3 | 3–5 |
| WP17 | Outcome-unknown recovery | D | 3 | 3–5 |
| WP18 | Three lifetimes and reclamation accounting | D | 3 | 2–4 |
| WP19 | AssemblyScript in-isolate compiler route | D | 3 | 4–6 |
| WP20 | MoonBit in-isolate compiler route | D | Stage 6+ / optional (joins C04 only if ready) | 3–5 |
| WP21 | Rust native lane | D | 3 | 3–4 |
| WP22 | TypeScript compatibility lane | D | 3 | 3–5 |
| WP23 | X4 kernel route-yield campaign | D | 3 | 5–8 |
| WP24 | X5 model-term measurement (lean subscription CLI, by effort; no API arm) | D | 3 | 3–5 |
| WP25 | X6 hosted fit probe | D | 3 | 3–5 |
| WP26 | Declarative glue schemas and host renderer binding | E Narrow whole cycle | 4 | 4–6 |
| WP27 | Whole-cycle integration: intake to activation | E | 4 | 6–10 |
| WP28 | Activation, promotion rule and question loop (Stage 4); live revision with state preservation (Stage 6+ / optional) | E | 4; live revision 6+ | 4–6 |
| WP29 | Legibility: the five presentation rules as glue gates (G7) and the contract explanation view | E | 4 (critical path since 2026-10-17) | 2–4 |
| WP30 | Matched end-to-end campaign | E | 4 | 8–12 |
| WP31 | Library index with behavioural-fingerprint retrieval | F Library | 5 | 12–18 |
| WP32 | Documentation upkeep | G Continuous | all | 5–8 |

Total: 130–207 days (Derived: sum of the bounds above; the 17 Oct critique raised WP10 and WP11 by 2–3 days each from 126–201; moving WP29 onto the critical path changed no estimate). Not costed: the unified-memory host (DP-5), rung-4 recruitment (DP-4), graders other than the author (WP08), re-delivery to and the merge in refrigeration-ai (the rung-4 path), and Stage 6+ / optional work once started.

---

## Group A — Measurement plane (Stage 0)

### WP01 — Campaign runner port

| Field | Content |
|---|---|
| Purpose | Make every later number a receipt. Port the lab's precommit chain, receipt-set schema and verifier, spec gate, environment control and calibration into Endoforge, extended to the POODO precommit fields [E3 §8; R13 §3] |
| Inputs | Lab harness and tests; `docs/templates/CAMPAIGN-PRECOMMIT.md`; `docs/templates/RECEIPT.md` |
| Deliverables | (1) A campaign runner that writes `precommit.json` and `precommit.sha256` before the first measured job and refuses to start otherwise. (2) Schema `endoforge-precommit-v1` (the template's skeleton) and an Endoforge receipt-set schema. (3) A verifier command implementing checks 1–6 of `RECEIPT.md` §2, including the ledger rules L1–L5. (4) Environment snapshot before and after, quiet gate, pinning plan, noise baseline. (5) Calibration C1–C7 re-run on the Main-rig at the measured commit, with C2 and C3 marked for re-derivation once the Wasmtime lane exists (WP14). (6) A spec gate that refuses placeholders and unsatisfied dependencies |
| Acceptance criteria | (a) A smoke campaign produces a set the new verifier accepts; the lab's `harness/verify-receipts.mjs` is run on the same set and its verdict is recorded (it is expected to refuse the `endoforge-precommit-v1` schema; a refusal for any other reason is a defect). (b) Mutating any byte of any file in the set makes the verifier fail with the file named. (c) Deleting `summary.json` makes the verifier refuse the set as partial. (d) Calibration C1–C7 pass on the same boot, at the measured commit, within 12 h. (e) A noise baseline receipt exists, with the quiet-gate result recorded either way. (f) The runner refuses an official campaign whose precommit lacks an evaluator hash |
| Dependencies | None |
| Experiments and campaigns | Every campaign C01–C18 |
| Estimate | 3–5 days (Estimated) |
| Reuses | `LAB/harness/run.mjs`, `LAB/harness/lib/receipts.mjs`, `LAB/harness/lib/receipt-schema.mjs`, `LAB/harness/lib/canonical.mjs`, `LAB/harness/lib/spec.mjs`, `LAB/harness/lib/prng.mjs`, `LAB/harness/lib/stats.mjs`, `LAB/harness/lib/analysis.mjs`, `LAB/harness/check-spec.mjs`, `LAB/harness/verify-receipts.mjs`, `LAB/harness/report.mjs`, `LAB/harness/replicate.mjs`, `LAB/harness/arm-server.mjs`, `LAB/harness/lib/cgroup.mjs`, `LAB/harness/lib/controls.mjs`, `LAB/harness/lib/envcontrol.mjs`; `LAB/tools/env-control/{snapshot,gate,pin,noise-baseline}`, `LAB/tools/env-control/lib/*.mjs`; `LAB/tests/calibration/` (`checks.mjs`, `c6.mjs`, `c7.mjs`, `known-truth/index.mjs`, `receipt.mjs`, `run.mjs`); `LAB/tests/lib/ledger.mjs`; example set `LAB/receipts/smoke-20261014T200656Z-99f032/` |

### WP02 — Lab must-fix carry-over

| Field | Content |
|---|---|
| Purpose | Close, in the ported code, the lab defects that would invalidate any Endoforge campaign, before WP01's runner is used for a registered campaign [R12 §4.4; R13 Stage 0] |
| Inputs | `LAB/CRITIQUE-2026-10-14-precampaign.md` (M1–M12, S1–S12); `LAB@scoped:docs/BACKLOG.md`; drafts on the two wip branches |
| Deliverables | Fixes with regression tests for: M2 (holdout verification runs the arm's own emitted artifact); M3 (`outcome_unknown` is its own stage, never a reject); M9 (every helper process stays in the arm cgroup, asserted at each readback); M10 (steady state compares like with like); M11 (official campaigns refuse a dirty tree; calibration not waivable by spec); the out-of-cgroup `systemd-coredump` helper (detected and gating the lifetime); S1 (null arm measures the harness constant); S2 (BCa or studentised interval, at least 16 blocks); S5 (contamination gates a lifetime); S7 (C6 exercises the scoring path); S8 (plateau acceptance for bounded pools); S9 (expected-failure declarations bounded and predeclared). M5 (pinned lib bytes) and M8 (arm representatives declared) are carried as precommit rules for C07 and C03b. M1, M4, M6, M7 and M12 are recorded as not applicable to the slice unless a lab workload is reused, with the reason |
| Acceptance criteria | (a) A test kills an executor mid-candidate and the summary shows the attempt under `outcome_unknown`, not under rejects. (b) A test spawns a helper with a `scope` option and the readback assertion fails the lifetime. (c) A synthetic core dump during a lifetime marks the lifetime contaminated. (d) The runner refuses an official spec on a dirty tree and refuses `allowNotRun`. (e) A mixed-composition stream no longer disqualifies a stable arm under the steady-state rule. (f) A table in the WP's receipt lists every M and S item with status fixed, carried as a precommit rule, or not applicable, with reason |
| Dependencies | WP01 |
| Experiments and campaigns | All; specifically C03 (M3), C07 (M2, M8, M9) |
| Estimate | 5–8 days (Estimated) |
| Reuses | `LAB@scoped:harness/lib/scoring.mjs`, `LAB@scoped:harness/lib/oracle.mjs`, `LAB@scoped:harness/test/precampaign.test.mjs`, `LAB@scoped:docs/PREDICTIONS.md` (v1.6 rules for M8, M10, M11); `LAB@deferred:` drafts for M9 second half, S1–S4 (cherry-pick reference only; the backlog says never merge wholesale); `LAB/tests/faults/faults.test.mjs` (F1 SIGKILL mid-candidate) |

### WP03 — Hardware qualification records

| Field | Content |
|---|---|
| Purpose | Record what each host enforces and measures before any experiment depends on it [E2 §12; E3 §18] |
| Inputs | `docs/templates/HARDWARE-QUALIFICATION.md`; WP01 environment control |
| Deliverables | `HQ-mainrig-<date>` (Stage 0): identity, enforced controls (affinity, cgroup controllers, `memory.max`, `pids.max`, network denial, `io.stat` availability), noise baseline, thermal note. `HQ-<uma-host>-<date>` (before C05): the same plus sustained memory bandwidth alone and under concurrent compilation, and the inference runtime identity. A discrete-GPU comparator record if one is used |
| Acceptance criteria | (a) Every value labelled Recorded cites a receipt path. (b) Every control in the record has an empirical probe result in `controls.json`, not a configuration claim. (c) Status is one of qualified, qualified-with-limits or failed, with the limits listed. (d) A kernel, firmware, driver or runtime change after the record re-opens it (checked by the runner comparing the environment snapshot) |
| Dependencies | WP01 |
| Experiments and campaigns | C04, C05, C06 (local comparison side), C07, C15, C16 |
| Estimate | 2–4 days across two hosts (Estimated) |
| Reuses | `LAB/tools/env-control/snapshot`, `LAB/tools/env-control/lib/topology.mjs`, `LAB/tools/env-control/noise-baseline`, `LAB/receipts/noise-baseline-2026-10-14*/`, `LAB/docs/ENVIRONMENT.md` (findings 2–6), `LAB/harness/lib/controls.mjs` |

### WP04 — Ledger v0: the R11 records

| Field | Content |
|---|---|
| Purpose | Give every candidate, build, artifact, evaluator, evaluation, observation and activation its own identity before any receipt cites it [E2 §10; R11] |
| Inputs | R11 record schemas; Mononoke study; Field OS ledger patterns |
| Deliverables | Record types and a local store (proposed: one SQLite file, see `EXECUTION-PLAN.md` §7) for: candidate (provenance), resolved source, build key, artifact, frozen evaluator, evaluation attempt (receipt), observation (append-only journal), activation (compare-and-swap on a named slot), overlay (scratch with owner, expiry, retain flag). Publication-after-closure rule; lost-acknowledgment reconciliation from the authoritative record; `outcome_unknown` as an attempt state; delivery state and outcome state as separate fields [E3 §8] |
| Acceptance criteria | (a) Inserting a record that references a non-durable object is refused. (b) Two candidates that produce the same build key share the build record and keep separate candidate records. (c) An activation CAS with a stale expected revision fails, and a simulated lost acknowledgment is reconciled to the correct state on reopen. (d) Observations cannot be updated or deleted through the API; derived records can be dropped and regenerated byte-identically from pinned inputs. (e) A kill during an evaluation leaves the attempt `outcome_unknown` after reopen. (f) Reopening the store verifies the event chain, as Field OS recorded for its private ledger (F13) |
| Dependencies | WP01 (canonical JSON) |
| Experiments and campaigns | All; C15 (scratch reclamation) |
| Estimate | 4–6 days (Estimated) |
| Reuses | `LAB/harness/lib/canonical.mjs`, `LAB/evaluator/lib/tree-digest.mjs`; `FO-REV/src/fieldops/worker_fabric.py` (durable admission, idempotent retries), `FO-REV/src/fieldops/worker_fabric_execution.py` (fenced dispatch, single durable claim); `docs/studies/mononoke/STUDY.md` and `SOURCE-MAP.md` (changeset-relative storage, derived data on demand, bookmark CAS with lost-acknowledgment replay) |

### WP05 — Provenance and license fields

| Field | Content |
|---|---|
| Purpose | Make license and provenance a field from the first admission, not a later audit [E3 §13 risk 6; DEC-60] |
| Inputs | WP04 candidate and resolved-source records; R15 RISK-06 |
| Deliverables | Fields on candidate and resolved-source records: origin (generated, imported, pre-built WASM), upstream URL or identity, upstream commit or version, license expression (SPDX where known, `unknown` otherwise), license evidence (file hash), generating model and version for generated material, data-lineage scope (which inputs were visible at generation, for RISK-04 and RISK-24). An admission rule that refuses imported material with `unknown` license in any campaign whose precommit says "no unknown licenses" |
| Acceptance criteria | (a) Admission of an imported file without license fields fails. (b) Every artifact can be traced to its sources' license fields by one query. (c) A generated candidate records the model identity and the input scopes visible at generation. (d) Promotion never removes a lineage scope (test: promote, then query) |
| Dependencies | WP04 |
| Experiments and campaigns | C07 (imported baselines), C12 (shared contracts across tenants) |
| Estimate | 1–2 days (Estimated) |
| Reuses | `LAB/adapters/checkers/tscrs-wasm/pins.json`, `LAB/adapters/checkers/tscrs-wasm/record-pins.mjs` (pin recording pattern); `LAB/adapters/checkers/tscrs-wasm/vendor/BUILD-INFO.txt` (build provenance example) |

### WP06 — Frozen evaluator store and hash-into-ledger

| Field | Content |
|---|---|
| Purpose | An evaluator's hash enters the ledger before evaluation begins; the engine refuses to judge if running code differs [E3 §6; R11 §Frozen evaluator] |
| Inputs | WP04; the lab's freeze discipline |
| Deliverables | A content-addressed evaluator store (code, configuration, synthesized residual, invariant set version); a `freeze` command that writes the frozen-evaluator record with its qualification evidence and confirmation; a `requireFrozen` check in the engine; revision only with an outcome-independent justification recorded [E3 §6] |
| Acceptance criteria | (a) Judging with an evaluator whose tree digest differs from the frozen record fails closed. (b) An evaluation-attempt record without a frozen-evaluator reference is refused. (c) A revision attempt that cites a candidate outcome as its reason is refused by schema. (d) The frozen record carries the residual's synthesis context id and confirms it is candidate-blind (no candidate id appears in that context's inputs) |
| Dependencies | WP01, WP04 |
| Experiments and campaigns | C02 onward (every evaluator hash "TBD at freeze" is filled here) |
| Estimate | 2–3 days (Estimated) |
| Reuses | `LAB/evaluator/lib/freeze.mjs`, `LAB/evaluator/FROZEN.json`, `LAB/evaluator/lib/tree-digest.mjs`, `LAB/evaluator/lib/self.mjs`, `LAB/evaluator/index.mjs` (`requireFrozen` gate order) |

---

## Group B — Specification evidence (Stage 1)

### WP07 — X1 specification study kit

| Field | Content |
|---|---|
| Purpose | Everything needed to run E3 X1 without engineering: collect, freeze, time and classify real requests, with an agent as the specifier (DEC-71) [E3 §15; R14 X1] |
| Inputs | Field OS users' and the author's real requests (the frozen pool of 60, DEC-66); C01 draft; `campaigns/x1-spec-study/factory/README.md` (the agent brief) |
| Deliverables | (1) Request intake and a frozen request set of 20 (60 if the extension rule fires), hashed before the study: **built** (`bin/x1.mjs freeze`, `receipt/freeze.json`, seed 20261017). (2) A per-request timer driven by the agent's own start/stop events, with void and re-run rules: **built**. (3) Classification rubric: specifiable in under ten minutes; satisfiable by composition; residual size in assertions under the tightened counting rule (C01 §5: assumption-pin and boundary rows counted separately); underdetermined; shape; cluster under a written procedure: **rubric built, counting rule and clustering procedure still to add**. (4) Blind-rater protocol: a fresh agent per request on the seeded half, blind to timings and to rater 1: **built, one agent across the half in the pilot**. (5) Analysis script: point estimate, Clopper–Pearson interval, extension rule, per-field blind agreement: **built** (`receipt/summary.json`). (6) The factory extension (contract → frozen tests → kernel → gates G1–G7 → promotion) that the pilot added is recorded here as the kit's path into WP28/WP29, not as an X1 deliverable |
| Acceptance criteria | (a) The request set hash is recorded in C01's precommit before the first contract is timed: **met by the freeze; the precommit itself is unregistered**. (b) Every request has a recorded start and stop time and a classification: **met for the pilot's 20 (4 voids recorded)**. (c) Inter-rater agreement is computed per field for the blind half, and κ is reported with its variance caveat: **κ met; per-field reporting to add**. (d) The analysis script reproduces the R14 interval values on synthetic inputs (0/20 → upper 16.8 %; 12/60 → 10.8–32.3 %): **met (`node --test test/`)**. (e) New: the residual-counting rule and the clustering procedure are in `RUBRIC.md` and hashed into the freeze before a registered run |
| Dependencies | None (template only) |
| Experiments and campaigns | E3 X1; C01 (piloted 2026-10-17, Pilot (not a registered result)); feeds C02's seed task set |
| Estimate | 2–4 days including the study (Estimated); the pilot used about one day for 20 requests end to end, under an agent specifier |
| Reuses | None from the lab. Field OS request sources and the public chatbot transcripts (L-09) |

### WP08 — X2 evaluator error-rate study kit

| Field | Content |
|---|---|
| Purpose | Measure how often a synthesized evaluator is wrong, by request type, before and after library growth [E3 §15; R14 X2] |
| Inputs | Task set of 100, of which the first 20 are the X1 pilot's contracts with their frozen executable tests, 41 persona verdicts and two rejections (C02 §6; hashes in `campaigns/x1-spec-study/receipt/factory-summary.json`, text under git-ignored `work/`); POODO precommit discipline; graders; C02 draft |
| Deliverables | (1) Task set with request types labelled and a determinate/ambiguous flag, covering both X3 domains (DP-3 must be recorded first). (2) Candidate-blind synthesis protocol: a fresh context per task with no candidate visible; context transcript hashed. (3) Grading form: does the residual accept every correct behaviour and reject every incorrect one the request implies; two blind graders; adjudication log. (4) Per-evaluator qualification run: seeded faults rejected, known-good anchor accepted where one exists, determinism. (5) A hand-authored invariant list v0 (plain-language invariants plus executable checks where cheap), file-hashed before pass 1; the growth step as a hashed diff to it; a fresh second task set. WP10 later ports this list into the engine; C02 does not wait for WP10. (6) Analysis: error rate overall and by type, κ, before/after, and the seed stratum reported separately. (7) The residual-counting rule (C02 §5) and the test-format totality check (a test file that cannot carry a value its tests need is an evaluator defect, L-04) written into the grading form before calibration |
| Acceptance criteria | (a) Every residual's hash is recorded before any grader sees it (met for the 20 seed residuals by the pilot's freeze). (b) No synthesis context contains a candidate (checked by the transcript hash and an input manifest). (c) Two independent grades exist for every evaluator; disagreements have an adjudication record. (d) Results report the point estimate and the one-sided 95 % bound, with the indecisive band (2–9 errors at n = 100) stated. (e) At least 100 pass-2 determinate evaluators exist before the kill rule is read; the kit extends pass 2 until it has them. (f) The 10 calibration evaluators include the pilot's C-006 v1, CC-011 and CC-001 as known defects, and graders agree on the residual count of the 10 before grading starts |
| Dependencies | None for the study (no Stage 2 package); DP-3 recorded; WP06 when available, to re-enter evaluator hashes |
| Experiments and campaigns | E3 X2; C02 (seeded by the C01 pilot); feeds C03, C17 |
| Estimate | 8–12 days of the author's time, dominated by grading (Estimated). The second grader's and adjudicator's hours (C02 §10 estimates about 67 person-hours for two graders) are not in this figure |
| Reuses | `LAB/tests/calibration/c6.mjs` (mutant-rejection pattern for qualifying a synthesized evaluator); `FO-REV/tools/worker-fabric/testbed/fusion-fixture.mjs` (six-case fixture as a known-good anchor for the refrigeration tasks) |

---

## Group C — Harness and escape rate (Stage 2)

### WP09 — Universal gates and evaluator engine

| Field | Content |
|---|---|
| Purpose | The fixed bottom layer of acceptance and the engine that applies all three layers in a fixed order [E3 §6, §7] |
| Inputs | WP06; lab evaluator; Edition 3's universal-gate list |
| Deliverables | Deterministic gates: contract and schema validity, type and interface conformance, resource bounds, determinism (repeat and compare), forbidden-effect scan. Engine: gates before ranking, no weighted sum, Pareto selection, finalist re-check on fresh rounds, attribution of every rejection to the check that caught it (needed by X3's secondaries), `outcome_unknown` as a stage |
| Acceptance criteria | (a) Each gate has a positive and a negative test. (b) The engine produces identical verdicts on two runs of the same inputs (determinism test). (c) Every rejection record names exactly one first-failing check. (d) A candidate that passes gates but fails the residual is never ranked. (e) Conformance probe passes against the engine's port interface |
| Dependencies | WP02, WP06 |
| Experiments and campaigns | C02 qualification runs, C03, all later campaigns |
| Estimate | 4–6 days (Estimated) |
| Reuses | `LAB/evaluator/lib/gates.mjs`, `LAB/evaluator/lib/pareto.mjs`, `LAB/evaluator/lib/finalists.mjs`, `LAB/evaluator/lib/strict-json.mjs`, `LAB/evaluator/lib/schema.mjs`, `LAB/evaluator/lib/task.mjs`, `LAB/evaluator/lib/ports.mjs`, `LAB/oracles/w-exec/check.mjs`; `LAB/tests/metamorphic/determinism.test.mjs`; `LAB/tests/conformance/probe.mjs` |

### WP10 — Invariant library v0 (both X3 domains)

| Field | Content |
|---|---|
| Purpose | The middle layer: domain invariants authored offline, qualified once, composed per task [E3 §6]. One set per X3 domain, because tiers are per domain and C03 needs both |
| Inputs | Field OS refrigeration contracts; the six-case fixture; Edition 3's invariant list; the hand-authored invariant list v0 and growth diff from C02 (WP08); the second domain's sources (DP-3) |
| Deliverables | Versioned invariants for the slice domain: dimensional consistency (unit equivalence and inequality), gauge versus absolute pressure without an assumed atmosphere, source-bound return (stale, retired, corrupt, paused-authority cases), no cross-room mutation, round-trip and idempotence, reconciliation of totals, order independence (reversed inputs). A second versioned set for the DP-3 domain, sharing no invariant with the first. Metamorphic relations usable without knowing the right answer. Each invariant with its qualification record (seeded faults rejected, anchor accepted) and a reviewer from a separate context [E3 §8] |
| Acceptance criteria | (a) Every refrigeration invariant rejects its own seeded-fault set and accepts the six-case fixture's frozen output (SHA-256 `1c5facb2…6b1033d`, F11); every second-domain invariant rejects its seeded-fault set and accepts that domain's known-good anchors. (b) Every invariant is deterministic over 100 repeated runs. (c) Each invariant has a reviewer record from a context that did not author it. (d) The library version hash is part of every frozen evaluator that composes it. (e) The ported C02 list reproduces C02's pass-2 verdicts on C02's qualification sets (parity with the hand-authored list) |
| Dependencies | WP09; DP-3 recorded; C02's list (WP08) |
| Experiments and campaigns | C03, C08; C02's list is its input, not its dependant |
| Estimate | 5–8 days for two domains (Estimated; raised from 3–5 by the 17 Oct critique) |
| Reuses | `FO-REV/tools/worker-fabric/testbed/fusion-fixture.mjs`, `FO-REV/tools/worker-fabric/verify-gateway-domain.mjs` (as at `58d6826`), `FO-REV/src/fieldops/worker_fabric_return.py` (source-bound return checks); `LAB/tests/metamorphic/transforms.mjs`, `LAB/workloads/w-search/generator/metamorph.mjs` |

### WP11 — Seeded-fault generator and known-good implementations

| Field | Content |
|---|---|
| Purpose | Produce thousands of non-equivalent faults per domain in four declared strata, filtered for equivalence [R14 §2.3–§2.4], and supply the known-good implementation per task that the filter needs |
| Inputs | WP10; base candidates across at least 105 distinct tasks per domain (6,294 ÷ 60 = 104.9; 210 tasks at 30 faults per task); probe `experiments/P-03-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | A known-good implementation per task, per domain (C02's anchors where they exist, otherwise authored and reviewed from a separate context), with its own frozen identity. Stratum S1 mechanical: at Stage 2, typed IR mutation of interim-lane candidates (JavaScript or TypeScript, the lab's operators); the kernel-level extension (AssemblyScript or WebAssembly operators) is a Stage 4 deliverable for X3b, since no kernel exists at Stage 2. S2 domain-semantic templates (swapped units, dropped rows, wrong join rule, stale source binding, off-by-one, reversed inputs) per domain; S3 model-plausible faults from a separate context; S4 hook for searched candidates (WP12). Equivalent-mutant filter by differential execution against the known-good implementation on an extended input set. Generator identity (tree digest) and per-stratum proportions written into the precommit |
| Acceptance criteria | (a) Output is deterministic given seed and generator digest. (b) Every emitted fault differs from the known-good implementation on at least one input of the extended set (non-equivalence evidence stored per fault). (c) The equivalent fraction is reported per stratum. (d) The generator emits the C03 plan size (6,294 non-equivalent faults per domain, of which at least 3,147 are S2) across at least 105 tasks with 30–60 faults per task, for both domains, before C03a registers; a domain that cannot reach the S2 count is recorded as such (Stage 2 narrowing rule). (e) S3 faults are tagged with the generating model and context id. (f) Every known-good implementation passes the domain's WP10 invariants and C02's residual for its task |
| Dependencies | WP09, WP10; DP-3 recorded |
| Experiments and campaigns | C03, C08; also feeds C04's seeded subset |
| Estimate | 7–11 days (Estimated; raised from 5–8 by the 17 Oct critique for the known-good implementations, which no package costed) |
| Reuses | `LAB/workloads/w-search/generator/ir.mjs`, `mutate.mjs`, `prng.mjs`, `hash.mjs`, `metamorph.mjs`; `LAB/tests/calibration/c6.mjs` (mutant set and control pattern); `LAB/tests/faults/workload/` (fault workload layout) |

### WP12 — Escape-rate harness (sampled and searched)

| Field | Content |
|---|---|
| Purpose | Run seeded faults through the full harness and count promotions, first in random order (X3a), then under a sixteen-wide search (X3b) [E3 §7, §11, §15] |
| Inputs | WP09–WP11; qualified evaluators from C02; the promotion rule; probe `experiments/P-03-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | (1) Submission driver: random order, per-domain and per-stratum counts, attribution of the catching check. (2) Search driver: G = 0 adaptive search at widths 1, 4 and 16 against the same frozen evaluator, with seeded fault families present; promotion counting; an independent oracle that labels searched candidates (stratum S4). (3) Analysis: escape rate with exact one-sided 95 % bound, cluster bootstrap over tasks, per-stratum and per-check tables. (4) Tier assignment report per domain |
| Acceptance criteria | (a) On a calibration set with a known injected escape rate (for example 5 escapes planted in 1,000), the harness reports exactly that count. (b) The bound computed matches the exact Clopper–Pearson value to four significant figures (2,995 / 4,742 / 6,294 at 1 in 1,000), and the fail threshold (12 escapes of 6,294 puts the one-sided 95 % lower bound above 1 in 1,000; Derived) is reproduced. (c) Every promoted seeded fault has a record naming every check it passed. (d) The search driver uses the frozen evaluator hash and fails closed if it changes mid-campaign. (e) Every receipt names the lane and candidate format (interim lane at Stage 2; kernel at Stage 4), so a sampled rate on interim-lane candidates is never read as kernel evidence |
| Dependencies | WP09, WP11; C02 decided (qualified evaluators exist) |
| Experiments and campaigns | E3 X3; C03 (a and b), C08 |
| Estimate | 3–5 days harness; campaign compute is hours (Estimated) |
| Reuses | `LAB/evaluator/lib/search.mjs` (G = 0 adaptive search), `LAB/evaluator/lib/openloop.mjs`, `LAB/evaluator/lib/stats.mjs`, `LAB/harness/lib/stats.mjs` (bootstrap) |

---

## Group D — Kernel substrate and its experiments (Stage 3)

### WP13 — Kernel contract and WIT interface

| Field | Content |
|---|---|
| Purpose | Fix the contract every candidate meets: a pure WebAssembly module, state in, event in, state out, effects out as data, declared imports as its only capabilities [E3 §5] |
| Inputs | Edition 3 §5; a pinned Wasmtime release with Component Model support (R18 SRC-44, SRC-45); probe `experiments/P-01-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | WIT world for the slice (`reduce(state, event) -> (state, effects)`, plus `describe` for contract metadata); handle types for host-owned buffers; effect schema; contract versioning rule (major version invalidates qualification, RISK-05); an interface conformance test suite; a pinned Wasmtime version recorded in R18 at use |
| Acceptance criteria | (a) A hand-written reference kernel passes the conformance suite; a kernel exporting an undeclared function or importing an undeclared capability is rejected at validation. (b) A kernel cannot obtain a pointer into host memory: a test passes a buffer handle and confirms only handle-mediated reads succeed. (c) The WIT file hash is part of every artifact record. (d) Conformance runs under the pinned Wasmtime release before X4 (R03 open question) |
| Dependencies | WP04; DP-1 recorded. Construction may start during Stage 2 (`EXECUTION-PLAN.md` Stage 3 entry); only judging candidates (WP23) waits for Stage 2 exit |
| Experiments and campaigns | C04, C14 (state shape for migration) |
| Estimate | 3–5 days (Estimated) |
| Reuses | `LAB/docs/ADAPTER-CONTRACT.md` (contract style); `LAB/tests/conformance/probe.mjs` (probe pattern) |

### WP14 — Wasmtime local-lane workcell

| Field | Content |
|---|---|
| Purpose | The RAM-resident workcell on the local lane: prepared machinery reused, every candidate's mutable state fresh [E3 §4, §13] |
| Inputs | WP13; WP03 Main-rig record; probe `experiments/P-01-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | A Wasmtime-based host process under OS sandboxing (bubblewrap or equivalent), in an owned cgroup, with an external watchdog process (WP16); module compile cache keyed by compiler and runtime identity; per-candidate store and instance; host-owned input buffers; the cheap gates of WP09 running inside; host-authored timing and resource counters |
| Acceptance criteria | (a) A candidate's instance is created and destroyed per attempt; a test shows no state carries between two candidates. (b) Machinery (compiled modules, invariant library) is reused across candidates: compile count stays at one over 1,000 attempts of the same module. (c) Every helper process stays in the workcell's cgroup (WP02 M9 assertion). (d) Calibration C2 and C3 re-derived for this lane pass |
| Dependencies | WP13, WP03, WP01 |
| Experiments and campaigns | C04, C05 (compile side), C07 arm K, C15 |
| Estimate | 5–8 days (Estimated) |
| Reuses | `LAB/adapters/executors/bwrap-process/index.mjs`, `LAB/adapters/executors/_lib/sandbox-proc.mjs`, `LAB/adapters/executors/_lib/sandbox-runner.mjs`, `LAB/adapters/executors/_lib/protocol.mjs`; `LAB/harness/lib/cgroup.mjs`; `FO-REV/src/fieldops/worker_fabric_execution.py` (owned execution, cgroup readback) |

### WP15 — Broker and declared imports

| Field | Content |
|---|---|
| Purpose | The only path from a candidate to anything outside it: declared imports, mediated by a host broker that checks authority on every call [E3 §5, §9] |
| Inputs | WP13 import list; Field OS source-bound return |
| Deliverables | A broker that resolves each declared import to a host service (read a bound source by handle; emit an effect as data; log); authority re-checked on every read (custody before reference); host-call amplification limits; a denial log; no ambient authority |
| Acceptance criteria | (a) A kernel calling an undeclared import fails to instantiate. (b) Reading a source whose authority was revoked between calls returns a denial, not stale data. (c) A host-call flood is cut off at the declared amplification limit and recorded. (d) The ported w-contain authority cases (`escape-authority`, `escape-proto`, `network`, `fs-read`, `spawn`) are contained |
| Dependencies | WP14 |
| Experiments and campaigns | C07, C14 |
| Estimate | 3–4 days (Estimated) |
| Reuses | `FO-REV/src/fieldops/worker_fabric_return.py` (source-bound return), `FO-REV/src/fieldops/worker_fabric_gateway.py`; `LAB/workloads/w-contain/cases/escape-authority.mjs`, `escape-proto.mjs`, `network.mjs`, `fs-read.mjs`, `spawn.mjs` |

### WP16 — Resource enforcement and external watchdog

| Field | Content |
|---|---|
| Purpose | Enforce limits where they work: deadlines, memory, output volume and host-call amplification by the runtime, an external watchdog, or termination of an owned cohort [E3 §9] |
| Inputs | WP14; lab containment matrix |
| Deliverables | Wasmtime fuel or epoch deadline per attempt; linear-memory cap per instance; output-volume cap at the transport; external watchdog that kills the owned cohort on deadline; cohort partitioning by trust; no fine-grained timers exposed to candidates [E3 §13 risk 3]. The 16 w-contain cases ported to kernels with an expected-failure oracle |
| Acceptance criteria | (a) Every ported containment case is contained or matches a predeclared expected failure with provenance (S9 bound). (b) Infinite loop, deep recursion, allocation bomb and output flood each terminate within their declared bound, recorded as time-to-kill (not whole wall, R12 §3). (c) Owned groups are empty or removed after every case. (d) The output cap is reached before the deadline in at least one flood case, settling the open question in R12 |
| Dependencies | WP14, WP02 |
| Experiments and campaigns | C04 (containment admissibility), C07 |
| Estimate | 3–5 days (Estimated) |
| Reuses | `LAB/workloads/w-contain/` (`cases/*.mjs`, `manifest.json`), `LAB/oracles/w-contain/expected.json`, `LAB/receipts/w-contain-smoke/matrix.json` (prior smoke matrix for comparison), `LAB/docs/EXECUTORS.md` |

### WP17 — Outcome-unknown recovery

| Field | Content |
|---|---|
| Purpose | Carry the Field OS recovery boundaries unchanged: durable intent before execution, fenced dispatch, `outcome_unknown` after any kill between claim and canonical finish, cancellation only after verified closure [E3 §9] |
| Inputs | WP04, WP14, WP16; W3/W4 receipt |
| Deliverables | Recovery procedure for the workcell: fence future work, verify the exact owned closure, record ambiguity; kill points at each boundary; a recovery test suite |
| Acceptance criteria | (a) SIGKILL at each of the five Field OS kill points (plus active cancellation) yields `unknown` for killed cases and `cancelled` only after verified closure, reproducing F20's behaviour on the new lane. (b) No recovery path infers success from leftover output, a PID or a successful spool (negative tests). (c) A retried historical attempt launches no process (F13 behaviour) |
| Dependencies | WP04, WP14, WP16 |
| Experiments and campaigns | Stage 3 exit gate; C07 (unknown-rate admissibility) |
| Estimate | 3–5 days (Estimated) |
| Reuses | `FO-REV/src/fieldops/worker_fabric_recovery.py`, `FO-REV/src/fieldops/worker_fabric.py`; `FO-REV/tools/worker-fabric/testbed/supervision.py`, `lab.py`; `LAB/tests/faults/` (F1 SIGKILL mid-candidate, F2 driver kill, F3 corruption) |

### WP18 — Three lifetimes and reclamation accounting

| Field | Content |
|---|---|
| Purpose | Keep durable, warm and attempt state apart, and measure reclamation in bytes [E3 §9; E2 §3] |
| Inputs | WP04, WP14, WP17 |
| Deliverables | Lifetime tags on every allocation class (durable store, warm caches partitioned by permission, attempt overlay and instance); per-campaign accounting of live, retained, awaiting persistence and reclaimable bytes; teardown verification; retained-memory slope over long runs; overlay expiry and owner enforcement (R11) |
| Acceptance criteria | (a) After a campaign's teardown, the accounting report balances: allocated = retained + reclaimed + leaked, with leaked reported, not hidden. (b) A cache hit never bypasses authorization (test: hit across permission partitions is refused). (c) Restart restores accepted capabilities from durable records only; a test kills the host and confirms no guest heap is needed. (d) Per-candidate memory is reported as an increment over the host's idle working set (needed by C04) |
| Dependencies | WP04, WP14, WP17 |
| Experiments and campaigns | C04 (memory increment), C15 |
| Estimate | 2–4 days (Estimated) |
| Reuses | `LAB/adapters/checkers/tscrs-wasm/memory-sensor.mjs` (JS heap plus linear-memory accounting); `LAB/receipts/executors-qa-01/` and `LAB/tests/conformance/` (plateau-versus-leak method, with S8 fixed) |

### WP19 — AssemblyScript in-isolate compiler route

| Field | Content |
|---|---|
| Purpose | The candidate default kernel route: the AssemblyScript compiler running inside the workcell [E3 §5] |
| Inputs | WP13, WP14; pinned AssemblyScript release (R18 SRC-47); probe `experiments/P-02-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | The compiler hosted as decision point DP-1 (`EXECUTION-PLAN.md` §7.1) records. Default: a supervised V8 process (Node `worker_threads`) in its own bwrap sandbox and cgroup as a trusted-tooling cohort beside the Wasmtime lane; only the compiled module enters Wasmtime, through WP13 validation. Alternative, Stage 6+ / optional: a JavaScript engine compiled to WebAssembly hosting the compiler inside Wasmtime, which would move rung 1. E3-10 notes Edition 3 does not say which; this WP records the choice and its evidence. Compile cache; prompt template and repair loop for kernel generation; route record with compiler hash. Stage 6+ / optional: a token-granular (incremental, per-token) checking interface to the compiler, the prerequisite for the type-constrained-decoding arm of C05 (R19 §2.2); no such interface exists upstream (R19 open question) |
| Acceptance criteria | (a) A receipt shows the compiler running inside the DP-1 boundary (the cohort's cgroup and sandbox), with its compile time and memory measured from outside; this is rung 1 evidence only if DP-1 chose the in-Wasmtime alternative, and the receipt says which. (b) Output modules pass WP13 conformance. (c) Diagnostics are mapped back to source lines for repair. (d) Compiler identity pinned by hash; a bump re-runs conformance |
| Dependencies | WP13, WP14; DP-1 recorded |
| Experiments and campaigns | C04 (arm), C05 (compile concurrency), C07 arm K, C13 (baseline for refinement) |
| Estimate | 4–6 days (Estimated) |
| Reuses | `LAB-WT/fastloop/factory/src/worker.mjs`, `LAB-WT/fastloop/factory/src/loop-thread.mjs` (compiler-in-worker hosting pattern); `LAB-WT/fastloop/factory/tools/sctrace.c` (zero-I/O check of the hot path) |

### WP20 — MoonBit in-isolate compiler route

| Field | Content |
|---|---|
| Purpose | The second in-isolate route, compared rather than assumed [E3 §5; E3-02]. **Stage 6+ / optional:** not on the path to rung 4 and not required by X4, which Edition 3 §15 defines over TypeScript, AssemblyScript and Rust; it joins C04 only if it is ready before C04 freezes |
| Inputs | WP19 (shared route harness); pinned MoonBit release (R18 SRC-48) |
| Deliverables | Browser-hosted MoonBit compiler inside the workcell or a recorded reason why not; GC-based WASM output validated against WP13; prompt template |
| Acceptance criteria | (a) Either a receipt shows compilation inside the workcell with output passing conformance, or a failure record states the missing integration (as Edition 2 requires: record the gap, do not disguise it [E2 §15]). (b) If it works before C04 freezes, it joins C04 as an optional fourth arm |
| Dependencies | WP19 |
| Experiments and campaigns | C04 (optional arm) |
| Estimate | 3–5 days (Estimated) |
| Reuses | None from the lab |

### WP21 — Rust native lane

| Field | Content |
|---|---|
| Purpose | Keeper refinement and X4's Rust arm: rustc and LLVM outside the isolate, producing a module that meets the same contract [E3 §5; DEC-29] |
| Inputs | WP13; pinned Rust toolchain; probe `experiments/P-06-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | A native build service outside the workcell with its own cgroup; build key covering toolchain, target, flags and dependency lock; output delivered as a pre-built module that enters through validation only |
| Acceptance criteria | (a) The same pure-function task compiled from AssemblyScript and Rust passes the same frozen evaluator. (b) The build is reproducible: two builds of the same build key are byte-identical. (c) The resulting artifact gets a new identity and its own qualification (DEC-33) |
| Dependencies | WP13 |
| Experiments and campaigns | C04 (arm), C13 (refinement) |
| Estimate | 3–4 days (Estimated) |
| Reuses | `LAB/adapters/checkers/tscrs-wasm/build-from-source.sh` (reproducible build recipe pattern) |

### WP22 — TypeScript compatibility lane

| Field | Content |
|---|---|
| Purpose | A named lane for imported code and behaviour that resists the kernel split: tsc-rs as WASM checks, a child V8 isolate executes, inside an owned process and cgroup [E3 §5; E3-01, E3-09] |
| Inputs | WP16; tsc-rs build pinned by module hash (DEC-59); Microsoft native compiler as parity oracle |
| Deliverables | Checker using the lab's tsc-rs WASM build; executor in a child isolate inside an owned process as decision point DP-2 records (default: workerd under bwrap in an owned cgroup, the configuration that contained every case in the lab's smoke matrix [R12 §4.2]; never in-process without an outer process boundary); lane name on every receipt; admission rule distinct from the kernel path |
| Acceptance criteria | (a) Diagnostic parity with the TS7 native oracle on the lab's w-check workloads. (b) `alloc-heap-unbounded` is contained by the outer process boundary (the in-process child isolates failed this in the lab smoke matrix). (c) Every receipt from this lane carries `lane: compatibility` |
| Dependencies | WP16, WP01; DP-2 recorded |
| Experiments and campaigns | C04 (TypeScript arm), C06, C07 arm D |
| Estimate | 3–5 days (Estimated) |
| Reuses | `LAB/adapters/checkers/tscrs-wasm/` (`host.mjs`, `worker.mjs`, `index.mjs`, `vendor/ts_rust.size.wasm`, `vendor/ts_rust.speed.wasm`, `vendor/BUILD-INFO.txt`, `pins.json`), `LAB/adapters/checkers/ts7-native/`, `LAB/adapters/executors/isolated-vm/`, `LAB/adapters/executors/workerd/`; `LAB/workloads/w-check-small/`, `w-check-medium/`, `w-check-stress/`; `LAB/oracles/w-check-parity/`; `LAB-WT/fastloop/factory/src/tscrs-host.mjs` |

### WP23 — X4 kernel route-yield campaign

| Field | Content |
|---|---|
| Purpose | Decide the default route and whether removing the interpreter layer is justified now [E3 §15; R14 X4] |
| Inputs | WP19, WP21, WP22 (and WP20 if ready); 20 tasks with X2-frozen evaluators; WP18 memory increment; WP11 seeded subset |
| Deliverables | Registered C04 precommit; task set; paired, randomised generation schedule (five generations per task per route); results report; like-for-like per-guest increment for the QuickJS lane if a footprint ratio is quoted (R12 F06) |
| Acceptance criteria | (a) C04 precommit hashed before the first generation. (b) Model, prompt template and token budget pinned per route. (c) Yield bounds by cluster bootstrap over tasks. (d) Kill rule applied as written; an inconclusive result is reported as inconclusive |
| Dependencies | WP19, WP21, WP22, WP18, WP08; C03a decided (Stage 2 exit): the runner refuses the C04 precommit without a C03a receipt |
| Experiments and campaigns | E3 X4; C04 |
| Estimate | 5–8 days (Estimated) |
| Reuses | `LAB/harness/campaigns/primary-p6.json` (paired-block design reused, pilot numbers not); `LAB-WT/measure/docs/PILOT-2026-10-14.md` (block count lesson) |

### WP24 — X5 model-term measurement

| Field | Content |
|---|---|
| Purpose | Measure the model turn through the hosted path this project actually uses, the subscription CLI's lean mode, by effort and output length; then local batched generation against that hosted baseline on the target unified-memory machine [E3 §10, §15; DEC-65] |
| Inputs | WP03 unified-memory host record (part b); the user's subscription login of the unmodified CLI with `ANTHROPIC_API_KEY` unset (DEC-65, L-02); X4 kernel task set; WP19 compiler for concurrent compilation; probes `experiments/P-04-*` and `P-04b-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`). P-04b's runner (`run.mjs`: lean flags, login and key assertions, per-sample receipts, idempotent resume) is the starting point for the part-a harness |
| Deliverables | Part a harness (C05a, any host): the lean-CLI turn at two operating points (default effort; `--effort low`) and a no-prose prompt variant, recording time to first text, thinking and visible tokens, decode rate, total, context tokens, cache-read tokens and `asc` pass; descriptive, no kill. No API arm. The probe's operating points: 90.6 s / 10.0k tokens at default effort, 56.4 s / 5.9k at low, Sonnet 65.6 s (P-04b, n = 12 each). Cache state is "none" or "byte-identical" (prefix caching across different requests is unavailable through the CLI). Part b harness (C05b, the DP-5 unified-memory host, conditional): four-way batched local generation of about 1,000-token kernels, compilation concurrent, yield-adjusted time to first passing candidate against arm H (lean CLI, default effort), bandwidth counters; carries the X5 kill. A conditional third arm, local batched with type-constrained decoding (R19 §2.2), is built only if WP19's token-granular checker interface (Stage 6+ / optional) exists at freeze; otherwise C05 records the arm as absent and why. Registered C05a and C05b |
| Acceptance criteria | (a) Part a produces the first Recorded (campaign) model latency in the project, per operating point, with the CLI version, lean configuration and prompt hashes, and the runner's login and no-key assertions in the receipt. (b) Pilot of 8 pairs sets the final n before part b's official run. (c) Bandwidth contention measured from hardware counters, not inferred. (d) If DP-5 records no host, part b is registered as "not run, no host" and the placement decision is recorded as "undecided, hosted by default" in R16 (WP32), so C07 can freeze |
| Dependencies | WP23 (task set), WP19; part b also WP03 and DP-5 recorded; DEC-65 in force |
| Experiments and campaigns | E3 X5; C05; feeds C16, C17 |
| Estimate | 3–5 days plus hardware access (Estimated) |
| Reuses | `experiments/P-04b-bare-api-model-term/run.mjs` (lean CLI runner). None from the lab (the lab has no model in the loop). `FO-REV/tools/worker-fabric/testbed/model-smoke.py` as the prior failed local trial's method (F10) |

### WP25 — X6 hosted fit probe

| Field | Content |
|---|---|
| Purpose | Decide whether the hosted lane compiles or only runs pre-checked artifacts [E3 §13, §15] |
| Inputs | WP22 pinned tsc-rs WASM; WP09 engine (the gates to port); Cloudflare account with Dynamic Workers; probe `experiments/P-05-*` (Recorded (probe) at most; never a campaign result; see `experiments/README.md`) |
| Deliverables | The port of the WP09 cheap gates and the evaluator shim to the Workers runtime (this package owns the port; WP09 does not deliver it); a Worker containing tsc-rs WASM, that shim and one module instance; memory read as JS heap plus maximum WebAssembly linear memory; a 50-file overlay check against native; Dynamic Worker creation cost; the worst frozen project (`w-check-stress`) |
| Acceptance criteria | (a) Peak working set recorded for the worst-case project, 10 repeats. (b) Latency ratio from 30 paired runs per project with a bootstrap CI. (c) Platform limits rechecked and dated in R18 before the run (RISK-27) |
| Dependencies | WP22, WP09 |
| Experiments and campaigns | E3 X6; C06 |
| Estimate | 3–5 days (Estimated) |
| Reuses | `LAB/adapters/checkers/tscrs-wasm/memory-sensor.mjs`, `vendor/ts_rust.size.wasm`, `vendor/ts_rust.speed.wasm`; `LAB/workloads/w-check-stress/`; `LAB/harness/campaigns/secondary-p5-stress-memory.json` (P5 prediction, never measured) |

---

## Group E — The narrow whole cycle (Stage 4)

### WP26 — Declarative glue schemas and host renderer binding

| Field | Content |
|---|---|
| Purpose | Views, bindings and interaction tests ship as data validated by closed schemas; the host renders them and runs the event loop [E3 §5] |
| Inputs | WP13 effect schema; WP09 schema gate; a registered component set |
| Deliverables | Closed schemas for view specification, data and action bindings (exact owners and revisions), interaction tests, result schema; a host renderer that binds kernel state to registered components; accessibility and keyboard checks; host-side interaction CPU measurement |
| Acceptance criteria | (a) Glue with an unknown field, unregistered component or unbound action fails schema validation. (b) A binding to a source revision that has changed is reported stale, displayed qualified with a rebind proposal, as Field OS recorded (F19), not silently refreshed. (c) Axe and keyboard-journey checks pass on the slice's generated interface. (d) No glue artifact can call the broker, renderer or ledger except through the host |
| Dependencies | WP13, WP09 |
| Experiments and campaigns | C07 (UI task class), C14 |
| Estimate | 4–6 days (Estimated) |
| Reuses | `LAB/adapters/renderers/pw-chromium-fixedlib/` (`schema.mjs`, `sensor.mjs`, `verdicts.mjs`, `page/`, `browser-lock.json`), `LAB/docs/RENDERER.md`; `LAB/uihill/gates/fixtures.mjs`, `LAB/uihill/instruments/` (negative-control instruments) |

### WP27 — Whole-cycle integration: intake to activation

| Field | Content |
|---|---|
| Purpose | One request crosses all five boundaries: intake and contract, specification, workcell, qualification and activation, library and feedback [E3 §4] |
| Inputs | WP26, WP19 (or WP22 if X4 killed the kernel route), WP06, WP12 (provisional tier), WP15, WP17; C01 outcome |
| Deliverables | Intake that establishes authoritative inputs, budget and permitted effects and asks when the request is underdetermined; residual synthesis in a candidate-blind context overlapped with generation, frozen before evaluation (DEC-56); plain-language confirmation screen; qualification outside the workcell; guarded activation hook (WP28); library entry stub (contract, tests, lineage); counterexamples returned to the specification stage |
| Acceptance criteria | (a) A recorded end-to-end run produces a ledger chain from request to activation with every identity present. (b) An underdetermined request produces a question, not a candidate. (c) The evaluator hash is in the ledger before the first evaluation record (ledger timestamps). (d) The person's confirmation is recorded before the campaign starts. (e) Rung-4 attempt with a pass/fail rule: the DP-4 person states a task of their own in the slice domain (hashed) before the capability exists; the capability is qualified; the person completes the task with it, without the author touching the capability, its inputs or the person's session; the receipt holds the consent record, the task hash, the capability identity and the person's completion statement. Fail: the task is not completed, or any intervention is recorded. The plain-language confirmation screen this criterion needs is in this package; the fuller explanation view is WP29 (Stage 6+ / optional) |
| Dependencies | WP26, WP15, WP17, WP06; C04 decided; DP-4 recorded |
| Experiments and campaigns | C03b, C07, C08, C14 |
| Estimate | 6–10 days (Estimated) |
| Reuses | `FO-REV/src/fieldops/worker_fabric.py` (durable admission), `FO-REV/src/fieldops/worker_fabric_gateway.py` |

### WP28 — Activation, promotion rule and question loop; live revision with state preservation

| Field | Content |
|---|---|
| Purpose | Decide what "promoted" means and get a promoted capability activated: promotion is gated **and** persona-accepted (L-13, L-14); the product is a capability plus its recorded question, and the question is answered through R19 §2.1's disagreement loop before promotion where a person is available. The incumbent stays pinned until the replacement can take over without losing state, focus or authority; restart restores from durable records [E3 §1, §4; A sheet 14] |
| Inputs | WP27, WP04 activation CAS, WP18; the pilot's `factory/promote.mjs` (promotion rule), `persona.json` shape and `work/factory/INDEX.md` statuses; P-03's disagreement-input generator (`experiments/P-03-escape-rate-method/`) |
| Deliverables | Stage 4 (needed for rung 4): (1) the promotion rule as code: promoted = every fixed gate passed (G1–G7, WP29 for G7) and no persona reject; accept-with-change = promoted-pending-change, listed separately with the change named; a persona reject = gated-but-not-promoted with the question recorded; no persona record = gated-unreviewed, not promoted. (2) The question loop (R19 §2.1, pulled from Stage 6+ on 2026-10-17): for a capability promoted with an assumption, generate the input on which the candidate and its stated alternative (or two surviving candidates) disagree, pose it as a choice between concrete outputs, freeze the answer as a person-authored test, re-run the gates, then promote; the evaluator hash changes only on this person-authored evidence [R19 §2.1]. The input generator must be shape-aware, not uniform random (L-06). (3) Persona findings handed forward as input to a fresh worker when a reject is repairable (the pilot's C-006 path; one void per id), and recorded as gated-not-promoted when it is not (CC-011: no kernel holds the price). (4) Activation as CAS on a named slot; rollback; restart from durable records; every kernel revision activates only with the person's confirmation until C14 has run. Stage 6+ / optional (C14): state migration for kernel revisions checked by replaying recorded events through old and new kernels; focus and authority preserved across an automatic swap |
| Acceptance criteria | Stage 4: (e) A capability with any persona reject cannot be activated (test: the pilot's CC-011 record is refused). (f) A capability promoted with an assumption carries its question into the activation record and the rendered surface (WP29 G7). (g) The question loop produces, for a test contract with two readings, one disagreement input and one frozen person-authored test, and the re-gated capability promotes only after it. (b) Rollback restores the previous revision and state with zero loss in a test. (c) Kill during activation leaves exactly one active revision after recovery. (d) Restart restores the capability without any guest heap. Stage 6+ / optional: (a) A revision whose migrated state differs from the replayed expectation is refused and the incumbent stays active |
| Dependencies | WP27, WP04, WP18, WP29 (G7) |
| Experiments and campaigns | Rung-4 attempt (DP-4); C07; C14 (live revision half). Measured input: the X1 pilot's 2 of 41 → 1 of 41 persona rejections and 19 → 3 promoted under the stricter rule (Pilot (not a registered result)) |
| Estimate | 4–6 days (Estimated); the promotion rule exists in the pilot's `promote.mjs` and the question loop is the new work |
| Reuses | `campaigns/x1-spec-study/factory/promote.mjs` (promotion rule and statuses); `experiments/P-03-escape-rate-method/` (disagreement inputs); `FO-REV/src/fieldops/worker_fabric_recovery.py` (verified closure before state change) |

### WP29 — Legibility: the five presentation rules as glue gates, and the contract explanation view

| Field | Content |
|---|---|
| Purpose | A capability is explained by its contract and evidence, in the same plain language the person confirmed [E3 §12; DEC-62]. **On the critical path since 2026-10-17** (was Stage 6+ / optional): the persona review of the X1 pilot found that gated kernels fail as products on presentation, not on arithmetic, and that the five rules it named are enforceable as a gate on the declarative glue with no kernel change (17 of 17 backfills passed G7 with every kernel hash intact; L-13, L-14). Legibility is a property of the glue, as R04 §8 assumes |
| Inputs | WP26 glue schema; WP27 confirmation text; WP06 frozen evaluator record; WP04 receipts; the pilot's `factory/glue.schema.json`, gate G7 in `factory/gate.mjs` and `factory/try.mjs` (the renderer through the glue) |
| Deliverables | (1) The five presentation rules as universal gates on the glue (G7): a message for every trap saying why the input was refused and what to supply; the assumption printed with every answer; every number at field precision with its unit; a label for every boolean and integer code; one kernel per quantity (checked at promotion, not by the schema). Closed schema; a capability whose glue fails G7 is not promoted (WP28). (2) The contract explanation view: what was checked (residual sentence, invariants composed, universal gates), the evidence (receipt hashes, escape-rate tier of the domain), known failure cases and counterexamples, the assumption and the open question, and the revision history; source inspection on request. (3) Schema items the pilot's backfill found missing: per-condition trap rendering, argument defaults, closed tables for open-ended code ranges (L-14 notes) |
| Acceptance criteria | (a) Every statement on the view links to a ledger record. (b) The displayed residual text is byte-identical to the text the person confirmed. (c) In C07, the person can predict the capability's output on three held-out inputs before running them (recorded; a legibility secondary, not a primary). (d) G7 rejects a glue file missing any of: an export label, an argument unit, a result precision, a code or boolean label, a trap message for a trapping export, the assumption, the question (test: each omission on a passing fixture). (e) G7 passes without any kernel edit on a frozen kernel (the pilot's 17 backfills are the fixture) |
| Dependencies | WP26, WP27, WP06 |
| Experiments and campaigns | Rung-4 attempt (DP-4, through WP28's promotion rule); C07 (secondary c); C01 follow-up |
| Estimate | 2–4 days (Estimated); G7 and the schema exist in the pilot, the view and the schema gaps are the new work |
| Reuses | `campaigns/x1-spec-study/factory/{glue.schema.json,gate.mjs,try.mjs}` (G7 and the glue renderer) |

### WP30 — Matched end-to-end campaign

| Field | Content |
|---|---|
| Purpose | Compare whole loops on identical tasks with frozen evaluators, including a conventional agent in a warm container measured with time to specify [E3 §15; R14 §3] |
| Inputs | WP27–WP29; WP22 (arm D); a pinned coding agent and warm container (arm G); a warm native baseline (arm A); C18's rotation rule; price declaration |
| Deliverables | Registered C07; arm adapters reached through one front door; task set of at least 30 across the five task classes; frozen evaluators; results report with contradictions first |
| Acceptance criteria | (a) Every arm's representative and full options declared in the precommit before data (M8). (b) Every helper process inside its arm's accounting boundary (M9). (c) Unknown rate per arm at most 1 % (2 % in any lifetime) or the arm is inadmissible. (d) Verdict against arm G recorded, including inconclusive |
| Dependencies | WP27, WP28 (activation half), WP22, WP02, WP03; WP29 if built; C03b, C06, C18 decided; C05b decided or recorded as "not run, no host" with placement "undecided, hosted by default" (DP-5) |
| Experiments and campaigns | C07 |
| Estimate | 8–12 days (Estimated) |
| Reuses | `LAB/harness/campaigns/primary-p6.json` (open-loop stream, content-unique verified accepts, paired blocks, equivalence margin), `LAB/harness/run.mjs`, `LAB/harness/arm-server.mjs`; `LAB/CRITIQUE-2026-10-14.md` items 5, 7, 10 as review checklist |

---

## Group F — The library (Stage 5)

### WP31 — Library index with behavioural-fingerprint retrieval

| Field | Content |
|---|---|
| Purpose | Retain what compounds (contracts, invariants, tests, counterexamples) and retrieve by behaviour, with deprecation, deduplication and reclamation from the first entry [E3 §12] |
| Inputs | At least one accepted capability (C07 or WP27); WP05 lineage; WP10 invariants; WP06 |
| Deliverables | Capability contracts separate from implementations; per-implementation qualification records that do not transfer across environments; a behavioural fingerprint per implementation (outputs on a fixed probe set of inputs derived from the contract's schema, hashed); retrieval that proposes compositions by contract match and fingerprint, treated as a model call with its own trust properties when semantic search is used (RISK-28); deduplication by fingerprint; retirement of capabilities without a passing qualification against the current host (DEC-61); tenant scoping of code and sharing of data-free contracts and invariants |
| Acceptance criteria | (a) Two implementations with identical fingerprints are flagged as duplicates; differing ones are not merged. (b) A host contract bump marks every dependent capability for re-qualification; failures are retired automatically and logged. (c) A retrieval proposal never activates without full qualification against a frozen evaluator. (d) A cross-tenant query returns contracts and invariants only, never code or data (test with two tenants) |
| Dependencies | WP30 (or WP27 with one accepted capability), WP05, WP06, WP10 |
| Experiments and campaigns | C12; the rung-6 lifetime-economics campaign (to be drafted) |
| Estimate | 12–18 days (Estimated) |
| Reuses | `LAB/evaluator/lib/canonical.mjs` (fingerprint hashing) |

---

## Group G — Continuous

### WP32 — Documentation upkeep

| Field | Content |
|---|---|
| Purpose | Keep the reference library, registers and coverage map true as evidence arrives |
| Inputs | Every receipt; R12, R15, R16, R18; `docs/coverage/` |
| Deliverables | After each decided campaign: R12 row added (Recorded only from receipts); R15 risk status updated; R16 decision recorded; R18 sources rechecked and dated; `COVERAGE-MAP.md` and `EDITION-3-ERRATA.md` updated; WP status column maintained. Fill R15's "WP??" placeholders with the WP numbers in this document |
| Acceptance criteria | (a) No number appears in a reference document without a label and a source. (b) Every campaign with a receipt has its R12 row within one week. (c) A link check over `docs/` passes. (d) Every C-record's status line matches its registration state |
| Dependencies | None |
| Experiments and campaigns | All |
| Estimate | 5–8 days over the plan, about half a day a week (Estimated) |
| Reuses | `LAB/docs/LAB-DESIGN.md` rules 1 and 8 (labels; contradictions first) |

## Edition 3 alignment

- **Changed.** The Edition 2 package's 32 packages were organised around the workcell first [E2 §15, Appendix A]. Here the first twelve packages build the evaluation plane and the specification evidence; the workcell starts at WP13 [E3 §12, §15].
- **Superseded.** Packages built around QuickJS guests, per-candidate VFS, or TypeScript→JavaScript as the default candidate format. The QuickJS lane survives only as X4's comparison baseline (R12 F06).
- **Still holds.** Narrow whole cycle before depth; warm baselines; receipts for every number; failed lanes stay failed [E2 §15; E3 §2].

## Open questions

- Which runtime hosts the AssemblyScript compiler and the compatibility lane's child isolate on a Wasmtime host (E3-09, E3-10)? Now decision points DP-1 and DP-2 with defaults (`EXECUTION-PLAN.md` §7.1); WP19 and WP22 record the choice made; R16 should hold it.
- Can S2 domain-semantic faults be generated by the thousand (3,147 per domain) for the second domain (DP-3)? WP11 will find out; if not, that domain's Supervised tier is unreachable by measurement.
- Who is the named person for the rung-4 attempt (WP27), and under what consent? Now DP-4, due by Stage 3 exit.
- Does a behavioural fingerprint on a fixed probe set discriminate enough to deduplicate safely (WP31)? C12 measures retrieval, not deduplication; a separate check may be needed.
- Can the question loop (WP28, R19 §2.1) be run with a person in the time Edition 3 §10 allows (30 s if present), given the pilot's questions needed facts the technician mid-job may not hold (CC-011)? The rung-4 attempt is the first measurement.
- Does G7's "one kernel per quantity" rule need the library (WP31) to be checkable, since the pilot found three duplicate pairs only by reading all 19 contracts?

## Sources

- Edition 3 §1, §3–§13, §15, §17 (`sources/text/Endoforge-Edition-3.txt`); Edition 2 §3, §4, §10, §15; white paper pp. 20–22; diagram atlas sheets 14, 28.
- R03, R04, R06, R07, R11, R12, R13, R14, R15, R16, R18, R19 §2.1; `docs/templates/`; `docs/studies/mononoke/`; `docs/coverage/EDITION-3-ERRATA.md`.
- `campaigns/x1-spec-study/` (kit, factory protocol, receipts; Pilot (not a registered result)); `experiments/P-03-*`, `P-04-*`, `P-04b-*` (Recorded (probe)); `docs/execution/LESSONS-LOG.md` L-01 to L-14; `docs/execution/CRITIQUE-2026-10-17-reconcile.md`.
- `~/Work/isolate-factory-lab` at `a95a492` (paths listed per package; directory listings read 17 Oct 2026); `CRITIQUE-2026-10-14-precampaign.md`; branches `wip/precampaign-scoped` (`cc9ccfe`) and `wip/precampaign-deferred` (`007bcd5`); worktrees `fastloop` and `measure`.
- `~/Work/field-ops-github-review/` worker-fabric files as at `58d6826` (`src/fieldops/worker_fabric*.py`, `tools/worker-fabric/`).
