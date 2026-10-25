# Atomization of C-007

Model sonnet; attempts 1; valid: true. Prompt sha256 0e4a65b4c97e4aa1…

Atoms 11; total work 16; critical path 7 (contract → tstatus → compose → rev-tech); speedup bound 2.29x; widest wave 5.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1); contract (contract, sonnet, w2/i1) |
| 1 | kstatus (kernel, sonnet+tools, w1/i1); kdev (kernel, sonnet+tools, w1/i1); tstatus (tests, sonnet, w2/i1); tdev (tests, sonnet, w2/i1); glue (glue, sonnet, w2/i1) |
| 2 | compose (compose, sonnet+tools, w2/i2) |
| 3 | rev-tech (review, sonnet, w1/i1); rev-eng (review, codex, w1/i1); rev-safe (review, opus, w1/i1) |

## Acceptance (from the need)

- A1: The module exports subcool_status and subcool_deviation_f, each taking one f64. [command]
- A2: A reading of 45 F is reported as above the assumed normal band (status 2) with deviation +33 F. [command]
- A3: Readings that are NaN, infinite, negative or above 100 F are refused with a trap. [command]
- A4: Readings inside the assumed band (8 to 12 F inclusive) give status 1 and deviation 0; below the band give status 0 and a negative deviation. [command]
- A5: CONTRACT.md records the assumption (reading is subcooling in F, normal band 8-12 F as for a TXV system, refrigerant and metering device unknown), one question, and the refused inputs. [command]
- A6: glue.json parses and carries the assumption, the question, units and trap messages. [command]
- A7: The answer a technician sees tells them 45 F is far above the usual band, without claiming a fault in their equipment, and asks the one question that resolves the open fact (metering device type, with refrigerant if needed). [oracle]
- A8: Gates G1-G7 pass on the composed artefact. [oracle]
