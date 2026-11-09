# Constraint record interface

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-ICD-CONSTRAINT |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

An append-only record of human constraints, kept separately from compaction summaries and reinjected verbatim at resume. Evidence and limits: [P-55](../../experiments/P-55-constraints/RESULT.md). Off unless a caller passes it; neither extractor has met the adoption bar.

| Interface | Contract |
|---|---|
| `core.constraints.port` | `Message`, `Origin`, the `Extractor`, `Store` and `ConstraintPort` protocols |
| `ConstraintRecord.observe(message)` | Warm path: appends to memory. No process, no I/O |
| `ConstraintRecord.cross()` | The one durable crossing, once per compaction: one extraction, one append, one fsync |
| `ConstraintRecord.resume_block()` | Active constraints as JSON strings with source message identity, plus any failure lines |
| `ConstraintRecord.set_status(id, status, by)` | Appends a status event. Only a human message can do this, and only on a human record |
| `tools.constraint_store.JsonlStore` | Durable `Store` adapter: hash-chained JSON lines, verified before each append |
| `StepHarness(constraints=port)` | Crosses before each fold and adds `constraint_record` to the view after the first checkpoint |
| `core.constraints.transcript.to_message` | Classifies a transcript record from transport metadata, never from its text |

Provenance: only human segments can be active. Tool, agent, assistant and system text, and blocks quoted inside a human message, are recorded as `refused` when they match a trigger and cannot be promoted. Model output that is not an exact substring of a human segment, or that reports someone else's words, is refused too. The record has no permission type, and its block states that it grants none.

Failure: any extractor exception appends a `failure` event, keeps the messages pending and adds `EXTRACTION FAILED` and `NOT YET EXTRACTED` lines to the block until a later crossing covers them. A broken hash chain raises `RecordCorrupt`. An extractor that returns nothing is not a failure, so low recall stays silent; see P-55.

Replay after a crash re-observes from the transcript; record identities are deterministic, so nothing duplicates.

## Requirements addressed

REQ-CONSTRAINT-001, REQ-CONSTRAINT-002.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | before 2026-11-08 | — | Written with P-55 | earlier PRs |
| 2.0 | 2026-11-08 | `4d692a4` | Metadata header, requirements addressed and change history added; content re-baselined | this PR |
