# The gates

A candidate is promoted only when nine deterministic gates pass for its exact bytes, under an evaluator that was frozen
before any code existed. The gates are ordinary code ([gates.mjs](../../core/runtime/x1/gates.mjs) `runGates`), they
never call a model, and the model that wrote the candidate cannot change them. This page lists what each gate checks,
in the order the code runs them, and then how the ledger turns gate results into a decision
([tools/x1_loop.py](../../tools/x1_loop.py) `decide`).

The gates check the kernel candidate form: a WebAssembly module compiled from `kernel.ts`, plus `glue.json`, the
declarative description of its exports, plus the frozen `CONTRACT.md` and `tests.json` it is judged against. How a
candidate gets there is in [the candidate loop](candidate-loop.md).

## One run, end to end

The repository's example drives the agent loop with a scripted model (a test double) and a test workload, the
need `integer add(a,b)`, and prints the gate verdicts the ledger recorded:

```console
$ node examples/first-loop.mjs
{
  "need": "integer add(a,b)",
  "promoted": true,
  "testDouble": true,
  "turns": 2,
  "rounds": [
    "passed"
  ],
  "ledger": "/tmp/ef-first-loop-9N4s7O/addition/ledger.sqlite"
}
$ python3 examples/show-gates.py /tmp/ef-first-loop-9N4s7O/addition/ledger.sqlite
ledger records: task, admitted_input, frozen_evaluator, candidate, receipt
  G1_frozen         pass
  G2_compiles       pass  {"wasmBytes": 57}
  G3_exports        pass  {"exports": ["add"]}
  G4_tests          pass  {"passed": 1, "total": 1}
  G5_deterministic  pass
  G6_bounded        pass  {"maxMs": 0.000692, "fuelUsed": 5}
  G7_glue           pass
  G8_nonfinite      pass  {"probes": 0}
  G9_units          pass  {"checks": {"add": "dimensionless"}}
decision: promote
kernel: /tmp/ef-first-loop-9N4s7O/addition/kernel.wasm (57 bytes)
```

`node examples/first-loop.mjs wrong` feeds the same loop a kernel that fails its frozen test. The model gets the
failure back six times, the attempt stops at its turn limit, and the decision is `refuse` with `G4_tests FAIL
{"passed": 0, "total": 1}`.

## Order of evaluation

```mermaid
flowchart TD
  g1["G1 frozen files<br/>and test strength"] --> g2["G2 compile binding,<br/>module, imports"]
  g2 --> g3["G3 exports named<br/>by the tests"]
  g3 --> run1["First run of every<br/>frozen test"]
  run1 --> g4["G4 tests pass"]
  run1 --> g6["G6 fuel and stack"]
  run1 --> run2["Second run on a<br/>fresh instance"]
  run2 --> g5["G5 runs agree"]
  g5 --> g7["G7 glue"]
  g7 --> g9["G9 units"]
  g9 --> g8["G8 NaN and<br/>infinity probes"]
```

The numbers name the gates; they are not the order. The order follows the data: G4 and G6 both read the first run,
G5 needs the second, and the glue, units and probe gates come after the runs. A failure in G1, G2 or G3 stops evaluation at once, so later gates are missing from the result. From G4 on, every
gate runs and records its own verdict. `promotable` is true only when every recorded gate is `ok`.

## What each gate checks

| Gate | Passes when | Code |
|---|---|---|
| `G1_frozen` | `frozen.sha256` exists; the SHA-256 of `CONTRACT.md` and of `tests.json` equal the hashes in it; `tests.json` parses; and `testProblems` finds nothing (below) | `runGates`, `testProblems` |
| `G2_compiles` | The compiled record exists, has no error, and its `source` is the SHA-256 of this `kernel.ts`; the module loads through the fuel meter; it imports nothing except `env.abort`; and it instantiates | `runGates`, [meter.mjs](../../core/runtime/x1/meter.mjs) |
| `G3_exports` | Every `fn` named in `tests.json` is an exported function of the module | `functionNames` |
| `G4_tests` | Every frozen test passes on the first run (comparison rules below) | `runAll` |
| `G6_bounded` | No call in the first run ran out of fuel or stack | `runAll` |
| `G5_deterministic` | A second run, on a fresh instance and in the same order, gives the same output and the same error-or-not for every test | `runAll` |
| `G7_glue` | `glue.json` matches the closed schema and agrees with the module, the tests and the contract (below) | `validate`, [contract.mjs](../../core/runtime/x1/contract.mjs) `glueFindings` |
| `G9_units` | A static units analysis of `kernel.ts` against the glue finds no problem (below) | [dimensions.mjs](../../core/runtime/x1/dimensions.mjs) `unitFindings` |
| `G8_nonfinite` | Every float parameter probed with NaN, `Infinity` and `-Infinity` behaves as the contract says | [measure.mjs](../../core/runtime/x1/measure.mjs) `probeCalls`, contract.mjs `nonFiniteExpectation` |

### Test strength (G1)

`testProblems` refuses a `tests.json` that could not catch a wrong kernel. The same function runs before the freeze,
so a weak specification is never frozen. It requires:

- a nonempty array of objects, each with a string `fn` and an array `args`;
- either `expectError: true`, or an `expect` that is a finite number, a boolean or a string;
- an integer `expect` within the safe-integer range (larger integers must be strings);
- `tol` only on a number, finite, non-negative and at most 1% of `max(1, |expect|)` (`maximumRelativeTolerance`).

### How a test passes (G4)

| Frozen test | Passes when the call |
|---|---|
| `expectError: true` | traps: a WebAssembly `RuntimeError`, or a call to `env.abort` |
| `expect` boolean | returns without error, and its truthiness equals `expect`, or it returns exactly `1` or `0` to match |
| `expect` number with `tol` | returns a value within `tol` of `expect` |
| `expect` number without `tol` | returns exactly `expect` |
| `expect` string | returns a value whose string form equals `expect` |

### Fuel and stack (G6)

[meter.mjs](../../core/runtime/x1/meter.mjs) rewrites the module before it is compiled: it adds a 64-bit fuel global,
charges each function entry and each loop header an upper bound on the instructions that block can execute, and traps
when the fuel goes negative. Bulk memory operations are charged a fixed 65,536. Each instance gets 1,000,000,000 units
(`kernelFuel`). A kernel that never returns therefore stops inside the guest instead of hanging the cell. G6 reports
`fuelUsed` and the slowest call (`maxMs`), but only fuel and stack exhaustion fail it.

Memory is bounded elsewhere: the in-cell compile refuses a module that declares more than 1,024 pages (64 MiB), the
workcell's WASM guard enforces the pool's ceiling, and the evaluator's `bounds` check (below) compares measured memory
with the 64 MiB limit.

### Glue (G7)

G7 first validates `glue.json` against the closed schema [glue.schema.json](../../core/runtime/x1/glue.schema.json):
no unknown fields, an `id`, an `assumption` and a `question` of at least 20 characters, at least one export, and a
`traps` list. Then it checks the glue against the candidate:

- `glue.id` equals the candidate's id;
- each exported function has exactly one glue entry, no entry names a function the module lacks, and names are unique;
- each entry lists as many `args` as the export takes, named exactly as the `kernel.ts` parameters;
- a `code` argument has a `codes` table; a `number` result has an integer `precision` from 0 to 6; a `code` result
  has a `codes` table that labels every code the frozen tests returned; a `boolean` result has `true` and `false`
  labels;
- every trap names an exported function, and every function with an `expectError` test has a trap entry;
- when the contract states exactly one number of decimal places for an export, the glue's `precision` matches it;
- code labels that fit the contract's code table better swapped are refused, unless the contract also states the
  result as a computation, in which case the finding is advisory only.

A unit that disagrees with its argument's name (`unitDisagreements`) is reported as advisory and does not fail G7;
G9 makes the binding units decision.

### Units (G9)

G9 reads only the glue, `kernel.ts` and the first run's outputs. It never reads the contract or the evaluator, so it
is an error source independent of the specification ([P-65](../../experiments/P-65-unit-gate/RESULT.md)). Each
problem carries a letter:

| Letter | Refused when |
|---|---|
| K | a `code` or `boolean` field carries a physical unit |
| N | a unit's dimension or scale disagrees with the dimension its name implies (`massLb` with unit `kg`) |
| L | two adjacent arguments' units fit each other's names better than their own |
| C | a code labelled as never returned is returned by the frozen tests |
| D | the dimension inferred from the kernel's arithmetic disagrees with the glue, or two terms of a sum have different dimensions, or a temperature or time point is shown as a difference |
| R | an export computes a new code but shows the unit of one of its arguments |

`checks` records what was inferred per export (`dimensionless`, a dimension, `code`, `no source`, `arity`).

### NaN and infinity (G8)

For each export, `nonFiniteExpectation` reads the contract's text and classifies what it says about non-finite
input: `permitted`, `trap`, `excluded`, `finite` or `silent`. `probeCalls` takes the first value test's arguments
for that export and replaces one float parameter at a time with NaN, `Infinity` and `-Infinity`. A probe fails when
the contract requires a trap and the call returns, when the contract promises a finite result and the call returns a
non-finite one, or when a probe exhausts fuel or stack. Integer parameters are not probed, so an export with only
integer parameters records `probes: 0`.

## From gates to a decision

`runGates` runs inside the frozen evaluator as its `residual` check, the task-specific part of acceptance that comes
after the universal checks. The engine's evaluator ([core/engine/evaluator.mjs](../../core/engine/evaluator.mjs))
evaluates every candidate once (round 0), keeps the survivors that are best on the measured objectives (the
frontier; here, the smallest module), and evaluates those again (round 1). Each round runs six checks in this order:

| Check | What it does here |
|---|---|
| `schema` | The shared gate input is well formed |
| `interface` | The module's observed signature equals the contract signature (`describe` refuses a missing export or a wrong arity) |
| `bounds` | Two fresh runs of the frozen tests and the NaN probes complete within 64 MiB of memory and the fuel limit; a run past 30 s of wall time is an unknown outcome, not a refusal |
| `determinism` | Those two runs give identical outputs and effects |
| `forbidden_effects` | The module's imports and calls are only `env.abort` |
| `residual` | `runGates`: the nine gates above |

The measured port ([measure.mjs](../../core/runtime/x1/measure.mjs) `measuredPort`) reverses the call order on every
second run of a candidate, so the `determinism` check compares a forward run with a reversed one. Usage is read from
outside the guest: fuel from the meter's global, memory from the instance's buffer.

The ledger decides. `decide` in [tools/x1_loop.py](../../tools/x1_loop.py) returns `promote` only when all of these
hold, and `refuse` otherwise:

- the candidate record's id is the SHA-256 of its content, and the receipt names that candidate and the frozen
  evaluator, is `finished` with outcome `passed`, and has the hash the commit just wrote (the receipt's precommit is
  what it bound before evaluation: the evaluator, its digest, the artifact, and what a failure means);
- the pool report is `completed`, its frontier is exactly this candidate, and it binds the same evaluator digest as
  the receipt's precommit;
- there are exactly two attempts, rounds 0 and 1, each `passed`, each running exactly the six checks above, all
  passing;
- in both rounds the residual's result is `promotable` and its gate set is exactly `G1_frozen` to `G9_units`, all
  `ok`.

`inconclusive` is a third answer, never a pass. `decide` returns it when the receipt records `outcome_unknown`: a
lost cell, a deadline, or a model call that failed after the freeze. On the host-side path
([tools/x1_ledger.py](../../tools/x1_ledger.py) `promote`), an unavailable ledger also gives `inconclusive`.

Before `decide` runs, `commit` re-checks the evidence against the frozen bundle inside the same transaction
(`evidence_problem`): the evaluator tree and implementation files still match their frozen digests, the candidate's
oracle files equal the frozen ones, the compiled `source` is the hash of `kernel.ts`, the module digest in G2 matches
the stored module, and every frozen test appears in the report with its recorded value meeting the frozen
expectation. A problem marks the receipt `failed`, and the decision refuses.

## Known issue: stale gate labels

The gate set is nine, and `decide` and `tools/library_verify_promotion.py` both require all nine. Some fixed strings
still carry older counts:

| Where | String |
|---|---|
| `tools/x1_loop.py` `decide`, `tools/x1_ledger.py` | `policy="X1-G1-G8/v1"` in every decision |
| `tools/x1_loop.py` `admit`, `tools/x1_ledger.py` `freeze` | task `acceptance` and frozen `residual` `"X1 G1-G7"` |
| `core/runtime/x1/ledger.mjs` `receipt` | precommit `acceptance_boundary: 'G1-G7'` |
| `tools/x1_loop.py` `decide` | the error text `"all seven gates must pass"` (it is never shown; any error becomes a refusal) |

They are labels only and change no verdict. They are also written into frozen records and decisions, so changing them
changes stored identities; that fix belongs in a code change with a migration note, not in the docs.

## Limits

- The gates trust the code that runs them. On the in-cell paths the report comes from EndoForge's own code in the
  cell; `commit` checks its bindings and recorded values against the frozen bundle and the stored module, but does
  not run the kernel again, so a bug that produced a consistent wrong report would not be caught there
  ([P-50](../../experiments/P-50-in-isolate/RESULT.md)).
- G7, G8 and G9 read contract text and names with fixed patterns. They catch the mistakes they were measured on
  ([P-52](../../experiments/P-52-real-gates/RESULT.md), [P-65](../../experiments/P-65-unit-gate/RESULT.md)), not
  every way glue can mislabel a result.
- The frozen evaluator records the bytes of `host.mjs`, `gates.mjs`, `glue.schema.json`, `measure.mjs`, `meter.mjs`
  and `contract.mjs` (and, on the in-cell paths, `loop-port.mjs`, `agent.mjs` and `oracle.mjs`), and the commit refuses
  if they drift. `dimensions.mjs`, which implements G9, is not in that list, so a change to it after a freeze is not
  caught by the drift check. This is a code gap, noted here until the list is extended.
- Frozen tests decide G4. A wrong expected value in a frozen test refuses every correct kernel; the
  [formula oracle](agent-loop.md#formula-oracle) and [evaluator synthesis](evaluator-synthesis.md) are the two
  mechanisms that check frozen tests from a second source.
