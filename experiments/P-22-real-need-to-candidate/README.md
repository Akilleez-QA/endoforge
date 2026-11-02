# P-22 real need to candidate

[PRECOMMIT.md](PRECOMMIT.md) and its [hash](receipt/precommit.sha256) fix the
procedure before validation. [run.mjs](run.mjs) runs twenty needs plus ten addition
requests in each mode, with a retained size-ten pool and generation concurrency ten.
Source digests and precommit are checked before execution. Use fresh external output.

```sh
export P22_NEEDS_ROOT=/tmp/p22-inputs/old
export ENDOFORGE_ASC_CMD=/tmp/p22-toolchain/node_modules/.bin/asc
export ENDOFORGE_CODEX_CMD=codex
export CODEX_HOME=/tmp/p22-configured-client
P22_OUTPUT=/tmp/p22-real-output flock /tmp/ef-bench.lock node experiments/P-22-real-need-to-candidate/run.mjs
```

Use P-21's AssemblyScript 0.28.20 and an already configured client home; the adapter
never reads/copies auth. External output holds candidates, frozen oracles, ledgers,
decisions and timing summaries. Failures are retained without retry and cause exit 1.
No existing assertions or expected results are changed. [RESULT.md](RESULT.md)
records validation; real measurement is pending. For labelled CI test doubles:

```sh
P22_OUTPUT=/tmp/p22-fake-output node experiments/P-22-real-need-to-candidate/run.mjs --fake
```

Fake generation always authors addition and cannot establish synthesis latency or
domain correctness. Set `P22_NEEDS_ROOT` with `--fake` to exercise actual need reads;
otherwise it uses synthetic identifiers. Client transcripts/account paths are omitted.
