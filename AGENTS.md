# Agent guide

This page is for coding agents (and people) changing the EndoForge repository itself.

## What you are working on

EndoForge lets coding agents (Claude Code through `claude -p`, and Codex) build real software inside in-memory V8
isolate workcells. An agent writes a contract and tests, EndoForge freezes them in a hash-chained ledger, and the agent
writes and repairs code until it passes the frozen tests and the gates. Passing code is kept in a library for reuse.
The [system overview](docs/architecture/architecture.md) maps every part to the code.

The small numeric needs in tests, examples and experiments (`integer add(a,b)` and similar) are test workloads that
measure the engine. Do not describe EndoForge by them, in code, docs or pull requests.

## Read first

[README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/README.md](docs/README.md), and the README nearest
the files you change. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) for reporting
problems.

## Where things live

| Path | What is there |
|---|---|
| `core/runtime/x1/` | The candidate loop: `pipeline.mjs` (`runNeed` and the three loop paths), `loop.mjs` (host side), `loop-port.mjs` (the in-cell port), `agent.mjs` (the agent's four calls and stage prompts), `gates.mjs`, `transports.mjs`, `synth/` |
| `core/runtime/` | Workcells (`isolate-*.mjs`), contained JavaScript, the Codex agent pool, the subscription guard, the usage governor, the capacity planner, the dump list |
| `core/ledger/`, `core/lifecycle.py` | The ledger and the lifecycle model. Lifecycle transitions validate references; they grant no authority |
| `core/library/`, `core/engine/`, `core/constraints/` | Reuse of promoted capabilities, the engine evaluator, constraint records |
| `tools/` | Workflow tools (job, atomizer, conductor, tscheck and more) and repository scripts; [tools/README.md](tools/README.md) lists each |
| `tests/` | Lifecycle behaviour, the core boundary and the repository checks |
| `experiments/` | Measurements planned before they ran. Never rewrite a merged `PRECOMMIT.md` or `RESULT.md`; their hashes are recorded |
| `docs/` | Indexed by [docs/README.md](docs/README.md); add new docs there |

Generated files: `sources/SHA256SUMS` (`make sums`) and the index in `experiments/README.md` (`make index`, from each
experiment's `INDEX.md`). Reserve a new P-number with `python3 -I tools/experiment_id.py reserve <slug>`.

## Rules for a change

- A change to behaviour updates its requirement in `docs/requirements/requirements.md` and its row in
  `docs/verification/verification-matrix.md` in the same pull request. A new test file needs a matrix row or a
  supporting entry; a new environment variable needs a row in the configuration reference. `make check` fails
  otherwise.
- Tests are discovered by glob in the Makefile. `tests/test_reachability.py` fails when `make test` does not reach a
  test file; wire it into a target or list it with a reason in `tests/test-reachability.json`.
- Keep changes focused, and open an issue before larger work.
- Put rationale in documentation, commit messages or the pull request, not in code comments.
- Use synthetic identifiers and local paths in examples, and keep generated evidence outside the source tree. Never
  publish credentials, account directories, home-directory paths, private inputs or sensitive receipts; `make check`
  runs a privacy lint.
- Model calls run on a subscription login. The subscription guard refuses anything else, and tests use test doubles.
- Preserve independent checks and expected results. Never weaken a check to get a pass.

## Verification

You need Python 3.11+, Node.js 22.8+, GNU Make and bubblewrap; the full suite also needs `age` and `gcc`. CI uses
Python 3.12 and Node.js 22 and 26. Run `make tools` once per checkout: it installs the pinned wasm-tools and a Python
virtual environment for the kernel tests into `.tools/`. Then, from the repository root:

```sh
make check
make test
make test-optimized
```

`make check` checks Markdown links and anchors, source digests, the experiments index, P-number allocation, privacy,
requirement traceability (`tools/check_trace.py`) and the generated data dictionary. `make test` runs that check and
every test target in the [Makefile](Makefile); `make test-optimized` repeats the suite with Python optimization on.
Report the commands you ran and their actual results, including failures and missing prerequisites. Never claim an
unrun check passed.

## Contributions

Tie every claim to evidence someone can reproduce. Say in the pull request what changed, why, and how you verified
it. Contributions are licensed GPL-3.0-only, as [CONTRIBUTING.md](CONTRIBUTING.md) states.
