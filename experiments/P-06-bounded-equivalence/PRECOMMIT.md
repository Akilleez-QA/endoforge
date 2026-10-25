# P-06 bounded-equivalence — precommit

Label: **Recorded (probe)**. Not a campaign; does not decide any X1–X6 experiment.

## Question

Given two implementations of the same pure kernel contract — one AssemblyScript, one Rust — both compiled to WebAssembly, can they be checked equivalent over a bounded input domain by exhaustive enumeration in Node, and what does it cost (inputs, wall time, calls per second)? Does the check expose a seeded semantic fault?

## Unknown it de-risks

- R19 §2.4 "Prove refinements rather than test them": a Rust rewrite of an AssemblyScript kernel "can be checked for equivalence on all inputs up to a bound"; where such a check exists, the refinement case needs no seeded-fault budget (R14 §2's 2,995–29,956 faults per domain are for generation). No such check has been run in this project.
- R03 §9 (promotion versus refinement; behavioural equivalence across a rewrite requires its own qualification).

## Procedure

1. **Contract** (`CONTRACT.md`): `convert(value: i32 milli-units, fromUnit: u8 in 0..3, toUnit: u8 in 0..3, basis: u8 in 0..1) -> i32`, exact integer semantics: rational scaling by fixed 10^-6 factors, round-half-even, saturation to `[INT32_MIN+1, INT32_MAX]`, `INT32_MIN` as the error code for an invalid unit or basis code. Written before either implementation.
2. **Implementations.** `as/convert.ts` compiled with AssemblyScript 0.28.9 (local `node_modules`, pinned in `package.json`; `asc -O3 --noAssert --runtime stub`). `rust/src/lib.rs` as a `cdylib` for `wasm32-unknown-unknown` with Rust 1.98.1 (mise; `rustup target add wasm32-unknown-unknown`; `opt-level 3`, `lto`, `panic=abort`). Toolchain versions and module sha256s recorded by `setup.sh`.
3. **Bounded exhaustive check** (`run.mjs`): all 4 × 4 × 2 = 32 (fromUnit, toUnit, basis) combinations × every `value` in `[-2^20, 2^20)` = 67,108,864 inputs per implementation. Both modules are called on each input in the same loop; disagreements are counted per combination and the first 20 per combination are kept. Separately, each module alone is timed over the same domain for calls per second. A BigInt oracle written from `CONTRACT.md` adjudicates every disagreement found and is also run over a stratified sample (edges ± 3, 200,000 pseudo-random values, all combinations) to say which implementation is wrong. Invalid codes (units 4..7, 255; basis 2, 3, 255) are checked over `value in [-4096, 4096)`.
4. **Two runs.** Run 1 uses the first versions of both implementations as written; its disagreements are recorded and the first versions are kept as `*.v1.*`. If there are disagreements, the implementation the oracle blames is fixed, and run 2 repeats the check. Both runs go in the receipt. If run 1 has no disagreements, that is recorded and run 2 is identical.
5. **Seeded fault.** `rust-faulty/src/lib.rs` is a copy of the final Rust kernel with round-half-even replaced by truncation toward zero (one-line change, recorded as a diff). It is checked against the final Rust kernel over the full domain: the number of inputs that expose it and the first one found are reported.
6. **Symbolic check.** None is run; `RESULT.md` says what one would add.

## Metrics

- Inputs checked, disagreements (run 1, run 2), wall time per run, calls/s per implementation (median of 3 timing passes), WASM module sizes.
- Seeded fault: exposing inputs, first exposing input, fraction of domain.
- Derived: full i32 × 32 cost extrapolated from calls/s (labelled Derived).

## Bad signs

- The 67M-input check takes more than 10 minutes wall (then the "cheap bounded proof" premise weakens).
- Disagreements that the oracle attributes to the contract being ambiguous (the contract, not an implementation, is at fault).
- The seeded fault exposed by fewer than 1 % of inputs (then bounded enumeration over a sub-range could miss realistic faults).

## Stop rule

Stop and record if either toolchain fails to produce a module that instantiates in Node, or if any single pass exceeds 15 minutes. Shared desktop; load average recorded before and after.
