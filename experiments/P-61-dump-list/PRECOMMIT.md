# P-61 big memory holders on the machine's dump list: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before any acceptance measurement. Amendments go below with a new digest appended to `receipt/precommit.sha256`; the first digest stays.

Question: EndoForge spends RAM for speed. When the machine needs that memory for something more urgent, can its big holders say what they could give back, give it back on a signal within two seconds, and lose no correctness and little speed doing it?

## Protocol (fixed by the memguard side)

- Registry: `${XDG_STATE_HOME:-~/.local/state}/memguard/dump-list.d/`, one file per holder, `<pid>-<name>.json`, written to a temporary file, fsynced and renamed: `{"schema":"memguard-dump/1","pid","name","priority","sheddable_bytes","signal":"SIGUSR2","updated"}`. `name` matches `[A-Za-z0-9_.-]{1,64}`.
- Lower priority is dropped first: 0–99 caches and spare warm instances, 100–199 working-set accelerators.
- The SIGUSR2 handler is installed before the file is first written. On the signal a holder frees what it can and rewrites its file with the new estimate; memguard waits up to 2 s and stops waiting once the file is rewritten. At most one refresh every few seconds otherwise. The file is removed on exit.
- Registration is off unless the registry directory exists or `ENDOFORGE_DUMP_LIST=1` (`0` forces it off).

## Holders and what each drops

| Holder | File name | Priority | Reported `sheddable_bytes` | On SIGUSR2 |
|---|---|---|---|---|
| Contained cohort (`core/runtime/contained/`) | `<cohort pid>-endoforge-cohort.json`, written by the supervisor; the signal goes to the cohort process itself | 40 | idle reused Workers beyond a floor of 1, each weighed by its V8 heap plus its reused tsrs instance and image at boot, scaled by a ratio measured from the cohort's own RSS (at boot, then after each shed) | retire idle Workers beyond the floor; the floor's (and sibling checkers') reused tsrs instances and images are dropped and their Worker collects garbage, so the next check there starts a fresh instance; spares aren't replenished for 30 s; in-flight attempts are untouched and new ones are never given a Worker that is still shedding |
| IsolatePool (`core/runtime/isolate-pool.mjs`) | `<pid>-endoforge-isolate-pool.json` | 20 | idle ready cells beyond a floor of 1: thread cells by heap statistics scaled by a measured ratio, process cells by private RSS from `smaps_rollup` | terminate those cells and don't respawn them for 30 s; demand still spawns cells as before |
| Ledger writer (`tools/ledger_writer.py`) | `<pid>-endoforge-ledger-writer.json` | 110 | SQLite's own `sqlite3_memory_used()` while handles are open | close every cached ledger handle and `malloc_trim(0)`, only between batches (deferred to the end of a batch when the signal lands inside one); queued, unacknowledged journal batches are never touched |

Why these priorities: a spare isolate cell is a warm instance that a new job can rebuild in about half a second, so it goes first (20). Cohort Workers and their reused instances are spares too, but rebuilding one costs a boot plus a baseline check (589–695 ms in P-60), so they go after (40). The ledger handle cache is on every accepted attempt's path: reopening touches the disk, which Craig names as the slow resource, and it holds little, so it stays in the accelerator band (110).

## Measurements

All with `experiments/P-61-dump-list/bench.mjs` on Node 26.13.0, `HEAVY_SLOTS=4 heavy-run`, temporary registry directories; the live memguard service and `~/.local/bin` aren't touched. A trial waits up to 5 minutes for the 1-minute load average to fall to 16 or below, then runs anyway. It is **loaded** if the load is above 16 at its start or end; loaded trials are reported and marked, not dropped or rerun to get an unloaded figure. If every trial of a bar is loaded, the bar is judged on the loaded trials and the verdict is marked loaded.

1. **Cohort shed** (`cohort`): the P-60 route default (`fused`, reused tsrs instance, host baseline) at width 16 with a 60-candidate deterministic corpus (the P-58 test corpus without the infinite loop, the baseline kernel and the 50 global-scope kernels). 16 closed-loop lanes for 6 s, then 4 s to measure pre-shed throughput, then load drops to 4 lanes for 2 s (attempts keep running), RSS of the cohort sampled every 10 ms; SIGUSR2 to the cohort pid; sampling continues for 2 s; then load returns to 16 lanes for 10 s. Five trials. Also five trials signalled while all 16 lanes are running.
   - bytes freed: median RSS over the 500 ms before the signal minus median RSS over 1.5–2.0 s after it;
   - time to free: first sample at or below the pre-signal median minus 70% of the reported bytes;
   - time to rewrite: first change of the file's `updated` after the signal;
   - recovery: from load returning to 16 lanes, the start of the first 1-s window (stepped by 250 ms) whose settled attempts per second reach 90% of the pre-shed rate. Also stated from the signal.
2. **Parity** (`parity`): the corpus five times in five orders at width 16, once with no registration and once with SIGUSR2 every 100 ms (30 s hold shortened to 500 ms so Workers come and go throughout), compared candidate by candidate. A verdict is status, reason, passed, total, compared runs, the first five diagnostics and the emitted artifact digests.
3. **Overhead** (`overhead`): accepted per second at width 16, registration on (no signal) vs off, four interleaved pairs of 8 s after 4 s warm-up; plus the per-call cost of the heap statistics read added to each result.
4. **IsolatePool** (`pool`): size 16, one job per cell, then SIGUSR2 to the process; reported vs freed RSS (same medians), time to free, next-job latency. Five trials.
5. **Ledger writer** (`ledger`, `ledger_bench.py`): 1,024 ledgers through one writer (one admit and two notes each), then a shed; reported vs freed RSS, shed time, every record intact and the writer still answering afterwards. Five trials.

## Bars, fixed now

1. **Free fast.** On SIGUSR2 at width 16 under load (trial type 1, 4 lanes in flight at the signal), the cohort frees at least **70% of its reported `sheddable_bytes` within 2 s**, measured as the RSS drop above, in every unloaded trial.
2. **No correctness cost.** **Zero** verdict differences and **zero** additional `outcome_unknown` between the shedding and non-shedding parity runs, and zero `outcome_unknown` in every shed trial.
3. **Recover.** Throughput is back within 10% of pre-shed **within 3 s** of load returning to 16 lanes, in every unloaded trial.
4. **Cheap.** Registration costs **under 1%** of accepted per second: the mean of the four interleaved on/off differences is above −1%.

Misses are reported as misses, not retuned. The pool and ledger figures have no bar; they're reported as measured.

## Predictions

- Cohort at 4 lanes: about 11 idle Workers to retire, 300–450 MiB reported, 70–100% of it freed, nearly all within 100 ms of the signal; the file rewritten within 100 ms. Bar 1 is likely but not safe: the four running attempts allocate while the others are freed, which makes the RSS drop noisy.
- Signalled at 16 lanes: almost nothing idle, so a few MiB reported. A reused instance in a busy Worker is part of the working set and isn't counted.
- Recovery: under 1.5 s, since the missing Workers boot on demand in about 0.6 s.
- Parity: zero differences. Overhead: within noise, below 1%, but at load above 16 the four pairs may not resolve 1%.
- IsolatePool: Workers with small heaps may return little RSS on termination within 2 s on Node 26; the reported figure may overstate the first shed.
- Ledger writer: about 1 MiB per 4–8 handles reported; most of it returned after `malloc_trim`.
