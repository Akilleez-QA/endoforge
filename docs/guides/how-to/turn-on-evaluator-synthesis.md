# Turn on evaluator synthesis

The agent that writes the code also writes the contract and the tests it is judged by. Its tests can be wrong or
thin, and a kernel that passes thin tests can still be wrong. Evaluator synthesis adds a second evaluator, written by
separate model calls that never see the code or the frozen tests, and frozen before any code exists. A kernel is
promoted only if it passes both.

It is off by default. With `ENDOFORGE_SYNTH=1` it runs on every loop path (`ENDOFORGE_LOOP` unset, `isolate` or
`agent`).

## How it works

Two model stages, each blind to the candidate:

1. **From the need alone**, as soon as the need arrives and in parallel with the specification: a sheet of what must
   be checked (quantities, signs, monotone relations, named invariants).
2. **From the frozen contract**, after the freeze: a binding (each export's parameters, ranges, units and result) and a
   plain JavaScript reference implementation.

EndoForge then compiles each binding into checks without a model and qualifies them: the binding has the right shape,
the reference gives the same answers twice, agrees with the frozen tests, is consistent with itself, and tells
mutants of itself apart. It generates input vectors from the declared ranges, and for a record, list or text
parameter from its declared layout, the frozen tests' values and the reference's own results, and writes the qualified checks to
`synth/evaluator.json`, whose hash is fixed in the ledger freeze before code. After the gates run, the candidate runs
those vectors under the fuel meter and is compared with the reference: on the current path in a separate worker
thread, on the `isolate` and `agent` paths in the same kind of thread at commit, by default with its own memory limits
and a 30 s deadline (`runNeed({ synthCell })` changes them on every path). A refusal blocks
promotion; on the current and `isolate` paths the verdict is written to `<directory>/synthesis.json`.

With `ENDOFORGE_SYNTH_WIDTH=2`, two independent members are written, and only the checks both agree on are kept. When
both references agree with each other against a frozen test, that test is reported as suspect before the
implementation turn, in `synth/suspect.json` and in the evaluator's `suspects`. The ledger then freezes a corrected
`tests.json` as a revision, and the implementation turn on every path reads the corrected file. Where the contract
returns a record, list or text, the binding declares its layout and the references return plain values, so a
structured test can be corrected too, and structured vectors are kept at width 2 only where both references give the
same whole value.

## Turn it on

```sh
ENDOFORGE_SYNTH=1 ENDOFORGE_SYNTH_MODEL=sonnet ENDOFORGE_SYNTH_CONFIG_DIR=~/.claude node your-runner.mjs
```

| Variable | Default | What it does |
|---|---|---|
| `ENDOFORGE_SYNTH` | off | `1` turns synthesis on. |
| `ENDOFORGE_SYNTH_MODEL` | `sonnet` | Model for the default provider, a `SpawnClaudeTransport`. |
| `ENDOFORGE_SYNTH_CONFIG_DIR` | unset (`~/.claude`) | Claude login directory. Model calls pass the subscription guard. |
| `ENDOFORGE_SYNTH_WIDTH` | `1` | `2` writes two independent members and keeps what both agree on. |
| `ENDOFORGE_SYNTH_PROVIDER` | unset | A module that exports `createProvider(env)`, used instead of the Claude transport. |

From code, pass `synthProvider` to `runNeed` to supply the provider directly. A `confirm(text, evaluator)` callback
shows a person the plain-language summary of what will be checked; without one the evaluator is approved by the task
contract. An unapproved evaluator abstains, and an abstention does not block promotion.

## Try it

[`examples/evaluator-synthesis.mjs`](../../../examples/evaluator-synthesis.mjs) runs the current path twice with
`ENDOFORGE_SYNTH=1`, a scripted synthesis provider that writes the reference `a + b`, and the `fake-codex.mjs` test
double as the generator. The frozen test is only `add(2,3) = 5`. The first kernel is correct; the second adds 1 when
`a > 5`, which that test cannot see:

```sh
node examples/evaluator-synthesis.mjs
```

```text
{"kernel":"correct","promoted":true,"frozenVectors":75,"synthesis":"pass","firstFailure":null}
{"kernel":"wrong-above-5","promoted":false,"frozenVectors":75,"synthesis":"refuse","firstFailure":"value.reference: add([10,3]) gives 14, expected 13"}
```

Both kernels passed gates G1 to G9. The synthesized evaluator caught the second one on a generated input.

## What it measured

[P-56 evaluator synthesis](../../../experiments/P-56-evaluator-synthesis/RESULT.md) ran the same tree with
synthesis off and on (width 2): sampled escapes fell from 280 to 105 of 7,883, rounding escapes from 107 to 12, and
glue escapes from 312 to 184 of 799, with all 177 correct kernels still promoted. The glue part of its bar (at most
156) was not met, which is one reason it stays off by default. The [evaluator synthesis](../../architecture/evaluator-synthesis.md)
page describes the design.
