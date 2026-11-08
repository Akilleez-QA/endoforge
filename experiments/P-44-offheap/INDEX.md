| Probe | Question | Result |
|---|---|---|
| [P-44](PRECOMMIT.md) | Off-heap allocation through the pool: 3 GiB past a 128 MiB heap passes in thread mode and in process mode without a cgroup; `memory.max` alone also failed to stop it until `memory.swap.max=0` was set | [RESULT.md](RESULT.md) |
