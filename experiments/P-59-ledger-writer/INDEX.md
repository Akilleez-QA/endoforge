| Probe | Question | Result |
|---|---|---|
| [P-59](PRECOMMIT.md) | A group-commit ledger writer, one journal `fdatasync` per batch: the ledger alone carries 94.7 accepted candidates/s (15.2× P-57's bridge) at 0.22 disk syncs per candidate against 24.3; `swarm-release-256` non-model p50 18.4 s to 2.0 s; 24 of 24 SIGKILL trials keep every acknowledged event once | [RESULT.md](RESULT.md) |
