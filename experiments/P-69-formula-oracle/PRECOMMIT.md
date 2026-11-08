# P-69 formula oracle: frozen expectations computed, not typed

Label: **Proposed** procedure, written 2026-11-08 before any acceptance measurement. Its SHA-256 is in [receipt/precommit.sha256](receipt/precommit.sha256), and [run.mjs](run.mjs) refuses to run when the file differs. Amendments are separate commits before the measurements they affect.

## Question

Wrong frozen expected values caused 30 of 38 failed candidates in P-56 and 5 of 6 failures in P-66. The model typed numeric literals from mental arithmetic while the contract's own formula sat beside them unused, and each wrong value cost about six repair turns that could never pass. Does computing every frozen expectation before the implementation turn remove that failure source, cheaply and without refusing good specifications?

## What is built (the treatment)

`core/runtime/x1/oracle.mjs`, called from the agent loop's specification stage inside the cell (no new process, no model call for the check). On by `limits.oracle`; this experiment decides the default.

1. **Formula reference.** The contract's own statement is parsed: the export signature, `name = expression` lines and intermediate steps, `returns expression`, continuation `= expression` lines and code-block expressions, evaluated in double precision with a small expression evaluator (no `eval`). Validity ranges (`lo <= x <= hi`, `in [lo, hi]`) give a trap reading for value tests outside them.
2. **Model reference.** With the oracle on, the specification prompt also asks for `reference.js`, one plain function per export, run in a fresh `vm` context (no string code generation, 50 ms per call). It is not frozen.
3. **Agreement (proposal 1b).** Per test: if the formula and `reference.js` agree, that value is frozen; a literal that differs beyond its declared tolerance is replaced and logged as a corrected spec error (proposal 1a). If they disagree, the literal is kept only when it agrees with one of them; otherwise, and whenever only one reference exists and contradicts the literal, the test is a flagged spec error and goes back to the specification turn as a check problem, before any implementation turn. A test with neither reference is marked unverified, never silently trusted.
4. **Tolerance (proposal 1c).** Every frozen number test carries `tol` = max(declared, 1e-9 × max(1, |expect|)), capped at the existing 1% gate limit.
5. **Host binding.** The host receives the cell's list of changes with the admission call and applies it to its own copy; a change to anything other than `expect`, `tol` or `expectError` is refused. The report (verified, corrected, flagged, unverified, spec errors, ms) is returned with the attempt.

## Corpus and labels

**Offline corpus (exact counts, no sampling).** Every frozen specification on disk from P-56 pilot and main (`endoforge-models-scratch/out`) and P-66 main (`p66-scratch/out`): 590 runs, 587 with a specification, 575 with a final kernel ([corpus.mjs](corpus.mjs)). Labels ([label.mjs](label.mjs)), fixed now and independent of the oracle:
- H needs: a test is **wrong** when it disagrees with the need's trusted reference (`P-56-model-effort/needs.mjs`) beyond max(tol, 1e-9 relative), or on trap versus value; otherwise **correct**.
- R needs: **correct** when the run's final compiled kernel passes it; **wrong** when it fails in one of the ten known wrong-value runs named in the P-56 and P-66 results (P-56 pilot `H08`/`CC-036` `sonnet-medium`; P-56 main `CC-036` `sonnet-low`, `CC-025` `opus-low`, `CC-002` `sonnet-low`; P-66 `H02` samples 0, 2, 5 and `H08` samples 3, 5); otherwise **unknown**.
- That gives **12 known wrong values in 10 specifications**, 8,475 correct tests and 26 unknown.

**Disclosure: the offline corpus is in-sample.** The parser was developed against this same corpus (dev rounds 1 to 7: false flags 353 → 56 → 35 → 26 → 17 → 16, catches 12/12 at the end). The offline bars below are therefore a fit, not a test. Held-out evidence comes only from the fresh specifications of the re-run below, which the oracle code has never seen.

**Pristine corpus.** P-51's 177 promoted kernels (`cand-r1`..`cand-r6` of P-42, the P-56 evaluator-synthesis loader), each judged with its own frozen tests and then with the oracle-frozen tests ([pristine.mjs](pristine.mjs)). The harness was smoke-run on three `cand-r1` kernels only, to check it loads.

**Re-run (fresh specifications).** Fixed need subset, in this order: H02, CC-036, H08, CC-002, H01, CC-025, H03, CC-013, the needs where P-56 and P-66 froze wrong values plus their siblings. Sonnet 5.5 at low effort (the P-56 recommendation, where the errors occur). 7 reps per need per arm, paired: rep *r* of both arms runs in the same wave of four reps, launch order alternating by rep parity (ABBA). `waits: 'hold'` so every failed check is counted (P-66 finding). ([run.mjs](run.mjs), [plan.json](plan.json), [analyze.mjs](analyze.mjs).)

Arms:
- `base`: the loop as on main (oracle off, current prompt).
- `oracle`: the loop with `limits.oracle` (new prompt, oracle at freeze).
- `rival`, **stop repairing after two identical failures**, derived from each `base` run without extra calls: the run is cut at the first check whose failure summary equals the previous check's. Under the paired design this is exactly the run the rival would have made, since it is identical to `base` until it stops.

Smoke: the `smoke` stage runs once with the P-56 fake CLI (no model calls) before the main stage.

## Bars (tighten, never loosen)

**Primary (one confirmatory bar, so no Holm correction): known wrong frozen values caught ≥ 80%** — 10 of 12 or more, exact count. Caught means flagged or corrected at freeze, or (for a value inside the 1e-9 relative floor) the frozen test then accepts the true value; each catch is reported with its mechanism.

Secondary, each reported met or missed on its own:
1. **False flags ≤ 2%** of the 8,475 correct offline tests, exact count; and separately on the correct tests of fresh `base` specifications.
2. **Zero verdict regressions** on the 177 pristine kernels, exact: a kernel promoted with its own tests must promote with the oracle-frozen tests, and a flagged test on a pristine specification counts as a regression.
3. **≤ 5 ms added per need at freeze**: p95 of the oracle's own time per specification over the 587 offline specifications, on a quiet machine (CPU PSI some avg10 < 5, load ≤ 16), and the in-situ p95 from the `oracle` arm (which includes `reference.js`). Loaded timings are labelled and are not acceptance figures.
4. **≥ 50% fewer failed candidates per promoted candidate**, `oracle` against `base` on the re-run: point estimate of the ratio ≤ 0.5, with a paired bootstrap 95% interval (10,000 resamples over need-rep slots, seed 69). **Exploratory, not confirmatory:** failed candidates come in lumps of about six from a few failed runs (P-66: 6 of 208 `sonnet-low` runs failed), so with 56 pairs the minimum detectable effect at 80% power is a reduction of roughly 85–90%, larger than the 50% bar. Single-row noise of 10–15% would need about 16 rows per arm for a 10% bar; this is not that kind of metric, and the count of failed runs is what limits it.
5. Held-out catch rate on fresh `base` specifications (offline mode, formula and ranges only), labelled by the H references and, for R needs, by the agreement of at least two promoted sibling kernels from either arm: reported; it counts as a bar (≥ 80%) only if at least 5 wrong values occur, otherwise exploratory.

**Model-call budget: ≤ 300**, `claude -p` through the warm transport on the default subscription login (`CLAUDE_CONFIG_DIR` set to the default `~/.claude`), `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` unset (the runner checks), `claude auth status` before the run and before every wave. No API keys or billing.

## Predictions

1. Offline: 12 of 12 caught (10 by the formula, 1 by ranges, 1 by the tolerance floor); 16 false flags (0.19%). These are the in-sample dev figures and are stated so a later change shows.
2. Pristine: 0 regressions; most specifications change only by added tolerances.
3. Offline freeze p95 under 2 ms; in-situ p95 under 5 ms including the `vm` context.
4. Re-run: `base` freezes 2–8 wrong values on these needs and loses 1–6 runs to them; `oracle` loses at most 1 run to a frozen value. Failed candidates per promoted: `oracle` ≤ 0.5 × `base` (point estimate), interval wide.
5. Rival: cuts `base`'s failed candidates per promoted by 30–60% but never raises promotions; `oracle` raises them.
6. In the `oracle` arm, at least 90% of corrections are true by the labels above (formula and `reference.js` agree with the H reference or sibling kernels).
7. Calls: 230–300.

## Decision rule

The oracle ships on by default (`agentLimits.oracle = true`) only if the primary bar and secondary bars 1–3 are met and bar 4's point estimate is ≤ 0.5. Any miss ships it behind the flag, off by default, and the miss is reported, not retuned. A bar missed by the in-sample offline figures but met on held-out data still counts as missed.

## What a miss means

- Primary missed: the parser can't read the contracts the model writes; the next step is the prompt's formula line, not more parsing.
- False flags over 2%: the oracle would cost spec turns on good specifications; keep it advisory.
- A pristine regression: tolerance or range handling changes verdicts on known-good work; off by default.
- Bar 4 missed with the primary met: wrong values were not what cost failed candidates in this sample, or the new prompt itself changed behaviour; the rival may then be the cheaper lever.

## Strongest rival and how it is discriminated

"Stop after two identical failures" saves most of the wasted turns more simply. It cannot repair a wrong value, so it saves calls but not promotions. Discriminated by promotions and failed candidates per promoted on the same paired runs: if the rival's ratio is close to the oracle's and promotions are equal, the simpler rule wins on cost.

## Stop conditions

The call budget (300), two transport errors in one wave, a failed auth check, or agent-guard blocking. Nothing is retried on another account.
