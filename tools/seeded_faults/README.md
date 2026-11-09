# Seeded faults

`generate` makes known-wrong versions of a trusted function, so you can find out whether your checks catch them. You
give it a correct function (the anchor), some inputs and the places to break it; it returns each fault that really
changes the output, with one input that shows the difference. The [escape harness](../escape_harness/README.md) runs
these faults through an evaluator and counts how many get promoted.

## Why it exists

A check that passes good code says little; what matters is how often it lets bad code through. EndoForge treats the
rate at which seeded faults escape the checks as the measure of how much a promotion can be trusted. This generator
makes the faults: the same kinds of mistake a coding agent makes in real work.

| Family | Parameter | Effect |
|---|---|---|
| `swapped_units` | `other` | Swaps output unit labels without converting values |
| `dropped_rows` | `index` | Removes that output row when present |
| `off_by_one` | `delta` (-1 or 1) | Shifts an integer output |
| `reversed_inputs` | `other` | Swaps input operands before running the anchor |
| `stale_binding` | `stale` | Replaces an output binding with an explicit prior revision |

## How it works

`generate(known_good, anchor_id=..., inputs=..., faults=..., seed=...)` takes a trusted synchronous JSON-to-JSON
anchor with an identity you pin, a non-empty input list, and fault sites: closed JSON objects with a family and a path
of dictionary keys or array indices. It runs every candidate on every input. A fault whose output matches the anchor
on all inputs is filtered out as `equivalent_on_extended_set`, because a structurally valid swap can be a no-op.
Canonical JSON is the comparison: object key order is ignored; list order and number representation count.

The result carries the generator digest, seed, anchor identity, input and baseline digests, and per fault: an id, the
fault, and a witness (the distinguishing input with the expected and actual outputs), plus filtered faults and counts
per stratum. Empty sets, duplicates, invalid paths or types, non-finite outputs, exceptions and more than 100,000
executions abort the batch.

## Example

Run from the repository root:

```console
$ python3 -B -c "
from tools.seeded_faults.generator import generate
quote = lambda o: dict(total={'value': 500 + 2 * o['grams'], 'unit': 'cents'}, weight={'value': o['grams'], 'unit': 'g'}, lines=list(o['lines']))
b = generate(quote, anchor_id='quote-v1', inputs=[dict(grams=1000, lines=['box'])],
             faults=[dict(family='swapped_units', path=['total', 'unit'], other=['weight', 'unit'])], seed=7)
w = b['faults'][0]['witness']
print(b['strata'], w['expected']['total'], w['actual']['total'])"
{'S2': {'proposed': 1, 'emitted': 1, 'equivalent': 0, 'equivalent_fraction': 0.0}} {'unit': 'cents', 'value': 2500} {'unit': 'g', 'value': 2500}
```

The fault kept the value and swapped the unit label, the mistake a units check exists to catch.

## Limits

- These are semantic injections at named output fields, not source-code mutations; you choose where they go.
- A match on a finite input set is only `equivalent_on_extended_set`, not proof of equivalence.
- Callbacks are trusted: this is not a sandbox, it sets no timeout, and it does not check that the anchor was
  independently verified.

## Tests

`make seeded-fault-test` runs `test_generator.py` (9 tests).

Engineering record: component C-19, requirement REQ-FAULT-001.
