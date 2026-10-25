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
