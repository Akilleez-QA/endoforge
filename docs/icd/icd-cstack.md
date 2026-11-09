# Interface control: Cstack

## Sides

| Side | Repository | Role |
|---|---|---|
| Provider | [endoforge](https://github.com/Akilleez-QA/endoforge) | Lifecycle model, ledger, evaluator and gates, isolate pool and capacity planner |
| Consumer | [cstack](https://github.com/Akilleez-QA/cstack) | Vendored copy in `vendor/endoforge/` |

## Pinned version

Cstack (code name Mjölnir) vendors EndoForge commit `6dffea963afdfebfeb6a769afde94cf6a815cdb3` (the merge of #124), checked on 2026-11-08.
The consumer records the pin in `contracts/SOURCE-PINS.json` and `vendor/endoforge/SOURCE-MANIFEST.json`, and describes it in its `docs/icd/icd-endoforge-pin.md`.
Cstack's `tools/pin_endoforge.py` builds the vendored copy from a fixed list of 25 files and refuses a commit that is not on EndoForge `main`.

## Vendored slice

- `core/__init__.py`, `core/lifecycle.py` and `tests/test_endoforge_core_boundary.py`.
- `core/ledger/` (ledger, frozen evaluator and record schema) and `tools/ledger_writer.py`, which the ledger bridge runs.
- `core/engine/` (evaluator, gates and the frozen adapter) and `tools/factory_quality/index.mjs`, which the gates import.
- `core/runtime/isolate-*.mjs` (`IsolatePool`, its workcell, cgroup, WebAssembly guard and ledger bridge).
- All of `core/runtime/capacity/` ([capacity ICD](../interfaces/capacity-icd.md)); vendored, not called.
- `LICENSE`.

## Interface

Cstack runs the vendored code. A goal in Cstack's `cstack_forge` domain freezes an evaluator in an EndoForge ledger,
starts an `IsolatePool` from a Node supervisor, and runs Cstack's own host port in the workcells; POODO evidence is
witnessed into the EndoForge `Ledger` through Cstack's `EndoforgePort` adapter. Cstack's `docs/icd/icd-endoforge.md`
(section 8) is the authoritative list. At the current pin Cstack calls these EndoForge names:

| EndoForge interface | Cstack use | EndoForge reference |
|---|---|---|
| `core.ledger.ledger.Ledger(path)`, `.append(...)`, `.records()` | Opens the run ledger, records task and admitted input, reads receipts during recovery | [Ledger ICD](../interfaces/ledger-icd.md) |
| `core.ledger.frozen.FrozenEvaluators(ledger).freeze(...)` | Freezes Cstack's workcell tree as the evaluator for one task | [Ledger ICD](../interfaces/ledger-icd.md) |
| `new IsolatePool({...})`, `ready()`, `run(job)`, `close()` | Options: `hostPort`, `size`, `isolation`, `trustedWasmModules`, `wasmMemoryMaxMb`, `resourceLimits`, `frozenThroughLedger: true`, `hostCalls`, `warm`, `jobTimeoutMs`, `cgroupRoot` | [V8 workcell pool interface](../interfaces/ledger-icd.md#v8-workcell-pool-interface) |
| `ENDOFORGE_LEDGER_JOURNAL`, read by `tools/ledger_writer.py` | Set to `<ledger>.journal` for every run | [Configuration reference](../configuration/configuration-reference.md) |
| `tests/test_endoforge_core_boundary.py` | Run as Cstack's import-boundary check | |

Inside the pool the vendored workcell calls the vendored gates and evaluator (`core/engine/`) and the ledger bridge.
The capacity planner is vendored but not called by Cstack.

The Python lifecycle package `core` is also vendored. Its public names are those in `core.__all__`:
`LEGAL`, `Artifact`, `LifecycleError`, `LifecycleRecord`, `PoodoDecision`, `QualificationReceipt`, `State`, `Transition`, `TransitionProposal`, `digest`.

`core` imports no concrete integrations; [tests/test_endoforge_core_boundary.py](../../tests/test_endoforge_core_boundary.py) checks this.
[tests/test_endoforge_lifecycle.py](../../tests/test_endoforge_lifecycle.py) checks the lifecycle behavior.

## Change control

A change to a name in the table above, or to the behaviour of a vendored file, is a breaking change for Cstack.
Record it in [CHANGELOG.md](../../CHANGELOG.md); Cstack moves its pin in a separate pull request.

## Not included

- The X1 loop (`core/runtime/x1/`), transports, the agent pool, the contained runner, the library and experiments are not vendored.
- Other agent runners, caching and receipts in `tools/` are not part of this interface.
