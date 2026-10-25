# Manifest-driven scalar factory

The current executable path uses **Codex subscription CLI + local Qwen**. Claude Code CLI is disabled. A single manifest drives request validation, two mutually blind eval writers, independent reference checking, eval freeze, generation, bounded WASM/Docker verification and trusted publication. The owned local-model lease starts and stops within the command.

From the repository root:

```bash
python3 -m tools.factory_campaign.cli campaigns/next50-20261018/control/runner-example.json --output /tmp/endoforge-new-run
```

The output directory must be new. The example is an already consumed synthetic threshold request, not fresh holdout evidence. `result.json` identifies publication or an explicit unsupported outcome; failures retain `failure.json` and private stage evidence under `work/`. Model and offline Docker attempts have separate ownership journals. No paid API provider is used.

The manifest has version1, typed `request` and `signature`, a `referenceSource` JSON packet, its exact SHA256, and `referenceIndex`. That source entry must bind exactly the same request/signature and supply independently registered affine or threshold reference coefficients. Reference values check evals on the host and never enter the generator view. Unsupported artifact classes are counted rather than silently routed into this scalar backend.

Current platform requirements are Python, Node, systemd user scopes, bubblewrap, Docker access, the pinned compiler/Wasmtime bundle and the pre-existing local Qwen runtime/model configured under `/home/user/LOCAL LLM`. This is a qualified local prototype, not a deployment or a generic multi-platform agent service. The portable checkpoint can resume remaining offline stages without moving credentials or model weights.

Checks:

```bash
make factory-check
make factory-integration
```

`execute50.py`, `compare50.py`, `holdout50.py`, `resolve_holdout50.py` and `decision50.py` preserve the recorded synthetic qualification/comparison campaign. Historical disabled Claude entry points are not the current runner. See the campaign result and independent audit for raw writer disagreement, protocol deviations, failed historical criteria and unsupported strata.
