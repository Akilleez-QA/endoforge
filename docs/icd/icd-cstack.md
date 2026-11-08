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
- All of `core/runtime/capacity/`; its CLI is the interface for non-Node callers ([capacity ICD](../interfaces/capacity-icd.md)).
- `LICENSE`.

## Interface

The Python interface is the package `core`, imported as source. Its public names are those in `core.__all__`:
`LEGAL`, `Artifact`, `LifecycleError`, `LifecycleRecord`, `PoodoDecision`, `QualificationReceipt`, `State`, `Transition`, `TransitionProposal`, `digest`.

`core` imports no concrete integrations; [tests/test_endoforge_core_boundary.py](../../tests/test_endoforge_core_boundary.py) checks this.
[tests/test_endoforge_lifecycle.py](../../tests/test_endoforge_lifecycle.py) checks the lifecycle behavior.

## Change control

A change to a public name or its behaviour in a vendored file is a breaking change for Cstack.
Record it in [CHANGELOG.md](../../CHANGELOG.md); Cstack moves its pin in a separate pull request.

## Not included

- The X1 loop (`core/runtime/x1/`), transports, the agent pool, the contained runner, the library and experiments are not vendored.
- Other agent runners, caching and receipts in `tools/` are not part of this interface.
- How Cstack calls the vendored code is described on its side, in `docs/icd/icd-endoforge.md`.
