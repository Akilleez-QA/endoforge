# Atomization of C-005

Model sonnet; attempts 1; valid: true. Prompt sha256 bd713f6d2720e393…

Atoms 13; total work 18; critical path 8 (contract → k-charge → compose → r-tech); speedup bound 2.25x; widest wave 6.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1); contract (contract, sonnet, w2/i1); data (data, sonnet, w1/i1) |
| 1 | k-charge (kernel, sonnet+tools, w2/i1); k-pair (kernel, sonnet+tools, w1/i1); t-charge (tests, sonnet, w2/i1); t-traps (tests, sonnet, w1/i1); g-charge (glue, sonnet, w1/i1); g-pair (glue, sonnet, w1/i1) |
| 2 | compose (compose, sonnet+tools, w3/i2) |
| 3 | r-tech (review, sonnet, w1/i1); r-codex (review, codex, w1/i1); r-safety (review, opus, w1/i1) |

## Acceptance (from the need)

- A1: The composed kernel is a WASM module with no imports that exports liquidLineFillG, additionalChargeG and linePairValid. [command]
- A2: For the requested case (1 m, 1/4 in liquid line, assumed R410A) the liquid-line fill is between 17 and 21 g. [command]
- A3: A run within the unit's pre-charged length needs 0 g additional charge; beyond it the charge is the excess length times the per-metre fill. [command]
- A4: Negative, NaN, over-limit lengths and unknown size or refrigerant codes trap rather than return a number. [command]
- A5: The contract states the assumptions (1/4 in is the liquid line, 1/2 in is the gas line; refrigerant R410A; pre-charged length), asks exactly one question, and lists refused inputs. [oracle]
- A6: Gates G1-G7 all pass on the composed artefact. [command]
- A7: glue.json gives labels, units (g, m), precision, codes for sizes and refrigerants, the assumption, the question, and a message for every trap. [command]
