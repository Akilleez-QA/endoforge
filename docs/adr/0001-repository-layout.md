# ADR 0001: Repository layout

## Status: Accepted

## Context

Endoforge mixes specifications, source evidence, experiment receipts, runtime code,
and development tools at the root. This obscures ownership and makes relocation
risky because imports, commands, links, and CI refer to current paths.

The reference is [foundation-engine](https://github.com/Akilleez-QA/foundation-engine),
whose docs tree separates ADRs, guides, policy, recipes, releases, research, and
verification. Its root retains entry points, governance, and build configuration.
We adopt those documentation categories while using Endoforge's required runtime,
research, and skill destinations. This is a layout decision, not a claim that the
two repositories have identical structures.

## Decision

This PR adds only this decision and the [path map](../../PATHMAP.md). It moves no
files. PR3 through PR8 below are planned migration slots, not existing GitHub PR
numbers or promises about the numbers GitHub will allocate.

Each independently listed move lands in its own PR, with tests green after each
one. Within a slot containing multiple moves, use separate PRs and record their
actual GitHub numbers in PATHMAP before landing them. Never combine moves merely
to fit the six planning slots.

| Slot | Move |
| --- | --- |
| PR3 | Reclassify existing docs into docs/adr, docs/guides, docs/policy, docs/recipes, docs/releases, docs/research, and docs/verification. |
| PR4 | Move sources into docs/research/sources; separately move PRIOR-WORK.md to docs/research/prior-work.md. |
| PR5 | Move experiments to research/experiments; separately move campaigns to research/campaigns. |
| PR6 | Move core to src/core. |
| PR7 | Split tools: runtime components into src, development tooling into scripts, in separate PRs. |
| PR8 | Move skills to .claude/skills; separately quarantine any explicitly retired paths under TODELETE with their original repository-relative path. |

Documentation classification follows purpose: decisions to adr, instructions and
indexes to guides, rules to policy, repeatable workflows and templates to recipes,
release history to releases, studies and source evidence to research, and audit,
coverage, test reports and receipts to verification. Preserve source basenames
and subordinate paths unless a later move PR documents an explicit mapping.
Resolve collisions explicitly; do not overwrite existing material. The ADR added
here already occupies its final destination.

Classify tools by their consumers, not their language: code required to execute
Endoforge belongs in src; developer checks, maintenance and build helpers belong
in scripts. Keep component tests and fixtures with their component; keep the
existing top-level tests directory. PR7 must inventory individual tool paths and
update imports and entry points before any move lands.

Root entry points, community documents, license, Makefile, GitHub configuration,
and ignore and scanner configuration stay in place. PATHMAP records all current
tracked top-level entries, including these retained paths.

Nothing is ever deleted outright. A path proposed for deletion instead moves to
TODELETE/<original-path>, retaining its full original relative path. No current
path is designated for retirement by this ADR. Before any quarantine move lands,
explicitly exclude TODELETE from build inputs, packaging, test discovery and CI
execution; verify those exclusions even for recursive globs. Retain security
scanning coverage. Review the exclusions and move together in that dedicated PR.

Every move PR updates imports, build commands, CI, links, indexes and source hash
manifests affected by that move. Run the applicable checks and tests before and
after relocation, require green results, and update PATHMAP with actual PR
references. A failing baseline must be resolved before landing a move. No move
is authorized to bypass a failing test.

## Consequences

Readers gain predictable locations for decisions, instructions, evidence and
runtime code. Root entry points remain discoverable. Small move PRs isolate path
breakage and permit review of each relocation with its dependent updates.

The migration requires repeated link, import and test validation. Tool ownership
needs a file-level inventory in its move PR. Quarantine preserves history and
recovery at the cost of retaining storage; exclusions need continued maintenance.
This documentation-only PR neither implements those exclusions nor validates the
future layout. The path map describes destinations that may not yet exist.
