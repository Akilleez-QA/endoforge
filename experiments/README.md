# Experiments

Recorded probes with their precommit, harness, and receipts. Each probe keeps a
precommit hashed before measurement and a result that states what it does not show.

| Probe | Question | Result |
|---|---|---|
| [P-15](P-15-workcell-concurrency/RESULT.md) | Workcell concurrency in V8 isolates on one host | [RESULT.md](P-15-workcell-concurrency/RESULT.md) |
| [P-16](P-16-workerd-isolates/RESULT.md) | Standalone workerd throughput and memory breach isolation | [RESULT.md](P-16-workerd-isolates/RESULT.md) |
| [P-17](P-17-workcell-gap/RESULT.md) | Workcell throughput between 10 and 50 isolates | [RESULT.md](P-17-workcell-gap/RESULT.md) |

Rebuild P-15 dependencies with `setup.sh` in its directory; `node_modules` is not committed.
