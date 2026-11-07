# P-47 a larger stack in process workcells: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, kernel 7.2, default stack rlimit 8 MiB, a shared desktop with other agent work running. Precommit: [PRECOMMIT.md](PRECOMMIT.md); the last digest in `receipt/precommit.sha256` covers Amendment 1. Raw results: [summary.json](receipt/summary.json) and the stopped first run in [first-run.json](receipt/first-run.json).

**`stackSizeMb` can be supported safely in process cells on this Linux host, so the refusal is replaced.** A V8 flag alone isn't safe, which is why it stayed refused: the rlimit has to be raised first.

| Probe, N = 3 | `--stack-size` alone, 8 MiB rlimit | rlimit raised, flag 192 KiB below, at 8, 64 and 256 MiB |
|---|---|---|
| JS recursion | **SIGSEGV** | `RangeError`, depth 102,331, 836,334 and 3,352,917 |
| `new Function` with deep parentheses | **SIGSEGV** | `RangeError` |
| WASM recursion | **SIGSEGV** | `RangeError` |
| `structuredClone` of deep nesting | **SIGSEGV** | `RangeError` |
| `JSON.parse`, depth 5,000,000 | **SIGSEGV** | Returned |
| `JSON.stringify`, depth 100,000 | Returned | Returned |

No raised-limit probe died by signal in the 54 trials of the rerun.

Through the real pool with `tools/tscheck/pin.mjs` limits, in process cells:

- All 11 `dos` projects and `medium/ill` completed with diagnostics identical to thread mode. `deep-array-nesting` took 16.5 s against 16.3 s.
- The deep project from `tscheck.test.mjs` was inconclusive without the limit and passed with it.
- A heap-exhausting job was still `rejected`/`heap`, with its held sibling completing.
- A job past its deadline still ended `outcome_unknown`/`deadline`.

## Predictions

All three held, with the amendment below. Prediction 2 had to be read as no `SIGSEGV` or `SIGABRT`, since harness timeouts sent `SIGTERM` in the first run.

**The first run was a harness mistake and was stopped.** `json-stringify` at depth 5,000,000 outlasted the 180 s timeout in both arms, and printed its whole result. `json-parse` at depth 20,000,000 timed out at 256 MiB. Those were timeouts, not stack faults, and that run had no `SIGSEGV` with the rlimit raised. Depths and the timeout changed in Amendment 1, so the deep-JSON probes in the rerun are shallower than first planned.

## How it works

Process cells with `stackSizeMb` start through `/bin/sh -c 'ulimit -s "$1" && shift && exec "$@"'`, then Node with `--stack-size` 192 KiB below it. `exec` keeps the PID, so cgroup attachment and signals are unchanged. The constructor runs `ulimit -s` as a preflight and throws if the host refuses, which includes a hard limit below the request and hosts with no `/bin/sh`. Without `stackSizeMb`, cells are still plain `fork`.

## What this does not show

- One Linux host and Node version. Other hard limits are refused by the preflight, but other platforms weren't run.
- The 192 KiB margin is the one a Worker uses, and these probes didn't overrun it. They don't cover all native recursion, and a native addon can still overrun it.
- Process mode doesn't share the compiled module, so a process cell pays the compile that [P-45](../P-45-shared-module/RESULT.md) removes from threads.
- `heavy-run` reported one process left in the scope at the end of the rerun. It wasn't identified. A direct check after closing plain, stack and deadline process pools found no children left.
