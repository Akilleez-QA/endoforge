# P-51 result: seeded faults through the real gate path

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256` (fa8b7306…), committed before any mutant reached a gate. Run on Node v26.13.0 (P-42 used v22), 2026-11-06, code at 95e53bc, gates digest ec4f586a… in `receipt/real-2026-11-06/environment.json`.

**5.6% of seeded kernel faults were promoted (441 of 7,883, P-21 cohort). When the tests share the fault, 92.7% were.** These kernels are nowhere near the proposed 1 in 1,000 tier on this fault set.

This is a probe, not C03 or C08, and it decides nothing under DEC-64. The rate is sampled, not searched. Edition 3 says a sampled rate overstates safety under search and sets the tiers on the searched rate, so this number can't assign a tier. Seeded faults are also not the faults a model makes.

## Corpus and path
The corpus is the 177 kernels promoted in the P-42 candidate arm: 118 from 20 P-21 needs and 59 from the one add need. Each kept the frozen tests it was promoted with. The sources stay outside git; `receipt/corpus-manifest.json` holds their hashes and `outside-git.sha256` the raw rows'.

Each case ran through unmodified `runNeed`: freeze, the production compiler, pool gates and ledger promotion. A shim replayed stored files where Codex would run. No model was called. All 177 pristine controls promoted.

## Escape rate: original frozen tests
Intervals are Clopper-Pearson two-sided 95%, then a cluster bootstrap over needs. The bootstrap is the one to read, because mutants from one need aren't independent.

| Class (P-21) | Escaped / submitted | Rate | Clopper-Pearson | Bootstrap |
|---|---|---|---|---|
| wrong rounding | 107 / 649 | 16.5% | 13.7–19.6% | 9.5–23.7% |
| boundary errors | 146 / 1,027 | 14.2% | 12.1–16.5% | 11.7–16.8% |
| wrong join | 79 / 800 | 9.9% | 7.9–12.2% | 5.9–14.0% |
| stale binding (values) | 47 / 997 | 4.7% | 3.5–6.2% | 2.9–6.7% |
| wrong constants | 32 / 951 | 3.4% | 2.3–4.7% | 1.0–6.4% |
| off by one | 26 / 955 | 2.7% | 1.8–4.0% | 0.9–5.0% |
| reversed inputs | 2 / 403 | 0.5% | 0.06–1.8% | 0–1.4% |
| dropped rows | 1 / 271 | 0.4% | 0.01–2.0% | 0–1.1% |
| swapped units | 1 / 884 | 0.1% | 0.003–0.6% | 0–0.3% |
| sign errors | 0 / 946 | 0% | 0–0.4% | 0–0% |
| **Overall** | **441 / 7,883** | **5.6%** | **5.1–6.1%** | **4.4–6.8%** |

| Other results | Escaped / submitted | Rate |
|---|---|---|
| P-21, faults visible on finite inputs only | 258 / 7,700 | 3.4% (3.0–3.8%) |
| P-21, faults visible only on NaN or infinity | 183 / 183 | 100% |
| Add cohort (one need, so no bootstrap) | 46 / 2,533 | 1.8% (1.3–2.4%) |
| All kernels pooled | 487 / 10,416 | 4.7% (4.3–5.1%); bootstrap 3.4–6.5% |
| Label-only glue faults, P-21 | 691 / 799 | 86.5% (83.9–88.8%) |
| Label-only glue faults, add | 118 / 118 | 100% |
| Tests or contract changed after freeze | 0 / 354 | All refused at G1 |

Kernel classes are mapped onto scalar code, as the precommit states; these kernels have no literal rows or joins. Of 11,599 selected mutants, the filter dropped 1,183 without using a gate: 89 didn't compile, 124 had identical wasm, 23 duplicated another mutant's wasm and 947 matched on the input grid. Grid equality isn't proof of equivalence.

## Sample size
| Tier (one-sided 95%) | Zero escapes allowed | Two escapes allowed |
|---|---|---|
| Below 1 in 1,000 | 2,995 | 6,294 |
| Below 1 in 10,000 | 29,956 | 62,956 |

- **Can claim:** on this fault set the sampled rate is well above 1 in 1,000, with a bootstrap lower bound of 4.4%. The sample is big enough to have supported that tier, had the escapes been there to allow it.
- **Can't claim:** anything at 1 in 10,000, any searched rate, or any other domain. It has 20 needs, one model's tests and one domain. No single class reaches 2,995, so even 0 of 946 sign errors only bounds that class below 0.4%.

## Why they escaped
| Reason (P-21) | Count | What it means |
|---|---|---|
| Test gap | 258 | No frozen test input shows any difference from the pristine kernel |
| Gate gap | 183 | Visible only on NaN or infinity, which P-42's scalar filter removes from tests |
| Evaluator weakness | 0 | No tolerance or `expectError` hid a difference that a test input showed |

The glue escapes are all gate gaps: G7 checks structure, not whether a label is true. It did catch every dropped code row (108 of 108 in P-21), but no swapped unit, reordered argument, changed precision or swapped code label.

Reading the gates also shows that in this path the universal gates don't examine the candidate. `core/runtime/x1/host.mjs` answers `describe`, `run` and `scanEffects` with constants, and the invariant list is empty. Everything is decided by the residual, G1–G7, and every sampled catch was at G4 (9,660 alone, 269 with G7).

## Correlated error
Rewriting each mutant's expected values from the mutant itself simulates one wrong reading shared by test and kernel. The contract text wasn't changed, and no gate reads its meaning.

- 7,311 of 7,883 P-21 mutants escaped: 92.7% (92.1–93.3%), bootstrap 90.2–94.9%. Add: 2,531 of 2,533.
- **6,870 of the 7,442 P-21 faults caught in the sampled arm (92.3%) were caught only because the tests were written independently of the fault.** That is the correlation Edition 3 section 6 warns about, and the 5.6% assumes it away.
- The 574 still caught across both cohorts were incidental: 269 at G7 (a new `expectError` without a glue trap entry), 136 by the scalar filter (no value tests left) and 169 at G4 only because JSON can't hold the mutant's non-finite expected value.

Could anything else see them? The precommitted counts flag a mutant even when its pristine kernel is already flagged, which overstates the catch. The net columns, added after the run and so exploratory, count a catch only if the pristine kernel wasn't flagged.

| Oracle | Sampled escapes, raw (of 441) | Sampled, net (of 258 finite) | Correlated, net (of 7,311) | Pristine kernels flagged (of 118) |
|---|---|---|---|---|
| Peer majority | 201 | 31 | 1,254 | 37 (8 on values) |
| Glue relations R1–R4 | 95 | 55 | 2,538 | 11 |
| Either | 229 | 84 (33%) | 3,387 (46%) | |

Neither caught 3,924 correlated mutants (54%). Those are invisible to every check measured here. Peers share the model and the request, so they aren't an independent reference, and none exists for these needs in this repository. A wrong reading all peers share can't be seen by them, and this probe can't measure it.

Promoted kernels also disagree with no seeding at all. Of 115 same-need P-21 pairs comparable on shared test inputs, 79 differ and 10 differ on a value, so one kernel in each of those 10 pairs would fail the other's frozen tests, or the two contracts read the request differently. Add: 0 of 1,711.

## Non-model checks to consider
None were added to the gates here. Numbers are exploratory and on this corpus only.

| Check | Would catch | Flags pristine kernels |
|---|---|---|
| Glue argument names must equal kernel parameter names | 239 of 239 reordered-argument escapes | 0 of 177 |
| Probe NaN and infinity directly in the gate, not through JSON; refuse a non-finite result | 157 of 183 non-finite escapes | 1 of 118 |
| Declared glue ranges must agree with the kernel (R1, R4) | 55 of 258 finite escapes | 11 of 118 |
| Peer differential on values only | 30 of 441 net | 8 of 118 |
| Run each kernel's own boundary and rounding mutants and report survivors | Would flag 66 of 118 kernels on finite survivors, so start report-only; a threshold is unmeasured | Not measured |
| Require tests on both sides of each comparison literal, and non-round inputs for float results | Aimed at the top two classes; not measured | Not measured |
| Compare glue precision with the decimals `CONTRACT.md` states | Aimed at 248 precision escapes; not measured | Not measured |

For correlated faults, only sources outside the generator's reading can help: the person's own examples, data, or an existing implementation. Edition 3 section 6 says the same.

## Predictions
| # | Prediction | Result | Verdict |
|---|---|---|---|
| 1 | P-21 rate 3–20% | 5.6% | Pass |
| 2 | Boundary highest, swapped units lowest | Rounding highest, sign errors lowest | **Fail** |
| 3 | At least 95% of catches at G4 | 100% | Pass |
| 4 | At least 60% of P-21 escapes are test gaps | 58.5% | **Fail** |
| 5 | At least 99% of controls promote | 177 of 177 | Pass |
| 6 | Glue escape rate at least 80% | 86.5% | Pass |
| 7 | No binding change promoted | 0 of 354 | Pass |
| 8 | Correlated escape rate at least 95% | 92.7% | **Fail** |
| 9 | Peers catch at least 50%, with at least 20% false alarms | 45.6% raw, 31.4% flagged | **Fail** on catch |
| 10 | Relations catch at most 25% | 21.5% raw | Pass |

## What went wrong in the run
- **Transient refusals:** 39 correlated mutants were refused on first pass although the gates passed them. All 39 promoted on retry at width 2, and one rechecked alone also promoted. They were refusals without a gate failure, so per the precommit they are not catches, and the figures above count them as escapes; the first pass read 7,272. The sampled arm had none. The cause wasn't found, and no ledger evidence from those runs was kept. It fails closed, but a promotion decision that varies under load needs looking at. All 136 scalar-filter refusals repeated on retry.
- **Bias in the design:** the precommitted peer count overstated catches, as described above. Both figures are reported.
- **Harness:** the first prepare crashed on `-trace` directories before compiling anything, costing about 5 minutes. The controls failed on two passes, from an invalid synthetic glue fixture and a wrong expected value in a test, before any real mutant ran.

## What it does not show
- Any searched rate, model-made fault rate, or result for another domain.
- Whether an escape matters in use. Many are guards moved slightly or rounding on values the tests happen to leave unchanged, and witnesses weren't limited to each kernel's declared domain.
- That the classes are balanced. Mutants are capped per kernel and class, so the overall rate depends on the operator mix; compare classes, not just the total.
- Stale compile bindings. G2 compares a recorded source hash and doesn't recompile, and the pipeline's own compile step can't produce a mismatch, so this wasn't measured.

## Reproduce
Set `ENDOFORGE_ASC_CMD` to AssemblyScript 0.28.20 and `P51_CORPUS` to a directory of P-42-format receipts. Set `P51_OUTPUT` and `P51_PREP` outside the checkout, then run `prepare.mjs`, `run.mjs` (add `P51_ARMS=correlated-retry` for the retry pass) and `analyze.mjs`. `node --test controls.test.mjs` runs the 11 synthetic controls. They include a planted escape, a caught fault and each escape reason.
