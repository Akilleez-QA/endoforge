# Task atomizer: a need becomes a DAG of single-shot atoms, each in its own isolate

Written 2026-10-17 (late evening) after the owner asked for "a task atomizer that can break the full need into its smallest components so massive parallelization can be used". Labels follow `docs/CONVENTIONS.md`; the numbers below are **Recorded (probe)** unless marked otherwise. Everything here is climbable (DEC-75): the rules live in `policy.json` and in the atomizer prompt, not in anyone's head.

## The design in one rule: the isolate boundary is the atom boundary

The owner asked whether atomization should happen inside or outside the isolates. Both, by role:

- **Decomposition runs inside.** The atomizer agent sees only the need and the rules (no pool, no earlier artefacts), so its decomposition is reproducible from hashed inputs.
- **Every atom runs inside its own isolate** (bubblewrap) whose mounts are exactly its declared inputs (`/in/<producer>/<file>`, read-only) plus one writable output directory (`/out`) and scratch (`/work`, `/tmp`). The DAG's edges become mount lists. The kernel atom gets the interface and the contract but never the frozen tests; the test writer never sees the kernel; a reviewer never sees the generator's code. The honesty rules stop being prompts and become the filesystem. A failed atom is regenerated alone, with its failure report, not with the tests.
- **The scheduler, composer and verifier run outside**, as deterministic scripts with no model in them. Outside is the only place with the authority to create isolates, so nothing with judgement lives there.
- **Two kinds of isolate, one principle.** The product runs in a WASM isolate (Wasmtime); the makers run in OS isolates. Both are no-ambient-authority boundaries. The agent isolate keeps network for the model, so it protects what an atom can *read*, not secrecy from the provider.

Probe `experiments/P-07-isolate-cli-turn/` established the premise: Claude (tool-less and tool-using) and Codex turns authenticate and run inside bubblewrap from a copied credential file in a private per-run home; a tool-using agent could read its mounted input and could not see the real home; sandbox start costs 7 ms.

## The schema (`endoforge/atoms/1`)

```json
{ "schema": "endoforge/atoms/1",
  "need": { "id": "C-005", "text": "<verbatim>" },
  "acceptance": [ { "id": "A1", "statement": "...", "check": { "kind": "command", "run": "<shell over /in/compose/...>" } } ],
  "atoms": [ { "id": "k-charge", "kind": "kernel", "title": "...", "contract": "what the output must satisfy",
               "inputs": [ { "from": "need" }, { "from": "iface", "output": "interface" } ],
               "outputs": [ { "name": "charge", "path": "charge.ts", "describe": "..." } ],
               "verify": "how a script checks it without a model",
               "worker": { "model": "sonnet|opus|codex|script", "tools": [], "toolchain": ["node","asc"], "prompt": "...", "command": ["..."] },
               "size": { "work": 2, "interface": 1 } } ] }
```

Rules the validator enforces (`lib/validate.mjs`, `policy.json`): unique ids; every input names an existing atom and a declared output; no cycles; exactly one `compose` atom; non-empty acceptance written from the need; `size.work ≤ 3` (single-shot) or "split further"; `size.interface > size.work` warns "over-atomized"; forbidden edges `tests→kernel`, `kernel→tests`, `kernel→review`, `review→kernel`; a tool-less model worker has exactly one output (it replies with that file's content); at most 64 atoms.

The granularity rule given to the atomizer: an atom is the smallest unit that (a) has a contract verifiable from its declared inputs and outputs alone, (b) one worker finishes in one turn with bounded output, (c) fails alone; split until (a)–(c) hold and stop when the interface a split would create costs more than the work it saves.

## Components

| File | Role |
|---|---|
| `policy.json` | the climbable rules: limits, forbidden edges, toolchain paths, model ids, the lean CLI flags proven in P-04b |
| `lib/dag.mjs` | topological order, waves, work-weighted critical path, speedup bound (total work / critical path) |
| `lib/validate.mjs` | structural validation of `atoms.json` |
| `lib/isolate.mjs` | the bubblewrap runner: private home from the user's own credential files (copied, 0600, deleted after), system read-only binds, declared mounts, `--clearenv`, unshared pid/uts/ipc |
| `lib/workers.mjs` | builds each atom's command, mounts and prompt (script / Claude tool-less / Claude with tools / Codex); parses usage from the CLI JSON or Codex JSONL |
| `bin/atomize.mjs` | need → `atoms.json`, `plan.json`, `report.md`: the atomizer agent runs tool-less inside an isolate; one repair round on validation errors |
| `bin/schedule.mjs` | runs the DAG with a ready queue and a concurrency limit; stages inputs by hard link; per-atom receipts (wall, exit, usage, output hashes, inputs); `receipt/run.json` with realized speedup and token totals |
| `bin/verify.mjs` | every atom done, outputs unchanged since their receipts, staged inputs present, acceptance `command` checks run inside an isolate against the compose output |
| `test/run.mjs` | the tests below (`make atomizer-test`) |

```bash
node tools/atomizer/bin/atomize.mjs campaigns/x1-spec-study/work/pool/C-005.md --out tools/atomizer/examples/C-005 --model sonnet
```

```bash
node tools/atomizer/bin/schedule.mjs run tools/atomizer/examples/C-005/atoms.json --run-dir work/atom-runs/C-005 --concurrency 8
```

```bash
node tools/atomizer/bin/verify.mjs work/atom-runs/C-005
```

**Running on another host.** Override any `policy.json` toolchain path with `ENDOFORGE_TOOLCHAIN_<NAME>` (uppercase, with non-alphanumerics replaced by `_`), such as `ENDOFORGE_TOOLCHAIN_CODEX`, `ENDOFORGE_TOOLCHAIN_CLAUDE`, `ENDOFORGE_TOOLCHAIN_NODE` or `ENDOFORGE_TOOLCHAIN_ASC`. For example, set `ENDOFORGE_TOOLCHAIN_CODEX=~/.local/share/endoforge-tc/codex` to a prefix whose `bin/` holds `codex`. Paths beginning with `~/` expand to your home; relative paths resolve against the Endoforge repo root. Unset overrides use the policy defaults. Missing Codex or Claude paths fail with an error naming the override; other missing toolchains keep the existing fallback behavior.

## What was measured (2026-10-17)

- **Scheduler, synthetic DAG** (`test/run.mjs`): ten script atoms of about one second each, one seed → eight parts → one composition, concurrency 9: wall 3,055 ms against a sequential equivalent of 10,135 ms; realized speedup 3.32x against the planned bound 3.33x; both acceptance commands passed inside an isolate. An atom that read a file it had not declared failed (the file was not mounted) and its dependant was blocked; verification failed. Cycles and a `tests→kernel` edge were rejected.
- **Atomizer on a real request** (`examples/C-005/`, loop-0 request C-005, Sonnet 5.5 tool-less inside an isolate): valid on the first attempt in 63 s with 9,535 output tokens (3,026 thinking). 13 atoms in four waves: interface, contract and data in parallel; two kernel atoms, two test atoms and two glue atoms in parallel; compose; three reviews in parallel on three model families (Sonnet technician, Codex, Opus safety). Seven acceptance items written from the need, five of them executable commands. Total work 18, critical path 8 (contract → kernel → compose → review), **speedup bound 2.25x**, widest wave 6. The DAG was planned, not executed; executing it needs the compose script described below.

## Honest limits

- **Per-request speedup is bounded by the serial spine.** Contract → kernel → compose → review cannot be parallelized away; Amdahl puts C-005's bound at 2.25x. "Massive" parallelism comes from pooling the atoms of many requests in one scheduler, and from treating the hill-climb's own steps (criteria for 20 requests, 60 noise-floor runs, 160 stage-runs) as atoms. The scheduler already does this: it has no notion of which request an atom belongs to.
- **Throughput is bounded by the subscription window, not by isolates.** Parallelism lowers wall time for a fixed token budget; it does not raise the budget. Behaviour under dozens of concurrent isolates on one login is untested.
- **Boundary errors are the new failure mode.** A wrong interface stub propagates to every atom in wave 1. Measure the rate at which composition fails on interface mismatch; if it is high, the interface atom deserves Opus or a two-model check.
- **Size estimates are the agent's guesses.** `size.work` and `size.interface` drive the plan; the receipts' measured walls are the truth and should be fed back into the atomizer's calibration.
- **Built since:** `bin/compose-kernel.mjs` (deterministic merge, freeze, gates), a fixed repair stage added by the scheduler (`lib/augment.mjs`: draft compose → one repair round that sees only failing tests → final compose), `bin/fanout.mjs` (many DAGs as one pool) and `bin/report.mjs`. Execution results: `RESULTS.md`.

## How it enters the factory and the loop (deviation D-08 for loop 1)

The incumbent protocol has one worker do contract, tests, kernel, glue and self-repair in sequence (`campaigns/x1-spec-study/factory/README.md`). D-08 proposes: one atomizer turn per request, then the DAG under `schedule.mjs`, then `verify.mjs` plus the oracle panel. Predicted effects: lower wall per request (bounded as above), fewer gate-blind defects because tests are written without sight of the kernel, and per-atom receipts that locate failures. Cost: one extra model turn per request (about 10k output tokens) and the interface-error risk. Test: a factor in the loop-1 screen or a separate arm on the working set. The owner's rule applies to this file too: if the loop finds a better decomposition rule, it changes `policy.json` and this README and records why.
