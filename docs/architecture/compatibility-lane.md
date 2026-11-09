# The compatibility lane

The compatibility lane runs TypeScript as JavaScript, for imported code and for behaviour that doesn't fit the kernel
split of Edition 3 §5. It has two parts: a TypeScript 7 checker compiled to WebAssembly that type checks and emits
inside a V8 isolate, and a contained cohort that runs the emitted JavaScript in child isolates with no ambient
authority. Every result it produces is labelled `lane: compatibility`. It is a lane of its own, not a weaker form of
the kernel path, and nothing on the kernel path depends on it.

| Part | Code | Page |
|---|---|---|
| Checker: `tsrs`, a Rust port of the TypeScript 7 compiler, as WebAssembly | [tools/tscheck](../../tools/tscheck/README.md) | its README |
| Contained cohort: one hardened Node process holding reusable Worker isolates | [core/runtime/contained](../../core/runtime/contained/runner.mjs) | [runtime README](../../core/runtime/README.md#contained-javascript) |
| Route: check, emit, run twice, score against the candidate's tests | [tools/tscheck/contained-route.mjs](../../tools/tscheck/contained-route.mjs) | this page |
| Promotion rule: freeze tests first, re-score the route's output, decide | [tools/compat_policy.py](../../tools/compat_policy.py), [core/runtime/contained/promotion.mjs](../../core/runtime/contained/promotion.mjs) | [below](#promotion) |

## The route on a candidate

`runNeed({ ..., containedRoute })` runs the route on every loop path (`current`, `isolate` and `agent`). What it does
depends on the route:

- A route with only `check` is run once, after the kernel decision: `containedRoute.check(candidate)`. Its report
  joins the result under `contained`.
- A route with `freeze` and `promote` (such as `createContainedRoute()`) has its tests frozen right after the kernel
  freeze, before any candidate: `route.freeze({ ledger: <directory>/compatibility.sqlite, need, tests })` with the
  frozen `tests.json`. After the kernel decision the pipeline calls `route.promote(candidate, { ledger, frozen,
  decisionPath: <directory>/compatibility-promotion.json })` ([below](#promotion)). The report joins the result under
  `contained`, and the lane's own decision under `compatibility`:
  `{ promoted, decision, policy: 'COMPAT-TS-CHECK-RUN2-TESTS/v1', candidate, receipt, sha256, reason? }`.

Neither changes the kernel decision: `promoted` is still the nine-gate result. An exception in `check` becomes
`{ lane: 'compatibility', status: 'outcome_unknown' }`; an exception in `freeze` or `promote` also gives
`compatibility: { promoted: false, decision: 'inconclusive', reason }`.

```mermaid
flowchart TD
  cand["Candidate<br/>kernel.ts, tests.json"] --> check["Type check and emit<br/>tsrs in a Worker"]
  check -- "diagnostics" --> refusedTs["refused: typescript"]
  check -- "clean emit" --> run["Run the emitted JS<br/>twice, fresh guest"]
  run -- "runs differ" --> nondet["refused: nondeterministic"]
  run --> score["Score against<br/>the frozen tests"]
  score --> report["contained report<br/>lane: compatibility"]
```

1. The candidate's `kernel.ts` becomes a project (`projectFor`) with strict options, `module: commonjs` and
   `noEmitOnError`, plus a declaration file for the scalar types.
2. The checker type checks and emits it. By default (`check: 'fused'`) this happens inside the cohort, in the Worker
   that then runs the guest; `'sibling'` uses checker Workers in the same cohort process; `'supervisor'` checks on the
   calling thread. A check with diagnostics is refused with reason `typescript`.
3. The emitted JavaScript runs twice through an adapter that calls each frozen test; the two runs must agree in status,
   output and reason.
4. Each test is scored with the same comparison rules as [G4](gates.md#how-a-test-passes-g4). The report records
   the compiler identity, the artifact's SHA-256, pass counts, the first failures and timings.

The report also carries the guest's raw `output` and its `outputSha256`, so the promotion rule can score it again.

When the caller gives no `width`, the route asks the [capacity planner](../interfaces/capacity-icd.md) for one cohort
per L3 cache domain, pinned with `taskset`, as wide as that domain's cores within the job's CPU share.

## Promotion

The lane has its own promotion rule, policy `COMPAT-TS-CHECK-RUN2-TESTS/v1`, separate from the kernel's nine-gate
policy. It uses the same hash-chained ledger and frozen-evaluator records, with the lane's own receipts and decisions.

```mermaid
flowchart TD
  freeze["route.freeze<br/>tests and compiler<br/>into the ledger"] --> register["Register candidate<br/>kernel.ts, tests.json"]
  register --> check["route.check<br/>the report above"]
  check --> receipt["Receipt<br/>report as observation"]
  receipt --> decide["promote<br/>re-score and decide"]
```

1. **Freeze, before any candidate.** `route.freeze({ ledger, need, tests })` writes `task`, `admitted_input` and a
   `frozen_evaluator` holding the tests and the pinned tsrs module digest (`TSRS_MODULE.sha256`) as the compiler.
2. **Register.** The candidate's `kernel.ts` and `tests.json` become a `candidate` record identified by their hash.
3. **Check.** The route runs as above.
4. **Receipt.** The report is recorded: `completed` is `passed`, `refused` is `failed`, anything else is
   `outcome_unknown`.
5. **Decide.** `promote` returns `promote` only when the receipt is bound to the stored hash and to this candidate, the
   evaluator was frozen under this policy, lane and route, the candidate's `tests.json` is byte for byte the frozen
   one, the report is a clean type check (no diagnostics) with two compared runs, its compiler digest equals the frozen
   one, every test passed, and the recorded `output` matches its digest and passes every frozen test when
   [compat_policy.py](../../tools/compat_policy.py) scores it again in Python. Any other evidence refuses. An
   `outcome_unknown` receipt gives `inconclusive`, and so does an unavailable ledger. A promote decision is sealed,
   stored once per receipt in the ledger's `compat_decisions` table, and written to `decisionPath` when given.

`route.promote(candidate, { ledger, frozen, decisionPath })` runs steps 2 to 5. A run on a one-test candidate:

```js
const route = createContainedRoute({ width: 1 });
const frozen = await route.freeze({ ledger, need: 'add two integers', tests });
const out = await route.promote(candidate, { ledger, frozen: frozen.identity, decisionPath });
```

```json
{
 "promoted": true,
 "decision": "promote",
 "policy": "COMPAT-TS-CHECK-RUN2-TESTS/v1",
 "passed": 1,
 "total": 1,
 "comparedRuns": 2
}
```

Each step is also a command, JSON on stdin: `python3 -B -m tools.compat_policy freeze|register|receipt|promote <
request.json`. With no arguments it prints its usage and exits 2.

## The contained cohort

`createContainedRunner({ width, heapMb, deadlineMs, ... })` starts one child process:

```text
node --permission --allow-worker --no-addons --disallow-code-generation-from-strings
     --no-warnings --no-experimental-websocket --max-old-space-size=64 -e <cohort>
```

with an environment of only `TZ=UTC` and `LC_ALL=C`, working directory `/`, core dumps off, and no file-system grant
except the pinned checker module when the cohort prepares checks. Inside it, `width` Worker isolates are kept between
attempts, plus spares; each attempt gets a fresh guest context with a closed allowlist of standard globals.

| Property | Rule |
|---|---|
| Authority | None unless the job's contract grants it: `grants.clock.fixedMs` (a fixed `Date`), `grants.random.seed` (a seeded `Math.random`), and named `ports` with `maxCalls` and `maxBytes`, reached by `require('host:ports')` and carrying JSON text. `Date.now` and `Math.random` are otherwise refused |
| Modules | CommonJS only. Any source containing `import` followed by `(` is refused as `dynamic_import` |
| Limits | Per-attempt heap, stack and deadline in the Worker; a process kill from the supervisor behind the deadline; an RSS watchdog behind that |
| Refusals | `heap`, `memory`, `deadline`, `stack`, `string_limit`, `thrown`, `never_settled`, `output_not_json`, `output_too_large`, `compile`, `dynamic_import`, `process_exit`, `nondeterministic` |
| Failure scope | A heap, stack or deadline breach that a Worker contains costs only that attempt. A V8 fatal error ends the cohort: every attempt it held is `outcome_unknown`, one replacement starts, and nothing is retried |

Other layouts: `reuse: false` gives a fresh Worker per attempt; `createContainedPool({ width })` gives one process
per cell, which loses no neighbour to a fatal error and costs about 70 MiB per cell. The route takes
`layout: 'shared-reuse' | 'shared-fresh' | 'process-per-cell'`.

## The checker in a workcell

[tools/tscheck](../../tools/tscheck/README.md) also runs the checker as an `IsolatePool` host port, adding a
`typescript` invariant to the frozen evaluator. The pool's `trustedWasmModules` names the checker's digest, so the WASM
guard admits it, and thread pools compile it once and share it. A hash mismatch, a missing compiler or a trap is an
unknown outcome, never a pass. Its README lists the file-name, option and program rules the host enforces, and the
requalification run that compares it with Microsoft's native compiler on every version bump.

## Measured

| Probe | Result |
|---|---|
| [P-54](../../experiments/P-54-contained-js/RESULT.md) | The shared, reused cohort matched one process per cell in attempts per second at every width with about a third of the memory per active attempt; a fresh Worker per attempt cost 9.6–27 ms of CPU against 0.46–1.1 ms |
| [P-58](../../experiments/P-58-cohort-typecheck/RESULT.md) | Checking inside the cohort: 380–516 accepted attempts per second at width 16, against 58–63 with the check on the supervisor, at 1.1–1.5× the CPU per attempt |
| [P-60](../../experiments/P-60-tscheck-snapshot/RESULT.md) | Reusing one checker instance per Worker and seeding each check with build info from the route's own baseline: 649–702 accepted per second at width 16 against 443–510 for fresh checks, with no verdict or emit difference |
| [P-43](../../experiments/P-43-tsrs-workcell/RESULT.md) | The checker's parity arm against the native compiler, and its memory floor in a workcell |

## Limits

- The cohort is not an OS sandbox and not a Spectre boundary. The permission model doesn't cover signals, and on
  Node 22 it doesn't cover the network. Passing the attack suite doesn't prove no escape exists.
- Mathematical and Unicode results follow the V8 and ICU of the running Node.
- Inside `runNeed`, the lane is decided only for the TypeScript of a candidate that reached the kernel decision; a
  need served from the library runs no compatibility route.
- Requires Node 22.8 or later.
