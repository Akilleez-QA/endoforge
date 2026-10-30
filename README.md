# EndoForge

EndoForge treats software creation as a runtime operation. A running system takes cheap model proposals and turns them into trusted, reusable capabilities, under rules that let the result be trusted without trusting whatever wrote it.

The design is set out in [Edition 3](sources/pdf/Endoforge-Edition-3.pdf). In short:

- **Proposals are cheap; trust is earned.** Models propose code. Independent checks, frozen evaluations and bounded verification decide whether it is accepted.
- **Work runs in isolates.** Checks run inside warm WebAssembly isolates instead of cold processes, so each check is fast and contained.
- **Passed capabilities are reused.** Once a capability passes, it becomes a function call instead of repeated work.
- **Everything leaves a receipt.** Every run records what happened, what failed and what was learned.

## Status

Preproduction research code. Not ready for production use. See the repository guide below for current status.

## Getting started

Requirements: Python 3.11+ and Node.js 20+.

```
make check
make x1-test
make ledger-test
make engine-test
make atomizer-test
```

## License

Not yet chosen. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

---

## Repository guide


Software creation as a runtime operation: a running system that turns cheap model proposals into trusted, reusable capabilities, under rules that let the result be trusted without trusting the thing that wrote it.

**Status (18 Oct 2026):** runnable preproduction scalar factory with Codex subscription CLI and local Qwen, independent source checks, frozen evals, bounded verification/publication and encrypted offline-stage resume on a second physical host. Claude Code CLI is disabled. The [manifest-driven runner](tools/factory_campaign/README.md) passed a real end-to-end probe. The [comparison decision](campaigns/next50-20261018/DECISION.md) is **no evidence to adopt**: both policies passed the small synthetic packet; the completed audit records incomplete historical criteria conversion in the [execution ledger](campaigns/next50-20261018/control/STATUS.md). No application or production capability is deployed.

## Where to start

1. [Edition 3](sources/pdf/Endoforge-Edition-3.pdf) — the governing design.
2. [docs/INDEX.md](docs/INDEX.md) — the reference library, execution plan, studies and templates.
3. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — evidence labels and document rules. Read before editing.
4. [PRIOR-WORK.md](PRIOR-WORK.md) — the earlier lab and Field OS work this builds on.

## Operating loop

Craig, 2026-10-26: "we ALWAYS work like this, iterate measure learn improve repeat". Endoforge runs every job in that loop:
- **Iterate.** Run short rounds.
- **Measure.** Every `endoforge run` receipt carries `lessons`: failed launches, retries, failovers, the slowest atom and queue waits. Every hill-climb round writes `rounds/rNN/LESSONS.md`.
- **Learn.** Keep a running `NOTES.md` of mistakes with their cost, and of findings.
- **Improve the tool.** Each lesson becomes a tool or PR change; `hillclimb.mjs lessons --close` records which one, and every round lists the lessons still open.
- **Repeat.**

Shape the work as **atomize → parallelize → recombine**, with **projection** (evals turn the output into numbers) and **attribution** (each finding goes to the atom that owns it). See [the deadline fan-out playbook](docs/PLAYBOOK-deadline-fanout.md) and the hill-climb tool's fan-out mode (`tools/hillclimb`).

## Layout

| Path | Contents |
|---|---|
| `sources/pdf/`, `sources/text/` | The four source documents (Edition 3, Edition 2, white paper, diagram atlas) and their extracted text. `sources/SHA256SUMS` pins them. |
| `docs/reference/` | R01–R18, the engineering reference library (reconstructed). |
| `docs/execution/` | Execution plan, work packages WP01–WP32, campaign records C01–C18. |
| `docs/studies/` | Source studies (Mononoke). |
| `docs/templates/` | Campaign precommit, receipt, hardware qualification. |
| `docs/coverage/` | Topic coverage map and Edition 3 errata. |
| `experiments/` | De-risking probes P-01–P-06 with precommits, receipts and results (Recorded (probe)). |
| `campaigns/` | Campaign kits: `x1-spec-study/` runs C01 (Edition 3 X1) end to end. |
| `tools/`, `Makefile` | Document checks and atomizer, plus preproduction quality/runtime/portability/campaign modules. Existing `make test` covers documents, X1 kit self-tests and Mononoke source verification; new module checks are listed in the next-50 execution handoff. |

## Provenance

Editions 2 and 3 and the white paper came out of conversations held outside this repository. The Edition 2 engineering reference library they cite was not preserved, so `docs/` is a reconstruction built from the surviving documents and from the local work listed in `PRIOR-WORK.md`. Reconstructed documents say so at the top.
