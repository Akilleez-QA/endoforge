# Atomizer ledger

Every atomizer process appends to one ledger: `events.jsonl` in `ATOMIZER_LEDGER_DIR` (default
`tools/atomizer/ledger`; set it outside the source tree). Each line is one JSON object. Lines are never rewritten; a
correction is a new event that references the old one. [lib/ledger.mjs](lib/ledger.mjs) writes the lines, and
`tools/atomizer/test/tools-gaps.test.mjs` fails when this page and the events the code emits disagree.

The schema id is `endoforge/atomizer-ledger/1`. It is carried in `context.schema`.

## Common fields

| Field | Type | Meaning |
|---|---|---|
| `v` | integer | Line format version, `1`. |
| `ts` | string | ISO 8601 UTC time the line was written. |
| `event` | string | The event name, one of the events below. |

Most events also carry:

| Field | Meaning |
|---|---|
| `need` | The need id the event belongs to. |
| `runId`, `poolId` | The scheduler run and, under `fanout.mjs`, the pool of runs it belongs to (`null` outside a pool). |
| `context` | Captured once per process by `context()`: `schema`, `pid`, `git` (`head`, `dirty` for `tools/atomizer`), `policySha256`, `gateSha256`, `codeSha16` (first 16 hex digits of each atomizer source file), `versions` (node, claude, codex, bwrap), `models`, `host` (hostname, cpus, memTotalGiB, kernel). Written on the `*.start` events and `verify.end`. |
| `load` | Machine load when the event was written: `load1`, `load5`, `load15`, `memFreeGiB`. |
| `backfilled` | `true` on events `bin/backfill.mjs` rebuilt from older receipts; those carry `source` or `at` in place of `context`. |

## Events

| Event | Written by | Fields beyond the common ones |
|---|---|---|
| `atomize.start` | `bin/atomize.mjs`, `bin/backfill.mjs` | `atomizeId`, `model`, `promptSha256`, `promptBytes`, `needSha256`, `out`, `fixture`. |
| `atomize.attempt` | `bin/atomize.mjs`, `bin/backfill.mjs` | `atomizeId`, `model`, `attempt`, `wallMs`, `exit`, `usage`, `parsed`, `valid`, `errors`, `warnings`, `atoms` (count), `outputBytes`. |
| `atomize.end` | `bin/atomize.mjs`, `bin/backfill.mjs` | `atomizeId`, `model`, `valid`, `attempts`, `atomsSha256`, `plan` (atoms, total, critical, criticalPath, speedupBound, width, waves), `kinds` (atoms per kind). |
| `plan.start` | `bin/plan-template.mjs` | `planId`, `model`, `effort`, `promptSha256`, `promptBytes`. |
| `plan.attempt` | `bin/plan-template.mjs` | `planId`, `attempt`, `wallMs`, `ok`, `error`, `cli` (durationMs, apiMs, usage). |
| `plan.end` | `bin/plan-template.mjs` | `planId`, `ok`, `wallMs`; on failure `error`; on success `errors`, `exports`, `modules`, `atoms`, `plan`, `usage`. |
| `pool.start` | `bin/fanout.mjs`, `bin/backfill.mjs` | `outDir`, `requests` (need ids), `parallelRuns`, `perRunConcurrency`. |
| `pool.end` | `bin/fanout.mjs`, `bin/backfill.mjs` | `wallMs`, `sumAtomWallMs`, `pooledSpeedup`, `promotable`, `verified`, `tokens`, `perRequest` (need, wallMs, allDone, promotable, verifyExit, realizedSpeedup). |
| `run.start` | `bin/schedule.mjs`, `bin/backfill.mjs` | `runDir`, `concurrency`, `retries`, `timeoutMs`, `atomsSha256`, `atoms` (count), `augmented`, `normalizedCompose`, `plan` (waves, total, critical, criticalPath, speedupBound, width), `atomSpecs` (id, kind, model, tools, effort, size, inputs, outputs). |
| `atom.start` | `bin/schedule.mjs`, `bin/backfill.mjs` | `atom`, `kind`, `model`, `readyAtMs`, `startAtMs`, `queueMs`, `running`; backfilled lines add `readyDerived`. |
| `preflight.end` | `bin/schedule.mjs` | `atom`, `kind`, `hit`, `exit`, `wallMs`, `stageMs`, `missing`, `stdoutTail`, `stderrTail`. |
| `attempt.end` | `bin/schedule.mjs`, `bin/backfill.mjs` | `atom`, `kind`, `model`, `tools`, `attempt`, `ok`, `exit`, `signal`, `timedOut`, `stageMs`, `wallMs`, `split` (modelApiMs, toolMs, harnessMs), `cli`, `codex`, `promptBytes`, `promptSha256`, `stdinBytes`, `stdoutBytes`, `stderrBytes`, `missing`, `inputsStaged`, `outputs` (path, bytes, sha256), `cmd`, `stderrTail`, plus the worker's own metadata (account, accounts, tier, failovers and similar). |
| `atom.end` | `bin/schedule.mjs`, `bin/backfill.mjs` | `atom`, `kind`, `model`, `ok`, `attempts`, `wallMs`, `endAtMs`, `outputs`. |
| `atom.blocked` | `bin/schedule.mjs`, `bin/backfill.mjs` | `atom`, `by` (the failed atom it depends on). |
| `run.end` | `bin/schedule.mjs`, `bin/backfill.mjs` | `allDone`, `statuses`, `wallMs`, `sumAtomWallMs`, `criticalPathWallMs`, `realizedSpeedup`, `speedupBound`, `tokens`. |
| `verify.end` | `bin/verify.mjs`, `bin/backfill.mjs` | `ok`, `fails`, `acceptance` (id, kind, ok, exit), `gates` (promotable, byGate, testsPassed, testsTotal), `reviews`. |
| `run.archived` | `bin/verify.mjs`, `bin/backfill.mjs` | The archive record: `path` (repository-relative), `bytes`, `sha256`, `files`, `format`. |
| `archive.refused` | `bin/verify.mjs`, `bin/backfill.mjs` | `refused`, the reason no archive was written (a credential-like string, or the archiver failed). |
| `cutover.start` | `bin/cutover.mjs` | `experimentId`, `ladder`, `cases`, `rep`, `parallelCases`, `dagConcurrency`. |
| `cutover.case` | `bin/cutover.mjs` | The case record also written to that case's `case.json`. |
| `cutover.end` | `bin/cutover.mjs` | `experimentId`, `rep`, `cases` (count). |

## Archives

`archiveRun` compresses a finished run directory into `archive/<runId>.tar.zst` (or `.tar.gz` without `zstd`) beside
`events.jsonl`, after refusing any run whose files contain a credential-like string. It returns `path`, `bytes`,
`sha256`, `files` and `format`, or `refused` with the reason. `verify.mjs` (unless `--no-archive`) and `backfill.mjs`
record that object as `run.archived` or `archive.refused`.

## Reading it

`node tools/atomizer/bin/ledger-export.mjs [--out dir]` flattens the ledger into CSV tables.
