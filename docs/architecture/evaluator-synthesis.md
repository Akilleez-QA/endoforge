# Evaluator synthesis

Status: **Proposed** design, written 2026-11-07 before any code. It implements the
specification stage of Edition 3 section 6 for the X1 scalar-kernel path. It is off
by default (`ENDOFORGE_SYNTH` unset) and changes no gate, rule or ledger policy.

## Why

The X1 residual today is `CONTRACT.md` plus `tests.json`, written in the same model
thread that later writes the kernel. Promotion rests on those tests alone. P-51 and
P-52 measured what that leaves: 251 sampled escapes that differ from their pristine
kernel only on finite inputs the tests don't cover (107 of them rounding), and 295
glue escapes, mostly unit swaps that no gate has a basis to refuse. Edition 3 places
the missing check before the workcell: an evaluator synthesized for the task, from
the request, before any candidate exists, mostly composed from reusable invariants,
qualified against fixed meta-gates, confirmed in plain language and frozen.

## Layers, against Edition 3 section 6

| Edition 3 layer | Here |
|---|---|
| 1. Universal gates | Unchanged: `x1/measure.mjs` and G1 to G8 in `x1/gates.mjs`. |
| 2. Domain invariants, authored offline and composed per task | `x1/synth/invariants.mjs`: units and dimensions, display precision, code labels, boundary behaviour (trap exactly outside the declared domain, at and beside each edge), sign and range, monotonicity, rounding probes, determinism. Deterministic code. The model only selects and parameterizes them. Non-finite handling stays with G8 and is not duplicated. |
| 3. Task residual | A reference function per export plus generated input vectors, written by the model in a candidate-blind context and turned into frozen test vectors by the host. |

## The stage

Two model steps, both through the host's provider port (the existing `claude -p`
transport, `SpawnClaudeTransport`), never inside an isolate. Neither step sees
`tests.json`, `kernel.ts`, `glue.json` or any candidate output.

1. **Need sheet**, from the need alone. Output: the plain-language residual ("what
   will be checked", at most eight sentences), the quantities the request involves
   with units and expected sign or range, expected monotone relations, and the ids of
   library invariants that apply. It starts when the request is admitted and runs
   concurrently with the specification turn (Edition 3 section 10, overlap).
2. **Binding**, from the need sheet and the frozen `CONTRACT.md`. The contract fixes
   the interface; the scalar path lets each run choose its own export names, so an
   executable evaluator cannot exist before the interface does. Output, per export:
   parameters (unit, closed or open domain, integer flag, code table), result (kind,
   unit, decimals, code table, range), monotone relations, and a reference function
   in plain JavaScript using only `Math` and `Number`.

Then the host, with no model:

3. **Compile.** Input vectors per export from the bound domains, seeded by the
   binding's hash: each edge, just inside and just outside it, the midpoint, non-round
   interior values, display-precision half points, every code, a one-at-a-time sweep
   per parameter from a base point, and seeded random combinations. The base point is
   the first frozen value test's arguments (the tests are frozen before any candidate;
   they are read here as data, never shown to the model). The reference runs in a
   permission-restricted Node child (`vm`, no file or network access), and its outputs
   become the expected values.
4. **Qualify** against fixed meta-gates. An export that fails M1 to M3 or M5 is
   unqualified and contributes no value or property check; a declaration that fails
   M4 is dropped.
   - M1 shape: closed schema; exports and arities equal the frozen tests' functions.
   - M2 deterministic and bounded: two runs agree, within 10 s.
   - M3 anchor: the reference reproduces every frozen value test (within its `tol`,
     or 1e-9 relative) and throws on exactly the `expectError` tests.
   - M4 self-consistency: the reference meets its own declared range, monotone
     relations, code tables and domain (throws outside it, returns inside it).
   - M5 discrimination: seeded faults in the reference (constant shift, comparison
     flip, operator swap, rounding swap, argument swap). Of those that differ from the
     reference on a denser sample, the frozen vectors must reject at least 80%.
5. **Confirm.** The residual and the list of checks render as plain text. A `confirm`
   callback approves or declines it. The loop's default is the task contract, recorded
   as `confirmed_by: task contract, no person`. Nothing records a person who wasn't
   asked.
6. **Freeze.** `synth/evaluator.json` (vectors, declarations, qualification receipt,
   residual, confirmation) is written into the oracle root before the existing ledger
   freeze, so the `frozen_evaluator` record's digest covers it before the
   implementation turn starts. The candidate never sees it.
7. **Evaluate**, after the pool gates and before ledger promotion: the kernel runs
   with the existing fuel meter on every qualified vector (value within 1e-9
   relative, trap exactly where the reference throws), then the declared properties,
   then glue against the declarations: argument and result units by dimension and
   scale, display decimals, code labels, result kind. Any failure refuses; nothing
   qualified abstains and leaves the decision to the existing gates.

**Dual mode** (`ENDOFORGE_SYNTH_WIDTH=2`) runs steps 1 and 2 twice in independent
contexts and counts a check only where both qualified evaluators agree: a vector
where both references give the same result, a property or unit both declared. This
spends model turns to lower the evaluator's own error rate, the term Edition 3 says
is silent.

## Rules kept

- **Before and blind.** Both steps run without a candidate. The binding reads the
  contract, which the same thread as the kernel wrote; the evaluator is therefore
  blind to the kernel, not to the contract's reading of the need. A shared misreading
  in the contract (P-51's correlated arm) is outside what this can catch, and only
  the need sheet is independent of it.
- **One per task.** The evaluator is keyed by task and frozen once. It is never
  regenerated after a candidate fails; a revision needs new admitted evidence, as the
  ledger already enforces.
- **Qualified.** By the meta-gates above, without any candidate.
- **Confirmed.** As above; the confirming party is recorded truthfully.

## Deviations, stated

- Edition 3 wants the binding to overlap generation too. Here it sits between the
  specification freeze and the implementation turn, because one ledger freeze must
  cover it and the ledger allows a second frozen evaluator only as a revision on new
  evidence. Only the need sheet overlaps. One model turn is on the critical path.
- Evaluation runs the kernel in the controller process under the existing fuel meter,
  not in the pool cell, because the pool's host port is shared with the gates P-55 is
  measuring. Moving it into the cell is follow-up work.
- Only the current (`ENDOFORGE_LOOP` unset) path calls the stage. The agent and
  in-isolate loops don't yet.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ENDOFORGE_SYNTH` | unset (off) | `1` runs the stage. |
| `ENDOFORGE_SYNTH_WIDTH` | `1` | Independent evaluators; `2` is dual mode. |
| `ENDOFORGE_SYNTH_MODEL` | `sonnet` | Model name for `claude -p`. |
| `ENDOFORGE_SYNTH_CONFIG_DIR` | unset | Claude configuration directory for the transport. |
| `ENDOFORGE_SYNTH_PROVIDER` | unset | Module exporting `createProvider(env)`, for replay and tests. |

## Trust measure

Escape rate on seeded faults, as Edition 3 section 7 defines it, through P-51's
unmodified harness: experiment P-56. A synthesized evaluator is the "model,
candidate-blind" row of the error-source table: partly independent. It isn't counted
as an offline-qualified invariant, and a passing synthesized check grants no tier.
