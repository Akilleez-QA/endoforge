# Repository path map

See [ADR 0001](docs/adr/0001-repository-layout.md) for the accepted decision.

Inventory generated from `git ls-files -z` on origin/main at fac4093d85859632f2885b4048eec9fc0a1847e5.
Every current tracked top-level directory and root file appears once. Untracked
and ignored files are outside this inventory. The two documents introduced by
this PR are listed separately below.

PR3–PR8 are planning slots, not allocated GitHub PR numbers. Each move needs its
own PR, even when several share a slot; record actual PR references as they land.
Retained entries have no move PR. Planned destinations are plain text because
they may not exist yet. Nothing is deleted outright; a later retirement moves
to `TODELETE/<original-path>` in a separate PR8-slot PR, with build and CI
exclusions in place. No retirement is selected here.

| Current tracked entry | Planned path | Move PR slot |
| --- | --- | --- |
| `.github/` | `.github/ (retained)` | — (no move) |
| `.gitignore` | `.gitignore (retained)` | — (no move) |
| `.gitleaks.toml` | `.gitleaks.toml (retained)` | — (no move) |
| `CODE_OF_CONDUCT.md` | `CODE_OF_CONDUCT.md (retained)` | — (no move) |
| `CONTRIBUTING.md` | `CONTRIBUTING.md (retained)` | — (no move) |
| `LICENSE` | `LICENSE (retained)` | — (no move) |
| `Makefile` | `Makefile (retained)` | — (no move) |
| `PRIOR-WORK.md` | `docs/research/prior-work.md` | PR4 |
| `README.md` | `README.md (retained)` | — (no move) |
| `SECURITY.md` | `SECURITY.md (retained)` | — (no move) |
| `campaigns/` | `research/campaigns/` | PR5 |
| `core/` | `src/core/` | PR6 |
| `docs/` | `docs/{adr,guides,policy,recipes,releases,research,verification}/ (classify by purpose)` | PR3 |
| `experiments/` | `research/experiments/` | PR5 |
| `skills/` | `.claude/skills/` | PR8 |
| `sources/` | `docs/research/sources/` | PR4 |
| `tests/` | `tests/ (retained)` | — (no move) |
| `tools/` | `src/ (runtime); scripts/ (development tooling)` | PR7 |

Added here: `PATHMAP.md` remains at the root; `docs/adr/0001-repository-layout.md` already has its final path. Neither needs a move PR.
