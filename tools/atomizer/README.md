# Atomizer

The atomizer splits a need into small, independent atoms and runs them as a DAG. Each atom runs in its own bubblewrap isolate with a private home and only the mounts it declares: its inputs at `/in`, its outputs at `/out` and scratch at `/work`. A script atom runs a fixed command. A model atom runs a Claude or Codex worker. The scheduler checks outputs against receipts, and every step is written to an append-only ledger.

## atoms.json

`lib/validate.mjs` checks a document before anything runs. The main rules:

- `schema` is `endoforge/atoms/1`. `need` has `id` and `text`. `acceptance` is a non-empty list of `{id, statement, check}` with `check.kind` one of `command`, `oracle` or `manual`.
- `atoms` is a non-empty list of at most `policy.maxAtoms` (64). Each atom has an `id` (a letter, then up to 31 letters, digits, `_` or `-`), a `kind`, a `contract` of at least 20 characters, one or more `outputs` with relative paths, a `verify` field and a `worker`.
- `worker.model` is `sonnet`, `opus`, `codex` or `script`. A script worker needs `command` (an array). A model worker needs `prompt`.
- `size.work` and `size.interface` are 1 to 5, and `size.work` may not exceed `policy.singleShotMaxWork` (3).
- Inputs name an earlier atom (or `need`). Cycles and the edges listed in `policy.forbiddenEdges` are refused, for example tests to kernel.
- There is exactly one `compose` atom, or a single `direct` atom.

[examples/example.json](examples/example.json) is a one-atom script DAG that passes these rules.

## Entry points

| Script | What it does | Launches a model |
|---|---|---|
| `bin/schedule.mjs run <atoms.json> --run-dir <dir>` | Validates, plans waves and runs every atom. Options: `--concurrency`, `--retries` (1), `--timeout-ms` (900000), `--policy`, `--force`, `--no-augment`. | Only for model atoms |
| `bin/verify.mjs <run-dir> [--policy file]` | Checks a finished run: every atom done, outputs match receipts, acceptance commands pass inside an isolate. | No |
| `bin/report.mjs <run-dir>` | Writes a Markdown timeline, tokens and realized speedup. | No |
| `bin/speed.mjs <run-dir or fanout-dir>... [--out SPEED.md] [--json speed.json]` | Breaks wall time down by stage. | No |
| `bin/fanout.mjs <atoms.json...> --out-dir <dir>` | Runs several DAGs as one pool, then verify and report on each. | Only for model atoms |
| `bin/atomize.mjs <need.md> --out <dir> [--model sonnet\|opus\|codex] [--fixture atoms.json]` | A model writes `atoms.json` from the need; the script validates it, repairs once and plans. `--fixture` skips the model. | Yes, unless `--fixture` |
| `bin/plan-template.mjs <need.md> --out <dir>` | One model call writes the interface; the script expands the fixed kernel template. | Yes |
| `bin/direct.mjs <need.md> --out <atoms.json>` | Writes a single-atom `direct` DAG. | No (the DAG does) |
| `bin/cutover.mjs <ladder.json> --out-dir <dir>` | Paired direct and atomized arms on the same gates. | Yes |
| `bin/compose-kernel.mjs --id <need> --in /in --out /out --work /work --gate <gate.mjs>` | Merges kernel parts, freezes and runs the gates. Runs inside a compose atom. | No |
| `bin/repair-noop.mjs`, `bin/testcheck.mjs strip\|merge`, `bin/isolate-exec.mjs` | Helpers used inside atoms. | No |
| `bin/ledger-export.mjs [--out dir]` | Flattens the ledger into CSV tables. | No |
| `bin/backfill.mjs`, `bin/bench.mjs` | One-time ledger backfill, and a scheduler benchmark (`--stub` uses a stub Codex). | `bench` without `--stub` does |

The library is under `lib/`: `validate.mjs`, `dag.mjs` (plan and waves), `isolate.mjs` (bubblewrap), `workers.mjs` (worker commands and toolchains), `routing.mjs` (Codex tiers from [routing.json](routing.json)), `augment.mjs`, `binds.mjs`, `ledger.mjs`, `trace.mjs` and `lessons.mjs`. [policy.json](policy.json) holds limits, forbidden edges, toolchain paths and model names.

## Run the example

These commands were run on the example with a script worker, so no model was called:

```sh
DEMO=$(mktemp -d)
export ATOMIZER_LEDGER_DIR=$DEMO/ledger ENDOFORGE_CLAUDE_ACCOUNTS=$DEMO/none
node tools/atomizer/bin/schedule.mjs run tools/atomizer/examples/example.json --run-dir $DEMO/run
node tools/atomizer/bin/verify.mjs $DEMO/run
node tools/atomizer/bin/report.mjs $DEMO/run
node tools/atomizer/bin/ledger-export.mjs --out $DEMO/tables
```

`schedule.mjs` printed `{"allDone":true,...}` and wrote `atoms.json`, `trace.jsonl`, `receipt/` and `atoms/complete/out/marker.txt` under the run directory. `verify.mjs` printed `{"ok":true,...}` with the manual acceptance marked `not executed here`. `ledger-export.mjs` wrote `attempts.csv`, `atoms.csv` and `runs.csv`.

`node tools/atomizer/bin/atomize.mjs need.md --out <dir> --fixture tools/atomizer/examples/example.json` validated and planned the fixture without a model and wrote `atoms.json`, `plan.json`, `receipt/` and `report.md`.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `ATOMIZER_LEDGER_DIR` | `tools/atomizer/ledger` | Ledger directory (`events.jsonl`, `archive/`). Set it outside the source tree. |
| `ENDOFORGE_WORKER` | `policy.workerBackend`, else `native` | `codex` turns every model atom into a Codex atom. |
| `ENDOFORGE_CODEX_CONCURRENCY` | 3 | Default concurrency with the Codex backend. Otherwise the default is 8. |
| `ENDOFORGE_CODEX_POOL` | `core/runtime/agent-pool.mjs` | Codex pool launcher. |
| `CODEX_POOL_STATE_DIR` | `.codex-pool` in the home directory | Where the scheduler reads the pool log. |
| `ENDOFORGE_TOOLCHAIN_<NAME>` | `policy.toolchain.<name>` | Host path of a toolchain, for example `ENDOFORGE_TOOLCHAIN_CODEX`. |
| `ENDOFORGE_TRACE` | on | `0` turns off `trace.jsonl`. |
| `ENDOFORGE_CLAUDE_ACCOUNTS` | `.claude-accts` in the home directory | See below. |
| `ENDOFORGE_CREDENTIAL_HOME` | unset | See below. |

Authentication must be configured explicitly. `ENDOFORGE_CLAUDE_ACCOUNTS` holds one Claude config directory per login, each with `.credentials.json`; each `claude` launch mounts the next one. With no such logins, `ENDOFORGE_CREDENTIAL_HOME` names an approved home template whose credential files are copied into the isolate's home. The launcher does not copy the current user's credentials implicitly. Codex support uses the optional local agent pool. Tests use empty synthetic account markers.

## Tests

`make atomizer-test` runs `test/run.mjs` (scheduler, isolation, cycles, forbidden edges, routing and lessons) and the other `test/*.test.mjs` files. It passed with 59 checks. The tests set their own ledger and account directories and use stubs, not models.

`ledger.mjs` mentions a `LEDGER.md` schema and `bench.mjs` defaults to `examples/C-005/atoms.json`; neither file is in this tree.
