# Gate runner

`gate.mjs` checks one AssemblyScript kernel against a contract and tests that were frozen before the code existed. It
is a stand-alone command: point it at a directory, and it either says the kernel is promotable or names the first gate
that failed. It compiles `kernel.ts` and hands the directory to the candidate loop's gates (`runGates` in
[core/runtime/x1/gates.mjs](../../core/runtime/x1/gates.mjs)), so a kernel on disk is judged exactly as the loop
judges it, structured state included. The [atomizer](../atomizer/README.md)'s compose atoms use it to check the kernel
they assemble.

A kernel here is the application-logic part of a candidate: a pure WebAssembly module plus `glue.json`, the
declarative description of its arguments, results and refusals.

## How it works

`freeze` hashes `CONTRACT.md` and `tests.json` into `frozen.sha256`, and refuses if `kernel.ts` already exists, so the
tests are fixed before any code. It also refuses, with exit 2 and no `frozen.sha256`, a `CONTRACT.md` whose
```capability block is missing, is not JSON, has no exports, leaves out the layout of a record, list or text value,
or disagrees with the tests (for example, an export with an `expectError` test that the block does not list under
`traps`). This is the check the loop's own freeze runs
(`capabilityProblems` in [core/runtime/x1/generator.mjs](../../core/runtime/x1/generator.mjs)).

`run` compiles `kernel.ts` with the core compiler's flags (`asc --runtime stub -O3 --noAssert --maximumMemory 1024`,
plus `--textFile kernel.wat`), then runs the nine core gates on `CONTRACT.md`,
`tests.json`, `frozen.sha256`, `kernel.ts`, `glue.json` and the compiled module, stopping at the first gate that cannot
continue:

| Gate | Passes when |
|---|---|
| `G1_frozen` | `CONTRACT.md` and `tests.json` still match `frozen.sha256`, and every test asserts something (no empty `tests.json`, no `tol` above 1% of the expected value) |
| `G2_compiles` | `kernel.ts` compiles, and the module imports nothing but `env.abort` |
| `G3_exports` | Every `fn` named in `tests.json` is exported |
| `G4_tests` | Each test's `expect` (numbers within `tol`, booleans, strings, and records and lists compared field by field) or `expectError` (a trap) holds |
| `G6_bounded` | No call runs out of fuel or stack |
| `G5_deterministic` | A second fresh instance, called in the same order, gives the same outputs |
| `G7_glue` | `glue.json` matches the closed [glue.schema.json](glue.schema.json), its `id` is the folder name, and it describes exactly the module's exports, arities, buffer pointers, result codes and traps; `CONTRACT.md` ends with a ```capability block, and the glue agrees with it on exports, argument kinds, units, ranges and codes, result precision and traps, and on the nested layout of record, list and text values, which the block must declare |
| `G9_units` | Units in the glue agree with the kernel and the test outputs |
| `G8_nonfinite` | Non-finite probes of number arguments and number fields give what the contract says |

It writes `result.json` and prints the gate summary. It exits 0 only when every gate passes (`promotable: true`).

[glue.schema.json](glue.schema.json) is the core schema ([core/runtime/x1/glue.schema.json](../../core/runtime/x1/glue.schema.json)),
so glue can declare `record`, `list` and `text` values with `fields`, `items`, `max` and `maxBytes`. A structured
argument or result is passed through linear memory in the declared layout
([structured state](../../docs/architecture/gates.md#structured-state)): the gate writes the input state, passes one
pointer per structured argument and one for a structured result, refuses a kernel that writes into its input, and
decodes the output state for comparison. A to-do reducer `reduce(state, event)` over a record holding a list of items
gates here as it does in the loop.

The loop runs the same gates inside workcells on candidate files held in memory; use this for a kernel directory on
disk.

## Use it

```sh
node tools/gate/gate.mjs freeze <dir>
node tools/gate/gate.mjs run <dir>
```

With no arguments it prints `usage: gate.mjs freeze|run <dir>` and exits 2. It compiles with the pinned compiler that
`make loop-setup` installs under `tools/asc` (`ASC_PATH` in [pin.mjs](../asc/pin.mjs)); `ENDOFORGE_ASC` overrides it.

## Example

A shipping-price kernel: 500 cents plus 2 cents a gram in zone 1 or 4 in zone 2, refusing negative weights and other
zones. The contract ends with its capability block, the same exports, kinds, units, codes and traps that `glue.json`
declares later. In a new directory named `shipping`:

````console
$ cat CONTRACT.md
shippingCents(grams, zone): 500 cents base plus 2 cents per gram in zone 1, 4 cents per gram in zone 2.
Refuse negative weights and any other zone.

```capability
{"exports":[{"name":"shippingCents","args":[{"name":"grams","kind":"integer","unit":"g"},{"name":"zone","kind":"code","unit":"code","codes":{"1":"domestic","2":"international"}}],"result":{"kind":"integer","unit":"cents"}}],"traps":["shippingCents"]}
```
$ cat tests.json
[{"name":"1 kg, zone 1","fn":"shippingCents","args":[1000,1],"expect":2500},
 {"name":"1 kg, zone 2","fn":"shippingCents","args":[1000,2],"expect":4500},
 {"name":"zone 3 is refused","fn":"shippingCents","args":[1000,3],"expectError":true},
 {"name":"negative weight is refused","fn":"shippingCents","args":[-1,1],"expectError":true}]
$ node $REPO/tools/gate/gate.mjs freeze .
frozen contract 64578df5af7b45a5… tests a00009a2a6ee74be…
$ cat kernel.ts
export function shippingCents(grams: i32, zone: i32): i32 {
  if (grams < 0 || (zone != 1 && zone != 2)) unreachable();
  return 500 + grams * (zone == 1 ? 2 : 4);
}
$ cat glue.json
{"id":"shipping","assumption":"Weights are whole grams and only zones 1 and 2 ship.","question":"Do any parcels ship outside zones 1 and 2?",
 "exports":[{"name":"shippingCents","label":"Shipping price for one parcel","headline":true,
   "args":[{"name":"grams","kind":"integer","unit":"g"},{"name":"zone","kind":"code","unit":"code","codes":{"1":"domestic","2":"international"}}],
   "result":{"kind":"integer","unit":"cents"}}],
 "traps":[{"fn":"shippingCents","when":"negative weight or unknown zone","message":"Give a weight of 0 g or more and zone 1 or 2."}]}
$ node $REPO/tools/gate/gate.mjs run .
{
 "promotable": true,
 "gates": {
  "G1_frozen": { "ok": true },
  "G2_compiles": { "ok": true, "wasmBytes": 105, "wasmSha256": "c4179aa0…" },
  "G3_exports": { "ok": true, "exports": [ "shippingCents" ] },
  "G4_tests": { "ok": true, "passed": 4, "total": 4 },
  "G6_bounded": { "ok": true, "maxMs": 0.073349, "fuelUsed": 116 },
  "G5_deterministic": { "ok": true },
  "G7_glue": { "ok": true },
  "G9_units": { "ok": true, "checks": { "shippingCents": "unknown" } },
  "G8_nonfinite": { "ok": true, "probes": 0 }
 }
}
````

(The JSON is compacted here; the tool prints one key per line.) In a fresh directory holding the same `tests.json` and
only the first two lines of `CONTRACT.md` (no capability block), `freeze` refuses before any code exists, and it
refuses a block that is not JSON too:

````console
$ node $REPO/tools/gate/gate.mjs freeze .
refusing to freeze: CONTRACT.md has no ```capability block
$ echo $?
2
$ printf 'shippingCents(grams, zone): ...\n\n```capability\n{ exports: shippingCents }\n```\n' > CONTRACT.md
$ node $REPO/tools/gate/gate.mjs freeze .
refusing to freeze: the ```capability block is not JSON
````

A record, list or text value must declare its layout in the block, at every depth: a record's `fields` (uniquely
named, each with its kind, a unit when integer, number or code, and codes when code), a list's `items` and `max` (1 to
4096), a text value's `maxBytes` (1 to 65536). A mean-temperature contract whose argument is a list of readings, with
the list's layout left out:

````console
$ cat CONTRACT.md
meanTemperature(log): the mean temperature of up to 8 readings, to 1 decimal place. Refuse an empty log.

```capability
{"exports":[{"name":"meanTemperature","args":[{"name":"log","kind":"list"}],"result":{"kind":"number","unit":"C","precision":1}}],"traps":["meanTemperature"]}
```
$ cat tests.json
[{"name":"two readings","fn":"meanTemperature","args":[[{"temperature":2.0},{"temperature":4.0}]],"expect":3.0,"tol":0.01},{"name":"empty log is refused","fn":"meanTemperature","args":[[]],"expectError":true}]
$ node $REPO/tools/gate/gate.mjs freeze .
refusing to freeze: capability export meanTemperature argument log of kind list needs max, an integer from 1 to 4096; capability export meanTemperature argument log of kind list needs items, the layout of one item
````

With the argument declared as
`{"name":"log","kind":"list","max":8,"items":{"kind":"record","fields":[{"name":"temperature","kind":"number","unit":"C"}]}}`
the same `freeze` writes `frozen.sha256`. G7 later refuses a `glue.json` whose nested layout differs from the block's.

Change the zone 2 rate to 3 and `run` reports
`"G4_tests": { "ok": false, "passed": 3, "total": 4 }` and `promotable: false`. Edit `tests.json` to make the tests
pass instead, and it stops at the first gate:

```console
$ echo '[]' > tests.json
$ node $REPO/tools/gate/gate.mjs run .
{
 "promotable": false,
 "gates": {
  "G1_frozen": {
   "ok": false,
   "why": "tests.json changed after freeze"
  }
 }
}
```

## Environment

- `ENDOFORGE_ASC`: path to an executable `asc` compiler. Unset, the gate runs the pinned AssemblyScript 0.28.20
  (`tools/asc/pin.mjs` `ASC_PATH`) with the current Node.js; run `make loop-setup` first.

The atomizer finds this tool through `toolchain.gate` in [policy.json](../atomizer/policy.json).

## Limits

- G5 repeats the same call order.
- `glue.schema.json` is a copy of the core schema, kept because the atomizer puts it in worker prompts;
  [test_gate_structured.mjs](../test_gate_structured.mjs) fails if the two differ.
- That test runs the CLI end to end. When the pinned `asc` is not installed it uses a fixture compiler that returns
  prebuilt modules for its kernels. `make gate-test`, part of `make test`, runs it.

Engineering record: component C-30, REQ-GATECLI-001 (the capability check at `freeze` closed GAP-EF-015 in round 7).
