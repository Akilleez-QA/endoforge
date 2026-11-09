# Gate runner

`gate.mjs` checks one AssemblyScript kernel against a contract and tests that were frozen before the code existed. It
is a stand-alone command: point it at a directory, and it either says the kernel is promotable or names the first gate
that failed. The [atomizer](../atomizer/README.md)'s compose atoms use it to check the kernel they assemble.

A kernel here is the application-logic part of a candidate: a pure WebAssembly module plus `glue.json`, the
declarative description of its arguments, results and refusals.

## How it works

`freeze` hashes `CONTRACT.md` and `tests.json` into `frozen.sha256`, and refuses if `kernel.ts` already exists, so the
tests are fixed before any code. `run` then checks, in this order, stopping at the first gate that cannot continue:

| Gate | Passes when |
|---|---|
| `G1_frozen` | `CONTRACT.md` and `tests.json` still match `frozen.sha256` |
| `G2_compiles` | `kernel.ts` compiles with `asc --runtime stub -O3 --noAssert`, and the module imports nothing but `env.abort` |
| `G3_exports` | Every `fn` named in `tests.json` is exported |
| `G4_tests` | Each test's `expect` (number within `tol`, boolean or string) or `expectError` holds |
| `G6_bounded` | No call takes over 2000 ms |
| `G5_deterministic` | A second fresh instance, called in the same order, gives the same outputs |
| `G7_glue` | `glue.json` matches the closed [glue.schema.json](glue.schema.json), its `id` is the folder name, and it describes exactly the module's exports, arities, result codes and traps |

It writes `result.json` and prints the gate summary. It exits 0 only when every gate passes (`promotable: true`).

This is the older, smaller gate set. The candidate loop in [core/runtime](../../core/runtime/README.md) runs its own
gates G1 to G9 inside workcells (`core/runtime/x1/gates.mjs`), which add weak-test detection, a fuel meter, non-finite
probes and a units check. Use those for the loop; use this for a kernel directory on disk.

## Use it

```sh
node tools/gate/gate.mjs freeze <dir>
node tools/gate/gate.mjs run <dir>
```

With no arguments it prints `usage: gate.mjs freeze|run <dir>` and exits 2. It needs the pinned compiler: run
`make loop-setup` and point `ENDOFORGE_ASC` at `tools/asc/node_modules/.bin/asc`.

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
$ export ENDOFORGE_ASC=$REPO/tools/asc/node_modules/.bin/asc
$ node $REPO/tools/gate/gate.mjs run .
{
 "promotable": true,
 "gates": {
  "G1_frozen": { "ok": true },
  "G2_compiles": { "ok": true, "wasmBytes": 103, "wasmSha256": "1b6a1f43…" },
  "G3_exports": { "ok": true, "exports": [ "shippingCents" ] },
  "G4_tests": { "ok": true, "passed": 4, "total": 4 },
  "G6_bounded": { "ok": true, "maxMs": 0.045124 },
  "G5_deterministic": { "ok": true },
  "G7_glue": { "ok": true }
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

- `ENDOFORGE_ASC`: path to the `asc` compiler. Default `node_modules/.bin/asc` at the repository root, which `make
  loop-setup` does not create.

The atomizer finds this tool through `toolchain.gate` in [policy.json](../atomizer/policy.json).

## Limits

- No weak-test check: an empty `tests.json` frozen before the code passes G4. The in-loop G1 refuses tests that assert
  nothing or have a tolerance above 1% of the expected value.
- G6 measures wall time per call, not fuel; G5 repeats the same call order.
- No `make` target runs it (GAP-EF-003).

Engineering record: component C-30, GAP-EF-003.
