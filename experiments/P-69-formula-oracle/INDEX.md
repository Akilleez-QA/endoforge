| Probe | Question | Result |
|---|---|---|
| [P-69](PRECOMMIT.md) | Frozen expectations computed from the contract's formula, ranges and a model-written `reference.js` before implementation (`core/runtime/x1/oracle.mjs`): 12 of 12 known wrong frozen values caught (in-sample), 0.19% false flags, failed candidates per promoted 0.22 to 0.04 in 56 paired runs (ratio 0.16, interval 0–0.65) against 0.07 for stop-after-two-identical-failures; missed zero pristine regressions (3 of 177 flagged) and the held-out catch bar, so it ships behind `limits.oracle`, off by default | [RESULT.md](RESULT.md) |
