# EndoForge

EndoForge treats software creation as a runtime operation. A running system takes cheap model proposals and turns them into trusted, reusable capabilities, under rules that let the result be trusted without trusting whatever wrote it.

The governing design is [Edition 3](sources/pdf/Endoforge-Edition-3.pdf). Its core ideas:

- **Repeated understanding is the expensive part.** Proposals from models are cheap; re-deriving the same understanding on every job is what costs time and compute.
- **Specification first.** Work starts from a spec and its checks, not from generated code.
- **Trust is measured.** A capability's trust is the escape rate of planted bugs under independent checks and frozen evaluations.
- **The model never grades itself.** Acceptance comes from checks the proposer cannot see or change.
- **Work runs in isolates.** Checks run in warm WebAssembly isolates with declarative glue, instead of cold processes.
- **Passed capabilities are reused.** Once a capability passes, using it again is a function call, not another model turn.
- **Everything leaves a receipt.** Every run records what happened, what failed and what was learned.

## Status

Preproduction research code. Not ready for production use, and no production capability is deployed. Interfaces will change.

## Measured so far

From the repository's own benchmarks on a 32-core workstation (RTX 4080, ~93 GiB free RAM), October 2026:

| Measure | Cold process | EndoForge isolate |
|---|---|---|
| Type/test checks per second (peak) | ~11 (cold `tsc`) | ~324 |
| Median check latency, 1 at a time | 489 ms | 35 ms |
| Median job wall time (atomizer) | 97 s | 30 s |

These are single-machine measurements without error bars. Receipts live under `experiments/` and `campaigns/`.

## Getting started

Requirements: Python 3.11+, Node.js 20+, GNU Make.

```
make check
make ledger-test
make engine-test
make atomizer-test
```

## Where to read next

1. [Edition 3](sources/pdf/Endoforge-Edition-3.pdf), the governing design.
2. [docs/INDEX.md](docs/INDEX.md), the reference library, execution plan, studies and templates.
3. [docs/CONVENTIONS.md](docs/CONVENTIONS.md), evidence labels and document rules. Read before editing.
4. [PRIOR-WORK.md](PRIOR-WORK.md), the earlier lab work this builds on.

## How work runs

Every job runs in one loop: iterate, measure, learn, improve the tool, repeat.

- **Measure.** Every `endoforge run` receipt carries `lessons`: failed launches, retries, failovers, the slowest step and queue waits. Every hill-climb round writes `rounds/rNN/LESSONS.md`.
- **Learn.** Mistakes and findings go into a running `NOTES.md` with their cost.
- **Improve.** Each lesson becomes a tool or PR change; `hillclimb.mjs lessons --close` records which one.

Work is shaped as atomize, parallelize, recombine. Evaluations turn output into numbers, and each finding is attributed to the step that owns it. See [the fan-out playbook](docs/PLAYBOOK-deadline-fanout.md) and `tools/hillclimb`.

## Layout

| Path | Contents |
|---|---|
| `sources/` | The source documents (Edition 3, Edition 2, white paper, diagram atlas) as PDF and extracted text, pinned by `sources/SHA256SUMS`. |
| `docs/reference/` | R01 to R18, the engineering reference library (reconstructed). |
| `docs/execution/` | Execution plan, work packages and campaign records. |
| `docs/studies/`, `docs/templates/`, `docs/coverage/` | Source studies, templates, the topic coverage map and Edition 3 errata. |
| `experiments/` | De-risking probes with precommits, receipts and results. |
| `campaigns/` | Campaign kits and their records. |
| `tools/`, `Makefile` | Runtime, ledger, engine, atomizer, hill-climb and document checks. |

## Provenance

Editions 2 and 3 and the white paper were written outside this repository. The Edition 2 reference library they cite was not preserved, so `docs/` is a reconstruction from the surviving documents and prior local work. Reconstructed documents say so at the top.

## License

GNU General Public License v3.0 only (SPDX: `GPL-3.0-only`). See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
