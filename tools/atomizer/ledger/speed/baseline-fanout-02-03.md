# Speed decomposition

Runs: 7 (C-005, C-007, C-010, C-015, CC-002, C-005, C-010). North star: wall per request. Every number is **Recorded (probe)** from atom receipts and the CLI's own timing fields; Codex attempts carry no internal timings and appear as one bucket.

## North star

| Request | Wall (s) | Atoms | Realized critical chain |
|---|---|---|---|
| C-005 | 69.3 | 15 | iface:interface → t-charge:tests → compose-draft:compose-draft → repair:repair → compose:compose → r-safety:review |
| C-007 | 56.9 | 13 | contract:contract → glue:glue → compose-draft:compose-draft → repair:repair → compose:compose → rev-safe:review |
| C-010 | 134.5 | 16 | iface:interface → contract:contract → t-count:tests → compose-draft:compose-draft → repair:repair → compose:compose → r-demo:review |
| C-015 | 61.8 | 14 | contract:contract → glue-decision:glue → compose-draft:compose-draft → repair:repair → compose:compose → review-tech:review |
| CC-002 | 64.5 | 11 | contract:contract → tests-dewpoint:tests → compose-draft:compose-draft → repair:repair → compose:compose → review-psychro:review |
| C-005 | 91.5 | 15 | iface:interface → contract:contract → glue:glue → compose-draft:compose-draft → repair:repair → compose:compose → rev-safety:review |
| C-010 | 86.3 | 15 | iface:interface → glue:glue → compose-draft:compose-draft → repair:repair → compose:compose → rv-readability:review |

Median wall 69.3 s; max 134.5 s.

## Where the wall goes (critical-chain time summed over runs)

Only time on the critical chain moves wall. Off-chain work is free until it becomes the chain.

| Bucket | Seconds | Share |
|---|---|---|
| modelApi | 427.7 | 76 % |
| harness | 53.1 | 9 % |
| queue | 50.7 | 9 % |
| tool | 21.9 | 4 % |
| codexTurn | 11.2 | 2 % |
| gap | 0.1 | 0 % |

## On-chain time by atom kind

| Kind | Times on chain | Wall (s) | model API | local tools | harness | codex | script | retry | queue |
|---|---|---|---|---|---|---|---|---|---|
| review | 7 | 128.5 | 109.8 | 0.5 | 7.0 | 11.2 | 0.0 | 0.0 | 0.1 |
| tests | 3 | 76.8 | 73.8 | 0.3 | 2.8 | 0.0 | 0.0 | 0.0 | 10.6 |
| repair | 7 | 72.9 | 58.2 | 6.6 | 8.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| contract | 5 | 56.2 | 49.7 | 0.2 | 6.2 | 0.0 | 0.0 | 0.0 | 0.0 |
| glue | 4 | 48.8 | 43.3 | 0.2 | 5.2 | 0.0 | 0.0 | 0.0 | 40.0 |
| compose | 7 | 44.1 | 28.0 | 7.4 | 8.6 | 0.0 | 0.0 | 0.0 | 0.0 |
| compose-draft | 7 | 43.9 | 28.3 | 6.3 | 9.3 | 0.0 | 0.0 | 0.0 | 0.0 |
| interface | 4 | 42.9 | 36.6 | 0.3 | 6.0 | 0.0 | 0.0 | 0.0 | 0.0 |

## Atom wall by kind and worker (all atoms, on or off chain)

| Kind | Worker | n | p50 (s) | p95 (s) | max (s) | turns p50 | API share |
|---|---|---|---|---|---|---|---|
| tests | sonnet | 14 | 20.4 | 33.2 | 33.5 | 1 | 93 % |
| review | opus | 5 | 18.8 | 26.3 | 26.3 | 1 | 94 % |
| tests | sonnet+tools | 1 | 18.3 | 18.3 | 18.3 | 6 | 94 % |
| review | sonnet | 8 | 13.4 | 16.3 | 16.3 | 1 | 89 % |
| review | codex | 7 | 12.6 | 16.9 | 16.9 | 0 | — |
| kernel | sonnet+tools | 17 | 12.3 | 14.3 | 15.5 | 4 | 78 % |
| contract | sonnet | 7 | 10.0 | 14.0 | 14.0 | 1 | 87 % |
| glue | sonnet | 11 | 9.7 | 17.6 | 17.6 | 1 | 88 % |
| interface | sonnet | 7 | 7.7 | 13.7 | 13.7 | 1 | 82 % |
| data | sonnet | 1 | 6.5 | 6.5 | 6.5 | 1 | 81 % |
| repair | sonnet+tools | 7 | 6.4 | 28.4 | 28.4 | 3 | 80 % |
| compose | sonnet+tools | 7 | 6.1 | 7.5 | 7.5 | 2 | 64 % |
| compose-draft | sonnet+tools | 7 | 5.9 | 8.7 | 8.7 | 2 | 64 % |

## Slowest atoms

| Run | Atom | Kind | Worker | Wall (s) | API (s) | tools (s) | harness (s) | turns | on chain |
|---|---|---|---|---|---|---|---|---|---|
| C-010 | t-count | tests | sonnet | 33.5 | 32.4 | 0.1 | 0.9 | 1 | yes |
| C-010 | t-date | tests | sonnet | 33.2 | 32.2 | 0.0 | 0.9 | 1 |  |
| C-010 | repair | repair | sonnet+tools | 28.4 | 21.8 | 5.4 | 1.2 | 4 | yes |
| C-005 | rev-safety | review | opus | 26.3 | 25.0 | 0.1 | 1.2 | 1 | yes |
| C-005 | t-charge | tests | sonnet | 25.1 | 24.2 | 0.0 | 0.9 | 1 | yes |
| C-005 | t-liq | tests | sonnet | 23.7 | 21.7 | 0.1 | 1.9 | 1 |  |
| C-010 | t-rel | tests | sonnet | 23.5 | 21.6 | 0.1 | 1.8 | 1 |  |
| C-005 | t-tot | tests | sonnet | 20.7 | 18.5 | 0.2 | 2.1 | 1 |  |
| C-005 | t-gas | tests | sonnet | 20.4 | 18.8 | 0.1 | 1.5 | 1 |  |
| C-010 | rv-readability | review | opus | 20.0 | 18.7 | 0.1 | 1.2 | 1 | yes |
| C-010 | t-calc | tests | sonnet | 19.5 | 17.8 | 0.1 | 1.7 | 1 |  |
| C-007 | rev-safe | review | opus | 18.8 | 17.9 | 0.0 | 0.9 | 1 | yes |
