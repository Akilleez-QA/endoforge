# P-50 the candidate loop inside the isolate: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement. No model calls and no spending: generation is the repository's existing test double. Model speed is a separate lever and is excluded by subtraction.

Question: between generation returning and promotion, the current X1 path spawns a process for compile, each frozen check, register and promote, and uses a temp directory. If compile, frozen verification, gates and bounded repair checks run in one warm workcell, and durable state crosses once through the persistent bridge, does everything around the model fall under 100 ms per candidate, with the same verdicts and no false promotion?

## Arms

Both arms run the real `runNeed` on the same inputs, selected by `ENDOFORGE_LOOP`. No retries or exclusions.

- `current`: the existing path, with the real AssemblyScript 0.28.20 `asc` executable as `ENDOFORGE_ASC_CMD`, one pool cell.
- `isolate-thread`: the new path in one thread cell, warmed by `ready()`.
- `isolate-process`: the new path in one process cell, warmed by `ready()`.
- `current-8`, `isolate-thread-8`, `isolate-process-8`: the same at 8 cells with 8 requests in flight.

Inputs: the 20 synthetic kernels in `experiments/P-15-workcell-concurrency/kernels` (3 are type errors by design) and the `add` kernel of P-22's P-19 cohort, 21 in all. Real P-22 kernels aren't retained in this repository, so P-22's numbers are a reference only and "the same kernels" means the same kernels in both arms here. Frozen tests and glue for each kernel are built once before the arms, from one compile and call of its numeric exports, and are identical in every arm. 5 reps of the 21 in one-cell arms, 3 reps in 8-cell arms, under `heavy-run`.

## Measures

- **Non-model time**: wall time of the whole `runNeed` attempt, including freeze, minus time inside the generation client invocations. Pool warm-up isn't per candidate and is reported separately. Nearest-rank p50 and p95 per arm.
- **Spawn and file counter**: a ptrace tracer (`syscount.c`) follows every thread and process in the run tree, including the ledger bridge and cells, and records actual syscalls: `execve`, `execveat`, process-creating `fork`, `vfork`, `clone` and `clone3`, and file-changing `open`/`openat`/`openat2` with write or create flags, `creat`, `mkdir`, `mkdirat`, `rename`, `renameat`, `renameat2`, `unlink`, `unlinkat`, `rmdir`, `link`, `linkat`, `symlink`, `symlinkat`, `truncate`. The run marks each window with a `stat` of a marker path the tracer recognizes. Read-only opens are also counted and reported. The same tracer on `current` is the positive control: if it doesn't see that arm's spawns and temp files, the counter isn't evidence and the result says so.
- **Handoffs**: process spawns plus bridge requests plus messages crossing the cell boundary, per candidate, between generation returning and the promotion returning. Spawns come from the tracer, bridge requests and cell jobs from counters in the harness.

## Acceptance, fixed by the request and not changed after this point

- **A1** Zero process spawns and zero temp-file writes per candidate between generation returning and the ledger commit starting, by the tracer, for `isolate-thread` and `isolate-process`.
- **A2** Non-model time under 100 ms per candidate on the one-cell arms. The stricter reading applies: A2 passes only if both p50 and p95 are under 100 ms on an arm. p50 alone passing is reported as what it is. The 8-cell arms are reported against the same line as **A2w**.
- **A3** Verdicts match: on the 21 kernels and every seeded bad candidate below, `promoted` and the G1–G7 pass/fail vector are equal between `current` and each isolate arm. Bytes of WASM aren't required to match, since `current` compiles under a random temp path.
- **A4** Seeded bad candidates are refused in the isolate arm: type error, wrong answer, missing export, extra import, invalid glue, source importing a host path, an infinite loop, and a kernel that traps on every call.
- **A5** A mutated frozen evaluator doesn't pass: a changed, added or deleted file in the frozen tree after admission (before the job, during it, and just before commit), a changed implementation file after admission, a changed bundle in the job with its digest unchanged, a self-consistent changed bundle and digest, and a change to the held bundle during the job.
- **A6** A forged receipt is refused: wrong hash, wrong candidate, wrong evaluator digest, a forged gate verdict, missing rounds, tests dropped from the report, a recorded value that doesn't meet its expectation with `pass: true`, a wasm digest that isn't the candidate's, and a kernel swapped by the cell.
- **A7** Crash tests with real SIGKILLs at each new point show no false promotion: cell during compile, during gates and after verdict; supervisor before and just after the commit request; bridge after each record, before SQLite commit, after commit before the decision, after the decision before the response; plus bridge kills at random times. After each: the chain verifies, a kill before commit leaves no candidate, receipt or decision for that attempt, no promotion was returned without its durable records, and the task can run again.

Each failure stays a recorded failure.

## Predictions

1. `current` non-model p50 is 800–1,200 ms, close to P-22's roughly 900 ms. Spawns are 8 per candidate: compile, register, 5 frozen checks, promote.
2. `isolate-thread` p50 is 50–90 ms: compile about 40 ms from P-20's addendum, gates and in-memory verification under 10 ms, commit with its fsyncs 10–30 ms, freeze 5–15 ms. p95 is under 100 ms on one cell.
3. `isolate-process` matches `isolate-thread` within 15% on one cell, and beats it at 8 cells, as P-48 saw for threads sharing an address space.
4. `isolate-thread-8` misses 100 ms at p95 and may miss at p50, since the compiler is CPU-heavy and P-15 saw a p50 of about 62 ms at 10 cells with no durable commit.
5. Handoffs fall from 12 (8 spawns, 2 bridge requests, 2 cell messages) to 3 (1 bridge request, 2 cell messages), with one more bridge request per task before generation returns, for freeze and admission.
6. Reference evaluation stays outside: a `vm` context in a cell isn't an equivalent boundary to a child under `--permission` with an empty environment. A probe shows it by escaping the context in a cell and reaching the file system. If the probe can't, this prediction fails.

## Amendment 1, after the harness failed

The first run reached the tracer's `isolate-thread` arm and stopped: the input list was over Linux's 128 KiB limit for one argument, so the tracer never started. Its parity arm had completed, with 0 differences in 31 inputs, and is kept as the first of two parity runs. The list now goes in a file. Nothing else changes, and everything runs again.

## Amendment 2, scope corrected by Craig before the agent path was measured

The arms above cover only generation returning to the ledger commit, and their results are labelled that way. Craig: "the whole point is not to run the CLIs outside of the isolate". The agent loop itself runs in the workcell: file overlay, turn loop, compile, checks, repair. The model is reached only through a host-owned transport behind a provider port. Subscription sign-in only, with no API keys or billing and no credential contents read. The CLI is a model transport with its tools off and no access to a working directory.

New arms, all with the kernels, tests and seeds above, `runNeed` under `ENDOFORGE_LOOP=agent`:

- `agent-thread`, `agent-process`: one cell, with a scripted provider that replies at once. 5 reps of the 21. `agent-thread-8`, `agent-process-8`: 8 cells, 3 reps.
- Parity: the same 31 inputs through `agent-thread` and `agent-process`, against `current`.
- Count: `agent-thread`, `agent-process` under the tracer. `need` marks admission of the need to the cell.
- Transport: `SpawnClaudeTransport` and `WarmClaudeTransport`, 5 trivial turns each on the cheapest model and one logged-in account, recording each turn's wall time and the CLI's reported API time. Warm startup is recorded separately.
- Real proof: one need, end to end through the warm transport, untraced for timing and once more traced. Its candidate quality is the model's, and is reported either way.

Revised acceptance:

- **B1** From need admission to ledger commit starting, zero process spawns and zero temp-file writes per candidate on the warm path, by the tracer, excluding the transport's own startup and its own process tree, which are recorded separately. The freeze crossing's own durable writes are reported as such and aren't temp files. Generation is inside this window.
- **B2** Non-model time under 100 ms at both p50 and p95 on `agent-thread` and `agent-process`. Non-model is wall time of the attempt minus time inside the provider call. 8-cell arms are reported against the same line as **B2w**. The transport's own overhead per turn (its wall time minus its reported API time) is reported beside it, not hidden in the subtraction.
- **B3** Verdicts match `current`, as A3.
- **B4–B6** A4, A5 and A6 hold on this path. Where no frozen tree exists on disk, A5's disk cases don't apply: the bundle is only in the ledger and in memory, and tampering with the ledger record stands in.
- **B7** A7 holds, adding kills during the model wait and just after admission.
- **B8** Leaving the isolate: only the model call through the host's transport and durable ledger crossings. The request says one crossing. Freeze-before-code needs the evaluator durable before implementation turns, so this design has one per candidate plus one per task. On the strict reading that is a failure, and it is reported as one.

Predictions:

7. `agent-thread` non-model p50 is 55–95 ms, about the same as `isolate-thread` since it compiles once and adds a turn loop and two cell messages per turn. p95 under 100 ms is less likely than p50.
8. Warm saves at least 500 ms per turn over spawn, excluding API time. Warm's own overhead per turn is 20–200 ms, so with a real CLI the 100 ms line is met by the harness and likely not by the harness plus the transport.
9. `/clear` keeps a warm process usable across candidates without leaking a prior conversation. A probe on 2026-11-06 saw this with one model, 4 turns; the real proof repeats it.
10. The real proof promotes on `add`, on a cheap model, perhaps after one repair turn.

## Amendment 3, after the first arms and before the agent arms

The `isolate` arms missed A2 on the freeze and commit, not the compiler. Before the agent arms ran: bridge-created ledgers use WAL, the agent path's decision commits in the receipt's transaction, and eviction moved after the response. After the first agent arms also missed: the ledger schema is one transaction, and `agent-thread` and `agent-process` ran again as `receipt/agent-second`. The first agent arms are kept. Acceptance and predictions are unchanged.

## Failure meaning

A1, A3, A4, A5, A6 or A7 failing means the path stays off, and the failure is named. A2 failing with the rest passing means the path is safe but not this fast, and the timing split says where the time goes. No test is softened to pass.

## Limits

A shared desktop with no quiet gate, one host and Node as recorded, `heavy-run`'s CPU quota and `nice 10`. Synthetic kernels with generated golden tests, which say nothing about synthesis quality. The tracer slows what it traces, so counting runs are separate from timing runs. A forged report in which every field is self-consistent, written by trusted code in the cell, can't be told from a real one without re-execution; the result says what is and isn't checked. `heavy-run` limits apply to all arms alike.
