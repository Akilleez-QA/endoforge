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
tests are fixed before any code. `run` compiles `kernel.ts` with the core compiler's flags (`asc --runtime stub -O3
--noAssert --maximumMemory 1024`, plus `--textFile kernel.wat`), then runs the nine core gates on `CONTRACT.md`,
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
| `G7_glue` | `glue.json` matches the closed [glue.schema.json](glue.schema.json), its `id` is the folder name, and it describes exactly the module's exports, arities, buffer pointers, result codes and traps |
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
zones. In a new directory named `shipping`:

```console
$ cat CONTRACT.md
shippingCents(grams, zone): 500 cents base plus 2 cents per gram in zone 1, 4 cents per gram in zone 2.
Refuse negative weights and any other zone.
$ cat tests.json
[{"name":"1 kg, zone 1","fn":"shippingCents","args":[1000,1],"expect":2500},
 {"name":"1 kg, zone 2","fn":"shippingCents","args":[1000,2],"expect":4500},
 {"name":"zone 3 is refused","fn":"shippingCents","args":[1000,3],"expectError":true},
 {"name":"negative weight is refused","fn":"shippingCents","args":[-1,1],"expectError":true}]
$ node $REPO/tools/gate/gate.mjs freeze .
frozen contract 245471e52b7f389d… tests a00009a2a6ee74be…
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
  "G2_compiles": { "ok": true, "wasmBytes": 103, "wasmSha256": "1b6a1f43…" },
  "G3_exports": { "ok": true, "exports": [ "shippingCents" ] },
  "G4_tests": { "ok": true, "passed": 4, "total": 4 },
  "G6_bounded": { "ok": true, "maxMs": 0.108772, "fuelUsed": 104 },
  "G5_deterministic": { "ok": true },
  "G7_glue": { "ok": true },
  "G9_units": { "ok": true, "checks": { … } },
  "G8_nonfinite": { "ok": true, "probes": 0 }
 }
}
```

(The JSON is compacted here; the tool prints one key per line.) Change the zone 2 rate to 3 and `run` reports
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

Engineering record: component C-30, REQ-GATECLI-001.
