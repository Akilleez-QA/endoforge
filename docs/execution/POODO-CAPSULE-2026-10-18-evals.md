# POODO continuation capsule: the failures questioned and the eval design (2026-10-18)

Working-state metadata for DEC-79 and DEC-80; not evidence. Depth: Deep. Fan-out: one independent critic (Codex GPT-6.1, sealed read-only folder of raw results; `docs/audits/` for the earlier audit). Research gate satisfied with inspected primary sources (listed under `sources`).

```yaml
POODO_CONTINUATION_V3_0
schema: POODO_CONTINUATION/3.0
capsule_id: PC-endoforge-evals-0001
revision: 1
parent_capsule: PC-endoforge-hillclimb-0001/r3
generated_at: 2026-10-18
objective: Decide the right changes after questioning every remaining failure against the intended design and the owner's directives (no human review; agents write executable evals in parallel, not judges; spec as incumbent).
acceptance:
  - id: AC-evals-01
    criterion: Each change justified by evidence or labelled a hypothesis; the central correction tested by a precommitted probe with frozen ground truth; decisions recorded; no human step.
authority:
  allowed: decide and record; edit docs and tools/atomizer; run read-only probes and subscription CLI calls.
  prohibited: human review of any kind; agentic judges as the ruler; API keys; installing software without approval; starting loop 2 (halted by the owner); touching refrigeration-ai.
favored_orientation: Most failures are drifts from the design (stub-fed evals, example tables instead of procedures, silent defaults, regeneration as repair, no property library), not limits.
strongest_rival: The interaction contract (missing input paths, irrelevant questions) and the strict ruler manufacture the failures, independent of eval source. Discriminator used: CC-020 (no input path) and C-003 (irrelevant question) in P-08.
precommit:
  artifact: experiments/P-08-request-blind-evals/PRECOMMIT.md
  sha256: 8ca5986d7f34f89fba124a5e398e6cd497441963212e47223fea356516f8da2c
  fixtures_sha256: see experiments/P-08-request-blind-evals/receipt/precommit.sha256
outcome:
  P1: met (request-blind 4/4 vs stub-fed 0/4 on the no-input-path fault)
  P2: failed (stub-fed bound); physics caught C-022 in 0/4, CC-029 in 2/2
  P3: failed_with_test_concern (request-blind rejected correct-valued kernels for accepting -500 F; the defect is real, the fixture was narrow)
  P4: met (one incidental catch)
  P5: met (request-blind about 1/3 to 1/2 the tokens and wall)
decision: DEC-80 (request-blind evals from two families; mandatory interface evals gated by decision stability; sourced physical-validity library; sourced property core independent of the kernel's table; evals challengeable only by independent evidence; out-of-class stratum). Atomizer test and check atoms now receive the bare signature only.
reverse_if: Loop 2 shows request-blind evals with the decision-stability gate do not raise usable capabilities on fresh requests, or the validity library's false-reject rate exceeds 10 % on correct kernels.
open_items:
  - Resolved: the property library was installed and then moved out of Endoforge (DEC-81); the consuming project supplies reference values.
  - Build the physical-validity library and the decision-stability gate; measure false rejects.
  - The irrelevant-question failure (C-003 per Codex) has no deterministic check yet.
sources:
  - Konstantinou, Degiovanni, Papadakis, "Can we find bugs using LLM-generated oracles?", arXiv 2410.21136 (retrieved 2026-10-18)
  - Edwards and Schuster, "Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents", arXiv 2603.26233, EMNLP 2026 (retrieved 2026-10-18)
  - Mu et al., ClarifyGPT, arXiv 2310.10996 (retrieved 2026-10-18)
  - Vikram, Lemieux, Sunshine, Padhye, "Can Large Language Models Write Good Property-Based Tests?", arXiv 2307.04346 (retrieved 2026-10-18)
  - NIST Chemistry WebBook, R-134a phase data, C811972 (Tc 374.1 K, Pc 40.6 bar) (retrieved 2026-10-18)
delivery_state: recorded and committed; atomizer template changed
outcome_state: probe-level evidence only; no fresh-request effect measured
highest_justified_claim: Request-blind evals catch interface faults that stub-fed evals structurally cannot, at lower cost, in a 4-request probe; they over-ask and miss some result-validity faults without a library.
who_controls_next_test: the owner (loop 2 start; property-library install)
END_POODO_CONTINUATION_V3_0
```
