# P-50 the candidate loop inside the isolate: result

Status: **Recorded (probe)**, 2026-11-06, Node v26.13.0, 32 threads, under `heavy-run`'s CPU quota and `nice 10`, on a shared desktop with other agents' tests running (load average 10–25). Ledgers were on a btrfs NVMe partition where one `fsync` took 9.4 ms at p50. Precommit: [PRECOMMIT.md](PRECOMMIT.md).

**The process and temp-file crossings are gone and verdicts match, but the 100 ms line was not met.** With generation in the cell and a scripted model, non-model time per candidate is 132–134 ms at p50 and 326–357 ms at p95, against 1,472 ms and 1,759 ms on the current path. About half of the p50 is creating and freezing a new ledger for each task. Excluding that, it's 68–69 ms at p50 and 212–248 ms at p95. The p95 is mostly the compiler on a loaded machine. No model call was timed here beyond the transport arm and the two real runs below.

## After the review of 6122dc8

An independent review found fifteen problems ([PRECOMMIT amendment 4](PRECOMMIT.md)). The review's regression file failed on 6122dc8 ([before](receipt/review/before-6122dc8.txt)) and passes 43 of 43 on 5d63294 ([after](receipt/review/after.txt)). The arms were rerun at 5d63294 in [after-review](receipt/after-review/summary.json), with the 1-minute load between 10.0 and 12.0 at every arm's start and end, so each is labelled acceptance under the rule of 16. It wasn't a held quiet window.

| Arm | Non-model p50 / p95 | Freeze | Compile | Gates | Ledger |
|---|---|---|---|---|---|
| `current` | 1,297 / 1,766 | 170 / 208 | 499 / 702 | 392 / 548 | 131 / 172 |
| `isolate-process` | 148 / 173 | 69 / 73 | 48 / 64 | 7 / 12 | 22 / 25 |
| `agent-process`, the default | 116 / 123 | 61 / 63 | 37 / 43 | 4 / 8 | 9 / 11 |
| `agent-thread` | 124 / 150 | 63 / 72 | 42 / 58 | 4 / 8 | 9 / 12 |
| `agent-process-8` | 562 / 815 | 295 / 412 | 56 / 78 | 6 / 12 | 247 / 383 |
| `agent-thread-8` | 562 / 774 | 294 / 419 | 55 / 71 | 5 / 11 | 247 / 398 |

B2 still fails: 116 ms at p50 against the 100 ms line, and the freeze, a new ledger per task, is 61 ms of it. Process cells with `--permission` didn't cost time; they were 8 ms faster than thread cells at p50. Parity covered 39 inputs, the six weak specifications, an expired deadline and a blank need included, with 0 differences and 0 wrong verdicts. The counter, now also seeing `write`, `writev`, `pwrite64`, `pwritev`, `ftruncate`, `fallocate` and `memfd_create`, saw 0 spawns and 0 writes from need to admission and from admission to commit on all 21 kernels in both cell kinds. It can't see writes through a shared memory map.

Predictions in amendment 4: 11, process within 10 ms of thread, **held** (it was faster). 12, `agent-process` p50 between 120 and 170 ms, **failed**: 116 ms. 13, warm's token growth comes from cache creation after `/clear`, **not tested**: the transport proof wasn't rerun, because that needs real model calls.

Corrections to the text below:

- "0 file changes" in A1 and B1 meant no file opened for writing, before amendment 4. The rerun above is the first count of writes themselves.
- Handoffs: the counter records 4 per candidate on the agent path with the scripted model. The review counted 6, plus 2 per model turn. The two counts haven't been reconciled, so neither is claimed as final.
- Transport: warm stream-json's wall p50 was 3,040 ms per turn against 1,955 ms for spawn per turn, in the same receipt; its lower overhead is wall minus the CLI's API time, which hides that. The review read its tokens per turn as growing from 63 to between 146 and 1,357. That may be a real cost of `/clear` or the warm prompt and hasn't been investigated.
- `run`, `scanEffects` and the usage figures in `loop-port.mjs` are constants, so `bounds`, `determinism` and `forbidden_effects` are vacuous there, and G5 and G6 aren't measured from outside the cell as E3 §4 asks. Replacing them is a separate change.
- The conversation and the file overlay live only in cell memory. There's no durable continuation: losing a cell loses the attempt's turns, and the resumed attempt starts again from the frozen evaluator.
- `isolate-ledger.mjs` imported `tools.x1_loop` by name, so a generic pool's `ready()` depended on that file. The ledger policy now reaches the pool through a port.
- E3 §6 Qualified and Confirmed with context separation isn't built. The freeze record now says `none` for confirmation and qualification instead of the fixed values it carried.

## Acceptance

The table below is from the earlier runs. The review's changes and the reruns are in the section above.

| Item | Result | Evidence |
|---|---|---|
| A1, B1: zero spawns and temp-file writes up to commit | **Pass** | Tracer: 0 spawns, 0 execs, 0 file changes per candidate on 21 kernels in thread and process cells, generation included on the agent path. Positive control saw 9 spawns and the temp directory on `current`. One real run through the warm transport also saw 0, excluding the transport's own tree. |
| A2: under 100 ms, generation returned to promotion | **Fail** | `isolate-thread` 301 / 479 ms, `isolate-process` 292 / 324 ms (p50 / p95). |
| B2: under 100 ms, need to promotion | **Fail** | `agent-thread` 134 / 357 ms, `agent-process` 132 / 326 ms, in the second run. First run, before the schema fix: 140 / 309 and 138 / 282 ms. |
| A2w, B2w: same line at 8 cells | **Fail** | `isolate` 1,773–1,920 ms p50, `agent` 711–720 ms p50 (first run). `current-8` 2,369 ms. Serial fsyncs in the bridge dominate. |
| A3, B3: verdicts match | **Pass** | 31 inputs, 0 differences in promoted or G1–G7, in 3 arm pairs and an earlier parity run. |
| A4, B4: seeded bad candidates refused | **Pass** | All 9, in `make loop-test` and the parity arm. |
| A5, B5: mutated evaluator doesn't pass | **Pass** | `make loop-test`. |
| A6, B6: forged receipt refused | **Pass** | 12 forgeries, with an unforged control that promotes. Limit below. |
| A7, B7: real kills give no false promotion | **Pass** | `make loop-test`: SIGKILL of cell, supervisor and bridge at each point, plus 8 rounds of random kills on the `isolate` path. Not a power-loss test. |
| B8: one durable crossing | **Fail on the strict reading** | One per candidate, plus one per task. |
| E3 §9: waiting releases compute | **Fail** | The cell, its pool slot and its memory stay held through every model turn. |

## Time, per candidate

p50 / p95 in ms, one cell. Receipts: [generation-to-ledger](receipt/generation-to-ledger/summary.json), [agent](receipt/agent/summary.json), [agent-second](receipt/agent-second/summary.json).

| Arm | Non-model | Freeze | Compile | Gates | Ledger | Promote |
|---|---|---|---|---|---|---|
| `current` | 1,472 / 1,759 | 339 / 538 | 532 / 625 | 340 / 393 | 156 / 279 | 91 / 107 |
| `isolate-thread` | 301 / 479 | 194 / 334 | 42 / 48 | 5 / 9 | 60 / 89 | in ledger |
| `isolate-process` | 292 / 324 | 188 / 215 | 38 / 47 | 4 / 7 | 59 / 65 | in ledger |
| `agent-thread`, second run | 134 / 357 | 65 / 122 | 49 / 195 | 5 / 20 | 10 / 19 | in ledger |
| `agent-process`, second run | 132 / 326 | 65 / 117 | 47 / 158 | 6 / 19 | 10 / 18 | in ledger |

Warm-up isn't per candidate: `ready()` took 2.5–3.5 s for one cell and 6–8 s for eight.

The `isolate` arms ran at commit `77db75d`, before WAL, the one-transaction schema and the decision in the commit transaction. Those changes, and no oracle files on disk, took the commit from 60 to 10 ms and the freeze from 190 to 65 ms. The freeze's remaining cost is mostly a new SQLite file: a separate profile on this disk took about 35 ms to switch to WAL and about 29 ms for a first commit, with fsyncs not counted one by one. It's paid once per task, because each need has its own ledger, a P-22 harness choice.

## Handoffs per candidate

| Path | Spawns | Bridge | Cell messages | Total |
|---|---|---|---|---|
| `current` | 9 | 2 | 2 | 13 |
| `isolate` | 0 | 1 | 2 | 3 |
| `agent` (need to return) | 0 | 2 (freeze, commit) | 2, plus 2 per model turn | 4, plus 2 per turn |

## Transport

Real CLI on the cheapest model, one logged-in account, subscription sign-in, 5 trivial turns each ([receipt](receipt/agent/transports.json)). Overhead is wall time minus the CLI's reported API time.

| Transport | Overhead per turn | Process spawns |
|---|---|---|
| Spawn per turn | 343 ms p50, 367 ms first turn | 5 |
| Warm stream-json | 15 ms p50 after the first, 496 ms first turn | 1 |

Warm is workable. It carries `--tools ""` and refuses a session whose init reports any tool but `StructuredOutput`, an API key source, or an MCP server. Setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` mattered: a probe without it saw about 2 s per turn outside API time, though it wasn't a controlled comparison. `/clear` costs about 20 ms and no API call. A probe saw a code word gone after it; the same probe wasn't repeated in the proof, which has one session.

With a real CLI, the 100 ms line can't count the transport's own turn overhead too, on the first turn at least: it's reported beside the line, not inside it.

Real runs: 2 of 2 promoted on `add`, in 2 turns with no repair ([untraced](receipt/agent/proof-untraced.json), [traced](receipt/agent/proof-traced.json)), about 11–13k tokens, non-model 204 and 143 ms. That is one easy need on a cheap model, which says nothing about quality in general. The transport's tree changed 14 files during the traced run, which are its own and are outside B1. Its overhead figures in those two files for the second turn are wrong: the CLI's API time is cumulative within a conversation. Corrected, it's 18–48 ms, and the script is fixed.

## Predictions

1. `current` 800–1,200 ms: **failed**, 1,472 ms. 8 spawns: **failed**, 9, with one fork not attributed.
2. `isolate-thread` 50–90 ms, p95 under 100: **failed**. It put the freeze at 5–15 ms and it took 194 ms.
3. Process within 15% on one cell: **held**. Process beats thread at 8: **failed**, 1,920 against 1,773 ms; the bridge is the limit there.
4. `isolate-thread-8` misses: **held**.
5. Handoffs 12 to 3: **held**, except it's 13.
6. Reference evaluation stays outside: **held**. From a thread, a `vm` escape reached the file system; in its own process under `--permission`, access was denied. It's kept, counted as 1 spawn for `ENDOFORGE_CODEX_TERSE=reference` needs, and isn't on the agent path.
7. `agent-thread` 55–95 ms: **failed**, 134 ms.
8. Warm saves at least 500 ms per turn: **failed**, about 330 ms. Warm's overhead of 20–200 ms: **beat it**, 15 ms.
9. `/clear` across candidates without leaking: **held in one probe and in the test double**; not repeated in the proof.
10. Proof promotes on `add`: **held**, n=2.

## What's left outside the isolate

- The model call, through the host's transport. Its startup is outside the window and recorded separately.
- The freeze crossing and the commit crossing. The evaluator stays durable before implementation turns, as the design requires.
- `x1/reference.mjs`, on its own path only, for the reason above.
- The cell is held idle during a model turn. No CPU, but the pool slot and the cell's memory stay held, unlike E3 §9's "waiting releases compute". Keeping a failed check in-process was the request; a pool sized for model concurrency is the cost.

## What this does not show

- A self-consistent forged report, from trusted code in the cell, can't be told from a real one without re-running the kernel. The commit checks bindings, frozen tests and recorded values against expectations, not that the kernel produced them.
- Kills aren't power loss. WAL with `synchronous=FULL` is relied on, not tested, for that.
- Synthetic kernels with golden tests. P-22's real kernels aren't retained.
- A shared desktop, no quiet gate, one host. The p95 tail tracks other load.
- The `agent-*-8` arms ran before the schema fix and weren't repeated.
- The default path is still the current one. Nothing here changes it.
