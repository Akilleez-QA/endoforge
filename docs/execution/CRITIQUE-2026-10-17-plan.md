# Execution-plan critique (2026-10-17, pre-registration)

> Written 2026-10-17. An independent critic wrote this before any campaign was registered and before any probe result was read. It then applied the fixes in place; this file records what was wrong, why it mattered, and what changed where.

## What was read and run

Read in full: `docs/CONVENTIONS.md`; `docs/execution/EXECUTION-PLAN.md`; `docs/execution/WORK-PACKAGES.md`; `docs/execution/campaigns/C01`–`C07`; R12, R13, R14 and R19 in `docs/reference/`; `docs/coverage/EDITION-3-ERRATA.md`; `experiments/README.md`; the six probe `PRECOMMIT.md` files (questions, scope notes and stop rules only). Read for their question, metric, sample-size and kill sections: `C08`–`C18` and `TEMPLATE.md`. Read as the model for this file: `~/Work/isolate-factory-lab/CRITIQUE-2026-10-14-precampaign.md`.

Run: `python3 -I tools/check-docs.py` before and after the edits (0 failures both times); exact Clopper–Pearson arithmetic in a scratch Python session to check every bound the records quote (0/20 upper 16.8 %; 9/20 lower 23.1 %; 12/60 10.8–32.3 %; 2,995 / 4,742 / 6,294 at zero, one and two escapes; 7, 10 and 12 escapes as the first counts whose one-sided 95 % lower bound exceeds 1 in 1,000 at those three n). Every quoted bound was correct. No probe result was read or used: the `RESULT.md` files were not opened beyond confirming they exist, and every probe number in the plan is written "pending".

The independence is limited: the critic is the same model family as the authors of the plan, with a fresh context and no part in writing the records.

Classes:
- **must-fix**: a gate could not fail, a kill rule could not be decided from a number the campaign produces at the sample size R14 requires, a dependency pointed at something not yet built, or two documents disagreed on a figure a reader would act on.
- **should-fix**: a real weakness that probably does not flip a verdict on its own.
- **note**: record it and decide.

Line numbers refer to the files as they were before this critique's edits (the repository is not under git; there is no commit to cite). "Now" means after the edits listed in the final table.

## Must fix before registration

### M1. X1's kill rule and its extension rule overlapped, so 2–7 of 20 both killed and extended
- **Evidence:** `C01` §3 line 57: "Below 20 %: kill … Between 10 % and 35 % at n = 20: extend to 60". A point estimate of 15 % (3 of 20) satisfies both. `EXECUTION-PLAN.md` Stage 1 line 62 states only "under 20 %" and never mentions the extension. `R14` X1 line 30 says the same two things in one sentence without ordering them.
- **Failure scenario:** 3 of 20 are specifiable. One reader kills generative applications and Stage 4 runs the agent-substrate variant; another extends to 60. Both cite the precommit. Whichever the author prefers after seeing the data is the one that happens: a kill rule written after the fact.
- **Fix (applied):** three ordered bands at n = 20 on the point estimate, recorded as decision point DP-6: 0–1 of 20 kill; 2–7 of 20 extend to 60 and decide at 60 against 20 %; 8 or more of 20 pass. Each band is a count the study produces. `C01` §3 and §9, `EXECUTION-PLAN.md` Stage 1 and §7.1, `R13` Stage 1 now agree. `C01` §3 also says which decisions X1 can and cannot make.

### M2. C02 (Stage 1, "no engineering") depended on WP10, a Stage 2 package
- **Evidence:** `C02` header line 26: "WP10 seed invariants for the refrigeration tasks". `WORK-PACKAGES.md` WP10 line 206: "Dependencies: WP09"; WP09 line 193: "Dependencies: WP02, WP06"; WP02 line 94: "Dependencies: WP01". `EXECUTION-PLAN.md` §3 drew `WP09 --> WP10` and `WP06 -.-> WP08` and listed WP10 under Stage 2. `R14` X2 line 49: "No engineering".
- **Failure scenario:** X2 cannot start on day one as E3 §15 and the plan's Summary promise; it waits for WP01 → WP02 → WP06 → WP09 → WP10 (14–22 days). Or it starts anyway with an undocumented invariant list, and the "library growth" step that the kill rule depends on has no frozen identity.
- **Fix (applied):** WP08 deliverable 5 is a hand-authored, file-hashed invariant list v0 and a hashed growth diff; `C02` §6 says so; WP10 now ports that list (acceptance e: parity with C02's verdicts) and depends on it rather than the reverse. The graph edge is now `X2 -.-> WP10`. Stage 1 depends on no Stage 2 package.

### M3. The second X3 domain was to be chosen "in C03's precommit", after everything it needs had frozen
- **Evidence:** `EXECUTION-PLAN.md` §1 line 117 and §7 line 304: "chosen in C03's precommit". `C03` header line 26: "C02 decided (qualified evaluators exist)"; §6 line 83: "Per domain, at least 100 distinct tasks … base candidates that pass the full harness". `C02` §6 line 83 named "refrigeration engineering claims plus at least two other request types", not a second domain. WP10's title was "Invariant library v0 (Field OS domain)" and listed no second-domain deliverable. `R14` §2.4: tiers are per domain; two domains need about 9,500–12,600 faults.
- **Failure scenario:** C03 registers, names a second domain, and finds there are no C02-frozen evaluators, no invariant set and no known-good implementations for it. Either C03 runs on one domain and the plan's "two domains" claim is quietly dropped, or the second domain's evaluators are synthesized inside C03 without C02's grading, which is exactly the uncertified evaluator the escape rate is meant to measure.
- **Fix (applied):** decision point DP-3, due by C02 freeze, with the default "one domain, no tier generalises, the plan says so". `C02` §6 covers both domains; WP10 covers both (estimate 3–5 → 5–8); WP11 supplies known-good implementations per task (see M5); `C03` reads DP-3 and says what happens if it was not recorded.

### M4. Stage 0's quiet-gate item could not fail
- **Evidence:** `EXECUTION-PLAN.md` Stage 0 exit gate (3), line 139: "A noise baseline is recorded with its quiet gate passing, **or the campaign window is declared exclusive**." `R13` Stage 0 line 56 has the same "or". R12 §4.2: both lab noise baselines failed the gate; the plan's own open question doubts the desktop can ever pass it.
- **Failure scenario:** the gate never passes; someone writes "exclusive" in the precommit; every later timing claim inherits a noise floor nobody measured. The lab's MDE table (upper bounds, gate failed) is then cited as if it were a floor.
- **Fix (applied):** an exclusive window is a noise-baseline receipt taken inside the claimed window whose quiet gate passes under the same thresholds; without that receipt the item fails. The Open question is reworded to match.

### M5. C03's task count did not reach its own n, and nobody was costed to build the known-good implementations it needs
- **Evidence:** `C03` §6 line 83 and §7 line 95: "at least 100 distinct tasks, 30–60 faults per task"; §7 line 93: 6,294 per domain. 100 × 60 = 6,000 < 6,294. WP11 line 216 listed "a known-good implementation per task" as an **input** with no package delivering it; `R14` §2.3 requires it for the equivalence filter. 200 implementations across two domains is engineering, not an input.
- **Failure scenario:** the generator reaches 6,000 and the two-escape bound cannot be stated; or the "known-good" oracle is improvised per task during the campaign, so the equivalent-mutant filter has no frozen identity and the denominator is unverifiable.
- **Fix (applied):** 105 tasks at 60 faults (6,294 ÷ 60 = 104.9) or 210 at 30, in `C03` §6–§7, WP11 and the plan's Stage 2 rule; WP11 now delivers the known-good implementations with their own identity and parity check (acceptance f), estimate 5–8 → 7–11. The S2 count the Stage 2 narrowing rule reads is now a number: 3,147 per domain.

### M6. Two Edition 3 hosting gaps (E3-09, E3-10) were assumed by C04's arms and by the rung-1 claim
- **Evidence:** `C04` §4 line 66: "A — AssemblyScript: Compiler inside the Wasmtime workcell (WP19)"; §2 line 49: "Rung 1 for a route whose compiler runs inside the workcell under receipt". `EXECUTION-PLAN.md` Stage 3 line 89: "rung 1 if the AssemblyScript compiler runs inside the workcell". WP19 line 325 only said the WP "records the choice". `EDITION-3-ERRATA.md` E3-10: Wasmtime does not run JavaScript and QuickJS left the architecture; E3-09: the compatibility lane's child V8 isolate has no stated home locally. The only existing evidence for the compiler is V8-hosted (P-02 scope note, `experiments/README.md` rule 6).
- **Failure scenario:** WP14 and WP19 are built around a compiler host that does not exist on the lane; or a JavaScript engine is compiled into Wasmtime for trusted tooling without anyone deciding to re-admit an engine of the QuickJS kind; or the compiler runs in a Node worker and the Stage 3 exit is read as rung 1 because the plan said "inside the workcell".
- **Fix (applied):** DP-1 (default: supervised V8 process in its own sandbox and cgroup beside the lane; rung 1 does not move; in-Wasmtime alternative is Stage 6+ / optional under WP19) and DP-2 (default: workerd under bwrap in an owned cgroup, the configuration that contained every lab smoke case), both due by Stage 3 entry. `C04` arms, `C04` rung row, WP19, WP22, WP13, `EXECUTION-PLAN.md` Stage 3 "Rung moved" and `R13` Stage 3 now say rung 1 moves only under the alternative.

### M7. C07 could never freeze: it required C05 decided, and C05's decidable half needs a host that does not exist
- **Evidence:** `C07` header line 26: "C03b, C05, C06 and C18 decided". `C05` header line 28: the Main-rig "is not" the target host; `EXECUTION-PLAN.md` Open questions line 324: "Is a unified-memory host available?". `C05` had one campaign id and one primary (Part 2), so Part 1 alone produced no decision and no "decided" state. `R14` X5 line 92 says the same.
- **Failure scenario:** no unified-memory host is acquired; C05 is neither killed nor passed; C07's dependency is never satisfied; the only campaign that can confirm the product proposition waits indefinitely on a hardware purchase nobody costed.
- **Fix (applied):** C05 splits into `c05a` (hosted turn, descriptive, any host) and `c05b` (the kill, unified-memory host), as C03 already does; DP-5 (default: no host, part b "not run", placement "undecided, hosted by default"); C07, WP24, WP30 and the plan's Stage 3 rule accept the recorded default. The host is listed as not costed.

### M8. The rung-4 "attempt" and the Stage 5 gate could not fail
- **Evidence:** `EXECUTION-PLAN.md` Stage 4 exit line 100: "A named person completes a real task with a qualified capability (rung 4 attempt)"; WP27 acceptance (e) line 434: the same, with "their consent and a receipt". No pass/fail condition, no definition of "real task", no rule against the author steering. The person was unnamed with no deadline (WP open question line 523). Stage 5 exit line 113: "Every retained capability has a passing qualification … or is retired", satisfied by retiring everything.
- **Failure scenario:** the author sits beside the person, picks the task, fixes an input, and the receipt reads "completed". Rung 4 moves on evidence weaker than E3 §17 intends. Stage 5 passes with an empty library.
- **Fix (applied):** a pass/fail rule in WP27 (e), the plan's Stage 4 gate and `C07` §2: the person states their own task (hashed) before the capability exists, completes it without intervention, consent and completion statement in the receipt; fail is defined. DP-4 names the person by Stage 3 exit with a default and a labelled fallback. Stage 5 requires at least one retained, qualified capability, and C12's guard is read from the proposals actually made.

### M9. The plan and R13 disagreed on the total by 44–72 days, and the plan misnamed the cause
- **Evidence:** `EXECUTION-PLAN.md` §6 line 380: 126–201 against R13's 82–129, "mostly WP03, WP04, WP05, WP20 and WP32". Summing those five gives 15–25 days; the gap is 44–72. The omitted list left out WP02 (5–8) and WP06 (2–3), and most of the gap is in Stages 2–4 (R13's 8–15, 15–25, 20–30 against package sums 15–24, 40–64 and 24–38). R13 Stage 5 (15–20) was higher than WP31 (12–18).
- **Failure scenario:** whoever schedules Monday reads R13 and plans for 82–129 days; whoever reads the plan expects 126–201; nobody reconciles and the shortfall is discovered inside Stage 3.
- **Fix (applied):** one accounting. `R13` §2 now carries the package sums per stage and a reconciliation table (§2.1) stating what it omitted (22–36 days of uncosted packages; 11–15, 14–21 and 4–8 days of under-counting in Stages 2–4; 2–3 days over-counted in Stage 5). With the M3 and M5 rises the total is **130–207 person-days (Estimated; Derived sum)**, in the plan's Summary, §6, `WORK-PACKAGES.md` Summary, Index and total, and `R13`. Items still not costed are listed in both.

### M10. The probe section said which work package each probe feeds, not which decision it may and may not narrow
- **Evidence:** `EXECUTION-PLAN.md` §8 line 312: "P-01 → WP13, WP14; P-02 → WP19; …". `experiments/README.md` rules 5–6 require each probe to say what it does not show; the plan did not carry that over. P-02's own scope note says it cannot speak to Wasmtime hosting; P-05's says workerd RSS is an upper bound, not the isolate footprint.
- **Failure scenario:** a probe number arrives and is read into the nearest gate: P-01 into C04's footprint column, P-05 into X6, P-02 into rung 1. The README forbids each of these, but the plan gave no table to point at.
- **Fix (applied):** §8.1 is a table with "May narrow", "May not" and "Result: pending" per probe, derived from each PRECOMMIT's question and scope note. The rule columns do not change when results arrive.

## Should fix

**S1. Stage 2 exit gated construction of the workcell, not just the judging of candidates.**
- `EXECUTION-PLAN.md` §3 line 298 `X3a --> WP13`; Stage 3 entry line 84. WP13–WP18 are contracts, hosts and recovery code; none needs an evaluator. Serialising 19–30 days of Stage 2 before any of them starts lengthens the critical path for no evidential gain; the gate that matters is that no route's yield is read before X3a (R13 Stage 3's reason).
- Fix (applied): entry split into construction (after WP03, WP04, DP-1, DP-2) and judging (after Stage 2 exit); graph edge now `X3a --> WP23`; WP23 and `C04` depend on a C03a receipt, which the runner checks. §6 names the parallel branch and notes it may become the critical path.

**S2. X3a's candidates are not kernels, and nothing said so in the gate.**
- Stage 2 runs on the interim lane (`EXECUTION-PLAN.md` line 125); WP11 line 217 planned "typed IR mutation extended to kernels" at Stage 2, before any kernel exists. A sampled rate measured on JavaScript candidates with the lab's operators would read as the kernel route's rate.
- Fix (applied): the Stage 2 gate records the rate per (domain, evaluator hash, candidate format) and names the lane; `C03` §4 and §13 and WP12 (e) say the same; WP11's kernel-level operators are a Stage 4 deliverable for X3b.

**S3. C02's kill rule had no behaviour when the pass-2 determinate n fell below 100.**
- `C02` header line 28 admitted the n may fall below 100; §7 line 95 called fewer "a screen only"; §9 read the kill regardless.
- Fix (applied): pass 2 extends with fresh tasks until 100 determinate evaluators exist (WP08 acceptance e); the kill is read at 6 or more of at least 100; 2–5 is a pass with "indecisive about 5 %" and every domain starts Confirmed. `C02` §3 states what X2 can and cannot decide.

**S4. WP01 acceptance (a) demanded the lab's verifier accept an Endoforge receipt set.**
- WP01 line 80 against line 79, which introduces a new schema `endoforge-precommit-v1`. The lab verifier checks `ifl-receipt-set-v1`; the criterion is unsatisfiable or satisfied by not changing the schema.
- Fix (applied): run the lab verifier and record its verdict; a refusal for a reason other than the schema is a defect.

**S5. C06's and WP25's "harness ported to the Workers runtime" was nobody's deliverable.**
- `C06` header line 26 and WP25 inputs line 402 attributed the port to WP09; WP09's deliverables (line 191) contain no Workers port.
- Fix (applied): WP25 owns the port; `C06` header and WP25 say so.

**S6. C05 lacked the R19 local arm, and the plan had no home for the "disagreement inputs" and "bounded equivalence" proposals.**
- `R19` §3 asks that X5's local arm be measured with constrained decoding and that X1 add clustering and a structural/parametric classification; `EXECUTION-PLAN.md` §8 line 313 only said "none is scheduled".
- Fix (applied): `C01` gains the two secondaries (descriptive, no effect on the primary). `C05` gains a conditional arm L-c that runs only if a token-granular checker exists at freeze, otherwise recorded absent with the reason; the interface is a Stage 6+ / optional WP19 deliverable. §8.2 folds these in and defers R19 §2.1, §2.4 and §2.6–§2.10 to Edition 4 with the reason for each (they change E3 §6's specification stage, or a rung-5 evidence bar, or nothing before Stage 6).

**S7. Several packages and campaigns were on the schedule without being on the path to rung 4 or required by X1–X6.**
- WP20 (MoonBit: optional X4 arm, E3-02), WP29 (legibility view: C07 secondary), the state-migration half of WP28 (C14), and campaigns C08, C14, C16, C17 (Stages 3–4).
- Fix (applied): marked "Stage 6+ / optional" in the plan's Summary, §2 stage rows, §4 schedule and Stage 6 table; in `WORK-PACKAGES.md` Index and package rows; in the four campaign headers. The count stays 32 and 18. Until C14 runs, revisions activate only with the person's confirmation (plan Stage 4 rule, WP28).

**S8. C07's 2× target and its decision rule pointed at different thresholds.**
- `C07` §2 line 47: "K ÷ G … at least 2×"; §3 line 57: "lower 95 % bound of K ÷ G above 1.0". `R14` §3.3 says the precommit fixes one.
- Fix (applied): the 2× target is a scored prediction (met if the lower bound is above 2.0); the 1.0 rule decides the proposition; both are reported. The rule also now states the minimum blocks it is read at.

**S9. If C04 kills the kernel route, arm K of C07 becomes arm D.**
- `C07` §4 line 66 admitted K may run on the compatibility lane; arm D (line 67) is the compatibility lane. Two identical arms in a four-arm paired design.
- Fix (applied): the plan's Stage 3 rule, `C07` header, §4 and Open questions say D is dropped as a duplicate and the lane is named in every claim.

**S10. C02 §14 "Monitoring and rollback" was timing-campaign boilerplate.**
- `C02` line 141: "watches the quiet gate, cgroup readbacks and unknown counts per block" for a grading study whose §8 says "Not applicable: this campaign makes no machine-timing claim".
- Fix (applied): replaced with the checks the study actually needs (hash-before-grading, no candidate in any synthesis manifest).

**S11. C06 wrote "128 MB" and "MiB" interchangeably.**
- `C06` §3 line 56 "128 MB limit"; `R14` X6 line 106 and lab documents use MiB. At a working set near the ceiling the 4.9 % difference decides the primary.
- Fix (applied): the limit is rechecked at registration (Upstream), the provider's unit recorded, and the stricter reading used.

## Notes

- **N1.** No sentence in the execution files reads as a result. The lab figures quoted (MDE 1.3–9.3 % at N = 30; C6a 1,081 of 1,081; the six-case output hash; the two gzip sizes; "the in-process child isolates failed `alloc-heap-unbounded`") match R12 §4.2 and §2. Numbers without a label were the Stage 2 fault counts (now cited Derived, R14 §2) and the Stage 2 duration comparison (now reconciled).
- **N2.** `experiments/README.md` assigns P-04 to E3-20 and E3-25 while P-04's own PRECOMMIT says the README once cited E3-12; and P-03's PRECOMMIT notes the brief cited E3-25 for the fixture erratum (E3-22). Both are probe-side notes outside this critique's edit scope; the plan's §8.1 cites the probes by their questions, not by erratum.
- **N3.** Edition 3's X4 defines the route comparison over TypeScript, AssemblyScript and Rust; under the DP-1 default, arm A's compiler runs in V8 and its kernel in Wasmtime, so C04 compares candidate formats and execution hosts, not "in-isolate compilation" as E3 §5 words it. `C04` §2 now says rung 1 does not move; the E3 §13 "Yes" cells stay Proposed (E3-10).
- **N4.** WP08's 8–12 days count the author's time; the second grader and adjudicator (`C02` §10: about 67 person-hours for two graders) are now listed as not costed rather than hidden inside the estimate.
- **N5.** `C18` needs 14 campaigns of 50 selection rounds each before C07's release run. At G = 0 this is compute, not model tokens, and WP12's search driver provides it; it is on C07's dependency list and is not optional. Its budget row should be checked against the WP03 record at registration.
- **N6.** The plan's §5 selection rule ("changes a gate, a default or a budget rule before Stage 6") is the rule applied in S7; C08, C14, C16 and C17 did not meet it on inspection, which §5's own table did not notice because it reviewed only the candidates that were rejected.

## Must-fix summary
1. M1: X1 decided in three ordered bands (DP-6); plan, C01, R13 agree.
2. M2: C02 depends on no Stage 2 package; WP08 authors the invariant list, WP10 ports it.
3. M3: second X3 domain is DP-3, due by C02 freeze; WP10 and WP11 cover both domains.
4. M4: an "exclusive window" is a passing noise-baseline receipt, not a declaration.
5. M5: 105 tasks per domain; known-good implementations are a WP11 deliverable; S2 count is 3,147.
6. M6: DP-1 and DP-2 with defaults; rung 1 moves only under the in-Wasmtime alternative.
7. M7: C05 split into c05a/c05b; DP-5 default lets C07 freeze with hosted inference declared.
8. M8: rung-4 pass/fail rule and DP-4; Stage 5 needs one qualified retained capability.
9. M9: one estimate accounting, 130–207 days, in plan, WORK-PACKAGES and R13, with the omissions stated.
10. M10: per-probe may/may-not table with "pending" results.

## What changed where

| File | Change |
|---|---|
| `docs/execution/EXECUTION-PLAN.md` | Summary (total 130–207, optional items, decision points, this critique); §1 domain row (DP-3); Stage 0 gate 3 (M4); Stage 1 kill rule and duration (M1, M2); Stage 2 gate, rule and duration (M5, S2); Stage 3 entry, campaigns, kill rule, rung and duration (M6, M7, S1, S7, S9); Stage 4 campaigns, exit gate, kill rule and duration (M8, S7); Stage 5 gate (M8); Stage 6 table (S7); §3 graph note and edges (`X3a --> WP23`, `X2 -.-> WP10`); §4 schedule rows C05, C08, C14, C16, C17; §6 estimates, not-costed list, critical path (M9, S1); §7 split into 7.1 decision points DP-1–DP-6 and 7.2 other decisions; §8 split into 8.1 probe table and 8.2 R19 folded-in and deferred (M10, S6); Open questions; Sources |
| `docs/execution/WORK-PACKAGES.md` | Summary and Index (totals, WP10 and WP11 titles and estimates, WP20/WP28/WP29 optional); total line with not-costed list; WP01 (a) (S4); WP08 deliverables, acceptance e, dependencies, estimate note (M2, S3, N4); WP10 rewritten for two domains (M3); WP11 rewritten with known-good implementations, task count, Stage 2/4 operator split (M5, S2); WP12 (b) and (e) (S2); WP13 dependencies (S1); WP19 deliverables and acceptance (M6, S6); WP20 purpose (S7); WP22 deliverables and dependencies (M6); WP23 dependencies (S1); WP24 deliverables, acceptance d, dependencies (M7, S6); WP25 inputs and deliverables (S5); WP27 acceptance e and dependencies (M8); WP28 split (S7); WP29 purpose (S7); WP30 dependencies (M7, S7); Open questions |
| `docs/execution/campaigns/C01-x1-specification-study.md` | Summary; §3 decision rule (bands, can/cannot decide) and secondaries (R19 clustering, structural/parametric); §4 named-person placeholders; §9 kill; Edition 3 alignment; Sources |
| `docs/execution/campaigns/C02-x2-evaluator-error-rate.md` | Header (WP08 not WP10, DP-3, n < 100 rule); §3 decision rule; §6 workload (both domains, hand-authored list); §7 planned n; §9 kill; §14 rewritten; Open questions |
| `docs/execution/campaigns/C03-x3-escape-rate.md` | Summary (DP-3, lane); header; §3 decision rule (3–11 band, not-measurable case); §4 arm lane and format per part; §6 workload (105 tasks) and stratum counts; §7 minimum samples; §13; Open questions |
| `docs/execution/campaigns/C04-x4-kernel-route-yield.md` | Header (C03a receipt, DP-1, DP-2, WP20 optional); §2 rung row; §4 arms T and A; Open questions |
| `docs/execution/campaigns/C05-x5-model-term.md` | Summary; header; §1 two campaign ids; §3 primary, decision rule, secondaries; §4 arm L-c; §9 kill; §11; §13; Open questions; Sources |
| `docs/execution/campaigns/C06-x6-hosted-fit.md` | Header (WP25 owns the port); §3 primary (limit unit) |
| `docs/execution/campaigns/C07-matched-end-to-end.md` | Header (C05b or DP-5 default, DP-4, WP29 optional, D dropped if K is the lane); §2 hypothesis and rung row; §3 decision rule; §4 arm K; §10 people; Open questions |
| campaigns C08, C14, C16, C17 (`docs/execution/campaigns/`) | Header Stage row: "Stage 6+ / optional" with reason |
| `docs/reference/R13-implementation-sequence.md` | Stage 0–5 cost rows reconciled to the package sums; Stage 1 cost note; Stage 3 entry and rung rows; new §2.1 reconciliation table; Open questions (DP-3, DP-1); Sources |
| `docs/execution/CRITIQUE-2026-10-17-plan.md` | This file (new) |

`python3 -I tools/check-docs.py` after the edits: 0 failures; the warnings are pre-existing `tools/…` path mentions that refer to lab and Field OS checkouts, plus the forward references to this file, which now resolve.
