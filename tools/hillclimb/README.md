# Hill-climb

Hill-climb improves a project round after round against a goal. A campaign (`endoforge/hillclimb/1`) names what to render, which references exist, how to critique and who fixes what. The default mode, `compete`, runs render, review (consult references, then critique into a fix list), fix (one atom per owner), apply and score. The `fanout` mode runs evals, re-atomizes, smokes one atom per engine, launches every piece under the capacity dial, collects owned diffs and reverts any piece that regressed. Each round lives in `<workdir>/rounds/rNN` and leaves a `LESSONS.md`. A lesson stays open in `<workdir>/lessons.json` until a tool or PR change is recorded for it.

Review and fix atoms run through the runner in `campaign.runner`, which defaults to `endoforge run` from `.local/bin` in the home directory. The atoms are validated with the [atomizer](../atomizer/README.md) rules first.

## Entry point

`bin/hillclimb.mjs <command> <campaign.json> [--round N]`. With no arguments it prints its usage and exits 2.

| Command | Effect |
|---|---|
| `check <campaign.json>` | Validates the campaign and prints `{"ok":...,"errors":[...]}`. Exit 1 when invalid. |
| `score <campaign.json>` | Round history from `scoreboard.json` and the stop decision. |
| `lessons <campaign.json> [--close KEY --by "PR #n"] [--add KEY --stage S --text T]` | Lists, closes or adds lessons. |
| `round <campaign.json> [--pr]` | One full round. Stops early when the stop rule says so. |
| `render [--profile fast\|final]`, `plan-review`, `review`, `refs [--fetch id,id\|all]`, `plan-fix`, `fix`, `apply`, `judge`, `pr` | The stages of a round. `plan-*` writes atoms without running them. |
| `atomize`, `prove-split`, `logins`, `smoke`, `evals [--phase pre\|post]`, `status`, `collect` | Fan-out mode stages (`lib/fanout-run.mjs`). |
| `compose-review`, `compose-fix`, `compose-judge` | Run inside atoms. |

`review`, `fix`, `judge`, `round`, `smoke` and fan-out launches start model workers. `render` runs the campaign's render commands. `pr` pushes and opens pull requests.

Scripts used by atoms and stages:

- `scripts/pixel-diff.py <before-dir> <after-dir> [--tolerance N]` compares two image trees by decoded pixels. It prints one JSON line and exits 0 when identical, 1 when not, 2 on usage errors. It needs Pillow.
- `scripts/sheets.py <stills_dir> <out_dir> [--per 4] [--brighten a,b]` makes labelled contact sheets and an `index.json`.
- `scripts/hc-patch.sh init <repo> <scope>...` and `hc-patch.sh diff <repo> <out.diff>` copy an owner's scope out and turn edits into a git patch. It works in `$HC_WORK`, default `/work`.

## Campaign rules

`lib/campaign.mjs` requires: an `id` slug, a `goal` of at least 20 characters, a `workdir`, at least one `render` job with an `id` and a `command` array (not wrapped in `systemd-run --scope`), and `stop.maxRounds` of at least 1. In `compete` mode it also needs `owners` (uppercase keys, each with `describe` and `scope`) and `critique.count` from 1 to 500. `fanout` mode has its own rules in `lib/fanout.mjs`.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_CLAUDE_ACCOUNTS` | `.claude-accts` in the home directory | Claude logins for fan-out. |
| `CODEX_POOL_PRIMARY`, `CODEX_POOL_ACCOUNTS_DIR` | `.codex`, `.codex-accounts` in the home directory | Codex logins for fan-out. |
| `CODEX_POOL_BIN` | `codex` on `PATH` | Passed to Codex lanes. |
| `WORKER_STATE_DIR` | `$XDG_STATE_HOME/workers`, else `.local/state/workers` | Worker capacity state. |

The runner gets `ENDOFORGE_WORKER` set to `native`, or to the stage's worker when `campaign.mix` is `false`.

## Example

These ran on a synthetic `compete` campaign with one owner and a `true` render command:

```sh
node tools/hillclimb/bin/hillclimb.mjs check campaign.json
node tools/hillclimb/bin/hillclimb.mjs score campaign.json
node tools/hillclimb/bin/hillclimb.mjs lessons campaign.json
python3 -I tools/hillclimb/scripts/pixel-diff.py before after
```

`check` printed `{"ok":true,"errors":[]}`. `score` printed `{"stop":false,"why":"no rounds yet"}`. `lessons` printed nothing. `pixel-diff.py` on two identical 4x4 PNGs printed `{"ok": true, "compared": 1, ...}`.

## Tests

`make lib-test` runs `test/lessons.test.mjs`, which passed. The fan-out library is also used by the [job](../job/README.md) and [project scheduler](../project-scheduler/README.md) tools.
