# POODO continuation capsule: the factory hill-climb method (2026-10-17)

Working-state metadata for the decision recorded as DEC-73 and `HILLCLIMB-METHOD.md` v2. It is not evidence; evidence lives at the locators named. Depth: Deep. Fan-out used: three blind research workers (Observe), a two-member blind council (Orient → Decide); independence limited by shared model family and a shared evidence digest; the red team was anchored on the draft by design.

```yaml
POODO_CONTINUATION_V3_0
schema: POODO_CONTINUATION/3.0
capsule_id: PC-endoforge-hillclimb-0001
revision: 1
parent_capsule: null
generated_at: 2026-10-17T22:30:00-04:00
objective: A repeatable method by which the factory improves itself, climbing accepted useful capability per total cost, whose comparisons are readable above the noise floor and whose adoption signal the optimised agents cannot read or game; and a precommitted loop-1 charter.
acceptance:
  - id: AC-endoforge-hillclimb-01
    criterion: Owner approves HILLCLIMB-METHOD.md v2 and the loop-1 charter; loop 1 runs only after an A/A replicate and ten blind owner verdicts; adoption decided by sealed-oracle paired contrast, canaries 3/3, guardrails, and owner-oracle agreement >= 4/5.
authority:
  allowed: Edit and commit documents in ~/Work/endoforge; propose sessions; run read-only analysis.
  prohibited: Running loop 1 or any factory agents without the owner's go; using an API key (DEC-65); modifying the refrigeration-ai trunk or protected folders; merging; weakening gates or guardrails.
constraints: Shared desktop (CV 0.13-0.18 within configuration); subscription rate windows bound throughput; reserve of 40 untouched requests plus a closed-form corpus; no interface requests exist; rung 4 unmet.
user_directives: Whole stack moves per loop (17 Oct evening); agents do the work; agentic evaluators in isolates; fixed example evals insufficient for non-deterministic tasks; evaluator and code in parallel by blind agents; record everything; get it right, stop racing ahead; POODO invoked.
current_head: D-endoforge-hillclimb-01
claims:
  - id: O-endoforge-hc-01
    state: observed
    status: active
    text: Loop 0, n=20 real requests, single sequential agent each; 19/20 gated; wall median 97 s, p95 146 s, CV 0.29; 20/20 underdetermined.
    source_type: artifact
    locator: campaigns/x1-spec-study/receipt/factory-summary.json (sha256 a41a56a4d70ca878...)
    observed_at: 2026-10-17
    freshness: revalidate
    evidence_family: EF-endoforge-pilot
    rehydration_status: unresolved
    supports: [D-endoforge-hillclimb-01]
    limits: Pilot, not a registered result; one machine, one day; completeness is worker self-report.
  - id: O-endoforge-hc-02
    state: observed
    status: active
    text: Persona review, 43 verdicts 14/27/2 (accept/with-change/reject), after v2 41 verdicts 16/24/1; two blind agent raters agreed 10/10 on complete and both missed the wrong-question defect.
    source_type: artifact
    locator: campaigns/x1-spec-study/receipt/persona-review-summary.md; receipt/classify/
    observed_at: 2026-10-17
    freshness: revalidate
    evidence_family: EF-endoforge-persona
    rehydration_status: unresolved
    supports: [D-endoforge-hillclimb-01]
    limits: Model judges from one family; no human verdict yet.
  - id: O-endoforge-hc-03
    state: observed
    status: active
    text: Within-configuration CV of a model turn 0.13-0.18 (12 turns per arm); low effort 56.4 s vs default 90.6 s with the same visible code; context size irrelevant to time.
    source_type: artifact
    locator: experiments/P-04b-bare-api-model-term/receipt/
    observed_at: 2026-10-17
    freshness: revalidate
    evidence_family: EF-endoforge-probe
    rehydration_status: unresolved
    supports: [D-endoforge-hillclimb-01]
    limits: Recorded (probe); one host; subscription CLI path only.
  - id: O-endoforge-hc-04
    state: reported_prior_state
    status: active
    text: Research records (3 workers, 40 sources, 31 primary-inspected): whole-stack contrast aliases stage effects; aOFAT needs error < ~25% of combined effects; judges are reusable holdouts (Ladder margin); judge errors correlate across providers; no proxy is unhackable; A/A before A/B; exact intervals at n=20 are 30-45 points wide.
    source_type: external_source
    locator: session transcript 2026-10-17 (worker reports); URLs listed there; to be registered in R18
    observed_at: 2026-10-17
    freshness: revalidate
    evidence_family: EF-literature
    rehydration_status: unresolved
    supports: [D-endoforge-hillclimb-01]
    limits: Several primaries behind paywalls were read via secondary records; none validates joint optimisation at n~20.
orientations:
  - id: OR-endoforge-hc-01
    text: The binding constraint is intent fit, not compute or the model; the loop must climb a sealed, human-anchored clean-promotion signal; the whole stack can move each loop only if the judge sits outside it and interactions are tested by design.
    depends_on: [O-endoforge-hc-01, O-endoforge-hc-02, O-endoforge-hc-03, O-endoforge-hc-04]
    confidence: {artifact_identity: high, test_path: medium, causal_model: medium, outcome: low}
    strongest_rival: H-endoforge-hc-01
alternatives:
  - id: H-endoforge-hc-01
    status: live
    text: Adaptive one-factor-at-a-time beats whole-stack for improvement at this budget and keeps attribution free.
    discriminator: A/A floor versus predicted move effects; if error < 25% of combined effects and interactions are small, H1 wins. Measured in loop-1 step 2.
  - id: H-endoforge-hc-02
    status: live
    text: The hill-climb is the wrong next step; rung 4 (one real use) dominates everything.
    discriminator: Whether a loop can produce any utility signal without a user; answered by the per-loop human slice and the loop-2 stop rule.
decisions:
  - id: D-endoforge-hillclimb-01
    text: Adopt HILLCLIMB-METHOD.md v2 (DEC-73): sealed oracle + canaries + human touchpoint decide; fast loop moves the whole stack; slow loop moves the judge with owner approval; A/A first; incumbent includes low effort; screen or four-corner design by measured budget; forecast ledger; refusals.
    depends_on: [OR-endoforge-hc-01]
    reversible: true
    reverse_if: Oracle-human agreement <= 3/5 after one revision; canary recall < 3/3 persists; or two loops show no main effect >= 20 points (budget moves to request harvesting and oracle work).
predictions:
  - id: P-endoforge-hc-01
    kind: prospective
    created_at: 2026-10-17T22:30:00-04:00
    created_before_observation: true
    observable: Loop-1 step 2 identical-configuration runs (v2 twice, 20 requests) differ in clean count by <= 3 of 20.
    acceptance: |delta clean| <= 15 points
    failure_means: Noise floor larger than designed; resize n or change the metric before any A/B is read.
    oracle: sealed consumer-oracle protocol v1 (to be written and hashed at registration)
    oracle_version: TBD
    artifact: A-endoforge-hc-01
    environment: Main-rig, shared desktop, subscription CLI; manifest hash TBD
    status: pending
    status_history: [pending]
    outcome_evidence: []
  - id: P-endoforge-hc-02
    kind: prospective
    created_at: 2026-10-17T22:30:00-04:00
    created_before_observation: true
    observable: All-new versus v2+low-effort paired clean gain on the 20 working requests.
    acceptance: gain >= +6 of 20 with guardrails intact, canaries 3/3, owner-oracle agreement >= 4/5
    failure_means: No evidence at this n (not "worse"); main effects become next loop's hypotheses.
    oracle: sealed consumer-oracle protocol v1
    oracle_version: TBD
    artifact: A-endoforge-hc-02
    environment: as above
    status: pending
    status_history: [pending]
    outcome_evidence: []
outcomes: []
contradictions: []
artifacts:
  - id: A-endoforge-hc-01
    locator: docs/execution/HILLCLIMB-METHOD.md
    identity_method: git_commit
    identity: 188aaac
    mutable: true
    captured_at: 2026-10-17T22:30:00-04:00
    role: output
  - id: A-endoforge-hc-02
    locator: campaigns/x1-spec-study/ (factory/, receipt/freeze.json seed 20261017)
    identity_method: git_commit
    identity: 188aaac
    mutable: true
    captured_at: 2026-10-17T22:30:00-04:00
    role: input
rehydration:
    status: complete
    losses: []
delivery_state: authored
outcome_state: unobserved
highest_justified_claim: A method and a loop-1 charter are written and committed; no factory configuration has been adopted or rejected; no loop has run.
required_runtime_observation: Loop-1 steps 0-2 (brief hashing, ten blind owner verdicts, oracle criteria + canary dry-run, A/A replicate) before any comparison is read.
who_controls_next_test: user
next_step: Owner approves the charter and schedules about one hour (ten blind verdicts now; five criteria validations and five uses during loop 1).
END_POODO_CONTINUATION_V3_0
```

## Amendment, revision 2 (2026-10-17, later the same evening): no human in the loop (DEC-74)

The owner approved the loop-1 charter ("I approve the loop-1 charter"), then removed the human step from the method ("we need this to work without a human"; "i dont work for you"). Revision 1 above is kept as written; this block records what changed. Nothing below is evidence; the receipts are at the locators named.

```yaml
POODO_CONTINUATION_V3_0
schema: POODO_CONTINUATION/3.0
capsule_id: PC-endoforge-hillclimb-0001
revision: 2
parent_capsule: PC-endoforge-hillclimb-0001/r1
generated_at: 2026-10-17T23:40:00-04:00
changes_from_r1:
  - AC-endoforge-hillclimb-01 criterion now reads: the owner has approved the charter (done); loop 1 runs after an A/A replicate and after the two-model sealed oracle panel has graded the ten blind loop-0 items (hc-01) with canary recall 3/3; adoption is decided by sealed-oracle-panel paired contrast, canaries 3/3, guardrails intact, inter-oracle within-one agreement >= 8/10; no step waits on a person.
  - authority.allowed now includes running loop 1 and the factory agents through the subscription CLI (the owner's approval of the charter plus the no-human directive); authority.prohibited unchanged otherwise (DEC-65 no API key; no trunk edits; no merge; no gate or guardrail weakening).
  - The human touchpoint (ten blind owner verdicts, five criteria validations, five uses) is replaced by: oracle A (Sonnet 5.5, field-technician frame) and oracle B (Opus 5.5, engineering-reviewer frame), blind, sealed from every production and optimiser agent; inter-oracle agreement recorded every loop as a measured independence proxy; agent-corroborated end-to-end use of five all-new promotions per loop.
  - Claim ceiling lowered and stated: agent-corroborated clean promotion; Edition 3 rung 4 (a person's real task) is reachable only by an optional human audit, never by the loop.
  - Forecasts added before results were read: P(inter-oracle exact agreement on hc-01 >= 6/10) = 0.5; P(both oracles catch the persona-rejected item) = 0.7.
precommit:
  artifact: docs/execution/HILLCLIMB-METHOD.md
  sha256: 506c5b3ba9f4cfff995a7d8c8980a91e6678e51f45842d836d5807c58da3b9f4
  hashed_before: any hc-01 oracle verdict was read by the orchestrator (both oracle agents were still running)
  oracle_sheets: campaigns/x1-spec-study/receipt/human-calibration/hc-01/setup.json (item hashes)
delivery_state: authored
outcome_state: unobserved
highest_justified_claim: Method v2.1 and the registered charter are committed; two sealed oracle agents are grading hc-01; no factory configuration has been adopted or rejected; no loop has run.
required_runtime_observation: hc-01 oracle scores and inter-oracle comparison (receipt/human-calibration/hc-01/summary-oracle-*.json, compare-*.json), then loop-1 steps 1-2 (criteria, canary dry-run, A/A) before any comparison is read.
who_controls_next_test: agents (the orchestrator session and the loop-1 session); the owner may veto at any time
next_step: Score hc-01 for both oracles, compare, record; start the loop-1 session with a hashed brief.
END_POODO_CONTINUATION_V3_0
```

## Amendment, revision 3 (2026-10-17, late evening): the spec is the incumbent, not the law (DEC-75)

The owner: deviate from the initial spec with better ideas; stop using it as the law. Method v2.2 adds a mandatory deviation step per loop, moves the spec's own choices onto the fast loop, fixes only the objective, the honesty rules and the record, and replaces the "claim ceiling" with evidence sources (production telemetry, D-05). The loop-1 charter is a plan the loop-1 session may change with a recorded, hashed departure. Seven seed deviations D-01 to D-07 are listed in the method. Precommit for whatever loop 1 actually runs is hashed by the loop-1 session before step 3.
