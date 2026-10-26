# Endoforge documentation index

Start with Edition 3 (`sources/pdf/Endoforge-Edition-3.pdf`). It is the governing design. Read `CONVENTIONS.md` before editing anything here.

## Reference library (`reference/`)

| ID | Title | Covers | Edition 2 mapping |
|---|---|---|---|
| R01 | Founding thesis | Software creation as a runtime operation; the two products; the north-star unit | E2 §1–2; E3 §1, §3 |
| R02 | The factory model | Workpiece vs machinery, setup and changeover, flow and WIP limits, inspection, scrap and reclamation, the scorecard | E2 §3; E3 §4 |
| R03 | Intake routes and keeper finishing | Routes into WASM, the kernel-plus-glue contract, compatibility lane, total feedback cost, refinement without identity loss | E2 §4; E3 §5 |
| R04 | Generative applications and retained capability | Host/factory split, live revision, the library as inventory, legibility, tenant-bound lineage | E2 §5, §9, §13; E3 §12 |
| R05 | Improvement loops and campaign controls | Product/discovery/machinery loops, promotion rules, Pareto profiles, holdout hygiene, break-even arithmetic | E2 §6; E3 §11 |
| R06 | Low-hanging performance reductions | Smaller generated surfaces, prepared dependencies, artifact reuse, parameter families, batching, conversions, reclamation | E2 §15; lab FASTLOOP |
| R07 | Persistent semantics and shared search | Incremental semantic state, structured changes, candidate families, e-graphs, coalescing, campaign specialization, useful failure | E2 §7 |
| R08 | Physical constraints | The lower-envelope model, distance, movement, thermodynamics, search and information limits | E2 §11; E3 §13 (two consequences) |
| R09 | Unified memory and local reasoning placement | Placement, shared-bandwidth budget, zero-copy as an interface property, decode estimates | E2 §12; E3 §10 |
| R10 | Source-control pressure and ledger requirements | Scion motivation, why every experiment cannot be a repository event, ledger requirements | E2 §10 |
| R11 | The experiment ledger | Identity separation, derivation on demand, bubbles, conditional publication, observations vs derived data | E2 §10; `studies/mononoke/` |
| R12 | Recorded observations versus missing proof | Every recorded number, its scope, and what it does not establish | E2 §14; E3 §14 |
| R13 | Implementation sequence | Build the whole cycle narrowly, then deepen | E2 §15; E3 §15 |
| R14 | Matched experiments and benchmark programme | X1–X6, the matched end-to-end campaign, measurement discipline | E3 §15; lab PREDICTIONS |
| R15 | Risk register | RISK-nn entries | E3 §13 |
| R16 | Decision register | DEC-nn entries, including every Edition 3 reversal | E3 §2 |
| R17 | Terminology | Defined terms | all |
| R18 | Source register | SRC-xx entries with revalidation status | E3 §18 |
| R19 | Frontier: the three irreducible costs | Ranking of costs by physical weight; ten proposed changes; what Edition 4 should change | none (written 17 Oct) |

## Execution (`execution/`)

- [`EXECUTION-PLAN.md`](execution/EXECUTION-PLAN.md): the vertical slice and its gates.
- [`WORK-PACKAGES.md`](execution/WORK-PACKAGES.md): WP01–WP32.
- [`CRITIQUE-2026-10-17-plan.md`](execution/CRITIQUE-2026-10-17-plan.md): the independent critique the plan was revised against.
- [`LESSONS-LOG.md`](execution/LESSONS-LOG.md): dated operational lessons (what was learned doing the work; decisions go to R16).
- [`HILLCLIMB-METHOD.md`](execution/HILLCLIMB-METHOD.md): the repeatable loop for improving the factory, v2.3 (the spec is the incumbent, not the law; deviation step every loop; three-rater sealed oracle panel under protocol v1.1; canaries; no human step; two cadences; loop 1 run and recorded, the ruler is loop 2's first work).
- [`POODO-CAPSULE-2026-10-17-hillclimb.md`](execution/POODO-CAPSULE-2026-10-17-hillclimb.md): continuity capsule for the method decision (claims, rivals, predictions, authority).
- [`../REPORT-2026-10-17.md`](REPORT-2026-10-17.md): end-of-day status report (what exists, what was measured, decisions, delivery, claim ladder, open items).
- [`TESTING-WRITEUP-2026-10-17.md`](TESTING-WRITEUP-2026-10-17.md): the testing write-up (what kind of testing, each probe, the pilot, persona review, delivery checks, what changed, open items); shareable copy at https://claude.ai/code/artifact/0892bb75-b8c4-4c55-86ff-af6e73a34dda.
- `campaigns/`: C01–C18 precommit records, plus [`TEMPLATE.md`](execution/campaigns/TEMPLATE.md):
  - [C01](execution/campaigns/C01-x1-specification-study.md): E3 X1: specification study
  - [C02](execution/campaigns/C02-x2-evaluator-error-rate.md): E3 X2: evaluator error rate
  - [C03](execution/campaigns/C03-x3-escape-rate.md): E3 X3: escape rate, sampled (a) and searched (b)
  - [C04](execution/campaigns/C04-x4-kernel-route-yield.md): E3 X4: kernel route yield
  - [C05](execution/campaigns/C05-x5-model-term.md): E3 X5: the model term
  - [C06](execution/campaigns/C06-x6-hosted-fit.md): E3 X6: hosted fit
  - [C07](execution/campaigns/C07-matched-end-to-end.md): Matched end-to-end campaign
  - [C08](execution/campaigns/C08-escape-rate-by-width.md): Searched escape rate at candidate widths 1, 4 and 16
  - [C09](execution/campaigns/C09-incremental-vs-full-parity.md): Incremental versus full recomputation parity
  - [C10](execution/campaigns/C10-parameter-family-vs-separate.md): Parameter family versus separate-program evaluation
  - [C11](execution/campaigns/C11-batch-evaluation-movement.md): Batch evaluation: does CPU fall, or only move?
  - [C12](execution/campaigns/C12-library-retrieval-hit-rate.md): Library retrieval hit rate
  - [C13](execution/campaigns/C13-keeper-refinement-break-even.md): Keeper refinement break-even
  - [C14](execution/campaigns/C14-state-preserving-live-revision.md): State-preserving live revision
  - [C15](execution/campaigns/C15-reclamation-bytes.md): Reclamation bytes after a campaign
  - [C16](execution/campaigns/C16-unified-memory-contention-sweep.md): Unified-memory contention sweep
  - [C17](execution/campaigns/C17-local-vs-hosted-evaluator-synthesis.md): Local versus hosted evaluator synthesis
  - [C18](execution/campaigns/C18-holdout-adaptation.md): Holdout adaptation under repeated scoring

## Studies (`studies/`)

- [`mononoke/STUDY.md`](studies/mononoke/STUDY.md): source study of Mononoke mechanisms at sapling `79071c2a`; all seven Edition 2 claims confirmed.
- [`scion/STUDY.md`](studies/scion/STUDY.md): Anthropic's Scion (13 Oct 2026 post) and its mapping to Mononoke and to Endoforge.

## Campaign kits (`../campaigns/`)

- [`campaigns/x1-spec-study/`](../campaigns/x1-spec-study/README.md): the X1 specification-study kit (C01, WP07): intake and contract templates, frozen rubric, timer, blind-half export, analysis with DP-6 bands and Clopper–Pearson intervals. `make x1-test` reproduces R14's interval values.
- [`campaigns/hillclimb-loop-01/`](../campaigns/hillclimb-loop-01/receipt/PRECOMMIT.md): loop 1 of the factory hill-climb (18 Oct 2026): metered single-shot kit (`lib/`, `bin/`), versioned briefs, the freeze (working/sealed split, canary packet, fixed-file hashes), the deviation step (`receipt/deviations.md`), the hashed precommit and forecast ledger, noise floor, screen, sealed set, decision and hand-offs under `receipt/`; request text stays in git-ignored `work/`.

## Experiments (`../experiments/`)

- [`experiments/README.md`](../experiments/README.md): de-risking probes P-01–P-06, their rules, and what they may and may not be cited for.

## Templates (`templates/`)

- Hardware qualification, campaign precommit, receipt.

## Coverage (`coverage/`)

- [`COVERAGE-MAP.md`](coverage/COVERAGE-MAP.md): every topic in Editions 2 and 3 → the document that carries it.
- [`EDITION-3-ERRATA.md`](coverage/EDITION-3-ERRATA.md): the 30 known inconsistencies in Edition 3, each with a proposed correction.

## Added 18 October 2026

- [`REPORT-2026-10-18.md`](REPORT-2026-10-18.md): where things stand after loop 1 and the speed track, what was missed, ranked opportunities, and corrections to the record.
- [`audits/AUDIT-2026-10-18-codex.md`](audits/AUDIT-2026-10-18-codex.md): the independent Codex audit of all results, kept verbatim.
- [`figures/baseline-20-then-and-now.png`](figures/baseline-20-then-and-now.png): the 20 loop-0 requests, 17 Oct against 18 Oct (data in the matching `.json`).
- [`execution/LOOP-1-BRIEF.md`](execution/LOOP-1-BRIEF.md) and `campaigns/hillclimb-loop-01/`: loop 1's brief, kit and receipts (`receipt/DECISION.md`).
- `tools/atomizer/`: the task atomizer and speed track: `README.md`, `LEDGER.md` (schema of the append-only ledger), `SPEED.md`, `CUTOVER.md`, `RESULTS.md`, `ledger/`.
- `experiments/P-08-request-blind-evals/`: request-blind versus stub-fed evals (DEC-80 evidence).
- [P-09 portable campaign replay](../experiments/P-09-portable-campaign/RESULT.md): Docker toolchain packaging, frozen-gate replay, role visibility, same-host archive round trip and startup overhead; Recorded (probe), no live agents or quality claims.
- [Portable campaign qualification](execution/PORTABLE-CAMPAIGN-QUALIFICATION-2026-10-18.md): P-10 through P-13 follow-ups: live host workers to Docker verification, empty-runtime recovery, owned-container lifecycle/reconciliation, fresh dependencies and equal-resource timings; Recorded (probe), remaining boundaries explicit.
- [Next 50 work items](execution/NEXT-50-2026-10-18.md): proposed dependency-linked backlog from trustworthy evals and intent handling to controlled execution, complete workflows, portability and a fresh-request comparison; planning only.
- [Next-50 execution](../campaigns/next50-20261018/README.md) and [item status](../campaigns/next50-20261018/control/STATUS.md): dependency-aware execution evidence and current subscription-authentication gate. Implemented mechanisms are separated from qualified items; no whole-cycle or fresh-request win is inferred.

## Playbooks

- [PLAYBOOK-deadline-fanout.md](PLAYBOOK-deadline-fanout.md): atomize → parallelize → recombine for deadline runs, the operating loop (iterate, measure, learn, improve the tool, repeat), and what enforces each lesson (2026-10-26, from the a collaborator run).
