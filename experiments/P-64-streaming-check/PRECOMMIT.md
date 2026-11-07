# P-64 working while the model writes: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. Model calls only through `claude -p` on the default subscription login (`authMethod` `claude.ai`, `apiKeySource` `none` at every init), at most 300 calls in total, 9 of them already spent on the diagnostic below.

Question: a candidate's critical path is mostly the model call (P-56: model time 98.7–99.5% of wall). Can we shorten it by acting on the reply while it streams: (a) start the check as soon as the code closes, (b) refuse a candidate as soon as a streamed prefix proves it fails and stop the call, (c) start a speculative next attempt before the current verdict and cancel it if the current one passes?

## Diagnostic before this precommit (9 calls)

Recorded with `diagnose.mjs` and `record.mjs`: the agent loop at this commit's parent, one process cell, `sonnet` at `low` effort (P-56's choice), a spawned `claude -p` per turn with `--output-format stream-json --include-partial-messages`, each stdout line timestamped. H01 (2 calls, promoted) with default streaming, H03 (7 calls, rejected at `max_turns`) with `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1`.

1. **The reply text does not stream by default.** The transport asks for `--json-schema`, so the reply is the input of the CLI's `StructuredOutput` tool. Without fine-grained tool streaming, all 285 and 135 `input_json_delta` events of the two H01 turns arrived inside the last 11 ms and 5 ms of the turn (the tool block opened 5.7 s and 2.6 s earlier). No code is visible before the model finishes, so (a) and (b) cannot act on the current transport at all. Thinking deltas do stream.
2. **With `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1`** (a CLI setting, read from the environment, not a credential) the tool input streams. In H03's first implementation turn `kernel.ts` closed at 9.36 s and `glue.json` at 11.42 s, the last token at 11.43 s: the kernel was complete 2.07 s before the model finished. The final structured output equalled the concatenated stream in all 9 turns.
3. **One API request per turn.** `num_turns` 2 is the CLI's tool round; there is no second model request after the `StructuredOutput` call. The `result` event came 7–26 ms after the last token and the process exited 15–51 ms after that.
4. **The tail is already small.** Last token to process exit: 28–77 ms per turn. The loop's own non-model time: H01 85 ms over 2 turns of a 19.7 s candidate, H03 392 ms over 7 turns of 52.5 s. Over P-56's 30 `sonnet-low` main runs (no new calls): non-model p50 295 ms of a 24.0 s wall, 1.30% at p50; adding the CLI's wall-minus-API time per turn (p50 114 ms per run) gives about 1.7%.

**The strongest rival holds before measurement:** the tail after the last token is under 5% of latency (about 1–2%), so (a) cannot reach a 15% end-to-end gain; by arithmetic the most it can save is the whole tail. As the lane instructs, the precommit pivots its weight to (b) and (c), and still measures (a) so that bars 1–3 are answered with numbers.

## Design under test

All three are measured in a **recorded-stream replay harness**. Real token timings are recorded once; replays are deterministic in their inputs and spend no calls.

- **Recording** (`record.mjs`, `run.mjs record`): the unchanged agent loop (`ENDOFORGE_LOOP=agent`, `release` waits, process cell) with a recording provider that spawns `claude -p` per turn with the transport's own `spawnArguments`, `--include-partial-messages` and `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1`, an allow-listed environment with no credential variable, and writes every stdout event with its time since spawn, keyed by the digest of the request messages. The loop's verdicts in the recording are the non-streaming reference.
- **Replay** (`replay.mjs`): a provider that answers each request from the recording with the same key, re-emitting the events on their recorded clock and resolving at the recorded process exit, through the same unchanged loop. A request with no recording is an error. Verdicts must equal the recording's.
- **Pre-checker** (`precheck-worker.mjs`): a worker thread (its own V8 isolate) with the pinned compiler warm. During a replayed turn an incremental scanner (`stream.mjs`) emits each element of `calls` when it closes. The provider rebuilds the file overlay from the conversation exactly as the loop does (`applyReply` over earlier assistant turns, with the stage's editable files), applies each closed edit to a copy, and:
  - when `kernel.ts` closes in an implementation turn, compiles it and runs `runGates` with the frozen files and the last known `glue.json`, keeping only the gates that do not read `glue.json` (G1–G6 and G8). If any fails, the turn's check must fail whatever glue follows, provided no later call edits `kernel.ts`; that is the **early refusal** of (b);
  - when the reply's last edit closes, runs the full check (the same compile options, memory-page limit and `runGates`) on the final files, reusing the compile when `kernel.ts` is unchanged. Its verdict at the last token is (a);
  - in a specification turn, when `tests.json` closes, runs `testProblems`; a non-empty result is an early refusal.
- **(a) tail.** Per turn, *tail before* is last token → verdict available on the non-streaming path: process exit, plus the full check started at exit, measured in the same worker. *Tail after* is last token → verdict available on the streaming path: the later of the last token and the pre-check's finish, plus the time to read the `result` event instead of waiting for exit. Per candidate, the tail is the sum over its turns plus the loop's other non-model time that does not depend on streaming (freeze, the final residual gates, the commit), taken from the replayed loop's timings and identical in both.
- **(b) savings.** For each refused turn: seconds from the refusal to the last token, and output tokens after the refusal point, estimated as the turn's non-thinking output tokens times the share of streamed tool-input characters still to come.
- **(c) speculation, fail-triggered hedge.** When (b) refuses an implementation turn, a fresh implementation attempt starts at the refusal time from the same frozen specification, in parallel with the current path's repair. The first path to a passing check wins; the other is cancelled and recorded with its model-seconds and tokens up to the cancel. The hedge's own streams are recorded live (`run.mjs hedge`): the replay provider answers the specification turns from the recording, then the first implementation request and everything after it go to a live call. As a reference arm with no new calls, **always-hedge** starts a parallel attempt at every implementation turn's first token and is cancelled when the current turn passes; its cost is estimated from the current turn's own recorded duration and tokens.

## Workload and arms

- **H**: P-56's ten fixed-interface needs H01–H10, 3 reps each, `sonnet` `low`, width 3, 30 recorded runs. Directory basenames are fixed (`H01-r0` …) so requests replay byte for byte.
- **P-57 workload**: P-50's 21-kernel corpus with its stage-scripted replies (P-57's `serial-release` arm, 2–3 turns per candidate). Scripted replies have no token timing, so each reply is given a stream synthesized from a recorded profile: turn *k* of corpus entry *i* takes the recorded H turn chosen by a seeded draw from the same stage, keeping its time to first event, thinking time and tool-input characters per millisecond, with the scripted reply's own JSON as the text. End-to-end latency is measured through the real loop with that provider resolving at the synthesized exit (non-streaming), and the streaming latency is that minus the per-turn tail difference measured by the pre-checker. 5 reps of the 21, as in P-57.
- Replays run serially under `HEAVY_SLOTS=4 heavy-run`; load is recorded at the start and end of each arm, and an arm above 16 at either end is labelled loaded and is not an acceptance figure.

## Bars, fixed here

1. **Tail**: per-candidate critical-path tail drops by at least 50% at p50 with (a), on H and on the P-57 workload.
2. **Latency**: end-to-end candidate latency drops by at least 15% at p50 on the P-57 workload.
3. **Verdicts**: zero differences. Replayed loop verdicts equal the recorded ones for every run; the streaming full-check verdict equals the non-streaming check verdict for every turn that ran a check; (b) makes zero false refusals (a refused turn whose eventual check passes, or whose final `kernel.ts` differs from the one refused); (c) never changes a candidate's verdict, and every cancelled attempt is in the receipt with its reason.
4. **(b)**: report the share of failing turns refused before the model's last token, the seconds and output tokens saved per refused turn and per failing run, and the share of all turns.
5. **(c)**: wasted model-seconds (cancelled or losing attempts) per model-second on winning paths at most **0.25** for the fail-triggered hedge, summed over all 30 H runs. Always-hedge is reported against the same budget.

## Predictions

1. Bar 1 **met**: per-turn tail before 90–250 ms p50 (exit lag 30–50 ms plus a 50–150 ms warm compile and gates), after 5–40 ms, since the kernel closes seconds before the glue and the compile finishes inside that gap. Per candidate the fixed non-streaming parts (freeze, residual gates, commit, together 10–40 ms serial) stay, so the candidate tail drops 50–80%.
2. Bar 2 **missed**: end-to-end p50 drops 0.3–2% on H and on the P-57 workload. The tail is that small a share.
3. Bar 3 **met**: zero verdict differences, zero false refusals. I expect no reply in 30 runs to edit `kernel.ts` twice.
4. (b): 40–85% of failing implementation turns refused before the last token, saving 1–3 s p50 per refused turn (the glue still streaming) and 20–40% of that turn's non-thinking output tokens. Turns whose only failure is G7 (glue) are not refusable early. Failing runs are a small minority (P-56 `sonnet-low`: 2 of 30 runs, 12 failed check rounds), so the p50 run saves nothing; end-to-end p50 gain from (b) under 1%.
5. (c): fail-triggered hedge waste 0.02–0.25 per winning model-second, **within budget**, because it fires only on refused turns; but its gain is under 5% on failing runs and 0 at p50, because P-56 found most failing runs come from a wrong frozen test, which no fresh implementation can pass either. Always-hedge waste 0.7–1.0, **over budget**.
6. Calls: recording 60–110 for the 30 runs, hedges 10–50, total with the diagnostic under 180.

## Decision rule

- If bar 3 fails anywhere, nothing here is recommended and the failing case is named.
- (a) is recommended for the loop only if bars 1 and 2 are both met. If bar 1 is met and bar 2 missed, the result says the tail is gone but was never the span; the transport change (fine-grained streaming and reading `result` rather than exit) is noted as a cheap follow-up, not adopted here.
- (b) is recommended as a follow-up loop change if it refuses at least 40% of failing turns with zero false refusals and saves at least 1 s per refused turn. Its live effect on the next prompt (a truncated reply in the conversation) is not measured by the replay and would need its own precommit.
- (c) is recommended only if within its waste budget and it cuts failing-run latency p50 by at least 10%.
- Misses are reported, not retuned.

## Oracle

The non-streaming verdicts of the recorded runs: the loop's own check per turn and its promote/reject per candidate. The pre-checker's full check uses the same compile flags, page limit and `runGates`; its verdicts are compared with the loop's per-round `failed` flags.

## What a miss means

- Bar 1 missed: the check does not overlap the stream (for example the model writes `glue.json` before `kernel.ts`), or the worker hand-off costs as much as the check.
- Bar 2 missed: the model's generation is the span (the rival), and only a faster or shorter model call moves end-to-end latency.
- Bar 4 below 40%: failing turns fail in the glue or finish the kernel last; early refusal has little to act on.
- Bar 5 missed: speculation spends more than it saves on this workload.

## Stop conditions

- Stop all live calls at 280 total, or after two consecutive transport errors, or at any `claude auth status` that is not `loggedIn` with `authMethod` `claude.ai`, or any init with `apiKeySource` other than `none`.
- If `agent-guard` blocks, stop and report.
- The replay refuses to run if `PRECOMMIT.md` differs from its recorded hash.

## Limits

One account on one day; one model and effort; spawned `claude -p` per turn (P-56 used a warm lane; spawn adds start-up before the first token, not after the last). Fine-grained tool streaming is a CLI setting the loop does not use today; whether it changes generation speed is not tested beyond comparing with P-56's timings. The P-57 workload's streams are synthesized from real profiles, not recorded. The replay measures decisions and timings; it does not measure what a truncated reply would do to the next live turn.
