# P-51-escape-rate PRECOMMIT: seeded faults through the real gate path

Probe only. This is not C03 or C08, and it decides nothing about tiers or width. No model call, Codex run, spend or account is involved.

## Question
How often does a seeded fault get promoted by the path production uses (`runNeed`: freeze, compile, register, pool gates, ledger promote), and how much of the catching depends on tests having been written independently of the fault?

`escape rate = seeded faults promoted / seeded faults submitted` (Edition 3, section 7).

## Corpus
All 177 kernels that promoted in the P-42 candidate arm (`ENDOFORGE_CODEX_TERSE=scalar`, six runs, 30 requests): 118 in the P-21 cohort across 20 needs, and 59 in the add cohort, all one need. The sources stay outside git, as P-42's receipts do. The per-file hash manifest goes in the receipt.

- corpus-manifest.json sha256: 51b397df0f73200f4a4b37d470ae45bed44a395871be5ffe81eb460f4068723f
- mutants.jsonl sha256: 18f575d6320745052d6e7433bd22a5a5f3104fa9c63c6b19d4e648d0c79fab3f
- gates: `core/runtime/x1/gates.mjs` unchanged on this branch; digest recorded in environment.json. AssemblyScript 0.28.20 with the production flags.

The 172 P-42 baseline-arm kernels are used only as peers, never mutated.

## Faults
Source mutation on a token stream (`mutate.mjs`), ten classes, at most 10 mutants per kernel and class, chosen by hash. Scalar kernels have no literal rows or joins, so the classes are mapped: `dropped_rows` drops a sum term, branch, ternary arm or array element; `wrong_join` swaps `&&`/`||`, min/max, `+`/`*` or ternary arms; `stale_binding` rounds a literal to three figures, shifts it by 0.2%, or binds another literal from the same kernel.

Filter, already run without any gate: compile with the production compiler, then differential execution against the pristine wasm on a grid built from test inputs, source literals and fixed values, plus non-finite inputs. Non-equivalent means trap status differs or relative difference above 1e-12.

| Enumerated | Selected | Would not compile | Identical wasm | Duplicate wasm | Equivalent on grid | Non-equivalent |
|---|---|---|---|---|---|---|
| 18,939 | 11,599 | 89 | 124 | 23 | 947 | 10,416 |

Non-equivalent: 7,883 P-21 and 2,533 add. 183 differ only on non-finite inputs. A mutant equal on the grid is dropped as `equivalent_on_extended_set`; that is not a proof of equivalence.

## Arms
A shim stands in for the Codex command and replays stored files through unmodified `runNeed` with a real pool of width 14, thread isolation.

- `control`: 177 pristine kernels. A kernel that doesn't promote is excluded with its mutants and reported.
- `sampled`: each non-equivalent mutant with its original frozen tests. Headline: P-21 cohort.
- `glue`: 917 mutants of labels only (units, argument order, precision, code labels and rows, boolean labels). Reported apart from the kernel rate.
- `binding`: 354 changes to tests or contract after freeze.
- `correlated`: each non-equivalent mutant with tests whose expected values were rewritten from the mutant before freeze. This simulates one wrong reading shared by test and kernel. It is a simulation, not observed model behaviour.

## Analysis
Clopper-Pearson two-sided 95% overall and per class, the count, one-sided 95% upper bound, and a seeded cluster bootstrap over needs. Mutants from one need are not independent, so the bootstrap is the interval to read for the headline.

Each escape is classified by execution, not by the gates:
- `test_gap`: no frozen test input shows a difference from the pristine kernel.
- `evaluator_weakness`: a frozen test input shows a difference and the comparison accepted it (tolerance, any trap satisfies `expectError`).
- `gate_gap`: nothing in the frozen test format or gates could see it: non-finite-only witnesses, and glue labels.

Oracles measured on escapes in both arms, and on pristine kernels for false alarms:
- Peers: other promoted kernels for the same need (candidate and baseline arms) with the same export name and arity. Flag when the candidate differs from a strict majority of at least 2 agreeing peers, tolerance 1e-6, on the union of their test inputs. Peers share the model and request, so this is N-version, not independent of the reading.
- Relations R1 to R4, from glue alone: declared range accepted, finite in range, codes labelled, outside range refused when the export declares a trap.

Natural disagreement: pairs of promoted pristine kernels for one need that differ on shared test inputs.

## Predictions, fixed before any mutant reaches a gate
1. P-21 sampled escape rate is between 3% and 20%.
2. `boundary_errors` has the highest class rate and `swapped_units` the lowest.
3. At least 95% of sampled catches are at G4.
4. At least 60% of P-21 escapes are `test_gap`.
5. At least 99% of pristine controls promote.
6. Glue escape rate is at least 80%.
7. Binding: none promoted.
8. Correlated escape rate is at least 95%.
9. Peers catch at least 50% of P-21 sampled escapes, with a pristine false-alarm rate of at least 20%.
10. Relations catch at most 25% of P-21 sampled escapes.

Failed predictions stay in the result. No gate, test or threshold changes during this probe. Harness errors are counted and reported, never treated as catches.

## What it will not show
- A searched rate. This is sampled, and Edition 3 sets tiers on the searched rate.
- Model-made faults. Seeded faults differ from what a model writes.
- Certification. 7,883 mutants from 20 needs in one domain, with one model's tests.
