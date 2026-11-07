# P-53-library-v0 PRECOMMIT: a need a promoted kernel satisfies skips generation

Probe only. It moves no claim-ladder rung: Edition 3 section 17 rung 6 needs months of lifetime economics. This is not C12, which needs two blind raters and requests from real users. No model call, spend or account is involved. Activation stays off by default: `runNeed` serves from the library only when a caller passes one.

## Question
On the P-51 corpus, how often does a library lookup end in a reuse, how often does it serve a wrong kernel to a near-miss need, and what does a verdict cost against generating?

## What ships in the probe
- Admission: `core/library/verify_promotion.py` reads the P-42 per-need ledger read-only with the chain verified by `core/ledger`, and requires promotion hash, receipt hash, candidate hash, evaluator digest and passing pool evidence to agree. The kernel then re-passes its own evaluator under the current gates in a cell.
- Key: `core/library/key.mjs`. The shipped key hashes per-export, positional, name-free: argument kind, unit, parsed range, code tables, result kind, unit, precision, rounding, code tables, labels, trap presence; plus the sorted set of numerals in the frozen contract text. Need text and export names are not in it. `interface` drops the numerals. `prose` replaces them with normalized contract text, as a floor.
- Serving: a key match with exactly one fingerprint class is bound by export name, run through the unmodified `runGates` in a warm worker-thread cell against the new need's frozen tests, then through a discrimination gate. Two classes under one key is a miss, `ambiguous_key`.
- Discrimination gate (`core/library/discriminate.mjs`): Edition 3 section 6 says an evaluator must reject seeded faults, and P-51 showed frozen tests miss them. Mutate the kernel's wasm in place with no compiler (comparison, arithmetic, rounding, constants) and wrap its result (negate, scale, round, floor, ceil). A variant that passes the new tests and differs from the kernel on the probe grid is a survivor. The shipped gate `full` refuses on any survivor. `mutants` counts wasm mutants only. `none` is the evaluator alone.
- Receipts: a hash-chained JSONL journal, one `fsync` per verdict, naming the source promotion. Revocation covers the fingerprint class.

The shipped configuration is `contract` key with `full` gate, fixed here. The other cells are ablations. They can't be promoted to shipped by this result.

## Data
All 177 kernels of P-51's corpus manifest, verified against its per-file hashes before use. The contract text is not in the P-51 receipts, only hashes and mutated copies, so the sources come from the P-42 receipts outside git, checked against that manifest. Nothing from them is committed. Mutants come from P-51's `mutants.jsonl`.

Disclosed before results: a need's capability is built from its own `glue.json`. The generator writes glue after freeze, and P-51 showed glue labels aren't verified. So this is a stand-in for a capability block frozen in the contract; the real path through `capabilityFromContract` needs a spec-stage prompt change this probe doesn't make, and until then generated needs miss with `no_capability`. Before writing this I saw per-need export-name and glue signature counts and three contracts. I did not run any lookup.

## Measures
1. Held-out hit rate: leave one run out over six runs. Each kernel's frozen contract and tests are the need; the library is the other five runs. Reported per cohort (P-21, 118; add, 59) and for all mode and gate cells. A hit is a pass through the configured gate.
2. Natural disagreement: for each hit, the served kernel against the need's own promoted kernel on the probe grid, relative tolerance 1e-9. It is not proof of a false hit, since either could be wrong, and it is reported in full.
3. Adversarial false hits. `near-miss.mjs` was written and hashed here before any lookup. The library holds all 177, including the kernel each case was derived from.
   - Arm A, declared: a text-similar need that states a different unit, rounding, boundary, sign or constant, in capability or numerals. `visible` also rewrites the tests; `blind` leaves them. Any case served is a false hit.
   - Arm M, P-51 mutants of those five classes with tests regenerated from the mutant, where the pristine kernel fails them. Any case served is a false hit.
   - Arm B, hidden intent: as M, where the pristine kernel passes the regenerated tests. These needs are behaviourally what the kernel's own evaluator says; only the seeded fault differs. Counted as false hits and reported apart, because nothing frozen in the need states the difference.
   - Arm C, prose only: only an English sentence changes (sign reversed, round down), and tests and capability still describe the kernel. The key does not read prose, so this is the stated limit. Counted and reported apart.
4. Warm path: `serve` wall time on one warm cell for pass, refused and miss, second pass over the corpus, journal on; spawn count with `child_process` instrumented.
5. Generation path: recorded P-42 stage times for the same 177, spec and implementation split from traces, plus spawn counts from replaying `runNeed` on five kernels with the same instrumentation.
6. Memory per admitted entry after GC, and serialized size.

## Predictions, fixed before any lookup
1. 177 of 177 admitted, none refused, all on the current gate and host digests.
2. Shipped hit rate on P-21 held-out needs is at most 5%, and on add at most 40%. The contracts are independent readings of each need.
3. `interface` with no gate reaches 5% to 30% on P-21 and at least 70% on add.
4. Arm A false hits under shipped: 0. This is a requirement, not a guess.
5. Arm M false hits under shipped: 0, a requirement.
6. Arm B under shipped: at most 1% of the arm. Under `contract` with gate `none`: at least 80%, which restates P-51's escape rate from the reuse side.
7. Arm C under shipped: above 0. At most the shipped self-hit rate.
8. Natural disagreements on shipped hits: 0.
9. Warm path: pass p50 at most 50 ms and p95 at most 200 ms; miss p50 at most 1 ms before any journal crossing; spawns 0.
10. Replayed generation path spawns at least 6 per need plus two model turns; implementation-stage p50 at least 15 s in P-42's traces.
11. At most 32 KiB per entry on the main thread.
12. Under the full gate, the invalid mutant count is 0 and no kernel is refused as unsupported opcode.

## What a failure means
- Any arm A or M false hit: the shipped key and gate are not sound on this set. It gets reported with the case; activation stays off and no threshold changes in this probe's result.
- Arm B above 1%: wasm mutation is a poor proxy for source mutation, and the gate needs the real compiler or more operators.
- A hit rate of 0 is a result, not a failure: the strictness has a cost and this states it.
- Predictions 9 to 11 are costs. Missing them does not touch soundness.

## Stop conditions
Stop and report if a forged promotion is admitted; if the manifest hash check fails; if the safety status or lane ticket is refused; if the run exceeds 60 minutes. A correction after this point is labelled post-hoc and stated next to the first-run number.

## What this does not show
Reuse under real intent, lifetime economics, tenant isolation, or that seeded faults are the faults a model makes. All reuse here is on one host and one input corpus.
