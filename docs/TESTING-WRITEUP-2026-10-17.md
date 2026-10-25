# Endoforge testing write-up, 17 October 2026

> Superseded for current status by `docs/REPORT-2026-10-18.md` (18 Oct): the same 20 requests now run at a median of 30 s; see `docs/figures/baseline-20-then-and-now.png`.

Shareable copy: https://claude.ai/code/artifact/0892bb75-b8c4-4c55-86ff-af6e73a34dda (same content; the chart there is a table here).

## How to read this

Every number in this write-up is probe- or pilot-level: one run, on a shared desktop under load, with no quiet gate, no calibration and no replication. None of it is a campaign result and none of it decides an Edition 3 experiment (X1–X6). What the tests do is narrow design decisions, and that is how the plan uses them.

| Label | Meaning here |
|---|---|
| Recorded (probe) | One precommitted run on the Main-rig (AMD 7950X, 125 GiB, Node 26); receipts under `experiments/P-*/receipt/` |
| Pilot (not a registered result) | The X1 dark-factory run: real requests, but C01 was never formally registered (no named author or reviewer) |
| Derived | Arithmetic from stated values, shown |
| Upstream | A third party's figure, pinned |
| Proposed | Design intent; nothing establishes it yet |

Two things are still open and are stated as such below rather than waited for: the merge of the delivered package (in the integration lead's next pass) and claim-ladder rung 4 (no technician has used a capability yet).

## What was tested and why

Edition 3 (17 Oct 2026) left its claim ladder at rung 2 with every number above it either estimated or missing. The day's programme turned each unknown that could be tested on this machine into a precommitted probe, then ran the whole factory loop once on real requests.

| Unknown Edition 3 left open | Test | Why it matters |
|---|---|---|
| Cost of a WASM kernel instance (§5) | P-01 kernel-instantiate | Sets the density the workcell can afford |
| Whether a compiler runs inside an isolate with no filesystem (rung 1, E3-10) | P-02 compiler-in-isolate | The all-local objective depends on it |
| Whether the seeded-fault method and its statistics work (X3, R14 §2) | P-03 escape-rate-method | X3 cannot be registered on an untested method |
| What a model turn costs (§10; never measured) | P-04, P-04b model-term | Four fifths of the loop's time |
| Whether tsc-rs fits a 128 MiB Workers isolate (X6, RISK-02) | P-05 hosted-fit | Decides whether the hosted lane compiles or only runs |
| Whether a refinement can be proven rather than tested (R19 §2.4) | P-06 bounded-equivalence | Removes the seeded-fault budget for rewrites |
| Whether agents can turn real small requests into qualified capabilities (X1; the dark-factory direction) | X1 pilot, 20 requests | The product claim itself |
| Whether gated means wanted | Persona review, factory v2 | Found the defect class the gates cannot see |
| Whether the result runs in the user's application | Package checks on `aaf112ba` | The path to rung 4 |

Each probe was hashed before measurement (`PRECOMMIT.md`), captured its environment before and after, kept raw samples, and carries a "what this does not show" section. The pilot froze every contract and its tests by hash before any code existed, and fixed gates the workers could not edit judged the result.

### What kind of testing this is

Three kinds, stacked; little of it is unit, integration, CI or CD in the usual sense.

| Layer | Kind of testing | Nearest standard term |
|---|---|---|
| Probes P-01–P-06, P-04b | Precommitted feasibility experiments and microbenchmarks; P-03 is a meta-test (mutation testing of an evaluator's discriminating power) | Spike / preregistered experiment; mutation testing |
| X1 pilot, per capability | Test-first unit tests written by the agent and frozen by hash before any code (G4); property-style gates: determinism, bounded time, no imports (G5, G6, G2); an acceptance gate (promotion) | Specification by example; property checks; acceptance test |
| X1 pilot, as a whole | End-to-end system test of the factory loop on real requests; the agents were also the subject under test | System test; agent evaluation |
| Persona review | Acceptance checking by simulated users, blind to the workers | User-acceptance proxy; heuristic evaluation |
| Package in refrigeration-ai | Unit and integration tests (vitest), typecheck, lint, denylist, ratchet | CI gates; CD not applicable |

"Agentic" holds in both directions: agents authored, ran and reviewed the tests, and agents were measured. Where a model judged (the blind rater-2 and persona agents) the verdict is labelled as a model's and is never, on its own, what promotes a capability.

## Probes: what each measured and what it narrows

All Recorded (probe). Every claim Edition 3 made about the workcell held with room to spare; the two surprises were in the model term and the hosted lane.

| Probe | Result | What it narrows | What it does not show |
|---|---|---|---|
| P-01 kernel-instantiate | 18.6 µs (V8) / 5.0 µs (Wasmtime; 4.0 µs pooling) per instantiate of a 1,594-byte kernel; ≈9–12 KB resident per instance plus touched memory; a call 210–240 ns | E3 §5's claims hold by two orders of magnitude; the 150 MiB lab figure was whole-unit | Managed objects or imports; density under memory pressure |
| P-02 compiler-in-isolate | asc with in-memory callbacks in a worker isolate and under bubblewrap (no home, /etc, network): 80/80 compiles, 0 real fs calls, 40–51 ms per kernel; RSS plateau ≈480–490 MB | Rung 1 at probe level for the V8-hosted route; the RSS is X6's problem | The compiler under Wasmtime (E3-10 stands) |
| P-03 escape-rate-method | 381 non-equivalent toy mutants; 17.8 % escape [14.1, 22.1]; gates alone 68.8 %, +invariants 35.4 %, +residual 22.6 %, all three 17.8 %; semantic faults: gates 0/23, invariants 19/23; disagreement inputs for 99.4 % of pairs, one frozen answer killed 58/68; 4.65 ms/mutant | Method works; invariants carry discriminating power; the evaluator must be total (v1 crashed, revised once) | Endoforge's escape rate; the searched stratum degenerated |
| P-04 / P-04b model-term | `claude -p` on the subscription: 93.9 s median with ≈460k context tokens; 7.2k context → 90.6 s; `--effort low` 56.4 s; Sonnet 65.6 s; output 6–10k tokens, half thinking; 4 parallel ≈ 1 in wall; 45/48 kernels passed the type gate; no prefix caching via the CLI | Thinking and output length are the levers; E3's "≈1,000 tokens, 5–10 s" is ~10× off here; X5's baseline is the lean CLI arm | A bare API turn (dropped: subscription only); any local model |
| P-05 hosted-fit | tsc-rs WASM + shim + kernel under workerd: RSS 77 → 183 MiB (peak 352), same in plain Node; 50-file check 1.90× native single-threaded, 3.01× at 5 files; bundle 2.23 MB gzip; JS heap limit enforced, WASM memory not | X6 latency line met at 50 files; 128 MiB line not met at process level (RISK-02) | Cloudflare's production accounting; per-isolate heap |
| P-06 bounded-equivalence | AssemblyScript vs Rust kernel of one integer contract: 67,108,864 inputs, 0 disagreements, 0.7 s; planted rounding fault exposed by 39.0 % of inputs; full i32 for two combinations clean in 42–44 s | Refinement with a reference can be exhaustively checked (R19 §2.4) | Symbolic equivalence; state or floating point |

Cost: about $11 on the CLI account for P-04; the rest on the subscription and this machine.

## The X1 dark-factory pilot

Twenty real requests went through the whole loop with no person in it, and 19 came out as gate-verified capabilities; the median request took 97 seconds. Pilot (not a registered result): C01 was never formally registered, completeness is the worker's own judgement, and the machine was shared.

The needs: 8 verbatim technician questions from the public Refrigeration.AI chatbot logs, 4 owner process rules, 5 recorded owner decisions, 1 owner issue, 2 derived from the corpus, plus 36 chatbot calculations as the frozen reserve (pool of 60, seed 20261017; the owner vouched for inclusion). One fresh agent per primary request: start the timer, read the request, write the contract and executable tests, freeze both by hash, generate an AssemblyScript kernel, run the fixed gates (frozen, compiles with no imports, exports, tests, deterministic, bounded), repair the kernel only, stop. The coordinator re-ran every gate before promotion.

| Request | Working s | Status after v2 | Rounds |
|---|---|---|---|
| C-015 | 59 | promoted-pending-change | 1 |
| CC-036 | 61 | promoted-with-assumption | 1 |
| CC-011 | 74 | gated-rejected-by-persona | 1 |
| CC-014 | 74 | promoted-with-assumption | 1 |
| CC-025 | 74 | promoted-with-assumption | 1 |
| CC-027 | 76 | promoted-pending-change | 1 |
| C-007 | 80 | promoted-pending-change | 1 |
| C-019 | 85 | promoted-pending-change | 1 |
| CC-002 | 94 | promoted-pending-change | 1 |
| C-016 | 97 | promoted-pending-change | 1 |
| CC-001 | 99 | rejected (gates) | 1 |
| CC-007 | 106 | promoted-pending-change | 2 |
| C-012 | 107 | promoted-pending-change | 1 |
| C-005 | 113 | promoted-pending-change | 1 |
| CC-026 | 126 | promoted-pending-change | 1 |
| CC-022 | 127 | promoted-pending-change | 1 |
| C-010 | 129 | promoted-pending-change | 1 |
| C-006 (re-run) | 132 | promoted-pending-change | 1 |
| CC-013 | 146 | promoted-pending-change | 1 |
| CC-009 | 162 | promoted-pending-change | 2 |

20/20 under the 600 s line; median 97 s, p95 146 s. 18 of 20 passed the gates first time. The one gate rejection, CC-001, was a worker-authored test that could not express NaN in JSON (`null` reads as 0 °F at the WASM boundary); the worker refused to make the kernel trap on a real freezer temperature and rejected itself.

**All 20 requests were underdetermined** (rater 1; 9 of 10 by a blind rater): no technician question named the fact that fixes its answer, so every promotion carries a stated assumption and the one question that would settle it. The blind rater agreed 10/10 on completeness (uninformative without variance), 9/10 on underdetermined, 8/10 on composable, 5/10 on shape, and counted residual assertions higher on 7 of 10 items.

## Persona review and factory v2

The gates certify that a kernel does what its contract says, not that the contract is the capability the person wanted. A persona review (ten named personas, two or three per capability, 155 kernel calls) found that gap, and the factory was extended the same afternoon so that promoted means gated **and** persona-accepted.

| | Before v2 (19) | After v2 (19 gated) |
|---|---|---|
| Persona verdicts | 43: 14 accept, 27 accept-with-change, 2 reject | 41: 16 accept, 24 accept-with-change, 1 reject |
| Accepted by every persona consulted | 3 (CC-014, CC-025, CC-036) | 3 promoted-with-assumption |
| Pending a named change | 16 | 15 promoted-pending-change |
| Rejected by a persona | C-006 (unsafe default equipment class for an A3 charge limit), CC-011 (answered a question not asked) | CC-011 only; C-006 re-run accepted |

The rejections are defects no gate can see: a wrong default and a wrong question. The accept-with-change verdicts collapsed into five presentation rules (trap messages; print the assumption; field precision and units; label every code; one kernel per quantity). Factory v2 made the first four a closed schema and a seventh gate (G7) on a glue file per capability, added a persona stage to promotion, and re-ran C-006 and CC-011; all 17 untouched kernels received glue with every hash intact. The personas are simulated users; a real technician's verdict is still rung 4.

## Delivery to refrigeration-ai

The 18 non-rejected capabilities are on branch `claude/endoforge-capabilities` at `aaf112ba`, rebased onto trunk `cb77ddc2`, not merged, no PR; the integration lead has accepted it for its own pass. The package (`packages/adapters-capabilities`) is a `ToolRegistry` adapter over the kernels with frozen contracts, tests, glue and a v2 manifest; results carry the rendered value, assumption, question and pending changes, and traps return the glue's message. `factory/deliver.mjs` regenerates it from the receipts.

| Check on `aaf112ba` | Result |
|---|---|
| Package tests (vitest, packages config) | 30 passed, 0 failed |
| `tsc -b packages/adapters-capabilities`, eslint, prettier | clean |
| `check:denylist` | OK, no file above baseline |
| `check:ratchet` | no violation in this package; failures identical on the bare trunk, elsewhere |
| Dry-run merge onto trunk `b0e87e27` (integration lead) | clean; 7 config files outside the package, +13/−1 |

Example call: `kwToHp(kw = 6.2 kW, hpCode = 0 (mechanical/imperial hp)) -> 8.3 hp`, then the assumption and the question. Nothing is wired into a run manifest yet.

## What the tests settled, changed, and left open

**Settled (probe/pilot level):** kernel instances are cheap enough per candidate; the AssemblyScript compiler needs no filesystem; the seeded-fault method works and the invariant layer carries discriminating power; the model turn is thinking-dominated; tsc-rs misses 128 MiB at process level but meets the latency line; bounded equivalence makes integer refinements provable; agents specify real small requests in one or two minutes; every real request was underdetermined; gated is not wanted.

**Changed in the plan (34d3890):** C01 rewritten for an agent specifier; C02 seeded with the 20 contracts and persona findings; C05 subscription-only with effort as lever; promotion = gated + persona-accepted (WP28); legibility (WP29) on the critical path as glue gates; "capability plus question" as the product; the disagreement loop as a work package; RISK-31; an Edition 4 inputs table.

| Rung (E3 §17) | Status |
|---|---|
| 1 compiler in the workcell | Probe-level yes (V8-hosted AssemblyScript); not under Wasmtime |
| 2 bounded, contained, recoverable execution | Recorded for the old guest adapter; probe-level for kernels |
| 3 measured evaluator error and escape rates | Method proven on a toy; X2/X3 not run |
| 4 a capability completes a real person's task | Not yet: 18 delivered, none used; path = merge, host binding, one consented hashed-task use, receipt |
| 5–7 | Not started |

**Open:** merge SHA; rung 4; X2 can start from the seeded set; C01 registration if wanted; RISK-02 has a number but no remedy.

## Lessons for the next round, and where the receipts are

1. A frozen evaluator must be total over any candidate output, and totality includes the test format (P-03 v1 crash; CC-001's NaN).
2. Probes narrow, campaigns decide (DEC-64); the labels are the only defence against over-citation.
3. Confirmation needs a question, not a sentence to approve; rendering the assumption and question is now a gate, and the disagreement loop turns an answer into a frozen test.

| Receipt | Where |
|---|---|
| Probe precommits, samples, results | `experiments/P-01`…`P-06`, `P-04b` |
| Probe summary rows | R12 §7 |
| X1 freeze, events, classifications, factory and persona summaries | `campaigns/x1-spec-study/receipt/` |
| Contracts, tests, kernels, glue (private, git-ignored) | `campaigns/x1-spec-study/work/factory/<id>/` |
| Gates, promotion, delivery | `campaigns/x1-spec-study/factory/` |
| Lessons, decisions, risks, plan changes | `LESSONS-LOG.md`; R16 DEC-64–71; R15 RISK-31; `CRITIQUE-2026-10-17-reconcile.md` |
| Delivered package | refrigeration-ai `packages/adapters-capabilities` @ `aaf112ba`; `~/LOCAL LLM/ENDOFORGE-TO-RETA-01-20261017.txt` |
| Lab tests; Mononoke verification | R12 §4.2 (92 tests, 90 pass); `docs/studies/mononoke/fetch-sources.sh` |
