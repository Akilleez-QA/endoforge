# Escape-rate harness

The escape harness measures how much to trust an evaluator. It feeds known-wrong candidates (from
[seeded_faults](../seeded_faults/README.md)) through your evaluator and counts how many it promotes. That ratio,
seeded faults promoted over seeded faults submitted, is the escape rate: the number EndoForge uses to say how far a
promotion can be trusted, instead of trusting whichever model wrote the code.

## How it works

- `seeded(known_good, domain=..., task=..., anchor_id=..., inputs=..., faults=..., seed=...)` calls the generator and
  tags each fault with its domain, task and the generator's provenance, keeping the distinguishing witnesses.
- `run(candidates, evaluate, current_digest, frozen_digest=..., checks=[...], lane="interim" or "kernel",
  candidate_format=..., seed=...)` submits the candidates in a seeded random order. `evaluate` gets a copy of each
  candidate and returns `results` as `[{check, passed}, ...]` in the configured check order, plus an explicit boolean
  `promoted`. A rejection may stop at the first failing check; a promotion needs every check to pass, and passing
  checks alone do not imply promotion. Malformed evidence, a promotion without complete passing checks, and an unknown
  outcome abort the run; none counts as a catch.
- `current_digest()` must hash the whole evaluator bundle and match the precommitted `frozen_digest` before and after
  every callback and at the end, so the evaluator cannot change mid-run.
- For searched (optimizing) runs, add `propose(generation, width, feedback)`, `oracle(candidate)`, a width of 1, 4 or
  16 and a positive number of rounds. Feedback holds only the candidate, the check results and the promotion; oracle
  labels never reach it, and candidates the oracle calls correct stay out of the fault count.

The report is kept per domain and per stratum: fault count, escapes, which check caught each fault first, and
binomial bounds from `stats.py`.

## Example

Saved as `escape_demo.py` in the repository root:

```python
import hashlib, json
from tools.seeded_faults.generator import run_candidate
from tools.escape_harness.harness import run, seeded

def quote(order):
    return dict(total={"value": 500 + 2 * order["grams"], "unit": "cents"},
                weight={"value": order["grams"], "unit": "g"}, lines=list(order["lines"]))

inputs = [dict(grams=1000, lines=["box"]), dict(grams=250, lines=["box", "card"])]
faults = [dict(family="swapped_units", path=["total", "unit"], other=["weight", "unit"]),
          dict(family="dropped_rows", path=["lines"], index=0),
          dict(family="off_by_one", path=["weight", "value"], delta=1)]
candidates = seeded(quote, domain="shop", task="quote", anchor_id="quote-v1", inputs=inputs, faults=faults, seed=7)

def evaluate(candidate):
    out = run_candidate(quote, candidate["fault"], inputs[1])
    units = out["total"]["unit"] == "cents" and out["weight"]["unit"] == "g"
    if not units:
        return dict(results=[dict(check="units", passed=False)], promoted=False)
    lines = len(out["lines"]) == 2
    return dict(results=[dict(check="units", passed=True), dict(check="lines", passed=lines)], promoted=lines)

evaluator = hashlib.sha256(b"units+lines v1").hexdigest()
report = run(candidates, evaluate, lambda: evaluator, frozen_digest=evaluator, checks=["units", "lines"],
             lane="interim", candidate_format="python-json", seed=7)
shop = report["domains"]["shop"]
print(json.dumps({k: shop[k] for k in ("n", "escapes", "caught_by")}))
print([r["candidate"]["fault"]["family"] for r in report["receipts"] if r["promoted"]])
```

```console
$ python3 -B escape_demo.py
{"n": 3, "escapes": 1, "caught_by": {"lines": 1, "units": 1}}
['off_by_one']
```

The evaluator checks units and line count but never the weight, so the off-by-one weight escaped: one in three. Adding
a check that the weight matches the order is how the rate comes down.

## Limits

- Execution is serial and refuses more than 100,000 submissions.
- Callbacks are trusted and must terminate and bound their own resources. This is not a sandbox.
- The bounds in `stats.py` are binomial diagnostics, not evidence that checks are independent, and no campaign rate or
  autonomy tier is claimed.
- The escape-rate measurement of the real gate path, [P-51](../../experiments/P-51-escape-rate/PRECOMMIT.md), used its
  own scripts rather than this harness.

## Tests

`make escape-test` runs `test_harness.py` (11 tests). They replay `experiments/P-03-escape-rate-method/receipt/`, which
holds only the two files they read.

Engineering record: component C-19, requirement REQ-ESCAPE-001.
