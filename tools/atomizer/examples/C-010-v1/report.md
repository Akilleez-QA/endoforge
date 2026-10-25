# Atomization of C-010

Model sonnet; attempts 1; valid: true. Prompt sha256 a72bcb06a316339d…

Atoms 14; total work 21; critical path 9 (iface → contract → k-sample → compose → r-tech); speedup bound 2.33x; widest wave 8.

| Wave | Atoms |
|---|---|
| 0 | iface (interface, sonnet, w1/i1) |
| 1 | contract (contract, sonnet, w2/i1) |
| 2 | k-day (kernel, sonnet+tools, w1/i1); k-sample (kernel, sonnet+tools, w2/i1); k-count (kernel, sonnet+tools, w2/i1); t-date (tests, sonnet, w2/i1); t-count (tests, sonnet, w2/i1); g-day (glue, sonnet, w1/i1); g-sample (glue, sonnet, w1/i1); g-count (glue, sonnet, w1/i1) |
| 3 | compose (compose, sonnet+tools, w3/i2) |
| 4 | r-tech (review, sonnet, w1/i1); r-demo (review, opus, w1/i1); r-codex (review, codex, w1/i1) |

## Acceptance (from the need)

- A1: The kernel exports dayStartMs, sampleDateMs, daysAgo and inWindow, and imports nothing. [command]
- A2: All four artefact files exist and tests.json and glue.json are valid JSON. [command]
- A3: Gates G1-G7 all pass on the composed artefact. [command]
- A4: Counts are stable across midnight UTC: with one anchor fixed, results of sampleDateMs, daysAgo and inWindow do not depend on any other clock reading. The kernel takes the anchor as an argument and never reads a clock. Tests cover an anchor at 23:59:59.999 UTC and a later 'now' just past midnight with the same anchor. [command]
- A5: Sample dates roll with the current day: for two anchors on different UTC days, the same (daysAgo, msIntoDay) arguments produce dates shifted by exactly the difference in days. [oracle]
- A6: CONTRACT.md states the assumption taken (UTC day boundary, sample dates never later than the anchor day, the host captures the anchor once per session and passes it in), the one question that resolves the open fact, and which inputs are refused. [oracle]
