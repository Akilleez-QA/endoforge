# C05 — E3 X5: the model term

> Reconstructed 2026-10-17. The original C05 was not available; this draft is rebuilt from
> Edition 3 (§10, §15), R09, R12 (F10), R14 X5, R15 (RISK-17, RISK-18) and R16 (DEC-50). Content follows Edition 3 where the editions differ.
> Redone 2026-10-17 (later the same day) after probes P-04 and P-04b and DEC-65; see `docs/execution/CRITIQUE-2026-10-17-reconcile.md`.

**Status: Draft — not registered.** No precommit hash exists; no job has run; no result exists. Two probes (P-04, P-04b) measured the hosted turn through the Claude Code CLI on 2026-10-17; their numbers are **Recorded (probe)** and narrow this draft's arms and levers (DEC-64); they decide nothing here.

## Purpose

This record drafts the precommit for Edition 3's fifth experiment: the first measured model turn in this project, and whether local batched inference beats hosted inference to the first passing candidate [E3 §10, §15]. Every recorded number in the project is model-free.

## Summary

- Part a (`c05a`, any host, descriptive, no kill): one model turn through the subscription CLI's lean mode (MCP, tools, settings, skills and project context off), measured end to end, at two operating points. **No API arm** (DEC-65: subscription only; `--bare` is key-gated). The hosted baseline for part b is this lean-CLI arm at default effort.
- The primary levers on the hosted turn are effort and output length, not context: P-04b removed ≈460k cached context tokens and the Opus 5.5 turn stayed at median 90.6 s, while `--effort low` gave 56.4 s with the same visible code and gate yield (Recorded (probe), `experiments/P-04b-bare-api-model-term/RESULT.md`). Part a varies these first; part b pins them per arm.
- Prefix caching across different requests is unavailable through the CLI: a changed last line re-read only the ≈2.1k-token system prompt from cache (P-04b). Cache-state claims are therefore "byte-identical turn" or "none"; a warm-prefix arm would need the API, which DEC-65 excludes.
- Part b (`c05b`, conditional on the unified-memory host of decision point DP-5): four-way batched local generation of about 1,000-token kernels against the lean-CLI hosted stream, compilation running concurrently; yield-adjusted time to first passing candidate. The two parts register as two campaign ids sharing this record, as C03 does, so part a can run and be recorded even if no host exists for part b. Part b's local arm stays conditional on DP-5; no local model is on disk (P-04 scope note).
- One primary metric (part b): local ÷ hosted ratio. Kill: worse than 1.5× [E3 §15]. If DP-5 records no host, part b is registered as "not run, no host" and placement is recorded as "undecided, hosted by default" (`EXECUTION-PLAN.md` §7.1); C07 then declares hosted inference for arm K.
- A third, conditional arm, local batched with type-constrained decoding (R19 §2.2), runs only if a token-granular checker interface exists at freeze (WP19, Stage 6+ / optional); otherwise the arm is recorded as absent and why.
- Planned 30 paired runs; a pilot of 8 sets the final n because no model-term spread has ever been measured (Estimated, R14).

## Record header

| Field | Content |
|---|---|
| Record | C05 |
| Status | Draft — not registered |
| Stage | 3 |
| Work packages | WP03 (unified-memory host record, part b only), WP19 (concurrent compilation; token-granular checker interface only for the conditional arm), WP23 (kernel task set), WP24 (part a is "the CLI's lean mode, by effort"); decision points DP-5 recorded and DEC-65 in force |
| Risk or decision addressed | RISK-18 (inference dominates latency), RISK-17 (unified-memory bandwidth contention); DEC-50, DEC-65 (subscription CLI only, no API arm) |
| What cannot be known yet | Whether a unified-memory host exists (DP-5; the Main-rig is a discrete-GPU host and is not it [R14 X5]); the local model; the CLI version and model version at freeze (P-04b used `claude` 2.1.299, Opus 5.5 and Sonnet 5.5); whether a token-granular checker exists for the conditional arm (none does upstream, R19 open question); the subscription's usage limits under a 30-pair run (none was hit in 48 turns, P-04b). The Field OS 27B CPU-only trial is not a precedent: it failed its criterion (R12 F10) |

Fields follow [`docs/templates/CAMPAIGN-PRECOMMIT.md`](../../templates/CAMPAIGN-PRECOMMIT.md); see [`TEMPLATE.md`](TEMPLATE.md).

## 1. Identity

| Field | Content |
|---|---|
| Campaign id | `c05a-x5-hosted-turn-<UTC>-<6 hex>` (part a) and `c05b-x5-local-vs-hosted-<UTC>-<6 hex>` (part b); TBD at registration |
| Label | `official` |
| Experiment | E3 X5 |
| Author and reviewer | TBD at registration. The reviewer must not have authored the evaluator, the residual or the candidates [E3 §8] |
| Created at | TBD at registration; must precede the first measured job (`createdBeforeFirstMeasuredJob: true`) |

## 2. Question and hypothesis

| Field | Content |
|---|---|
| Question | Is local four-way batched generation on the target unified-memory machine, yield-adjusted, within 1.5× of the hosted lean-CLI stream in time to the first passing candidate? It decides inference placement. Part a's descriptive question: at which effort and output-length setting does the hosted turn come closest to Edition 3 §10's "≈1,000 tokens, 5–10 s" (no probe arm met it; closest 3.5k visible tokens, 56 s) |
| Hypothesis and predicted observable | Edition 3's reasoning (Estimated): batched decode reads the weights once per step, so four candidates cost close to one in time, the strongest latency argument for unified memory [E3 §10]. Observable: time from request to first candidate passing the frozen evaluator, per arm |
| Strongest rival | Local decode is slower per token for any model large enough to match hosted quality, and lower local yield erases the batching gain [E3 §10] |
| Claim-ladder rung | None. It informs placement; it does not move a rung [E3 §17] |
| Predictions file cited | This record, hashed at registration (SHA-256 TBD at registration); shared design in R14 |

## 3. Metrics

| Field | Content |
|---|---|
| Primary metric (exactly one) | Part b: yield-adjusted time to first passing candidate, local batched (arm L) ÷ hosted (arm H, lean CLI at default effort): geometric mean over paired tasks of (local time to first pass ÷ hosted time to first pass), where time to first pass includes repairs and is capped at a declared limit (censored runs counted at the cap and reported). Part a has no primary in the decision sense: its one metric is total turn time, descriptive, reported per operating point (H and H-low) |
| Decision rule | Part b, read at the pilot-set n (at least 12 pairs). Upper 95 % bound below 1.5: local is a lane for generation. Point estimate above 1.5: kill. Otherwise inconclusive: local serves short calls only until a replication decides. The conditional arm L-c (constrained decoding) is compared as L-c ÷ H as a secondary and cannot rescue the primary; if L-c beats 1.5 while L does not, the record says "local wins only with constrained decoding" and placement stays as the primary decided. Part a decides nothing |
| Secondary metrics | Part a, per operating point: time to first text and to first stream event, thinking and visible output tokens, decode tokens/s, context tokens per turn, `asc` type-gate pass rate, and the effect of a prompt wording that forbids prose on output length (the second lever); cache-read tokens for byte-identical repeats only. Part b: decode tokens/s per stream, memory-bandwidth counters, compile wall time under concurrent decode, first-pass yield per arm, tokens per accepted candidate; L-c ÷ H and L-c's repair-round count if the arm runs |
| Multiplicity | One primary comparison; secondaries are descriptive and cannot rescue the primary |

## 4. Arms

| Arm | Representative (full options) | Artifact identity | Regime and retained state | Isolation | Accounting |
|---|---|---|---|---|---|
| L — Local batched | Four-way batched generation on the unified-memory host; model, quantisation, runtime and prompt cache residency TBD at freeze | Model weights SHA-256 and runtime binary hash TBD at freeze | Resident model and prompt cache (warm) | Host process; compiler (WP19) running concurrently | Host counters for bandwidth; arm cgroup for CPU |
| H — Hosted lean CLI, default effort (baseline) | One `claude -p` turn under the user's subscription login with MCP, settings, tools, skills and project context off (P-04b's S1 configuration); Opus-class model, default effort; `ANTHROPIC_API_KEY` asserted unset and `claude auth status` recorded (L-02). No API arm exists (DEC-65) | CLI version, model identifier, runner and prompt SHA-256 TBD at freeze | No cross-request prefix cache through the CLI; byte-identical repeats read ≈6.6k cached tokens, a changed last line only the ≈2.1k system prompt (P-04b) | Network; subscription usage limits recorded | Wall time; tokens from the CLI's usage fields; list-price shadow reported, not billed |
| H-low — Hosted lean CLI, low effort | As H with `--effort low` (P-04b: median 56.4 s against 90.6 s, thinking 2.3k against 6.4k tokens, same visible code, 12/12 `asc`); part a only, and part b's sensitivity arm | As H | As H | As H | As H |
| L-c — Local batched with type-constrained decoding (conditional) | As L, with the compiler's token-granular checker masking ill-typed continuations during decode (R19 §2.2). Runs only if WP19's token-granular interface exists at freeze; otherwise this row is recorded "absent: no token-granular checker for the route" and the reason is carried into the receipt | As L plus the checker-interface digest | As L | As L | As L |

Control arm: H. Null arm: none. A Sonnet-class row (P-04b S3: 65.6 s) may be added to part a as a third operating point; it is not a part-b arm.

## 5. Evaluator and oracle

| Field | Content |
|---|---|
| Frozen evaluator hash | TBD at freeze |
| Synthesized residual | Per-task frozen residuals from C02 / C04's task set; hash TBD at freeze |
| Acceptance boundary | WP09 gate order; first passing candidate is the first one any of the arm's streams produces |
| Independent validator | Independent oracle per task, cost not charged |
| Parity rule | An arm pass the validator rejects is a parity failure and the run's time is not admissible |

## 6. Fixtures and holdouts

| Field | Content |
|---|---|
| Workload | The X4 kernel task set (about 1,000-token kernels); task order randomised; arms paired by task |
| Public fixtures | TBD at freeze (digest) |
| Holdouts | none |
| Seeded faults | none |

## 7. Sample size and power

| Field | Content |
|---|---|
| Unit of replication | One paired task run (local and hosted) |
| Planned n | Pilot 8 pairs; planned 30 pairs; final n set from the pilot's spread and recorded before the official run |
| Power calculation | Paired log-ratio test against a 1.5× threshold at α = 0.05, power 0.8: sd 0.5 needs 12 pairs, sd 0.8 needs 31 (Derived from assumed sd, Estimated, R14 X5) |
| Minimum samples | 12 pairs for any decision |
| Randomisation | PRNG `ifl-prng` from WP01 (`LAB/harness/lib/prng.mjs`); seed TBD at registration; schedule SHA-256 recorded before the first job |

## 8. Measurement rules

| Field | Content |
|---|---|
| Cache states | Hosted: prefix caching across different requests is unavailable through the CLI (P-04b), so the hosted cache state is declared as "none" for paired tasks and "byte-identical repeat" where a repeat is measured; the cache-read token count is recorded per turn. Local: prompt cache residency declared; model resident before the first run; cold-start runs reported separately |
| Steady-state rule | Not applicable to Part 2's primary (first-pass time per task); decode-rate secondaries use a 60 s steady window after the first token |
| Warm-up | At least 20 iterations per lifetime, covering every path the measured window uses [R14 §4] |
| Placement | Local: compiler and model placement per WP03 record; recorded GPU and CPU frequency policy |
| Quiet gate | WP03 record's quiet conditions; thermal state recorded before each pair |
| Calibration | WP01 calibration receipt at the measured commit, same boot, within 12 h; path and SHA-256 TBD at registration; no waivers (official) |
| Accounting cross-check | Bandwidth from hardware counters, not inferred; host-wide CPU checked against the arm cgroup |

## 9. Stop rules and kill criterion

| Field | Content |
|---|---|
| Stop rules | Budget exhausted; thermal throttling recorded in more than a quarter of runs; model or provider version change (stop; new campaign) |
| Kill criterion | Part b only: local batched time-to-pass, yield-adjusted, worse than 1.5× hosted (point estimate above 1.5 at the pilot-set n): local inference serves short calls only [E3 §15]. Part b not run for want of a host (DP-5): no kill is read; placement is recorded as "undecided, hosted by default" and the record says so |
| Escalation | Author and reviewer. A kill, failure or inconclusive result is entered in R12 and R16 (WP32) before any dependent work package starts |

## 10. Budget

| Field | Content |
|---|---|
| Compute | Hours of local inference on the target host (TBD at freeze from the pilot) |
| Model | Hosted turns draw on the subscription's 5-hour and weekly limits, not a dollar meter (DEC-65): about 30–40 tasks × repairs × about 6–10k output tokens per turn (P-04b: 5.9k at low effort, 10.0k at default); the runner stops on the first usage-limit error and the stop is recorded. A list-price shadow is reported for comparison with P-04 only |
| People | Operator time only |
| Price declaration | Not needed: the primary metric is not a total cost |

## 11. Environment identity

Part b: the DP-5 unified-memory host per its WP03 record (identity TBD at registration). Part a: any host, recorded; the Main-rig may serve part a only. Hosted side: CLI version, login account (asserted, not recorded as a secret), model identifier and effort setting at registration.

## 12. Artifact identity

Local model weights, inference runtime, CLI runner and its lean configuration, prompt templates, compiler: hashes TBD at freeze.

## 13. Failure meaning

A kill means local inference is for short calls (retrieval judgments, criterion drafting, single-diagnostic repairs), not that it is useless [E3 §10]. A pass says nothing about energy (CPU time is not energy) or about any host other than the one qualified. Part a alone, if run on the Main-rig, is a latency observation for that host, CLI version and lean configuration only; it decides nothing, and it says nothing about an API turn with a warm prefix, which this record cannot measure under DEC-65. An absent L-c arm says nothing about constrained decoding; it says the checker interface was not built (R19 open question).

## 14. Monitoring and rollback

The runner watches the quiet gate, cgroup readbacks and unknown counts per block. Owned units are stopped through their cgroups. A partial receipt set is kept as evidence and never stitched into another campaign [RECEIPT §1]. Nothing outside the campaign's owned resources is touched.

## 15. Signatures and hash chain

| Field | Content |
|---|---|
| `precommit.sha256` | TBD at registration |
| Spec hash | TBD at registration |
| Parent hashes | Predictions: this record. Calibration receipt: TBD at registration. Evaluator: TBD at freeze. Workload: TBD at freeze |
| Approvals | Person approving the precommit (and the residual, where one exists): TBD at registration |
| Chain rule | Every evaluation request and the summary cite the precommit hash; `SHA256SUMS` covers every file; a mismatch invalidates the receipt set |

## Edition 3 alignment

- New in Edition 3: the model term had never been measured; Edition 2 discussed unified memory without an experiment [E3 §10, §15; E2 §12].
- Edition 3's decode estimates imply uneven bandwidth efficiencies (E3-25); this record measures bandwidth instead of assuming it.
- Edition 3 §10's "≈1,000 tokens, 5–10 s" per turn (E3-20) is not met by any probe arm; the measured turn is thinking-dominated (about half the output tokens) and the lever is effort, not context (L-01). This record makes effort and output length the primary part-a variables; Edition 4 should restate the per-turn figure from a measured operating point (`CRITIQUE-2026-10-17-reconcile.md`).

## Open questions

- Is a unified-memory host available (DP-5)? Without it only part a can run, and placement stays "undecided, hosted by default".
- Does any in-isolate compiler expose a token-granular checking interface (R19 open question)? If not, arm L-c is absent and R19 §2.2 waits for Edition 4.
- Does the hosted arm's provider-side caching make runs non-independent? Through the CLI only byte-identical turns share cache (P-04b), so paired tasks with distinct prompts are independent on this count; the cache-read tokens are recorded per turn to check it.
- Does the subscription's usage limit bind under a 30-pair run? P-04b's 48 turns hit none; a limit error stops the run and is recorded.
- Can the second lever (output length by prompt wording) be varied without changing the task? Part a measures it on the same prompt with and without a no-prose instruction.

## Sources

- Edition 3 §10, §14, §15.
- R09 §7–§11; R12 F10, §7 (P-04, P-04b rows); R14 X5; R15 RISK-17, RISK-18; R16 DEC-50, DEC-64, DEC-65; R19 §2.2, §3; errata E3-20, E3-25.
- `experiments/P-04-model-term/RESULT.md`, `experiments/P-04b-bare-api-model-term/RESULT.md` (Recorded (probe)); `docs/execution/LESSONS-LOG.md` L-01 to L-03.
- `docs/templates/HARDWARE-QUALIFICATION.md`.
