# Documentation conventions

Every document in this repository follows these rules. They exist so that a reader can tell, for any sentence, whether it reports something that happened or something that is intended.

## Governing order

1. **Edition 3** (`sources/pdf/Endoforge-Edition-3.pdf`, 17 Oct 2026) governs the architecture.
2. **Edition 2** (`sources/pdf/Endoforge-Edition-2-The-Entire-Idea.pdf`, 16 Oct 2026) is the broad concept narrative. Where it disagrees with Edition 3, Edition 3 wins, and the reference document says so in its "Edition 3 alignment" section.
3. **The white paper** (`sources/pdf/In-Isolate-Software-Workshop-v1.pdf`, 14 Oct 2026) and **the diagram atlas** (`sources/pdf/Diagram-Atlas.pdf`, 30 sheets) record the original TypeScript/QuickJS workshop design and the Field OS evidence.
4. **Local work on this machine** is primary evidence where it exists:
   - `~/Work/isolate-factory-lab` (and its worktrees under `~/Work/isolate-factory-lab-wt/`): the 14 Oct test lab.
   - `~/Work/field-ops-github-review/docs/receipts/FIELD-OS-WORKER-FABRIC-*.md` and `~/Work/field-ops/docs/specs/FIELD-OS-WORKER-FABRIC-V1.md`: the Worker Fabric receipts Edition 3 cites.

Extracted text of the four PDFs is in `sources/text/`. Cite PDFs by page (`[E3 §6]`, `[E2 §4]`, `[W p.10]`, `[A sheet 07]`) and local files by repo-relative path.

## Reconstruction notice

The Edition 2 engineering reference library (R01–R18, 32 work packages, 18 campaign records, the Mononoke study) was originally written in a ChatGPT conversation that is not available here. This repository **reconstructs** it from the sources above. Each reconstructed document starts with:

```
> Reconstructed 2026-10-17. The original R0x was not available; this version is rebuilt from
> [sources]. Content follows Edition 3 where the editions differ.
```

Never present reconstructed text as the original. Never invent a recorded result, a receipt, a commit, a measurement, or a quotation.

## Evidence labels (Edition 3 §2)

Every number and every architectural claim carries one label:

| Label | Meaning |
|---|---|
| **Recorded** | Reported by a receipt from a real run. Not rerun unless the document says so. Cite the receipt. |
| **Upstream** | Reported by a third-party maintainer, pinned where possible. |
| **Derived** | Arithmetic from stated values. Show the arithmetic. |
| **Estimated** | Order-of-magnitude figure reasoned from public data, not measured here. |
| **Proposed** | Intended architecture, experiment, or rule. Nothing establishes it yet. |

Edition 2 also used **Illustrative** (a calculation from stated assumptions) and **Speculative** (a longer-term possibility). Here, Illustrative is written as **Derived** with the assumptions shown, and Speculative as **Proposed** with a horizon stated. Probe results from `experiments/` are labelled **Recorded (probe)** and may not be cited as campaign results.

Lab pilot numbers are labelled **Pilot (not a result)**, following the lab's own rule that pilot numbers are never reported as results.

## Document shape

- Title, then the reconstruction notice, then a one-paragraph **Purpose**.
- A **Summary** of at most five bullets.
- Body sections, plainly written: short sentences, tables where comparison helps, no marketing language.
- **Edition 3 alignment**: what changed, what is superseded, what still holds.
- **Open questions**: things the document cannot settle; link the experiment or work package that would.
- **Sources**: the exact sources used.

Write in British-neutral technical English as the editions do. Name people with they/them. Markdown only; diagrams as Mermaid where a diagram helps.

## Identifiers

| Prefix | Meaning | Where |
|---|---|---|
| R01–R18 | Reference documents | `docs/reference/` |
| WP01–WP32 | Work packages | `docs/execution/WORK-PACKAGES.md` |
| C01–C18 | Campaign records (precommit templates) | `docs/execution/campaigns/` |
| X1–X6 | Edition 3 experiments (§15) | referenced as `E3 X1` etc. |
| RISK-nn, DEC-nn | Risk and decision register entries | R15, R16 |
| SRC-xx | Source register entries | R18 |
