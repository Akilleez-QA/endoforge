# Atomization of C-010

Model sonnet; attempts 1; valid: true. Prompt sha256 241c3391fdee1d0a…

Atoms 13; total work 22; critical path 8 (contract → k-date → compose → rv-operator); speedup bound 2.75x; widest wave 7.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1); contract (contract, sonnet, w2/i1) |
| 1 | k-day (kernel, sonnet+tools, w1/i1); k-date (kernel, sonnet+tools, w2/i1); k-age (kernel, sonnet+tools, w2/i1); k-win (kernel, sonnet+tools, w2/i1); t-calc (tests, sonnet, w2/i1); t-rel (tests, sonnet, w2/i1); glue (glue, sonnet, w2/i1) |
| 2 | compose (compose, sonnet+tools, w3/i2) |
| 3 | rv-operator (review, sonnet, w1/i1); rv-auditor (review, codex, w1/i1); rv-readability (review, opus, w1/i1) |

## Acceptance (from the need)

- A1: The composed artefact is promotable: all gates G1-G7 pass. [command]
- A2: The kernel exports anchorDay, sampleDateMs, sampleAgeDays and sampleInWindow and has no imports. [command]
- A3: With the anchor fixed at the last millisecond before midnight UTC, sample dates and ages are the same as they are one millisecond later in wall-clock terms: dates and counts depend only on the anchor, never on a running clock; sample dates roll with the anchor day (a sample 3 days back from the anchor is exactly midnight UTC three days earlier, and its age is 3). [command]
- A4: No future sample dates are produced: a negative days-back is refused and the age of a sample dated after the anchor day is refused. [command]
- A5: glue.json records an assumption, one question, and a trap message for each refusal. [command]
- A6: CONTRACT.md states that the session anchor is supplied once by the caller and all dates derive from it, names the assumption taken (epoch ms UTC, whole UTC calendar days, no future dates), asks the one question that resolves the open fact, and lists the refused inputs. [oracle]
