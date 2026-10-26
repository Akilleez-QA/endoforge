# Hill-climb: render, review, consult references, critique, fix, repeat

Written 2026-10-25 after Craig ran the St. Louis campus this way by hand. He asked first for "find 100 problems that need correction in the stills", then "keep repeating this as a loop and hillclimb", then "add consult and find new references to the loop after review and before critique", and finally "work this as hillclimb tooling into endoforge … so we can re-use it in the future". The tool makes that loop repeatable for any visual (or other reviewable) work: a campaign file holds what is specific to a project, and every round is ordinary Endoforge atoms with a scoreboard.

## One round

| Stage | Where | What |
|---|---|---|
| render | host | runs the campaign's `render` jobs (any command; `${repo}`, `${out}`, `${round}` expand) into `rounds/rNN/stills/<job>/` |
| review | host | `scripts/sheets.py` makes labelled 2x2 contact sheets (1920x1080, so detail survives) in `rounds/rNN/sheets/` |
| consult | atom | reads the sheets, consults the declared references for each weak spot, and (when `references.research.allow`) proposes **new** licensed references from allowed sources → `references.json`, `consult.md` |
| critique | atom | up to `critique.count` concrete problems against the references and rubric, each with one owner, a severity, and `carried_from` / `resolved_from_previous` against the last round → `fixlist.json` |
| compose | atom (script) | validates the fix list and writes `FIXLIST.md` and `score.json` |
| refs | host | `refs --fetch` downloads approved candidates from allowed sources and licences into the reference store, with an inventory row (url, licence, sha256) |
| fix | atoms | one per owner with open items. Each copies its scope out of the read-only repo (`scripts/hc-patch.sh init`), edits, and returns a repo-relative `patch.diff` plus a per-item `report.json`. The compose step rejects any patch outside the owner's scope |
| apply | host | one worktree branch per owner from `apply.base`, then `git apply`, the owner's `postApply` builds (binaries are rebuilt here, never patched), `apply.gates`, a commit and, with `--pr`, a PR. It never merges |

**The scoreboard** (`<workdir>/scoreboard.json`) records, per round: open problems, blockers, a weighted score (blocker 5, major 2, minor 1), new, carried and resolved. **The stop rule** (`stop`) ends the loop when:
- the target is met (`targetOpen` reached with no blockers);
- the round limit is reached (`maxRounds`); or
- the weighted score has plateaued for `patience` rounds.

## Commands

```sh
B=forge/endoforge/tools/hillclimb/bin/hillclimb.mjs
node $B check  campaigns/stl-campus.json          # validate a campaign
node $B round  campaigns/stl-campus.json --pr     # render → review → (stop?) → fix → apply, one full round
node $B render campaigns/stl-campus.json          # or stage by stage: render, review, refs, fix, apply
node $B review campaigns/stl-campus.json
node $B refs   campaigns/stl-campus.json --fetch 1,4,7
node $B fix    campaigns/stl-campus.json
node $B apply  campaigns/stl-campus.json --pr
node $B score  campaigns/stl-campus.json          # history and the stop decision
```

**Runner:** stages that run atoms go through `~/.local/bin/endoforge run` (`campaign.runner` overrides it) with `ENDOFORGE_WORKER` from `campaign.worker` (`native` uses the Claude pool logins, `codex` uses codex-pool).

**Background running:** run `round` detached (`systemd-run --user …`), so renders and agents stay out of an interactive app's process tree.

**Bind paths:** `workdir`, `repo` and every reference bind must sit under the atomizer's `policy.bindRoots`. Use the tool from a checkout that is under them too, such as `~/Code/akilleez`.

## Campaign file (`endoforge/hillclimb/1`)

See `campaigns/stl-campus.json`. The fields:

| Field | What it holds |
|---|---|
| `goal` | What "better" means, shown to every atom |
| `render` | The jobs |
| `sheets.brighten` | Stills to lift, such as night shots |
| `references.binds` | Mounts, read-only |
| `references.index` | What each mount holds |
| `references.research` | `allow`, `sources` (host suffixes), `licences` and `store` |
| `critique` | `count`, `model`, `rubric` |
| `owners` | Per lane: `describe`, `scope` (repo paths), `brief`, `model`, `postApply`, `commitAlso` |
| `apply` | `base`, `branch` template, `worktrees`, `gates`, `trailer`, `prFooter` |
| `stop` | The stop rule |

## Rules the tool keeps

- **Isolation:** atoms only read: the round directory at `/hc`, the tool at `/hc-tool`, the repo at `/repo` and the references. They write only `/out` and `/work`.
- **Owner scope:** a fix lane's patch is checked against its scope before anything is applied.
- **Downloads:** nothing is fetched without `refs --fetch`, and only from the campaign's allowed sources and licences, with provenance recorded.
- **Private material:** a project's private references (for example Craig's own photos) can be mounted for local viewing, but the tool never copies them into git or the store.
- **Merging:** PRs follow the repo's merge train. The tool only opens them.

Tests: `node test/run.mjs`. They cover campaign and fix-list validation, atoms passing the atomizer validator, scoring and stop rules, patch scope, a real hc-patch → `git apply` round trip, and both compose steps.
