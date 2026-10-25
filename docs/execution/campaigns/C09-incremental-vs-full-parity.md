# C09 — Incremental versus full recomputation parity

> Reconstructed 2026-10-17. The original C09 was not available; this draft is rebuilt from
> Edition 2 (§7, §15), Edition 3 (§1, §13, §14), R06, R07 (§1.2, §5) and R15 (RISK-01, RISK-23). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

Edition 2 admits incremental semantic state only when it is backed by a comparison with full recomputation [E2 §7, §15]. R07 turns that into a rule: every incremental path ships with a differential test against full recomputation, in forward, reversed and shuffled orders, over valid and invalid programs, and over at least one edit with a large transitive effect. This record is that test, for the first incremental path proposed for admission.

## Summary

- The lab found two retained-state defects of exactly this kind (a stale tsc-rs native snapshot; a WASM incremental mode returning only re-emitted files) [R07 §1.2].
- One primary metric: parity mismatch rate over edit steps. Zero mismatches in 2,995 steps bounds the rate below 0.1 % (Derived).
- Any mismatch means the path is not admitted. CPU saving is a secondary and is not read unless parity holds.
- The path under test is named at freeze (candidates: retained parsed-library state in the compatibility-lane checker; incremental re-qualification in the library).

## Record header

| Field | Content |
|---|---|
| Record | C09 |
| Status | Draft — not registered |
| Stage | 6 |
| Work packages | WP22 or WP31 (whichever path is proposed), WP09, WP01 |
| Risk or decision addressed | RISK-01 (tsc-rs stale-output cases under build mode [E3 §13]), RISK-23 (measurement artefacts); R07 rule |
| What cannot be known yet | Which incremental path is proposed first; the edit workload (no workload with realistic edit locality exists in the lab [R07 open question]) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c09-incremental-parity-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | R07 differential rule; Stage 6 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Does the proposed incremental path produce byte-identical results to full recomputation on every edit step, including invalid programs and large transitive edits? It decides whether the path is admitted |
| Hypothesis and predicted observable | The path is admissible (Proposed): zero mismatches. Observable: byte comparison of diagnostics, emitted artifacts and verdicts per step |
| Strongest rival | Retained state leaks across steps: stale results look fresh, as the lab's two defects did [R07 §1.2] |
| Claim-ladder rung | None; it gates a Stage 6 reduction |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Parity mismatch rate = edit steps whose incremental output (diagnostics, emit, verdict) differs byte for byte from full recomputation ÷ edit steps |
| Decision rule | Admit only with zero mismatches over the planned n (upper bound below 0.1 %). One or more mismatches: not admitted; each mismatch is a defect record |
| Secondary metrics | CPU-seconds per step, incremental ÷ full (read only if parity holds); retained memory slope across a long session (upstream documents memory growth [E3 §13]) |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| I — Incremental | The proposed path with full options (TBD at freeze) | Digest TBD at freeze | Long-lived handle across the edit sequence | As the lane | Arm cgroup |
| F — Full recomputation | Fresh state per step, same tool version | Same tool digest | Fresh per step | As the lane | Arm cgroup |

Control arm: F. Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | none |
| Acceptance boundary | Byte equality of canonicalised outputs per step |
| Independent validator | F is the reference; a third run of F on a sample of steps checks F's own determinism |
| Parity rule | The primary is the parity measure |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Edit sequences over valid and invalid programs, each run in forward, reversed and shuffled order, including at least one edit class whose transitive closure is large (definition fixed at freeze, R07 open question). Sequence set SHA-256 TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One edit step |
| Planned n | 2,995 edit steps, split evenly across the three orders |
| Power calculation | Zero mismatches in n steps bounds the mismatch rate below 3/n at one-sided 95 %: 299 steps → below 1 %; 2,995 → below 0.1 % (Derived, exact binomial) |
| Minimum samples | At least 100 steps of the large-transitive-edit class |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Not applicable to the primary |
| Warm-up | Not applicable to the primary |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Recorded; gates only the CPU secondary |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Host-wide `/proc/stat` against arm cgroup CPU at every window boundary; out-of-cgroup work (including `systemd-coredump`) above 5 % of the arm's CPU invalidates the lifetime (threshold Proposed; WP02) |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | First mismatch does not stop the run (all mismatches are wanted for diagnosis); tool version change stops it |
| Kill criterion | Any mismatch: the incremental path is not admitted until a fixed version passes a new campaign |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Minutes to hours depending on the path (TBD at freeze) |
| Model | none |
| People | Author and reviewer time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Tool binaries or modules, edit sequences, canonicaliser: digests TBD at freeze.

## 13. Failure meaning

Admission covers only the tested path, tool version and edit distribution. Parity says nothing about speed; a fast path that fails parity has no admissible timing.

## 14. Monitoring and rollback

The runner watches the quiet gate, cgroup readbacks and unknown counts per block. Owned units are stopped through their cgroups. A partial receipt set is kept as evidence and never stitched into another campaign [RECEIPT §1]. Nothing outside the campaign's owned resources is touched.

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | Predictions: this record. Calibration receipt: TBD at registration. Evaluator: TBD at freeze. Workload: TBD at freeze |
| Approvals | Person approving the precommit (and the residual, where one exists): TBD at registration |
| Chain rule | Every evaluation request and the summary cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## Edition 3 alignment

- Edition 3 keeps change-proportional work as its first thesis point [E3 §1]; this record is the admission test for it.

## Open questions

- What counts as a "large transitive edit" for kernels rather than TypeScript projects?

## Sources

- Edition 2 §7, §15; Edition 3 §1, §13, §14.
- R06 §5; R07 §1.2, §5; R15 RISK-01, RISK-23.
- `~/Work/isolate-factory-lab/docs/CHECKERS.md` (retained-state defects).
