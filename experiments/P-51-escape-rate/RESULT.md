# P-51 result: seeded faults through the real gate path

Precommit: `PRECOMMIT.md`, sha256 in `receipt/precommit.sha256` (fa8b7306…), committed before any mutant reached a gate. Corrected on 2026-11-06 after an independent review; see [Corrections](#corrections-2026-11-06).

**5.6% of seeded kernel faults were promoted (441 of 7,883, P-21 cohort; one-sided 95% upper bound 6.04%). In a simulation where the tests fully share the fault, at least 92.7% were. That figure is a floor for the simulation, not an estimate of how often correlation happens.** On this fault set the rate is far above the proposed 1 in 1,000, even counting only faults with a plausibly in-domain witness (about 1.1%).

This is a probe, not C03 or C08, and it decides nothing under DEC-64. The rate is sampled, not searched. Edition 3 says a sampled rate overstates safety under search and sets the tiers on the searched rate, so this number can't assign a tier. Seeded faults are also not the faults a model makes.

## Corpus and path
The corpus is the 177 kernels promoted in the P-42 candidate arm: 118 from 20 P-21 needs and 59 from the one add need. Each kept the frozen tests it was promoted with. The sources stay outside git; `receipt/corpus-manifest.json` holds their hashes and `outside-git.sha256` the raw rows'.

Each case ran through unmodified `runNeed`: freeze, the production compiler, pool gates and ledger promotion. A shim replayed stored files where Codex would run. No model was called. All 177 pristine controls promoted.

The run uses `ENDOFORGE_CODEX_TERSE=scalar`, the corpus's own mode. The generator's default is `exact`, so this describes tests written under the scalar rule, not the default.

## Escape rate: original frozen tests
Intervals are Clopper-Pearson two-sided 95%, then a cluster bootstrap over needs. The bootstrap is the one to read, because mutants from one need aren't independent. Cells marked * are degenerate: every need had the same outcome, so they are not a measure of uncertainty.

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
| sign errors | 0 / 946 | 0% | 0–0.4% | 0–0%* |
| **Overall** | **441 / 7,883** | **5.6%** | **5.1–6.1%** | **4.4–6.8%** |

| Other results | Escaped / submitted | Rate |
|---|---|---|
| P-21, faults visible on finite inputs | 258 / 7,700 | 3.4% (3.0–3.8%) |
| P-21, faults visible only on NaN or infinity | 183 / 183 | 100% (98.0–100%); bootstrap 100–100%* |
| Add cohort (one need, so no bootstrap) | 46 / 2,533 | 1.8% (1.3–2.4%) |
| All kernels pooled | 487 / 10,416 | 4.7% (4.3–5.1%); bootstrap 3.4–6.5% |
| Label-only glue faults, P-21 | 691 / 799 | 86.5% (83.9–88.8%) |
| Label-only glue faults, add | 118 / 118 | 100% |
| Tests or contract changed after freeze | 0 / 354 | All refused by the generator, before any gate |

The binding arm doesn't exercise G1. Those rows failed at `generator.mjs:119`, and the `G1_frozen` label in the receipt was added afterwards by the harness's `attribute()`.

Kernel classes are mapped onto scalar code, as the precommit states; these kernels have no literal rows or joins. Of 11,599 selected mutants, the filter dropped 1,183 without using a gate: 89 didn't compile, 124 had identical wasm, 23 duplicated another mutant's wasm and 947 matched on the input grid. Grid equality isn't proof of equivalence, though the review's denser search found no witness for any of the 947.

### Finite faults, and how many are plausibly in-domain
Most boundary and join escapes differ only on NaN or infinity. Counting finite-visible faults changes the class order. The last column comes from the independent review: a search for a witness inside the kernel's declared glue ranges.

| Class (P-21, finite) | Escaped / submitted | Rate | With an in-range witness |
|---|---|---|---|
| wrong rounding | 107 / 649 | 16.5% | 62 |
| stale binding (values) | 47 / 997 | 4.7% | 5 |
| wrong constants | 32 / 951 | 3.4% | 4 |
| boundary errors | 27 / 908 | 3.0% | 2 |
| off by one | 26 / 955 | 2.7% | 8 |
| wrong join | 15 / 736 | 2.0% | 0 |
| reversed inputs | 2 / 403 | 0.5% | 2 |
| dropped rows | 1 / 271 | 0.4% | 1 |
| swapped units | 1 / 884 | 0.1% | 1 |
| sign errors | 0 / 946 | 0% | 0 |

Of the 258 finite escapes, 85 have an in-range witness. Another 104 have fully declared ranges and no witness was found, and 69 have partial ranges and no witness was found. So 85 to 154 are plausibly in-domain: 1.1% to 2.0% on the unadjusted denominator of 7,883, which is not itself limited to in-domain faults. "Far above 1 in 1,000" holds at either end.

## Sample size
| Tier (one-sided 95%) | Zero escapes allowed | Two escapes allowed |
|---|---|---|
| Below 1 in 1,000 | 2,995 | 6,294 |
| Below 1 in 10,000 | 29,956 | 62,956 |

These counts assume independent faults, and these are not. The review's design effect is about 6.1, from the squared ratio of bootstrap to Clopper-Pearson widths, giving an effective sample of about 1,290. Rechecked here, a ratio estimator gives 6.4 (about 1,240), and the receipt's own bootstrap interval gives 5.4 (about 1,450). All of these are below 2,995.

- **Can claim:** on this fault set the sampled rate is well above 1 in 1,000, with a bootstrap lower bound of 4.4%.
- **Can't claim:** anything at 1 in 10,000, any searched rate, or any other domain. With 7,883 clustered mutants, even zero escapes wouldn't have supported the 1 in 1,000 tier. It has 20 needs, one model's tests and one domain. No single class reaches 2,995, so even 0 of 946 sign errors only bounds that class below 0.4%, before clustering.

## Why they escaped
| Reason (P-21) | Count | What it means |
|---|---|---|
| Test gap | 258 | No frozen test input shows any difference from the pristine kernel |
| Gate gap | 183 | Visible only on NaN or infinity, which no frozen test here uses |
| Evaluator weakness | 0 | No tolerance or `expectError` hid a difference that a test input showed |

The likelier source of the gate gap is the prompt rule at `generator.mjs:39`, which tells the generator that `expectError` tests use only finite numeric inputs. It isn't the scalar filter: all 180 `scalar-filter.json` reports show `droppedCount: 0`. The same rule says the boundary is finite numbers, so these faults are arguably outside the contract the kernels were asked to meet. The review's dense finite search found no finite witness for any of the 183.

The glue escapes are all gate gaps: G7 checks structure, not whether a label is true. It did catch every dropped code row (108 of 108 in P-21), but no swapped unit, reordered argument, changed precision or swapped code label.

### Universal gates
The universal gates carry no information about the candidate in this path. `host.mjs:18-21` returns constants from `describe`, `run` and `scanEffects`, and the invariant list is empty. The review ran an empty candidate, a garbage wasm and a nonexistent id through them, rechecked here, and all three pass. So 5 of the 6 results that `x1_ledger.py:62-63` requires say nothing about the candidate. Only the residual, G1–G7, does. Every sampled catch was at G4 (9,660 alone, 269 with G7).

Non-terminating kernels are not exercised. `run.mjs:107` sets no `jobTimeoutMs`, and G6 measures time only after a call returns, so such a kernel would plausibly hang this harness rather than be refused.

## Correlated error
Rewriting each mutant's expected values from the mutant itself simulates one wrong reading shared by test and kernel. The contract text wasn't changed, and no gate reads its meaning.

- 7,311 of 7,883 P-21 mutants escaped: 92.7% (92.1–93.3%), bootstrap 90.2–94.9%. Add: 2,531 of 2,533.
- **This is a floor for a fully correlated simulation.** It says nothing about how often real tests and kernels share a wrong reading, which this probe doesn't measure.
- All 572 P-21 catches come from how the simulation was built: 269 at G7 (a new `expectError` with no glue trap entry, because glue wasn't rewritten), 134 by the scalar filter (no value test left for a function) and 169 at G4 because JSON can't hold the mutant's non-finite expected value.
- **6,870 of the 7,442 P-21 faults caught in the sampled arm (92.3%) were caught only because the tests were written independently of the fault.** That is the correlation Edition 3 section 6 warns about, and the 5.6% assumes it away.

Could anything else see them? The precommitted counts flag a mutant even when its pristine kernel is already flagged, which overstates the catch. The net columns, added after the run and so exploratory, count a catch only if the pristine kernel wasn't flagged.

| Oracle | Sampled escapes, raw (of 441) | Sampled, net (of 258 finite) | Correlated, net (of 7,311) | Pristine kernels flagged (of 118) |
|---|---|---|---|---|
| Peer majority, as run (3 matching peers) | 201 | 31 | 1,254 | 37 (8 on values) |
| Peer majority, as precommitted (2 peers) | 234 | 32 | Not computed | 47 (10 on values) |
| Glue relations R1–R4 | 95 | 55 | 2,538 | 11 |
| Either, as run | 229 | 84 (33%) | 3,387 (46%) | |

Moving from 3 peers to 2 raises the raw catch and the false alarms, but the net catch barely moves, from 31 to 32.

Neither caught 3,924 correlated mutants (54%). Those are invisible to every check measured here. Peers share the model and the request, so they aren't an independent reference, and none exists for these needs in this repository. A wrong reading all peers share can't be seen by them, and this probe can't measure it.

Promoted kernels also disagree with no seeding at all. Of 115 same-need P-21 pairs comparable on shared test inputs, 79 differ and 10 differ on a value, so one kernel in each of those 10 pairs would fail the other's frozen tests, or the two contracts read the request differently. Add: 0 of 1,711.

## Non-model checks to consider
None were added to the gates here. Numbers are exploratory and on this corpus only.

| Check | Would catch | Flags pristine kernels |
|---|---|---|
| Non-round inputs in tests of float results | Aimed at rounding, the largest finite class (107 escapes, 62 with an in-range witness); not measured | Not measured |
| Check numeric literals against a declared source table | Aimed at stale binding and constants, the next finite classes (79 escapes); not measured | Not measured |
| Probe NaN and infinity directly in the gate, not through JSON; refuse a non-finite result | 157 of 183 non-finite escapes | 1 of 118 |
| Declared glue ranges must agree with the kernel (R1, R4) | 55 of 258 finite escapes | 11 of 118 |
| Peer differential on values only | 30 of 441 net | 8 of 118 |
| Run each kernel's own mutants and report survivors | Would flag 66 of 118 kernels on finite survivors, so start report-only; a threshold is unmeasured | Not measured |
| Glue argument names must equal kernel parameter names | 239 of 239, true by construction: those mutants swap the names in glue. It says nothing about a real mislabelled argument | 0 of 177 |
| Compare glue precision with the decimals `CONTRACT.md` states | Aimed at 248 precision escapes; not measured | Not measured |

Tests on either side of comparison literals aren't a priority, contrary to the first version of this result. `relax_or_tighten_comparison` escaped 2 of 412 times. `drop_guard_disjunct` is 140 of the 146 boundary escapes, and 117 of those 140 differ only on NaN or infinity.

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
| 9 | Peers catch at least 50%, with at least 20% false alarms | Precommitted 2 peers: 53.1%, 39.8% flagged. As run with 3: 45.6%, 31.4% | Pass on the precommit text; as run it would fail |
| 10 | Relations catch at most 25% | 21.5% raw | Pass |

The precommit says at least 2 agreeing peers, and that text governs the verdict. `probe.mjs:160` also requires 3 matching peers, so the receipt holds the 3-peer figures. The 2-peer figures come from the independent review and were rechecked here.

## What went wrong in the run
- **Transient refusals:** 39 correlated mutants were refused on first pass although the gates passed them. All 39 promoted on retry at width 2. Per the precommit they are not catches, so the figures above count them as escapes; the first pass read 7,272.
  - They fall in 7 tight runs of rows, 39 of 9,842 gate-passing rows (0.40%) at width 14.
  - The review reproduced the signature by injection: a stalled `requireFrozen` hitting its 10 s timeout, at any of its calls. Rechecked here. A failed compile gives the same signature, so the specific cause is plausible, not settled, because the run discarded timings and decision reasons.
  - It fails closed. All 136 scalar-filter refusals repeated on retry.
  - "The sampled arm had none" is weak evidence. Only its 487 gate-passing rows could show this, about 2 expected at this rate, with a 14% chance of none even if independent, and these come in bursts.
- **Bias in the design:** the precommitted peer count overstated catches, as described above. Both figures are reported.
- **Harness:** the first prepare crashed on `-trace` directories before compiling anything, costing about 5 minutes. The controls failed on two passes, from an invalid synthetic glue fixture and a wrong expected value in a test, before any real mutant ran.

## Provenance
- Run on Node v26.13.0 (P-42 used v22), 2026-11-06, gates digest ec4f586a… in `receipt/real-2026-11-06/environment.json`.
- That file records no commit. The main arms ran from the tree committed as 95e53bc; this rests on git history and order of work, not on a receipt.
- `correlated-retry` is not in 95e53bc. It was added to `run.mjs` after the main arms and committed in b1d27c1, after being run.
- The earlier note that one refused mutant, rechecked alone, promoted has no receipt.
- `analyze.mjs` also changed during the run, for the exploratory columns, which is why they are marked so.

## What it does not show
- Any searched rate, model-made fault rate, how often correlation happens, or a result for another domain.
- Whether an escape matters in use, beyond the in-domain bound above.
- That the classes are balanced. Mutants are capped per kernel and class, so the overall rate depends on the operator mix; compare classes, not just the total.
- Stale compile bindings. G2 compares a recorded source hash and doesn't recompile, and the pipeline's own compile step can't produce a mismatch, so this wasn't measured.
- The binding arm's effect on G1, or how the path behaves on a kernel that never returns.

## Reproduce
Set `ENDOFORGE_ASC_CMD` to AssemblyScript 0.28.20 and `P51_CORPUS` to a directory of P-42-format receipts. Set `P51_OUTPUT` and `P51_PREP` outside the checkout, then run `prepare.mjs`, `run.mjs` (add `P51_ARMS=correlated-retry` for the retry pass) and `analyze.mjs`. `node --test controls.test.mjs` runs the 11 synthetic controls.

## Corrections, 2026-11-06
An independent review of b1d27c1 confirmed the headline counts and found the errors below. Its scripts stayed outside git. Where a script existed, the figures were rerun here and matched: peer counts, in-domain bound, scalar-filter reports, universal gates, stall injection and the retried refusals. Two came from its saved output without a rerun: the denser searches on the 183 non-finite escapes and on the 947 dropped mutants. `PRECOMMIT.md` and all receipts are unchanged, so `summary.json` still holds the first-version wording and the 3-peer figures. Nothing was rerun.

| First version said | Now |
|---|---|
| Prediction 9 failed | Passes on the precommit's 2 peers; the code also required 3. Both reported |
| Binding changes "all refused at G1" | Refused by the generator before any gate; the label came from `attribute()` |
| Cause of the 39 not found, no further detail | Plausible stalled `requireFrozen`, not settled; bursts recorded; "sampled had none" marked weak |
| The sample "is big enough to have supported" the tier | Removed: effective sample is about 1,290 |
| Bootstrap cells unqualified | 0–0% and 100–100% marked degenerate |
| Only overall finite rate given | Finite rates per class added; the recommendation on comparison literals withdrawn |
| Witnesses not limited to declared domain | In-domain bound added: 85 to 154 of 258 |
| Gate gap blamed on the scalar filter | The filter dropped nothing; the likelier source is the prompt rule. The `probe.mjs` detail string was also corrected |
| Bold 92.7% read as a result on correlation | Stated as a floor for a simulation; all 572 catches attributed to its construction |
| "Would catch 239 of 239" | True by construction; says nothing about a real mislabelled argument |
| Code at 95e53bc | Provenance section added; one-sided upper bound and `scalar` mode stated |
| Universal gates "don't examine the candidate" | Stated with evidence; non-terminating kernels noted as unexercised |

Also changed: `run.mjs` now keeps per-row timings, pool outcomes and the ledger's decision and reason, and labels refusals before any gate as `before_gates`. Discarding these is why the 39 can't be settled. Rows from this run don't have them.
