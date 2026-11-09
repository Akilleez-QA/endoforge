# Sources

This directory holds the digest manifest for EndoForge's controlled sources, and one example input.

- `SHA256SUMS` lists the SHA-256 of every controlled source file, one `<sha256>  <path>` line each, with paths
  relative to this directory: the candidate loop and runtime in `core/`, the compiler pin in `tools/asc/`, the ledger
  scripts, the experiment inputs that recorded results depend on, and the archived files under `TODELETE/`. A version
  description records the hash of this file, so a recorded state names exactly which sources it ran.
- `example.json` is a minimal example input (`{"id":"example","request":"Return twice the input","input":2,"expected":4}`),
  kept here because `make check` reads it through the manifest.

## Use it

```console
$ python3 -I tools/source_sums.py --check
$ make sums
python3 -I tools/source_sums.py
sources/SHA256SUMS: 91 entries
```

`--check` exits 0 silently when every listed file matches. After a listed file changes it prints
`sources/SHA256SUMS: stale digests or order; run make sums` and exits 1.
`make check` runs it (through `tools/check-docs.py` as well). After you change a listed file, run `make sums` and commit
the new `SHA256SUMS` with the change. `--add PATH` and `--remove PATH` change the list itself.

Write your own inputs here only with synthetic identifiers; keep generated evidence outside the source tree.
