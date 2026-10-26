# Ephemeral Endoforge runtime

Bots launch one swarm per throwaway bubblewrap instance; nothing stays running.
The job is execution capability (owner-directed infrastructure); the happy path
is atoms → isolated workers → verified outputs and receipts.

```sh
endoforge run C-005 --tier standard --timeout 3600
endoforge run /path/atoms.json --out /path/results --concurrency 3
endoforge run /path/atoms.json --stub-replay /path/finished-run
endoforge ls
endoforge reap
```

Each run reaps abandoned instances, takes a concurrency slot, caches the Git
image and asc layer, takes a lease, schedules and verifies, copies results,
then kills descendants and removes the instance. Output is one JSON line;
diagnostics go to stderr. `--no-verify` skips verification.

Exit codes: 0 success, 1 swarm/verification/setup failure, 2 usage,
75 shields up, 124 timeout, 143 signal. Results include timing and receipts.

Install from `forge/endoforge`:
```sh
ln -s "$PWD/tools/runtime/endoforge" ~/.local/bin/endoforge
```
Hosts without the fleet pool (main-rig) install the local pool, which passes
`tools/atomizer/test/codex-swarm.test.mjs`, and point the codex toolchain at an
installed codex prefix (one with `bin/codex`):
```sh
install -m755 tools/runtime/codex-pool.mjs ~/.local/bin/codex-pool
mkdir -p ~/.local/share/endoforge-tc && ln -sfn ~/.local/share/mise/installs/codex/latest ~/.local/share/endoforge-tc/codex
```
Accounts are `~/.codex` (logged as `default`) and `~/.codex-accounts/<name>`;
it reads neither credential file, only checks that `auth.json` exists.
Called directly (outside Endoforge, which sets `CODEX_POOL_BIN` to its isolate),
the pool runs the first `codex` on PATH. The child inherits stdin, so
`codex-pool exec - < brief.txt` works; a file on stdin is reopened for each
failover try. With `-i` image flags, put the prompt before them or pass `-`:
`-i` takes many values and swallows a trailing prompt.
`node tools/runtime/test/codex-pool.test.mjs` checks both (stub codex, no model).
Set `ENDOFORGE_SRC_REPO` and `ENDOFORGE_REF` in
`~/.config/endoforge/runtime.env` (simple KEY=VALUE lines).
Other knobs: `ENDOFORGE_HOME`, `ENDOFORGE_RUNS_DIR`, `ENDOFORGE_ASC_SEED`,
`ENDOFORGE_MAX_INSTANCES` (4), `ENDOFORGE_SLOT_WAIT` (900),
`ENDOFORGE_TOOLCHAIN_CODEX`, `ENDOFORGE_CODEX_POOL`, `CODEX_POOL_*`,
`ENDOFORGE_SHIELDS_FILE`, `ENDOFORGE_NO_AUGMENT=1`.
Stub latency: `ENDOFORGE_STUB_LATENCY_MS` (0).

Main-rig needs overlay-capable bubblewrap, Node, npm, Git, flock and setsid.
Keep the cache outside /tmp; the atom isolates overlay /tmp. Default runs go
to /workspace/ops/endoforge/runs (fallback ~/endoforge-runs). Account directories
are mounted by path; account names alone appear in logs. Global pool caps use
host PIDs, so the outer instance keeps the host PID namespace.
