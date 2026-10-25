# Atomization of CC-002

Model sonnet; attempts 1; valid: true. Prompt sha256 ad19751e1d1b9bf1…

Atoms 9; total work 13; critical path 7 (contract → kernel-dewpoint → compose → review-technician); speedup bound 1.86x; widest wave 3.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1); contract (contract, sonnet, w2/i1) |
| 1 | kernel-dewpoint (kernel, sonnet+tools, w2/i1); tests-dewpoint (tests, sonnet+tools, w2/i1); glue-dewpoint (glue, sonnet, w1/i1) |
| 2 | compose (compose, sonnet+tools, w2/i1) |
| 3 | review-technician (review, sonnet, w1/i1); review-psychro (review, codex, w1/i1); review-safety (review, sonnet, w1/i1) |

## Acceptance (from the need)

- A1: For 60 F dry-bulb and 60% RH the kernel returns a dew point of about 46 F (between 45.5 and 46.5), in Fahrenheit. [command]
- A2: At 100% RH the dew point equals the dry-bulb temperature (within 0.01 F), and at 50% RH it is below it. [command]
- A3: Inputs outside the stated domain (RH <= 0 or > 100, NaN or infinite values, temperature outside the validity range) trap instead of returning a number. [command]
- A4: CONTRACT.md states the formula assumption taken, the one question that resolves it, and the refused inputs. [command]
- A5: glue.json is valid JSON and carries the assumption and the question for the technician. [command]
- A6: A technician reading the interface and glue understands that the answer is a dew point in degrees Fahrenheit, taking the room temperature as dry-bulb air temperature, with the formula assumption openly stated. [oracle]
