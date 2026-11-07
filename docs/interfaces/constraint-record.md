# Constraint record interface

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
