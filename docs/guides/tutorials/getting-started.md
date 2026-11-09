# Getting started

EndoForge is where AI coding agents build software. An agent such as Claude Code or Codex works inside a
*workcell*: a V8 isolate (the lightweight JavaScript sandbox Node.js and browsers use) that keeps the agent's
conversation and files in memory, so many agents can work at once without starting processes or writing temporary
files. In the workcell the agent first writes a contract and tests. EndoForge freezes them, so the agent cannot
change what it will be judged by. Then the agent writes the code, and the workcell compiles it and checks it against
the frozen tests. Only code that passes is promoted, and every step is recorded in a ledger: an append-only SQLite
file where each record carries a hash of the one before it, so later edits are detectable.

Why bother, instead of letting an agent run its own tests? Because here the agent never grades its own work: the
evaluator is frozen before any code exists, the checks run outside the agent's control, and what passed is on record.
A promoted program can be served again from the library instead of asking a model again.

In this tutorial you run that loop on your own machine. First a scripted agent plays the model (a *test double*: a
script that replays fixed answers), so you need no account and every step is repeatable. You watch it build a small
coin-operated turnstile, fail a check, fix the code and get promoted. The turnstile is kept small so every step fits
on screen; real agents in the same loop build whatever they are asked to. (For work that spans a whole repository,
[run a job](../how-to/run-a-job.md) has Codex and Claude Code workers edit a real repository side by side, each change
gated the same way.) Then you read the ledger and call the program. At the end you see the exact commands that put Claude Code or Codex in the scripted agent's place.

It takes about ten minutes. The commands in sections 1 to 6 were run on Linux with Node.js 26.13.0 and Python 3.14;
section 7 says how its commands were checked without a real model.

## 1. Check the prerequisites

You need:

- Git, GNU Make and Python 3.11 or later.
- Node.js 22.8 or later. CI runs Node 22 and Node 26.
- Network access once, to install the pinned compiler.

The full test suite also needs bubblewrap (`bwrap`), `age` and `gcc`. This tutorial does not.

## 2. Clone and run the repository checks

```sh
git clone https://github.com/Akilleez-QA/endoforge.git
cd endoforge
make check
```

`make check` takes about a second. It checks the repository itself (Markdown links, the experiments index, source
digests, privacy and traceability), so a clean result means your clone is complete. The last line it prints is
`data dictionary current`.

## 3. Install the pinned compiler

The agent writes its program in AssemblyScript, a TypeScript-like language, and the workcell compiles it to
WebAssembly with one pinned compiler version:

```sh
make loop-setup
```

This runs `npm ci` in `tools/asc`. It prints `added 3 packages`.

## 4. Run the loop with a scripted agent

[`examples/agent-loop.mjs`](../../../examples/agent-loop.mjs) asks for a coin-operated turnstile. The need, in plain
words:

> A coin-operated turnstile. State 0 is locked, 1 is unlocked. Event 0 is a coin, 1 is a push. A coin unlocks it; a
> push locks it again. Any other state or event is an error.

The program the agent must write is a *kernel*: a pure WebAssembly function with no access to anything outside it,
which takes the current state and an event and returns the next state. (Kernel here means application logic, not an
operating-system kernel.) The agent also writes `glue.json`, which tells a user interface how to show each argument
and result: here, tables that name the codes `locked`, `unlocked`, `coin` and `push`.

The scripted agent answers the way a model does, as tool calls (`edit_file`, `check`, `done`). Its first kernel has a
bug: a push leaves the state unchanged instead of locking. Its second kernel is correct. Run it:

```sh
node examples/agent-loop.mjs
```

It finishes in about two seconds. Your temporary path will differ:

```json
{
  "promoted": true,
  "testDouble": true,
  "turns": 3,
  "exit": "stop",
  "rounds": [
    {
      "failed": [
        "G4_tests"
      ],
      "tests": [
        "push locks"
      ]
    },
    "passed"
  ],
  "ledger": "/tmp/ef-agent-loop-aAzxcY/turnstile/ledger.sqlite"
}
```

What happened, in three agent turns and one commit:

1. **Specification turn.** The workcell sent the need to the agent. The agent wrote `CONTRACT.md` and `tests.json`
   (five tests, including `push locks`: `next(1, 1)` must be `0`, and one test that an unknown event traps).
   EndoForge checked that every test can fail, then froze both files: their hashes went into the ledger before any
   code existed.
2. **First implementation turn.** The agent wrote `kernel.ts` and `glue.json`. The workcell compiled the kernel and
   ran gates G1 to G9, nine independent checks described in section 5. `G4_tests`, the frozen tests, failed on
   `push locks`.
3. **Repair turn.** The failure went back to the agent as its next prompt. It rewrote the kernel, every gate passed,
   and the agent said `done`.
4. **Commit.** The host wrote the candidate, its receipt and a `promote` decision to the ledger in one transaction.

The whole conversation and the agent's files lived in memory inside one workcell. The host was asked only for model
turns and for the freeze. `testDouble: true` says a scripted agent wrote the code: the run shows the machinery works,
and says nothing about any real model.

## 5. Read the ledger

[`examples/show-gates.py`](../../../examples/show-gates.py) opens the ledger, which verifies its hash chain, and prints
each gate's result from the receipt and the final decision. Use the ledger path from your output:

```sh
python3 examples/show-gates.py /tmp/ef-agent-loop-aAzxcY/turnstile/ledger.sqlite
```

```text
ledger records: task, admitted_input, frozen_evaluator, candidate, receipt
  G1_frozen         pass
  G2_compiles       pass  {"wasmBytes": 114}
  G3_exports        pass  {"exports": ["next"]}
  G4_tests          pass  {"passed": 5, "total": 5}
  G5_deterministic  pass
  G6_bounded        pass  {"maxMs": 0.010449, "fuelUsed": 130}
  G7_glue           pass
  G8_nonfinite      pass  {"probes": 0}
  G9_units          pass  {"checks": {"next": "code"}}
decision: promote
kernel: /tmp/ef-agent-loop-aAzxcY/turnstile/kernel.wasm (114 bytes)
```

Each record kind has a job. `task` is the need, `admitted_input` the need and configuration the host accepted,
`frozen_evaluator` the hashes of the frozen contract and tests, `candidate` the source and compiled module, and
`receipt` the gate results. The ledger is append-only: SQLite triggers refuse updates and deletes, and each record's
hash covers the one before it, so an edited record makes `Ledger(path).records()` fail with
`ledger chain failed at sequence N`. The [ledger ICD](../../interfaces/ledger-icd.md) describes every record.

The gates, briefly: G1 the frozen files are unchanged; G2 the kernel compiled and imports nothing but `env.abort`; G3
it exports what the tests call; G4 the frozen tests pass on a fuel-metered instance (one that counts instructions
and stops a runaway loop); G5 a second fresh instance gives
the same results; G6 it never runs out of fuel or stack; G7 the glue matches its closed schema and the exports;
G8 float arguments given NaN or infinity behave as the contract says; G9 the units in the glue agree with the
kernel's arithmetic. The
[candidate loop](../../architecture/candidate-loop.md) page has the detail.

`show-gates.py` also saved the promoted module as `kernel.wasm`. It is an ordinary WebAssembly module; call it from
Node.js:

```sh
node -e '
const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
const { next } = new WebAssembly.Instance(m, { env: { abort() { throw Error("trap") } } }).exports;
console.log("coin while locked:", next(0, 0), " push while unlocked:", next(1, 1));
try { next(0, 7) } catch (e) { console.log("unknown event:", e.message) }
' /tmp/ef-agent-loop-aAzxcY/turnstile/kernel.wasm
```

```text
coin while locked: 1  push while unlocked: 0
unknown event: trap
```

## 6. Watch a refusal

Run the same script with `stubborn`. Now the scripted agent sends the buggy kernel every time:

```sh
node examples/agent-loop.mjs stubborn
```

```text
{
  "promoted": false,
  "testDouble": true,
  "turns": 7,
  "exit": "max_turns",
  "rounds": [
    {
      "failed": [
        "G4_tests"
      ],
  ...
```

The loop gave the agent one specification turn and six implementation turns (`limits.maxTurns`, default 6), then
stopped. The receipt was still written, and `show-gates.py` on this ledger prints `G4_tests FAIL {"passed": 4,
"total": 5}` and `decision: refuse`. Nothing was promoted.

## 7. Put a real agent in the loop

The scripted agent stands in for a *provider*, the piece that answers the workcell's model turns. A real provider
wraps a model CLI (a *transport*). Swap it, and everything else (the workcell, the freeze, the gates, the ledger)
stays the same. This tutorial does not call a real model: we ran the commands below with stand-in CLIs that behave
like `claude` and `codex` without a model behind them, and the experiments linked under each one ran them with real
models.

### Claude Code

EndoForge drives `claude -p` with its own tools turned off and uses it only as the model. Model calls must run on a
claude.ai subscription login (Pro, Max or Team), never on API billing: the subscription guard refuses the launch with
exit 78 if `ANTHROPIC_API_KEY` or another billing variable is set, or if the login has no subscription.

Check the login first. `claude auth status` should report `"authMethod": "claude.ai"` and a `subscriptionType` of
`pro`, `max` or `team`:

```sh
claude auth status
```

Then run the loop on your own need with
[`examples/claude-agent-loop.mjs`](../../../examples/claude-agent-loop.mjs). It wraps the CLI in a
`WarmClaudeTransport` (one long-lived `claude -p` session in stream-json mode) and runs the same agent loop:

```sh
node examples/claude-agent-loop.mjs --model sonnet --effort low "Convert kilowatts to mechanical horsepower for 0 to 10000 kW."
```

`--config-dir` picks a login other than `~/.claude`. Sonnet at low effort is the default because it was the fastest
arm that met the quality bar in [P-56](../../../experiments/P-56-model-effort/RESULT.md) (27.4 s per accepted
capability, 28 of 30 accepted). Without a subscription login the script stops before any model call (home path shortened):

```text
claude -p refused (exit 78): no claude.ai login in ~/.claude (.credentials.json is missing). Model calls must run on a claude.ai subscription login, never API billing.
```

Receipts for real Claude Code runs on this path: [P-50](../../../experiments/P-50-in-isolate/RESULT.md) (the transport
proof, 2 of 2 promoted) and [P-56](../../../experiments/P-56-model-effort/RESULT.md) (320 runs over eight model and
effort arms).

### Codex

Codex writes files in a working directory rather than answering with tool calls, so it uses a different loop path,
`isolate`: `codex exec` writes the files on the host machine, and the freeze, compile, gates and commit happen in the
workcell. Log in with a
ChatGPT plan (`codex login`), then check:

```sh
codex login status
```

It should print `Logged in using ChatGPT`. Then run
[`examples/codex-loop.mjs`](../../../examples/codex-loop.mjs):

```sh
ENDOFORGE_CODEX_CMD=codex CODEX_HOME=~/.codex node examples/codex-loop.mjs "Convert kilowatts to mechanical horsepower for 0 to 10000 kW."
```

`CODEX_HOME` is the login directory Codex reads. EndoForge passes it through and never reads the auth file. To spread
work over several Codex logins, set `ENDOFORGE_CODEX_CMD` to the account pool, which runs `codex` with the next free
login and cools a login down when it hits a rate limit:

```sh
ENDOFORGE_CODEX_CMD="[\"node\",\"$PWD/core/runtime/agent-pool.mjs\"]" CODEX_HOME=~/.codex node examples/codex-loop.mjs "Convert kilowatts to mechanical horsepower for 0 to 10000 kW."
```

The path must be absolute, because the command runs inside the need's own working directory.

The pool reads `~/.codex/auth.json` and `~/.codex-accounts/<name>/auth.json`; the
[configuration reference](../../configuration/configuration-reference.md#codex-account-pool) lists its settings.

Receipts for real Codex runs through `runNeed`: [P-22](../../../experiments/P-22-real-need-to-candidate/RESULT.md)
(41 of 60 promoted; generation is about 99% of the latency), [P-27](../../../experiments/P-27-g4-fix/RESULT.md)
(57 of 60) and [P-28](../../../experiments/P-28-p21-nov2/RESULT.md) (16 of 20, median 72.6 s, the time going to
Codex).

## 8. Clean up

Each run leaves its ledger in a temporary directory (`ef-agent-loop-*`, `ef-claude-loop-*` or `ef-codex-loop-*` under
your system's temporary folder). Delete them when you are done.

## Next steps

- [Run the agent loop](../how-to/run-the-agent-loop.md): providers, pools, limits and waits in your own code.
- [Run a job](../how-to/run-a-job.md): take a larger piece of work from intake to merged changes with several agents.
- [Run local checks](../how-to/local-checks.md): the full test suite.
- [Configuration reference](../../configuration/configuration-reference.md): every setting and its default.
