# R14 — Matched experiments and benchmark programme

> Reconstructed 2026-10-17. The original R14 was not available; this version is rebuilt from
> Edition 3 (§1, §5, §6, §7, §10, §11, §13, §15), Edition 2 (§14, §15), the white paper (pp. 21–22),
> the diagram atlas (sheet 28), the Field OS receipts, and the isolate-factory-lab documents
> listed under Sources. Content follows Edition 3 where the editions differ.

## Purpose

This document turns Edition 3's six experiments into designs that can be precommitted: for each, the question, the design, how large it must be and why, the one metric, the decision it drives, the kill criterion, what it depends on, and what it costs. It gives the statistical power arithmetic explicitly, because several of Edition 3's thresholds cannot be decided at the sample sizes it names. It then specifies the matched end-to-end campaign and the measurement discipline every campaign follows. Every experiment, sample size, threshold and cost here is **Proposed** or **Estimated**; the arithmetic is **Derived**; nothing has been run.

## Summary

- Six experiments in Edition 3's order: specification study (X1), evaluator error rate (X2), escape rate (X3), kernel route yield (X4), the model term (X5), hosted fit (X6). Each produces one number and each number decides something [E3 §15].
- Power changes the designs. Certifying an escape rate below 1 in 1,000 with zero observed escapes needs 2,995 independent, non-equivalent seeded faults per decision unit; below 1 in 10,000 needs 29,956. A plan that tolerates one or two escapes needs 4,742–6,294 (or 47,437–62,956), and is the only kind with reasonable power when the true rate is a few times below the threshold.
- X1 at 20 requests and X2 at 100 tasks are coarse screens: most outcomes are statistically indecisive. Their precommits must say whether the decision is on the point estimate, and when to extend.
- X4 at one generation per task per route cannot resolve its 20-point kill threshold; it needs about five samples per task per route.
- After the six comes the matched end-to-end campaign: warm native baseline, kernel workcell, child-isolate topology, and a conventional agent in a warm container measured end to end including time to specify. The product proposition is confirmed only against that last arm [E3 §15].

## 1. The six experiments

Shared rules for all six: one primary metric; a precommit written and hashed before the first measured job (`docs/templates/CAMPAIGN-PRECOMMIT.md`); a receipt set that verifies (`docs/templates/RECEIPT.md`); an inconclusive result stays inconclusive [E3 §11]. Cost estimates are working days for one person with model access, **Estimated**.

### X1 — Specification study

| Field | Content |
|---|---|
| Question | Can real "too small for a project" requests be turned into a checkable acceptance contract cheaply enough? |
| Design | Twenty real requests from Field OS users, the owner's own work and the public chatbot corpus, collected before the study starts and frozen (DEC-66). For each, one fresh agent writes the acceptance contract and its executable tests and times itself (DEC-71, 2026-10-17; the earlier human-specifier design is withdrawn). Each contract is classified: specifiable in under ten minutes or not; satisfiable by composing what already exists or not; size of the residual (the part only this request determines, counted under C01 §5's rule); underdetermined or not [E3 §6, §15]. A second fresh agent, blind to timings and to the first's judgments, classifies a random half to measure agreement; the person confirms the recorded question. Piloted once: 20/20 complete under 600 s, median 95 s; 20/20 underdetermined (Pilot (not a registered result); C01 §16) |
| Sample size | 20 is the Edition 3 figure. With a two-sided 95 % Clopper–Pearson interval, 0 of 20 specifiable gives an upper bound of 16.8 %; 9 of 20 gives a lower bound of 23.1 %. Outcomes 1–8 of 20 do not separate from 20 % (Derived). Precommit: decide on the point estimate, and extend to 60 requests if it lands between 10 % and 35 % (at 60, the interval for 12/60 is 10.8–32.3 %) |
| Metric (one) | Fraction of requests specifiable in under ten minutes |
| Secondaries | Fraction satisfiable by composition; residual size (number of residual assertions); time distribution; fraction underdetermined; per-field blind agreement (κ is uninformative when one rater has no variance, as in the pilot) |
| Decision | Whether generative applications have a market now; how thin a residual to design for |
| Kill criterion | Under 20 % specifiable in ten minutes: the agent substrate is the product; generative applications move to research [E3 §15] |
| Dependencies | None. No engineering [E3 §15]; the kit exists (`campaigns/x1-spec-study/`, WP07) |
| Cost | 2–4 days (Estimated); the pilot took about one day end to end under an agent specifier |

### X2 — Evaluator error rate

| Field | Content |
|---|---|
| Question | How often is a synthesized evaluator wrong, and by request type? |
| Design | One hundred tasks. POODO frames each and synthesizes the residual in a context that has seen no candidate. People grade the evaluators, not candidates: does the residual accept every correct behaviour and reject every incorrect one the request implies? Two graders per evaluator, blind to each other; disagreements adjudicated and reported. One pass of invariant-library growth, then a second synthesis on fresh tasks of the same types [E3 §15]. Each evaluator is also qualified against seeded faults and a known-good anchor where one exists [E3 §6] |
| Sample size | At n = 100, the one-sided 95 % upper bound is below 5 % only with 0 or 1 errors (2.95 %, 4.66 %); the lower bound exceeds 5 % only with 10 or more errors. Between 2 and 9 errors, X2 cannot say which side of 5 % the rate is on (Derived). Per request type, 25 tasks cannot certify below 5 % even with no errors (upper bound 11.3 %). At n = 400 the indecisive band narrows to 13–27 errors. Precommit: the kill rule reads the point estimate on determinate requests; certification of a below-5 % rate for a domain requires the bound, and therefore more tasks in that domain |
| Metric (one) | Evaluator error rate on determinate requests after two library passes |
| Secondaries | Error rate by request type; grader agreement (Cohen's κ); rate before versus after library growth |
| Decision | The starting autonomy tier for every domain; the real size of the trust gap |
| Kill criterion | Above 5 % on determinate requests after two library passes: no autonomous tier anywhere; every domain starts Confirmed [E3 §15] |
| Dependencies | Task set; POODO precommit discipline; graders. No engineering |
| Cost | 8–12 days, dominated by grading (Estimated) |

### X3 — Escape rate

| Field | Content |
|---|---|
| Question | At what rate do known faults pass the full harness and get promoted, by domain, under random sampling and under search? |
| Design | See §2 for the power arithmetic that sets the design. Faults are seeded into candidates that otherwise pass, then run through the full harness: universal gates, the domain's invariants, the frozen synthesized residual, and the promotion rule. X3a (sampled): seeded faults are submitted in random order. X3b (searched): a sixteen-wide campaign proposes candidates against the same evaluator while seeded fault families are present, and promotions are counted [E3 §7, §11, §15] |
| Sample size | Per domain (the decision unit for tier assignment): 2,995 non-equivalent faults with zero escapes certifies below 1 in 1,000 at one-sided 95 %; 4,742 allows one escape; 6,294 allows two. For below 1 in 10,000: 29,956, 47,437, 62,956 (Derived, Clopper–Pearson). See §2 for power and stratification |
| Metric (one) | Escape rate per domain = seeded faults promoted ÷ seeded faults submitted, with its one-sided 95 % upper bound |
| Secondaries | Escape rate by fault class; sampled versus searched ratio; which check caught each fault (attribution to independent error sources) |
| Decision | Tier assignment per domain; whether candidate width may rise above one |
| Kill criterion | Searched escape rate above 1 in 1,000 with the full harness: width stays at one until a new non-model check lands [E3 §15]. Operationally (Derived): at 2,995 searched faults, 7 or more escapes put the one-sided 95 % lower bound above 1 in 1,000 |
| Dependencies | X2 (qualified evaluators exist); Stage 2 harness (R13); a fault generator per domain; for X3b, a campaign engine with G = 0 search (the lab's `evaluator/lib/search.mjs`) before any model proposer |
| Cost | 8–15 days per pair of domains, dominated by fault generation and equivalence filtering; harness compute is hours (Estimated) |

### X4 — Kernel route yield

| Field | Content |
|---|---|
| Question | Which route into the kernel contract yields the most accepted candidates per unit cost, and is removing the interpreter layer justified now? |
| Design | The same twenty tasks generated in TypeScript (compatibility lane), AssemblyScript and Rust [E3 §15]. Each task has a frozen evaluator from X2. Generations are paired by task, the route order is randomised per task, and the model, prompt template and token budget are pinned. Measure first-pass yield, tokens, compile time, per-candidate memory as an **increment** over the host's idle working set, and escape rate on a seeded subset |
| Sample size | One generation per task per route gives a 95 % half-width of about ±31 points on a yield difference near 50 % (Derived, unpaired approximation), which cannot resolve a 20-point threshold. Five generations per task per route (100 per route) gives about ±14 points before pairing gains. Bounds use a cluster bootstrap over tasks |
| Metric (one) | First-pass yield per route against the frozen evaluator |
| Secondaries | Tokens per accepted candidate; compile time; per-candidate memory increment; escape rate on seeded faults |
| Decision | The default route; whether removing the interpreter layer is justified now |
| Kill criterion | Best in-isolate WebAssembly route more than 20 points below TypeScript: the compatibility lane stays default and the kernel contract waits [E3 §15] |
| Baseline note | Edition 3 compares footprint against "the 150 MiB guest baseline". That figure is a whole-unit peak (Node, Just Bash, worker pool, QuickJS, startup, warm-up, verification), not a per-candidate footprint [R12 F06]. Measure a like-for-like per-guest increment for the QuickJS lane if a footprint ratio is to be quoted |
| Dependencies | Stage 3 kernel workcell (Wasmtime host, AssemblyScript compiler inside it); native Rust lane; tsc-rs compatibility lane (lab build at `3644f32`); X2 evaluators |
| Cost | 5–8 days (Estimated) |

### X5 — The model term

| Field | Content |
|---|---|
| Question | What does a model turn actually cost in this project, and does local batched inference beat hosted inference to the first passing candidate? |
| Design | Part 1: one model turn through the subscription CLI's lean mode (MCP, tools, settings, skills and project context off), measured end to end (time to first text, thinking and visible tokens, decode rate, total), at two operating points: default effort and `--effort low`, plus a prompt-wording variant that forbids prose. **No API arm** (DEC-65, 2026-10-17); the lean-CLI arm at default effort is the hosted baseline. Effort and output length are the primary levers: P-04b measured Opus 5.5 at median 90.6 s (10.0k output tokens, 6.4k thinking) against 56.4 s at low effort (5.9k tokens, 2.3k thinking) with the same visible code and gate yield, after removing ≈460k cached context tokens changed wall by ≈3 s (Recorded (probe); R12 §7). Prefix caching across different requests is unavailable through the CLI (only a byte-identical turn re-reads the user prompt), so cache state is "none" or "byte-identical". Part 2: on the target unified-memory machine (conditional on DP-5), four-way batched local generation of a roughly 1,000-token kernel against the lean-CLI hosted stream, with compilation running concurrently; time to first passing candidate, yield-adjusted; bandwidth contention measured [E3 §10, §15]. Tasks paired across arms, order randomised |
| Sample size | No model term has ever been measured here, so the spread is unknown. For a paired log-ratio test against a 1.5× threshold at α = 0.05, power 0.8: sd 0.5 needs 12 pairs, sd 0.8 needs 31 (Derived from assumed sd, Estimated). Plan 30 paired runs; a pilot of 8 sets the final number |
| Metric (one) | Yield-adjusted time to first passing candidate, local batched ÷ hosted |
| Secondaries | Time to first text and thinking share per operating point; output tokens per turn; `asc` type-gate pass rate; decode tokens/s; memory-bandwidth contention with the compiler. Edition 3 §10's "≈1,000 tokens, 5–10 s" (E3-20) was not met by any probe arm (closest: 3.5k visible tokens, 56 s) |
| Decision | Inference placement; whether unified memory is a lane or a preference |
| Kill criterion | Local batched time-to-pass, yield-adjusted, worse than 1.5× hosted: local inference serves short calls only [E3 §15] |
| Dependencies | Part 2 only: access to the target unified-memory machine (DP-5; the Main-rig is a discrete-GPU host and is not it). Part 1: the user's subscription login of the unmodified CLI, `ANTHROPIC_API_KEY` unset and asserted by the runner (DEC-65; L-02); X4's kernel task set; the Field OS 27B trial is not a precedent (it failed its criterion) [R12 F10] |
| Cost | 3–5 days plus hardware access (Estimated) |

### X6 — Hosted fit

| Field | Content |
|---|---|
| Question | Can the hosted lane compile, or may it only run pre-checked artifacts? |
| Design | tsc-rs as WebAssembly, plus the harness, plus one module instance, inside a Workers isolate. Working set against the 128 MB isolate limit, including WebAssembly memory; a 50-file overlay check against native; Dynamic Worker creation cost [E3 §13, §15]. Memory is read as JS heap plus maximum WebAssembly linear memory (the lab's P5 sensor accounting, `adapters/checkers/tscrs-wasm/memory-sensor.mjs`), not a cgroup peak. Include the worst frozen project (lab `w-check-stress`) |
| Sample size | Fit is deterministic per project: one worst-case run decides it, repeated 10 times to rule out allocator variance. Latency ratio: 30 paired runs per project; ratio of medians with a bootstrap CI |
| Metric (one) | Peak working set of the check in the isolate, against 128 MB |
| Secondaries | Check latency ratio, isolate ÷ native; Dynamic Worker creation cost per candidate |
| Decision | Whether the hosted lane compiles or only runs pre-checked artifacts |
| Kill criterion | Over the memory limit, or more than 3× native: the hosted lane consumes checked artifacts and never compiles [E3 §15] |
| Context | Upstream module size 4.2 MB is not reproduced at v0.7.0; the lab's builds are 5.21 MB (gzip 2.21 MB) and 6.52 MB (gzip 2.65 MB), both inside the 10 MB compressed Worker limit (Recorded and Derived; R12 §3). The lab's predeclared P5 predicts a fresh check on `w-check-stress` exceeds 128 MiB; it was never measured (Proposed) |
| Dependencies | Cloudflare Workers account with Dynamic Workers; pinned tsc-rs WASM build; harness port to the Workers runtime |
| Cost | 3–5 days (Estimated) |

## 2. Statistical power for X3

### 2.1 The rule of three, exactly

If n independent seeded faults produce zero escapes, the one-sided 95 % upper bound on the escape rate p solves (1 − p)^n = 0.05, so n = ln 0.05 / ln(1 − p) ≈ 3/p (Derived):

| Target | Zero escapes allowed | One escape | Two escapes | Three escapes |
|---|---|---|---|---|
| Below 1 in 1,000 (Supervised tier) | 2,995 | 4,742 | 6,294 | 7,752 |
| Below 1 in 10,000 (Autonomous tier) | 29,956 | 47,437 | 62,956 | 77,535 |

(Clopper–Pearson one-sided 95 % bounds; computed for this document.)

### 2.2 Power: a good harness can fail a zero-escape plan

A zero-escape plan fails whenever one escape happens, even if the true rate is well below the threshold. For the Supervised threshold (Derived):

| True escape rate | Plan 0 escapes, n = 2,995 | Plan ≤ 1, n = 4,742 | Plan ≤ 2, n = 6,294 | Plan ≤ 4, n = 9,151 |
|---|---|---|---|---|
| 1 in 10,000 | 0.74 | 0.92 | 0.97 | 1.00 |
| 1 in 5,000 | 0.55 | 0.76 | 0.87 | 0.96 |
| 1 in 3,333 | 0.41 | 0.58 | 0.71 | 0.86 |
| 1 in 2,000 | 0.22 | 0.32 | 0.39 | 0.52 |

Each cell is the probability the plan certifies the tier. The same table holds for the Autonomous threshold with every n multiplied by ten. A harness whose true rate is half the threshold is not distinguishable from one at the threshold at any affordable n. **Design consequence:** plan for one or two allowed escapes (n ≈ 4,700–6,300 per domain for Supervised), not the bare rule of three.

### 2.3 What the arithmetic assumes, and how X3's design meets it

| Assumption | Why it fails naively | Design response |
|---|---|---|
| Faults are independent | Faults seeded into a few base candidates share their weaknesses; one evaluator blind spot lets a cluster through | Seed across at least 100 distinct tasks per domain, about 30–60 faults per task. Use a cluster bootstrap over tasks; if escapes cluster, the effective n is nearer the number of tasks than the number of faults |
| Every fault is a real fault | Equivalent mutants behave identically to the correct program; "promoting" them is not an escape, and including them inflates n | Filter by differential execution against a known-good implementation on an extended input set before submission; report the equivalent fraction separately |
| Faults represent what candidates actually get wrong | Mechanical mutants are easy to catch; the dangerous errors are semantic | Stratify the generator (below) and report per stratum |
| The rate under random sampling is the rate that matters | Search finds evaluator holes [E3 §7, §11] | Tiers are set on X3b (searched), not X3a |
| The evaluator is fixed | Revising after seeing escapes adapts it to the fault set | Freeze the evaluator hash before X3; any revision is a new evaluator and a new X3 on fresh faults |
| The evaluator is total: it returns a verdict for any candidate output | A candidate that crashes the evaluator, or a test file that cannot represent a value its own tests need, produces no verdict; the fault is then neither an escape nor a kill, and n is silently wrong. P-03's evaluator v1 crashed on mutant output and was revised once (L-04); the X1 pilot's CC-001 test file used JSON `null` for NaN, which the WASM boundary read as 0 °F, and the only honest outcome was a self-rejection on the test format (L-11) (Recorded (probe); Pilot (not a registered result)) | Every gate and invariant is exception-safe and returns a verdict with a named reason for any input shape; a crash is a reject, never an absence. Totality includes the **test format**: the frozen test encoding must represent every value the contract's domain can produce (NaN, infinities, −0, out-of-range), or the contract must trap on them explicitly, before the evaluator freezes (WP09, WP08 (7)) |

### 2.4 Fault generation strategy

Four strata per domain, each drawn from a declared distribution written into the precommit:

| Stratum | Source | Examples | Notes |
|---|---|---|---|
| S1 Mechanical | Typed IR mutation, extending the lab's operators (`workloads/w-search/generator/mutate.mjs`) to kernels | Operator swap, constant tweak, loop bound, statement deletion, branch negation | Cheap; mostly caught by universal gates; keeps n honest |
| S2 Domain-semantic | Templated transforms per domain | Swapped units, dropped rows, a wrong join rule, a stale source binding [E3 §7]; off-by-one and reversed inputs [E3 §6] | The faults Edition 3 names; the tier decision should rest mainly on these |
| S3 Model-plausible | A separate model context asked to introduce a subtle, plausible fault | Rounding mode change, boundary inclusivity, unit-basis confusion | Correlated with the evaluator's prior; report separately; never the only stratum |
| S4 Searched | X3b: candidates a sixteen-wide campaign proposes that are wrong against an independent oracle | Whatever the search finds | Measures the optimizer's pressure on the evaluator |

**Stratification by domain.** Tiers are per domain [E3 §7], so each domain is its own decision unit with its own n. Two consequences:
- Two domains at the Supervised bar need about 9,500–12,600 faults in total (two allowed escapes or fewer each); the Autonomous bar is about ten times that per domain. Start with the domain with the most existing invariants (Field OS refrigeration) and one unrelated domain.
- A pooled cross-domain bound is not a per-domain guarantee. If a per-class floor is also wanted, 300 faults per class with zero escapes bounds that class below about 1 % (one-sided 95 %, Derived), which is diagnostic only.

**Cost of n.** Harness compute is not the constraint: at an assumed 0.1–1 s per full harness run (Estimated), 6,300 faults is 10 minutes to under 2 hours per domain. The constraints are generating thousands of non-equivalent domain-semantic faults and filtering equivalents. S3 at 1,000 tokens per fault is about 6 million tokens per domain (Estimated).

### 2.5 The only seeded-fault figure that exists

The lab's calibration C6a rejected 1,081 of 1,081 output mutants (Recorded; R12 §4.2). Zero escapes in 1,081 bounds that checker's escape rate below 0.28 % at one-sided 95 % (Derived). It is an oracle checker against output mutants, not a synthesized evaluator against faulty candidates, and it is about a third of the n the Supervised bar needs.

## 3. The matched end-to-end campaign

After the six experiments, the matched campaign compares whole loops on identical tasks with frozen evaluators [E3 §15; W p.22; A sheet 28].

### 3.1 Arms

| Arm | What it is | Why it is there |
|---|---|---|
| A — Warm native baseline | A vetted function or declarative composition in an already-warm process | The cheaper known operation; the control every claim must beat or match [E2 §15] |
| K — Kernel workcell | The Stage 3 workcell: synthesized residual, pure WebAssembly kernel plus declarative glue, local Wasmtime lane | The design under test |
| D — Child-isolate topology | A compiler worker plus a child V8 isolate (Dynamic Worker, or a local child isolate inside an owned process and cgroup) running TypeScript→JavaScript | The compatibility lane and hosted shape; not identical to K and not presented as such [W p.14] |
| G — Conventional agent in a warm container | A pinned coding agent (model and harness version fixed) in a pre-warmed container with dependencies installed, using the same frozen evaluator, measured end to end **including the time to specify** | The arm the product proposition must beat; a cold VM is a strawman [E3 §15] |

The lab's critique applies directly: every arm reached through the same front door; every helper process inside the arm's accounting boundary; one representative per arm declared with full options before data [`LAB/CRITIQUE-2026-10-14.md` items 5, 7, 10; `LAB/CRITIQUE-2026-10-14-precampaign.md` M8, M9].

### 3.2 Tasks, evaluators and the specify term

- Task classes: a small generated tool; type-heavy code; a data transform; an interactive UI; adversarial loop, heap and output cases [A sheet 28].
- Evaluators are frozen per task before any arm runs, hashed into the precommit, and shared by all arms. Holdouts are rotated or fresh for the release run [E3 §11].
- Time to specify is measured the same way in every arm that needs it: for K, residual synthesis plus the person's plain-language confirmation; for G, the person writing or confirming the agent's acceptance tests; for A, zero if the baseline already exists, otherwise the time to author it. Person time is wall-clock minutes, recorded by the harness.

### 3.3 Metric and decision

- **Primary (one):** independently accepted useful capabilities per unit of total cost, where total cost includes model tokens, CPU-seconds, repairs, evaluation, review and failures, converted with prices declared in the precommit [E3 §1].
- **Secondaries:** median and p95 wall time from request to accepted capability including time to specify; CPU-seconds; peak and retained memory; reviewer minutes; searched escape rate; failed and unknown attempts.
- **Prospective target (Proposed):** the white paper's example, at least 2× lower median time to an accepted small capability, or materially more accepted improvements at equal complete cost [W p.22]. The precommit fixes one before data.
- **Sample size (Derived from an assumed spread):** to detect a 2× effect on a paired log scale at power 0.8, sd 0.8 needs 11 task pairs, sd 0.5 needs 5. Floor at 30 tasks, each with at least three replicate runs per arm in randomised order, because the lab's pilot showed the P6-style metric is dominated by reject cost and contended variance [R12 §4.3].
- **Stop:** budget, plateau, regression or ambiguous execution; an arm with any parity or containment failure outside its predeclared expected failures is inadmissible for that task.

## 4. Measurement discipline

These rules come from the lab's predictions, test plan and environment work, and from the defects its critiques found. They apply to every experiment above.

| Rule | Content | Source |
|---|---|---|
| One primary metric | Secondary metrics cannot rescue a result. Anything found after the fact is exploratory and needs a fresh replication | `LAB/docs/PREDICTIONS.md` (primary metric, multiplicity) |
| Precommit before the first measured job | Workload, adapters, runtime versions, budgets, sample counts, seed and predictions are hashed first; a late change creates a new campaign | `LAB/docs/LAB-DESIGN.md` rule 2; `CRITIQUE-…-precampaign.md` M11 |
| Calibration first | Timing, CPU, memory, I/O, throttling, evaluator sensitivity and noise floor checked against known truths at the measured commit, on the same boot, within 12 h; any failure blocks every campaign | `LAB/docs/END-STATE-AND-TEST-PLAN.md` §3 L3; `LAB/docs/TESTING.md` |
| Paired, randomised comparisons | Arms never run concurrently; block-randomised order; the replicate process lifetime is the unit; ratios of totals; paired log-ratio CIs with an equivalence margin; a CI straddling the threshold is inconclusive | `LAB/docs/PREDICTIONS.md` |
| Enough blocks | At least 16 blocks; the percentile bootstrap under-covers at 8; BCa or a studentised interval declared in the precommit. The lab's contended pilot recommended 32 | `CRITIQUE-…-precampaign.md` S2; `LAB-WT/measure/docs/PILOT-2026-10-14.md` |
| Explicit cache states | "Cold" means process-cold and page-cache-warm (page caches cannot be dropped without root); disk compile caches disabled or pinned; warm state declared per arm; retained state checked for leakage | `LAB/docs/PREDICTIONS.md` (regimes, warm-up) |
| Steady-state rule | Predeclared; compares like with like (a fixed probe set or whole stream passes), never consecutive windows of a mixed stream; non-converging lifetimes flagged and analysed with and without; warm-up curve published; warm-up past JIT tier-up (at least 20 iterations on this host) | `CRITIQUE-…-precampaign.md` M10; `LAB/docs/ENVIRONMENT.md` finding 6 |
| Correctness before speed | An arm with an oracle or parity failure has no admissible timing. `outcome_unknown` is its own stage, never a pass or a reject; an arm with more than 1 % unknown (2 % in any lifetime) is inadmissible | `LAB/docs/LAB-DESIGN.md` rule 5; PREDICTIONS v1.6 on `wip/precampaign-scoped` |
| Host accounting | Driver in its own cgroup; every helper process inside the arm's cgroup, asserted at each readback; a null arm measures the harness constant; host-wide `/proc/stat` cross-checks out-of-cgroup work, including `systemd-coredump`, and gates lifetimes | `CRITIQUE-…-precampaign.md` M9, S1, S5; backlog core-dump item |
| No quota on timed runs | Pin to quiet cores (on this host the scheduler's preferred cores were the noisiest); no `cpu.max` on timed runs. The Field OS warm series ran under quota and recorded 20 and 9 throttled periods, which is why they are not runtime ceilings | `LAB/docs/ENVIRONMENT.md` findings 2–4; R12 F04, F06 |
| Environment identity | Snapshot before and after: kernel, CPU model and microcode, governor, frequency, SMT, thermals, load, pressure, memory, runtime versions, cgroup controllers | `LAB/receipts/*/environment-*.json` |
| Noise floor sets sample size | Warm in-process compute here has 0.5–2 % CV; fresh-process wall 2–10 %; allocation-heavy work 2.5–19 %. A 10 % effect is detectable with few samples; effects under 2 % need n ≥ 100 and a passing quiet gate | `LAB/docs/ENVIRONMENT.md` (recorded with the gate failed: upper bounds) |
| Pilot sets the numbers, never the result | A pilot estimates variance and checks the steady-state rule; its numbers are never reported as results | `LAB/docs/END-STATE-AND-TEST-PLAN.md` phase 3 |
| CPU time is not energy | Cgroup CPU-seconds are not joules. Frequency, idle power, memory traffic, GPU and the rest of the machine are outside them. Energy needs a power sensor or wall meter and its own precommit. Wall time is not resource use either: tsc-rs `--fast` is faster at up to 2.2× CPU [U04] | E3 §14 (energy not established); `LAB/docs/END-STATE-AND-TEST-PLAN.md` (energy out of scope) |
| Holdout hygiene | Repeated scoring on one holdout trains on it; release confirmation uses rotated or fresh fixtures; for model proposers, a fresh holdout seed kept out of the proposer's context | E3 §11; `LAB/docs/WORKLOADS.md` (holdout handling) |
| Contradictions first | Reports list contradictions and failed predictions before explanations; failed campaigns stay recorded | `LAB/docs/LAB-DESIGN.md` rule 8 |

## Edition 3 alignment

- **Changed.** Edition 2 and the white paper made the matched end-to-end campaign "the decisive experiment" [W p.22; A sheet 28]. Edition 3 puts six smaller experiments first and adds the conventional-agent arm, measured including time to specify [E3 §15].
- **Superseded.** The white paper's arm B (the private Node/QuickJS adapter) and arm C (strict in-isolate TypeScript compiler as the main path). The kernel workcell replaces C; TypeScript→JavaScript is the compatibility lane inside arm D.
- **Inconsistency inside Edition 3.** §5's route table says AssemblyScript is the default "pending Experiment 1" and MoonBit is "compared in Experiment 1", but §15's Experiment 1 is the specification study, and the route comparison is Experiment 4, which lists TypeScript, AssemblyScript and Rust, not MoonBit. This document treats the route comparison as X4 and lists MoonBit as an optional fourth route.
- **Still holds.** Freeze identical tasks, toolchains, evaluators and budgets before comparing; correctness before speed; measure both the candidate and the search [W p.22].

## Open questions

- What price converts person-minutes, tokens and CPU-seconds into one total cost? It must be declared before the matched campaign and should be revisited in the decision register (R16).
- How many domains can reach the X3 sample sizes at all? If domain-semantic faults cannot be generated by the thousand, the Supervised tier is unreachable by measurement and must stay Confirmed.
- Is the searched escape rate defined per seeded fault or per campaign? Per-campaign bounds below 1 in 1,000 would need about 3,000 campaigns; this document defines it per seeded fault, which the X3 precommit must state.
- Can the shared desktop ever pass the quiet gate? If not, every timing campaign needs an exclusive window or a root-owned cpuset.

## Sources

- Edition 3 §1, §5, §6, §7, §10, §11, §13, §14, §15 (`sources/text/Endoforge-Edition-3.txt`).
- Edition 2 §14, §15; white paper pp. 14, 21–22; diagram atlas sheet 28.
- `~/Work/isolate-factory-lab` at `a95a492`: `docs/PREDICTIONS.md`, `docs/END-STATE-AND-TEST-PLAN.md`, `docs/TESTING.md`, `docs/ENVIRONMENT.md`, `docs/WORKLOADS.md`, `docs/LAB-DESIGN.md`, `docs/CHECKERS.md`, `docs/CRITIQUE-2026-10-14.md`, `CRITIQUE-2026-10-14-precampaign.md`, `workloads/w-search/generator/`, `evaluator/lib/search.mjs`, `tests/.out/calibration/calibration-6366e38abdd814c2.json`.
- `~/Work/isolate-factory-lab-wt/measure/docs/PILOT-2026-10-14.md`; `docs/PREDICTIONS.md` v1.6 on `wip/precampaign-scoped`.
- Added 2026-10-17: `experiments/P-03-escape-rate-method/RESULT.md`, `experiments/P-04b-bare-api-model-term/RESULT.md` (Recorded (probe)); `campaigns/x1-spec-study/receipt/` (Pilot (not a registered result)); `docs/execution/LESSONS-LOG.md` L-01 to L-04, L-11; R16 DEC-65, DEC-71.
- R12 (recorded figures F04, F06, F10, U04, lab §4); R13 (stages).
- Power arithmetic: exact binomial (Clopper–Pearson) bounds computed for this document on 17 Oct 2026.
