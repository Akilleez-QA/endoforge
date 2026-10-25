# Loop-1 design draft (v1, written before the deviation step; the precommit will supersede it)

What loop 1 intends to run, so that a critic can propose deviations against the real plan rather than the charter's sketch.

## The objective and the judge
Clean promotion on fresh real requests: a request is clean when the factory promotes it and the sealed three-oracle panel (Sonnet 5.5 technician frame, Opus 5.5 engineering-reviewer frame, Codex GPT-6.1 technician frame; each writes its own criteria blind from the raw request before any artefact exists) gives a median verdict of clean on the consumer sheet (request, what it does, rendered example calls, coordinator probe calls at the edges of every stated range and on NaN, assumption, question). Strict (all three clean) and lenient (none not-usable) rates are recorded too. Canaries C-006 v1, CC-011 and CC-009 must be caught by at least two of three oracles or the loop is void.

## The incumbent (all-old)
Factory v2 as run in loop 0, in single-shot metered form: one worker call (Opus 5.5, `--effort low`) writes contract, tests, kernel, glue and outcome in one response; the coordinator freezes contract and tests by hash, compiles, runs G1-G7 (gate.mjs byte-identical to loop 0), feeds failures back for up to three repair rounds (kernel and glue only); then a blind output persona stage (Sonnet, two personas from the requester role) decides promoted / promoted-pending-change / rejected. A third noise-floor arm runs the same at default effort.

## The challenger (all-new), four stage blocks
- S-new: stub (interface, assumption, question, consequence tier; Sonnet low) -> contract-stage persona (two personas; one fold-in revision of the stub before anything is built) -> blind evaluator (contract, properties, 6-14 tests including property instances and range traps; Sonnet) -> frozen.
- G-new: two blind candidates (Sonnet; request + stub + contract, tests withheld), compile and schema self-check (one fix each), G1-G7 per candidate, first passing selected; if none passes, one Opus escalation with the failing tests as feedback.
- Q-new: G1-G7 plus G8 (every range the glue states as a leading bound or interval is enforced by a trap).
- R-new: no output persona stage (promotion = gated); the review moved to contract time.
- Retrieval: fingerprint over the 19 loop-0 artefacts only; a hit's request, interface, assumption and kernel are shown to the stub and the generator.

## The design: S x G generated, Q x R filtered
Per working request four artefacts are generated: (S-old,G-old) = the incumbent run; (S-new,G-new); (S-new,G-old) = Opus-low sequential generator on the blind evaluator's spec; (S-old,G-new) = blind generator on the incumbent's contract with its tests withheld. Q (G8 on/off) and R (output persona on/off) are applied afterwards as filters, so all 16 corners are read from the 4 artefacts. The whole-stack contrast is all-new vs all-old, paired by request. Main effects of S and G come from 40-vs-40 artefacts paired by request; Q and R effects from the filters. Declared aliasing: in the all-old corner S and G share one context (as in loop 0); in every other corner they do not.

## Order and budget
Step 0 freeze (done: working/sealed split seed 20261018, canary packet, hashes). Step 1 deviation critic (Codex). Step 2 criteria for the 20 development and 20 working requests by all three oracles; audit of five sheets; canary dry-run 3/3 or stop. Step 3 noise floor: incumbent twice and incumbent-at-default-effort once on the 20 development requests, 60 runs interleaved, all scored. Step 4 budget decision. Step 5 the screen on the 20 working requests (80 artefacts). Step 6 scoring; five all-new promotions used end to end by a consumer agent; the 20 sealed requests run once under both manifests as the durability baseline. Step 7 analysis, decision, merge or record deviations, hand-off.

Measured on the smoke run (one request, CC-036, tokens all kinds): incumbent run 26k (worker 10.7k, one repair 9.5k, persona 5.9k); S-new 25.6k (stub 4.7k, contract persona 5.7k, stub revision 5.9k, evaluator 9.3k); G-new 30k (two candidates 9.7k each, escalation 10.8k); G-old on S-new 19.4k. Walls 35-64 s per stage with calls in parallel. Projected: step 3 about 1.9M, the screen about 2.9M, the sealed set about 1.8M, steps 1-2 about 0.5M: about 7.1M of the 8M target (hard stop 12M). The budget decision in step 4 uses the measured step-3 figure.

## What the critic should know is already decided
Subscription CLI only (no API key); the three honesty rules; gates G1-G7 byte-identical for every incumbent run; the sealed set untouched until the end; every brief versioned and hashed; forecasts written before results and Brier-scored.
