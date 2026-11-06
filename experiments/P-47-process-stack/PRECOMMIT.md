# P-47 a larger stack in process workcells: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: `stackSizeMb` is refused in process mode (REQ-ISO-011), so [P-43](../P-43-tsrs-workcell/RESULT.md)'s deep inputs can't run there. Can it be supported safely, or does it stay refused?

A Worker gets a thread stack of the requested size. A forked process has a main-thread stack set by `RLIMIT_STACK` at exec, so V8's `--stack-size` only moves V8's own check. The design under test sets the rlimit first: `/bin/sh -c 'ulimit -s "$1" && shift && exec "$@"'`, then Node with `--stack-size` set 192 KiB below it, the margin a Worker uses. `exec` keeps the PID and the IPC descriptor. The pool refuses in the constructor if a preflight `ulimit -s` fails.

Arm A, naive, N = 3: `node --stack-size=261952` with the default 8 MiB rlimit, one process per probe.

Arm B, rlimit raised, N = 3 per size at 8, 64 and 256 MiB, one process per probe.

Probes: JS recursion; `JSON.parse` and `JSON.stringify` on deep nesting; `new Function` on deep nested parentheses; WASM recursion; `structuredClone` on deep nesting. Record exit code, signal, thrown error name and, for JS recursion, depth reached.

Arm C, the pool: process workcells with `WORKCELL` (256 MiB stack). Run the 11 `dos` projects and `medium/ill`, and compare diagnostics to thread mode on the same inputs. Also run the `deep` project from `tscheck.test.mjs` with and without the stack limit, one heap-exhausting job with a held sibling, and a job past its deadline.

Predictions:

1. Arm A: JS recursion dies with SIGSEGV. This is why a flag alone is unsafe.
2. Arm B: no probe dies by signal at any size. JS recursion throws `RangeError`, and depth grows with stack size.
3. Arm C: every project completes with diagnostics identical to thread mode, the deep project needs the limit, heap exhaustion is still `rejected`/`heap` with the sibling intact, and the deadline still stops the cell.

Decision: if prediction 2 and 3 hold, process mode supports `stackSizeMb` on hosts where the preflight passes, and the refusal test is replaced with the preflight refusal plus these checks. If any probe dies by signal at a size, the refusal stays and this result records why.

Failure meaning: a signal death in arm B or C means the margin isn't safe. Windows has no `/bin/sh`, so the preflight refuses it there.

Limits: one Linux host, one kernel and Node as recorded. The probes are not exhaustive of native recursion, and a native addon can still overrun.

## Amendment 1, after the first run was stopped

The first run was stopped partway and is kept as `receipt/first-run.json`. The harness was wrong in two ways: `json-stringify` at depth 5,000,000 takes longer than the harness's 180 s timeout in both arms, and its result was printed in full, and `json-parse` at depth 20,000,000 hit the timeout at 256 MiB. Those `SIGTERM`s come from the harness's timeout and aren't stack faults. Up to that point arm A had died with SIGSEGV on `js`, `json-parse`, `parser`, `wasm` and `clone`, and arm B had no `SIGSEGV`. For the rerun, `json-stringify` uses depth 100,000, `json-parse` 5,000,000, a 60 s timeout, and no probe prints its value. `SIGTERM` from that timeout is recorded separately as a timeout. Predictions and decision are unchanged, with prediction 2 read as no `SIGSEGV` or `SIGABRT`.
