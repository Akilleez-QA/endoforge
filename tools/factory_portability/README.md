# Factory portability

Moves a partly finished campaign to another machine and resumes an offline stage there. Credentials are never packed; the destination re-authenticates.

## Scripts

- `checkpoint.py`: packs and unpacks version 1 checkpoints (`endoforge.checkpoint.v1`), encrypted with the external `age` tool to X25519 recipients.
  - `pack <source> <archive> --recipient <age-recipient>` reads `checkpoint.json` from `<source>`, which must carry non-empty `job_states`, `frozen_evals`, `dependencies`, `references` and `provenance` plus `credentials: "excluded-reauthenticate-at-destination"`. It adds a file inventory (`sha256`, `size`, `executable`) for every other regular file. It refuses symlinks and hard links, paths such as `.env`, `.ssh`, `.aws`, `.claude`, `.codex`, `*.pem`, `*.key`, and file contents that look like private keys or API tokens. The limit is 512 MiB.
  - `unpack <archive> <destination> --identity <age-identity-file>` decrypts with `age`, which authenticates before anything is extracted, then checks every file against the inventory. It refuses an existing destination.
- `resume_stage.py <checkpoint> <bundle> <output>`: resumes one pending deterministic WASM stage named by `resume.json` (`endoforge.portable-stage.v1`). It checks the module and the bundle's pinned `bin/wasmtime` hash from `toolchain.json`, runs each case with fuel, memory and timeout limits, and refuses if the checkpoint changes. It writes an attempt under `<output>/attempts/` and, on a pass, publishes `<output>/stage.json` once without overwrite. The stage must declare `requiresModelAuthentication: false`.
- `qualify_wasmtime.py <bundle>`: smoke-checks the pinned Wasmtime in a bundle (a return value, a fuel-exhausting loop, a trap) and prints a JSON receipt.
- `campaign_transfer.py <source> <bundle> <receipt> --identity <file> --host <host> --remote /tmp/endoforge-transfer-<id>`: packs, copies with `scp` to the named host, unpacks and resumes there under `ssh` in a `bwrap` sandbox, and writes a receipt directory. It needs a reachable host and was not run.

## Commands run

```
python3 -I tools/factory_portability/checkpoint.py --help
python3 -I tools/factory_portability/resume_stage.py --help
python3 -I tools/factory_portability/campaign_transfer.py --help
```

Each printed its argparse usage. `resume_stage.py` and `qualify_wasmtime.py` need a toolchain bundle with a pinned Wasmtime, which was not available, so they were not run on real input.

## Tests

```
make portability-test
```

This runs `python3 -B tools/factory_portability/test_checkpoint.py`, which needs `age` on `PATH` and prints a JSON list of refusal cases. No environment variables are read.
