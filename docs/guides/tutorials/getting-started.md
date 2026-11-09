# Getting started

In this tutorial you clone EndoForge, ask it for an integer addition kernel, and watch it get promoted. Then you give it
a wrong kernel and watch it get refused. It takes about five minutes.

The model in this tutorial is a script that replays fixed answers, so you need no model account and no network after
setup. Everything else is the real code: the freeze, the pinned compiler, the V8 isolate, gates G1 to G9 and the
ledger.

Every command below was run on a fresh clone on Linux with Node.js 26.13.0 and 22.23.3 and Python 3.

## 1. Install the prerequisites

You need:

- Git, GNU Make and Python 3.11 or later.
- Node.js 22.8 or later. CI runs Node 22 and Node 26.

The full test suite also needs bubblewrap (`bwrap`), `age` and `gcc`. This tutorial does not.

## 2. Clone and run the repository checks

```sh
git clone https://github.com/Akilleez-QA/endoforge.git
cd endoforge
make check
```

`make check` takes about a second. It checks Markdown links, the experiments index, source digests, experiment
numbers, privacy and requirement traceability. The last line reads `data dictionary current`.

## 3. Install the pinned compiler

The loop compiles AssemblyScript (a TypeScript-like language) to WebAssembly with a pinned compiler:

```sh
make loop-setup
```

This runs `npm ci` in `tools/asc` and needs network access once.

## 4. Look at the two example scripts

The repository ships the two scripts this tutorial runs.

[`examples/first-loop.mjs`](../../../examples/first-loop.mjs) sends the need `integer add(a,b)` through the loop and
prints the outcome. The scripted model comes from the test fixtures: in its first turn it writes the contract and
tests, and in its second turn the kernel. With the argument `wrong` it writes a kernel that subtracts instead.

```js
const need = 'integer add(a,b)';
const kernel = process.argv[2] === 'wrong' ? seeds[1] : good;
const { files } = candidate();
const script = modelFor(inputFor(files['CONTRACT.md'], files['tests.json'], kernel.kernel, kernel.glue));
const pool = createLoopPool({ provider: scriptedProvider(script) });
const directory = join(mkdtempSync(join(tmpdir(), 'ef-first-loop-')), 'addition');
try {
  const result = await runNeed({ need, directory, pool, env: { ENDOFORGE_LOOP: 'agent' } });
```

`runNeed` is the same entry point a real run uses. Only the provider differs: here it is `scriptedProvider`, in a real
run a model transport.

[`examples/show-gates.py`](../../../examples/show-gates.py) opens the ledger that run wrote, which also verifies its
hash chain, and prints each gate's result from the receipt and the final decision. If the kernel was promoted, it
also saves the WebAssembly module as `kernel.wasm` next to the ledger.

## 5. Promote a kernel

```sh
node examples/first-loop.mjs
```

It finishes in about three seconds. Your temporary path will differ:

```json
{
  "need": "integer add(a,b)",
  "promoted": true,
  "testDouble": true,
  "turns": 2,
  "rounds": [
    "passed"
  ],
  "ledger": "/tmp/ef-first-loop-rPp1e0/addition/ledger.sqlite"
}
```

Now look at the evidence, using the ledger path from your output:

```sh
python3 examples/show-gates.py /tmp/ef-first-loop-rPp1e0/addition/ledger.sqlite
```

```text
ledger records: task, admitted_input, frozen_evaluator, candidate, receipt
  G1_frozen         pass
  G2_compiles       pass  {"wasmBytes": 57}
  G3_exports        pass  {"exports": ["add"]}
  G4_tests          pass  {"passed": 1, "total": 1}
  G5_deterministic  pass
  G6_bounded        pass  {"maxMs": 0.000751, "fuelUsed": 5}
  G7_glue           pass
  G8_nonfinite      pass  {"probes": 0}
  G9_units          pass  {"checks": {"add": "dimensionless"}}
decision: promote
kernel: /tmp/ef-first-loop-rPp1e0/addition/kernel.wasm (57 bytes)
```

What happened:

1. `ENDOFORGE_LOOP=agent` chose the agent loop, where the model's whole turn loop runs inside one workcell. The
   [candidate loop](../../architecture/candidate-loop.md#three-loop-paths) page compares the three loop paths.
2. Turn 1: the scripted model wrote `CONTRACT.md` ("Integer addition on [-10,10].") and `tests.json` (`add(2,3)`
   must be 5). The host stored their hashes in the ledger. That is the `frozen_evaluator` record.
3. Turn 2: the model wrote `kernel.ts` and `glue.json`. The workcell compiled the kernel to a 57-byte WebAssembly
   module and ran gates G1 to G9.
4. Every gate passed, so the host wrote the candidate, its receipt and a `promote` decision in one transaction.
5. `testDouble: true` says a test double wrote the code. A scripted run shows the machinery works. It is not evidence
   about any real model.

The ledger is append-only: SQLite triggers refuse updates and deletes. The records are also hash-chained, each hash
covering the one before it, so if someone removes the triggers and edits a record, `Ledger(path).records()` fails with
`ledger chain failed at sequence N`. The [ledger ICD](../../interfaces/ledger-icd.md) describes each record kind.

The promoted kernel is an ordinary WebAssembly module. Call it from Node.js:

```sh
node -e 'const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1])); console.log(new WebAssembly.Instance(m).exports.add(2, 3))' /tmp/ef-first-loop-rPp1e0/addition/kernel.wasm
```

```text
5
```

## 6. Watch a wrong kernel get refused

Run the same script with `wrong`. The scripted model answers the same need with a kernel that subtracts:

```sh
node examples/first-loop.mjs wrong
```

```text
{
  "need": "integer add(a,b)",
  "promoted": false,
  "testDouble": true,
  "turns": 7,
  "rounds": [
    [
      "G4_tests"
    ],
    ...
  ],
  "ledger": "/tmp/ef-first-loop-uNMOBv/addition/ledger.sqlite"
}
```

```sh
python3 examples/show-gates.py /tmp/ef-first-loop-uNMOBv/addition/ledger.sqlite
```

```text
ledger records: task, admitted_input, frozen_evaluator, candidate, receipt
  G1_frozen         pass
  G2_compiles       pass  {"wasmBytes": 57}
  G3_exports        pass  {"exports": ["add"]}
  G4_tests          FAIL  {"passed": 0, "total": 1}
  G5_deterministic  pass
  G6_bounded        pass  {"maxMs": 0.001452, "fuelUsed": 5}
  G7_glue           pass
  G8_nonfinite      pass  {"probes": 0}
  G9_units          pass  {"checks": {"add": "dimensionless"}}
decision: refuse
```

The kernel compiled and ran, but `add(2,3)` returned -1, so `G4_tests` failed. Each failure went back to the model as
its next prompt. The script never fixes the kernel, so the loop stopped at the turn limit: one specification turn plus
six implementation turns (`limits.maxTurns`, default 6). The receipt was still written, and the decision is `refuse`.

## Next steps

- Run the full suite: [run local checks](../how-to/local-checks.md).
- Read how the loop works and what each gate checks: [candidate loop](../../architecture/candidate-loop.md).
- Look up a setting: [configuration reference](../../configuration/configuration-reference.md).
- Use a real model: the agent loop takes a provider such as `WarmClaudeTransport`. Real calls go through the
  subscription guard and the usage governor; see [runtime](../../../core/runtime/README.md#the-agent-loop-in-the-workcell).

The run leaves its ledger in a temporary directory (`ef-first-loop-*` under your system's temporary folder). Delete it
when you are done.
