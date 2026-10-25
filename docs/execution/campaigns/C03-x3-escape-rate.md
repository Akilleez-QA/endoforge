# C03 — E3 X3: escape rate, sampled (a) and searched (b)

> Reconstructed 2026-10-17. The original C03 was not available; this draft is rebuilt from
> Edition 3 (§7, §11, §15), R14 X3 and §2, R15 (RISK-08, RISK-10) and R16 (DEC-44, DEC-45, DEC-57). Content follows Edition 3 where the editions differ.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists.

## Purpose

This record drafts the precommit for Edition 3's third experiment: the rate at which known faults pass the full harness and get promoted, per domain, first in random order (part a, Stage 2) and then inside a sixteen-wide search (part b, Stage 4) [E3 §7, §15]. Tiers are set on the searched rate (DEC-45). Part a and part b register as two campaign ids sharing this record, because each has its own primary metric.

## Summary

- Two domains: Field OS refrigeration engineering claims and the unrelated domain recorded at decision point DP-3 before C02 froze (`EXECUTION-PLAN.md` §7.1), because this record needs C02-frozen evaluators and a WP10 invariant set in that domain [R14 X3]. If DP-3 was not recorded, this record registers for one domain and no tier generalises.
- Part a runs on the interim lane, so its rate is per (domain, evaluator hash, candidate format) and names the lane; part b on kernels sets tiers (DEC-45).
- Plan for two allowed escapes: 6,294 non-equivalent seeded faults per domain certifies below 1 in 1,000 at one-sided 95 %; it certifies with probability 0.87 if the true rate is 1 in 5,000 (Derived, R14 §2).
- Four strata: S1 mechanical, S2 domain-semantic, S3 model-plausible, S4 searched (part b only). The tier decision rests mainly on S2.
- Kill (part b): searched escape rate above 1 in 1,000 keeps width at one [E3 §15]. At n = 6,294, 12 or more escapes put the lower bound above 1 in 1,000 (Derived).

## Record header

| Field | Content |
|---|---|
| Record | C03 |
| Status | Draft — not registered |
| Stage | Part a: 2. Part b: 4 |
| Work packages | WP09, WP10, WP11, WP12; C02 decided (qualified evaluators exist); part b also WP27 |
| Risk or decision addressed | RISK-08 (evaluator overfitting under search), RISK-10 (thresholds not supported by sample size), RISK-29; DEC-44, DEC-45, DEC-57 |
| What cannot be known yet | Whether S2 faults can be generated at this n (3,147 per domain) for the DP-3 domain; the frozen evaluators (from C02); the base candidates. The searched rate's definition per seeded fault, not per campaign, is fixed here (R14 open question) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c03a-x3-sampled-<UTC>-<6 hex>` and `c03b-x3-searched-<UTC>-<6 hex>`; TBD at registration |
| Label | `official` |
| Experiment | E3 X3 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | At what rate do seeded faults pass the full harness and get promoted, per domain, under random sampling (a) and under a sixteen-wide search (b)? It decides tier assignment per domain and whether width may rise above one |
| Hypothesis and predicted observable | Design assumption under test (Proposed): with universal gates, qualified domain invariants and a frozen, qualified residual, fewer than 1 in 1,000 seeded faults are promoted per domain, under sampling and under search. Observable: promotions of seeded faults, each attributed to the checks it passed |
| Strongest rival | The evaluator has blind spots that search finds: the searched rate is many times the sampled rate, and escapes cluster in a few tasks or one fault class [E3 §11]. A searched-to-sampled ratio well above 1, or escapes concentrated in S2 or S3, favours it |
| Claim-ladder rung | Rung 3, escape-rate half: part a moves the sampled half, part b the searched half [E3 §17]. Neither moves rung 4 or 5 |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Part a: sampled escape rate per domain = seeded faults promoted ÷ non-equivalent seeded faults submitted in random order, with its exact one-sided 95 % upper bound. Part b: searched escape rate per domain = seeded faults promoted ÷ seeded faults present in a sixteen-wide G = 0 search against the same frozen evaluator, with its bound |
| Decision rule | Per domain, at n = 6,294 non-equivalent faults. Upper bound below 1 in 1,000 (0, 1 or 2 escapes): eligible for Supervised (part a provisional, part b final). Lower bound above 1 in 1,000 (12 or more escapes; Derived, exact one-sided 95 %): fails. 3–11 escapes: not certified; the domain stays Confirmed and width stays one. A domain whose generator delivered fewer than 6,294 non-equivalent faults, or fewer than 3,147 of them in S2, is "not measurable at this n" and stays Confirmed; its partial count is reported with its bound and decides nothing |
| Secondary metrics | Escape rate by stratum and by fault class; searched ÷ sampled ratio; which check caught each fault (independent-error-source attribution [E3 §7]); equivalent-mutant fraction per stratum; cluster-bootstrap interval over tasks |
| Multiplicity | Two domains are separate decision units, each certified on its own; no pooling across domains. Stratum and class rates are diagnostic |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| H — Full harness | Universal gates (WP09) → domain invariants (WP10, version TBD at freeze) → frozen residual (from C02) → promotion rule; candidate width 1 in part a, 16 in part b | Harness, invariant library and evaluator tree digests TBD at freeze | Warm machinery; fresh per-candidate state | Part a: the interim lane (Field OS guest adapter or native baseline; candidates are JavaScript or TypeScript, mutated with the lab's typed-IR operators). Part b: the kernel workcell (WP14; kernel candidates, WP11's kernel-level operators). Lane and candidate format named on every receipt | Arm cgroup; WP02 assertions |

Control arm: Known-good anchors per task, which must be accepted (acceptance rate reported; a rejected anchor invalidates that task's faults). Null arm: none.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | One frozen residual per task, from C02's qualified set; hash TBD at freeze; any revision after seeing an escape is a new evaluator and a new X3 on fresh faults [R14 §2.3] |
| Acceptance boundary | Gate order as WP09; a fault is "promoted" only if the promotion rule would activate it; `outcome_unknown` is its own stage and counts neither as caught nor as escaped (admissibility: at most 1 %) |
| Independent validator | Differential execution against the known-good implementation on an extended input set labels every fault as non-equivalent before submission (WP11); in part b, an independent oracle labels searched candidates (S4) |
| Parity rule | A fault the validator labels equivalent is excluded and counted separately; never counted as caught |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | Per domain, at least 105 distinct tasks at 60 faults per task, or up to 210 at 30 (6,294 ÷ 60 = 104.9, Derived; R14 §2.3's "at least 100" does not reach the two-escape n at 60 per task), base candidates that pass the full harness, each with a WP11 known-good implementation. Task lists and generator digest TBD at freeze |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | Fresh fault seeds for any replication; the search proposer in part b never sees the seeded-fault list |
| Seeded faults | Generator WP11 (tree digest TBD at freeze). Part a proportions (Proposed): S1 25 % (1,574), S2 50 % (3,147), S3 25 % (1,573) of the 6,294 non-equivalent faults per domain; the S2 count is the one the Stage 2 narrowing rule reads. Part b: S1–S3 families present at the same proportions, plus S4 as found. Equivalence filter by differential execution; equivalent fraction reported per stratum |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One non-equivalent seeded fault (clustered by task) |
| Planned n | Part a: 6,294 per domain, 12,588 total. Part b: 6,294 seeded faults present per domain at width 16. C08 adds widths 1 and 4 |
| Power calculation | Exact one-sided 95 %: 2,995 (zero escapes), 4,742 (one), 6,294 (two) faults certify below 1 in 1,000. Probability a two-escape plan at n = 6,294 certifies: 0.97 at a true rate of 1 in 10,000, 0.87 at 1 in 5,000, 0.71 at 1 in 3,333, 0.39 at 1 in 2,000 (Derived, R14 §2.2). If escapes cluster, the effective n approaches the number of tasks; the cluster bootstrap is reported beside the exact bound |
| Minimum samples | 105 tasks per domain (210 at 30 faults per task); 6,294 non-equivalent faults per domain, 3,147 of them S2; 300 faults per fault class if a per-class diagnostic is wanted (bound about 1 %) |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Process-cold means a fresh process with page cache warm (caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm [R14 §4] |
| Steady-state rule | Not applicable: the metric is a count, not a timing |
| Warm-up | Not applicable |
| Placement | Pinned quiet cores taken from the WP03 record (not the scheduler's preferred cores); driver on separate cores; SMT policy recorded; no `cpu.max` on timed runs [R14 §4] |
| Quiet gate | Recorded but not gating: the primary is a count |
| Calibration | WP01 calibration receipt, plus a planted-escape check: the harness reports exactly the planted count on a calibration set (WP12 acceptance a) |
| Accounting cross-check | Not timing-relevant; cgroup containment still asserted |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | All planned faults submitted; evaluator hash change (stop: new campaign); anchor rejection rate above 1 % (stop: evaluator defect); unknown rate above 1 % |
| Kill criterion | Searched escape rate above 1 in 1,000 with the full harness: width stays at one until a new non-model check lands [E3 §15]. Operationally: 12 or more escapes of 6,294 searched faults in a domain (Derived) |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Harness compute is about 10 minutes to under 2 hours per domain at an assumed 0.1–1 s per run (Estimated, R14 §2.4) |
| Model | S3 generation: about 6 million tokens per domain at 1,000 tokens per fault (Estimated, R14 §2.4); model TBD at freeze |
| People | Fault-generation review and equivalence spot checks; about 2 person-days per domain (Estimated) |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Main-rig (local lane): Ryzen 9 7950X, 16 cores / 32 threads, about 125 GiB RAM, kernel `7.2.5-3-omarchy`, shared desktop (as recorded 8 Oct 2026 [R12 §2]). Microcode, governor, frequency policy, SMT state, cgroup controllers, and Node, Wasmtime and compiler versions with binary hashes: TBD at registration, from the WP01 snapshot and the WP03 record. Repository head TBD at registration; dirty tree refused (official).

## 12. Artifact identity

Harness, invariant library, evaluators, generator, base candidates, known-good implementations, extended input sets: each with tree digest TBD at freeze.

## 13. Failure meaning

A failed domain is not "unsafe"; it is not certified, and it stays Confirmed. A pass certifies the rate only for that domain's fault distribution, that evaluator hash and that candidate format on that lane; it does not transfer to another domain, another evaluator, another candidate format (part a's interim-lane candidates are not kernels), or a model proposer (part b uses G = 0 search). The sampled rate never sets a tier on its own (DEC-45).

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

- Edition 3 gives thresholds without sample sizes (E3-03). This record adopts R14's exact bounds and the two-escape plan.
- Edition 3's §6 calls the seeded-fault list "the shape of the existing six-case fixture" (E3-22); the S2 templates here follow §7's list, not the fixture.

## Open questions

- Can the DP-3 domain supply 3,147 non-equivalent S2 faults and 105 known-good implementations? If not, the Supervised tier is unreachable by measurement for it (R14) and this record says so rather than pooling.
- Does a model proposer (G > 0) need its own part c? Proposed: yes, once a model proposer exists; G = 0 search understates model-driven pressure.

## Sources

- Edition 3 §6, §7, §11, §15.
- R14 X3 and §2; R15 RISK-08, RISK-10, RISK-29; R16 DEC-44, DEC-45, DEC-57; errata E3-03, E3-22.
- `~/Work/isolate-factory-lab/evaluator/lib/search.mjs`; `workloads/w-search/generator/mutate.mjs`.
