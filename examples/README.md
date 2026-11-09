# Examples

Runnable scripts for the guides. Run them from the repository root after `make loop-setup`. None of them calls a real
model unless you point it at one: the ones that take a model run here with scripted agents or test-double CLIs.

| Script | What it does | Guide |
|---|---|---|
| [agent-loop.mjs](agent-loop.mjs) | A scripted agent builds a turnstile kernel in the agent loop: fails one check, fixes it, gets promoted. `stubborn` never fixes it and is refused. | [Getting started](../docs/guides/tutorials/getting-started.md) |
| [show-gates.py](show-gates.py) | Opens a ledger, verifies its hash chain, prints each gate and the decision, and saves a promoted kernel as `kernel.wasm`. | [Getting started](../docs/guides/tutorials/getting-started.md#5-read-the-ledger) |
| [claude-agent-loop.mjs](claude-agent-loop.mjs) | The agent loop with Claude Code as the agent, through `WarmClaudeTransport`. Needs a claude.ai subscription login; `--command` swaps in a test-double CLI. | [Run the agent loop](../docs/guides/how-to/run-the-agent-loop.md) |
| [codex-loop.mjs](codex-loop.mjs) | The `isolate` loop with Codex as the generator. Needs `ENDOFORGE_CODEX_CMD` and `CODEX_HOME`. | [Run the agent loop](../docs/guides/how-to/run-the-agent-loop.md#codex) |
| [evaluator-synthesis.mjs](evaluator-synthesis.mjs) | Evaluator synthesis catching a kernel that passes its frozen tests but is wrong above 5. | [Turn on evaluator synthesis](../docs/guides/how-to/turn-on-evaluator-synthesis.md) |
| [library-reuse.mjs](library-reuse.mjs) | A promoted kernel admitted to the library and served to a later need without an implementation turn. | [Reuse with the library](../docs/guides/how-to/reuse-with-the-library.md) |
| [first-loop.mjs](first-loop.mjs) | The smallest agent-loop run, on the test suite's addition fixture. `wrong` sends a subtracting kernel. `make loop-test` runs it. | |

Each run writes its ledger under your system's temporary folder (`ef-*`). Delete those directories when you are done.
