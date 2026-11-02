# Experiments

Recorded probes with their precommit, harness, and receipts. Each probe keeps a
precommit hashed before measurement and a result that states what it does not show.

| Probe | Question | Result |
|---|---|---|
| [P-15](P-15-workcell-concurrency/RESULT.md) | Workcell concurrency in V8 isolates on one host | [RESULT.md](P-15-workcell-concurrency/RESULT.md) |
| [P-16](P-16-workerd-isolates/RESULT.md) | Standalone workerd throughput and memory breach isolation | [RESULT.md](P-16-workerd-isolates/RESULT.md) |
| [P-17](P-17-workcell-gap/RESULT.md) | Workcell throughput between 10 and 50 isolates | [RESULT.md](P-17-workcell-gap/RESULT.md) |
| [P-18](P-18-pool-breach/RESULT.md) | Thread/process pool memory breach containment at N=8 | [RESULT.md](P-18-pool-breach/RESULT.md) |
| [P-21](P-21-x1-twenty-rerun/RESULT.md) | The twenty loop-0 requests re-run with Codex workers against Oct 17 and Oct 18 | [RESULT.md](P-21-x1-twenty-rerun/RESULT.md) |
| [P-19](P-19-need-to-candidate/RESULT.md) | Need intake to candidate selection: real stage latency and missing synthesis/promotion links | [RESULT.md](P-19-need-to-candidate/RESULT.md) |
| [P-20](P-20-pool-speed-rerun/RESULT.md) | Old compile/precompiled probes through the real thread/process isolate pool | [RESULT.md](P-20-pool-speed-rerun/RESULT.md) |
| [P-20 addendum](P-20-pool-speed-rerun/RESULT.md#addendum-2026-11-01-earliest-baselines-inside-isolatepool) | P-01/P-02/P-05 and 10-29 ramp re-measured through IsolatePool; P-05 blocked by WASM guard | [receipt](P-20-pool-speed-rerun/receipt/addendum-2026-11-01/summary.json) |
| [P-22](P-22-real-need-to-candidate/README.md) | Real generation, pool gates and local qualification: 41/60 promoted; generation is ~99% of latency | [RESULT.md](P-22-real-need-to-candidate/RESULT.md) |
| [P-23](P-23-generator-rerun/PRECOMMIT.md) | Contract-up-front generator, resumed sessions and auto effort: 0 precision refusals, about 2x faster, but only 26/60 promoted (G4 regression) | [RESULT.md](P-23-generator-rerun/RESULT.md) |
| [P-24](P-24-g4-ablation/PRECOMMIT.md) | Session x effort ablation on the P-21 cohort: neither factor raises G4; 43/45 G4 refusals use `assert(`, 0/34 promotions do | [RESULT.md](P-24-g4-ablation/RESULT.md) |
| [P-25](P-25-pool-ledger/PRECOMMIT.md) | Supervisor ledger confirmed as the pool limit (L1); persistent batched ledger bridge raises width-16 throughput from 11.89 to 152.9 checks/s with full chain verification | [RESULT.md](P-25-pool-ledger/RESULT.md) |
| [P-27](P-27-g4-fix/PRECOMMIT.md) | P-23 re-run after the no-assert generator fix: 57/60 promoted, 0/60 kernels use `assert(`, every total p50 within 20% of P-23 | [RESULT.md](P-27-g4-fix/RESULT.md) |

Rebuild P-15 dependencies with `setup.sh` in its directory; `node_modules` is not committed.
