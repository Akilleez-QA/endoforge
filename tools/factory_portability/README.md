# Factory portability

Moves a partly finished campaign to another machine and resumes an offline stage there. The portable unit is a
checkpoint (the job states, frozen evaluators, dependencies, references and provenance) plus a toolchain bundle;
nothing live moves, and credentials are never packed: the destination signs in again. It comes from the earlier
factory design and sits beside the isolate loop, not inside it.

## Scripts

- `checkpoint.py` packs and unpacks version 1 checkpoints (`endoforge.checkpoint.v1`), encrypted with the external
  `age` tool to X25519 recipients.
  - `pack <source> <archive> --recipient <age-recipient>` reads `checkpoint.json` from `<source>`, which must carry
    non-empty `job_states`, `frozen_evals`, `dependencies`, `references` and `provenance` plus
    `credentials: "excluded-reauthenticate-at-destination"`. It inventories every other regular file (`sha256`,
    `size`, `executable`), and refuses symlinks, hard links, paths such as `.env`, `.ssh`, `.aws`, `.claude`, `.codex`,
    `*.pem` and `*.key`, and contents that look like private keys or API tokens. The limit is 512 MiB.
  - `unpack <archive> <destination> --identity <age-identity-file>` decrypts with `age`, which authenticates before
    anything is extracted, then checks every file against the inventory. It refuses an existing destination.
- `resume_stage.py <checkpoint> <bundle> <output>` resumes one pending deterministic WebAssembly stage named by
  `resume.json` (`endoforge.portable-stage.v1`). It checks the module and the bundle's pinned `bin/wasmtime` hash from
  `toolchain.json`, runs each case with fuel, memory and timeout limits, refuses if the checkpoint changes, writes an
  attempt under `<output>/attempts/`, and on a pass publishes `<output>/stage.json` once without overwrite. The stage
  must declare `requiresModelAuthentication: false`.
- `qualify_wasmtime.py <bundle>` smoke-checks a bundle's pinned Wasmtime (a return value, a fuel-exhausting loop, a
  trap) and prints a JSON receipt.
- `campaign_transfer.py <source> <bundle> <receipt> --identity <file> --host <host> --remote /tmp/endoforge-transfer-<id>`
  packs, copies with `scp` to the named host, unpacks and resumes there under `ssh` in a `bwrap` sandbox, and writes a
  receipt directory.

## Example

```console
$ make portability-test
python3 -B tools/factory_portability/test_checkpoint.py && true
{
  "schema": "endoforge.portability-test.v1",
  "passed": true,
  "checks": [
    "roundtrip",
    "source-immutable",
    "wrong-key",
    "ciphertext-tamper",
    "existing-destination",
    "existing-archive",
    "credential-file",
...
```

The test packs and unpacks a real `age`-encrypted checkpoint and confirms each refusal case.

## Limits

- `campaign_transfer.py` needs a reachable second host and has not been run.
- `resume_stage.py` and `qualify_wasmtime.py` need a toolchain bundle with a pinned Wasmtime, which is not in this
  repository; they have not been run on real input here.
- `campaign_transfer.py` has an unused import (D-02 in the assurance record).
- No environment variables are read. `age` must be on `PATH`.

## Tests

`make portability-test` runs `test_checkpoint.py`.

Engineering record: component C-25, requirement REQ-FACTORY-002.
