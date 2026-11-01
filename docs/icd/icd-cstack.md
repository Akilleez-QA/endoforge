# Interface control: Cstack

## Sides

| Side | Repository | Role |
|---|---|---|
| Provider | [endoforge](https://github.com/Akilleez-QA/endoforge) | Lifecycle model in `core/` |
| Consumer | [cstack](https://github.com/Akilleez-QA/cstack) | Vendored copy in `vendor/endoforge/` |

## Pinned version

Cstack vendors Endoforge commit `cebd463ea9828dfd9bbf09181a631ee604eac8cf`.
The consumer records the pin in `contracts/SOURCE-PINS.json` and `vendor/endoforge/SOURCE-MANIFEST.json`, and describes it in its `docs/icd/icd-endoforge-pin.md`.

## Interface

The interface is the Python package `core`, imported as source. Its public names are those in `core.__all__`:
`LEGAL`, `Artifact`, `LifecycleError`, `LifecycleRecord`, `PoodoDecision`, `QualificationReceipt`, `State`, `Transition`, `TransitionProposal`, `digest`.

`core` imports no concrete integrations; [tests/test_endoforge_core_boundary.py](../../tests/test_endoforge_core_boundary.py) checks this.
[tests/test_endoforge_lifecycle.py](../../tests/test_endoforge_lifecycle.py) checks the lifecycle behavior.

## Change control

A change to a public name or its behavior in `core/` is a breaking change for Cstack.
Record it in [CHANGELOG.md](../../CHANGELOG.md); Cstack moves its pin in a separate pull request.

## Not included

- Cstack's `EndoforgePort` is reserved and has no callable method, so Cstack does not run Endoforge.
- Agent runners, caching and receipts in `tools/` are not part of this interface.
