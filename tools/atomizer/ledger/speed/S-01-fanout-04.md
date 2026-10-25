# Speed decomposition

Runs: 5 (C-005, C-007, C-010, C-015, CC-002). North star: wall per request. Every number is **Recorded (probe)** from atom receipts and the CLI's own timing fields; Codex attempts carry no internal timings and appear as one bucket.

## North star

| Request | Wall (s) | Atoms | Realized critical chain |
|---|---|---|---|
| C-005 | 87.4 | 15 | iface:interface → contract:contract → t-tot:tests → compose-draft:compose-draft → repair:repair → compose:compose → rev-safety:review |
| C-007 | 45.9 | 13 | contract:contract → glue:glue → compose-draft:compose-draft → repair:repair → compose:compose → rev-safe:review |
| C-010 | 91.7 | 15 | iface:interface → t-rel:tests → compose-draft:compose-draft → repair:repair → compose:compose → rv-readability:review |
| C-015 | 47.0 | 14 | contract:contract → glue-decision:glue → compose-draft:compose-draft → repair:repair → compose:compose → review-codex:review |
| CC-002 | 50.9 | 11 | contract:contract → tests-dewpoint:tests → compose-draft:compose-draft → repair:repair → compose:compose → review-psychro:review |

Median wall 50.9 s; max 91.7 s.

## Where the wall goes (critical-chain time summed over runs)

Only time on the critical chain moves wall. Off-chain work is free until it becomes the chain.

| Bucket | Seconds | Share |
|---|---|---|
| modelApi | 219.9 | 68 % |
| queue | 38.8 | 12 % |
| codexTurn | 31.2 | 10 % |
| harness | 21.4 | 7 % |
| script | 8.0 | 2 % |
| tool | 3.5 | 1 % |
| gap | 0.1 | 0 % |
| retry | 0.0 | 0 % |

## On-chain time by atom kind

| Kind | Times on chain | Wall (s) | model API | local tools | harness | codex | script | retry | queue |
|---|---|---|---|---|---|---|---|---|---|
| review | 5 | 111.3 | 75.9 | 0.2 | 4.0 | 31.2 | 0.0 | 0.0 | 0.0 |
| tests | 3 | 64.1 | 59.9 | 0.3 | 3.8 | 0.0 | 0.0 | 0.0 | 21.7 |
| contract | 4 | 45.2 | 38.4 | 0.4 | 6.4 | 0.0 | 0.0 | 0.0 | 0.0 |
| glue | 2 | 19.9 | 17.2 | 0.1 | 2.7 | 0.0 | 0.0 | 0.0 | 17.1 |
| interface | 2 | 18.8 | 15.2 | 0.1 | 3.4 | 0.0 | 0.0 | 0.0 | 0.0 |
| repair | 5 | 17.0 | 13.3 | 2.3 | 1.2 | 0.0 | 0.1 | 0.0 | 0.0 |
| compose | 5 | 4.2 | 0.0 | 0.0 | 0.0 | 0.0 | 4.2 | 0.0 | 0.0 |
| compose-draft | 5 | 3.7 | 0.0 | 0.0 | 0.0 | 0.0 | 3.7 | 0.0 | 0.0 |

## Atom wall by kind and worker (all atoms, on or off chain)

| Kind | Worker | n | p50 (s) | p95 (s) | max (s) | turns p50 | API share |
|---|---|---|---|---|---|---|---|
| review | opus | 3 | 28.2 | 31.8 | 31.8 | 1 | 95 % |
| tests | sonnet | 10 | 20.6 | 23.7 | 23.7 | 1 | 91 % |
| tests | sonnet+tools | 1 | 19.3 | 19.3 | 19.3 | 5 | 92 % |
| review | codex | 5 | 15.2 | 18.4 | 18.4 | 0 | — |
| review | sonnet | 6 | 13.6 | 14.8 | 14.8 | 1 | 87 % |
| kernel | sonnet+tools | 12 | 10.8 | 12.4 | 14.0 | 4 | 80 % |
| glue | sonnet | 6 | 10.3 | 12.3 | 12.3 | 1 | 86 % |
| contract | sonnet | 5 | 9.7 | 15.1 | 15.1 | 1 | 84 % |
| interface | sonnet | 5 | 6.5 | 11.2 | 11.2 | 1 | 73 % |
| compose | sonnet+tools | 5 | 0.8 | 1.0 | 1.0 | 0 | 0 % |
| compose-draft | sonnet+tools | 5 | 0.7 | 0.8 | 0.8 | 0 | 0 % |
| repair | sonnet+tools | 5 | 0.0 | 16.9 | 16.9 | 0 | 78 % |

## Slowest atoms

| Run | Atom | Kind | Worker | Wall (s) | API (s) | tools (s) | harness (s) | turns | on chain |
|---|---|---|---|---|---|---|---|---|---|
| C-005 | rev-safety | review | opus | 31.8 | 30.5 | 0.0 | 1.2 | 1 | yes |
| C-010 | rv-readability | review | opus | 28.2 | 26.5 | 0.1 | 1.6 | 1 | yes |
| C-010 | t-rel | tests | sonnet | 23.7 | 22.3 | 0.1 | 1.3 | 1 | yes |
| C-005 | t-liq | tests | sonnet | 22.0 | 20.6 | 0.1 | 1.3 | 1 |  |
| C-005 | t-tot | tests | sonnet | 21.0 | 19.7 | 0.0 | 1.3 | 1 | yes |
| C-005 | t-gas | tests | sonnet | 20.8 | 19.7 | 0.0 | 1.0 | 1 |  |
| C-010 | t-calc | tests | sonnet | 20.6 | 19.4 | 0.0 | 1.2 | 1 |  |
| C-007 | rev-safe | review | opus | 20.1 | 18.9 | 0.0 | 1.2 | 1 | yes |
| CC-002 | tests-dewpoint | tests | sonnet+tools | 19.3 | 17.8 | 0.2 | 1.3 | 5 | yes |
| C-010 | rv-auditor | review | codex | 18.4 | 0.0 | 0.0 | 0.0 | — |  |
| C-010 | repair | repair | sonnet+tools | 16.9 | 13.3 | 2.3 | 1.2 | 3 | yes |
| C-015 | review-codex | review | codex | 16.3 | 0.0 | 0.0 | 0.0 | — | yes |
