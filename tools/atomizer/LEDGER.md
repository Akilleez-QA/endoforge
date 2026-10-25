# Atomizer ledger: everything logged, for later analysis

Owner's directive (18 Oct 2026): log and ledger everything; overall speed (wall per request and per pool) is the north star, reached by focused improvements. This file is the schema; the data lives in `ledger/`.

## What is recorded, and where

| Path | What | Mutability |
|---|---|---|
| `ledger/events.jsonl` | every event from every atomizer process, one JSON object per line | append-only; never rewritten; a correction is a new event |
| `ledger/improvements.jsonl` | the improvement ledger: a `proposal` (target bucket, baseline evidence, prediction with confidence, test, code hashes) written **before** the run, then an `outcome` (mechanism check, paired per-request deltas, north star, quality, verdict, caveats) | append-only |
| `ledger/archive/<runId>.tar.zst` | the whole run directory: prompts, CLI stdout/stderr, every input and output file, receipts; credential-scanned before writing (refused if a credential-like string is found) | write-once |
| `ledger/tables/*.csv` | flattened tables (`runs`, `attempts`, `atoms`, `pools`, `atomizations`, `reviews`) from `bin/ledger-export.mjs` | derived; regenerate any time |
| `ledger/speed/*.md` | speed decompositions from `bin/speed.mjs` | derived |

The work directories (`tools/atomizer/work/`) are scratch and git-ignored; nothing in the analysis depends on them once a run is archived.

## Events (`endoforge/atomizer-ledger/1`)

Every event has `v`, `ts` (ISO), `event`, and the ids that apply: `poolId`, `runId`, `atomizeId`, `need`, `atom`. Backfilled events carry `backfilled: true` and `source`.

| Event | Emitted by | Key fields |
|---|---|---|
| `atomize.start` / `atomize.attempt` / `atomize.end` | `atomize.mjs` | model; prompt and need sha256; per attempt wall, usage, validity, errors; plan (atoms, total work, critical path, speedup bound, width, waves); atom count by kind |
| `pool.start` / `pool.end` | `fanout.mjs` | requests, pool shape; pooled wall, summed atom wall, pooled speedup, promotable and verified counts, tokens, per-request outcome |
| `run.start` | `schedule.mjs` | concurrency, retries, timeout, atoms.json sha256, every atom's spec (kind, model, tools, size, inputs, outputs), plan, augmentation, **context** (git head and dirty flag, policy and gate sha256, code file hashes, tool versions, models, host), **load** |
| `atom.start` | `schedule.mjs` | readyAtMs, startAtMs (from run start), **queueMs**, atoms running at start, load |
| `preflight.end` | `schedule.mjs` | script fast path: hit or miss, exit, wall, missing outputs |
| `attempt.end` | `schedule.mjs` | ok, exit, timeout, **stageMs**, **wallMs**, **split** {modelApiMs, toolMs, harnessMs} from the CLI's own `duration_ms`/`duration_api_ms`, turns, full CLI usage and modelUsage, Codex item counts (reasoning, commands, web searches) and usage, prompt bytes and sha256, stdout/stderr bytes, staged input sizes, output files with bytes and sha256, command line, load |
| `atom.end` / `atom.blocked` | `schedule.mjs` | ok, attempts, wall, endAtMs, output hashes; which failed atom blocked it |
| `run.end` | `schedule.mjs` | statuses, wall, summed atom wall, realized critical-path wall, realized speedup, tokens, load |
| `verify.end` | `verify.mjs` | acceptance results, gates per gate, tests passed/total, every review's model, persona, verdict and change |
| `run.archived` / `archive.refused` | `verify.mjs`, `backfill.mjs` | archive path, bytes, sha256, file count |

## Speed buckets (what `speed.mjs` reports)

North star: wall per request (and per pool). Underneath, every second of each run's **realized critical chain** (walk back from the last atom through the input that finished last) is assigned to one bucket: `queue` (ready but waiting for a slot), `modelApi` (inside model calls), `tool` (the agent's local tools: compiles, test runs), `harness` (bubblewrap, CLI start, auth, teardown), `codexTurn` (Codex attempts, which report no internal timings), `script` (deterministic steps and fast-path hits), `retry` (failed attempts and fast-path misses), `gap` (scheduler overhead). Only chain time moves wall.

## How to use it

```bash
node tools/atomizer/bin/ledger-export.mjs
```

```bash
node tools/atomizer/bin/speed.mjs tools/atomizer/work/fanout-04 --out tools/atomizer/ledger/speed/<name>.md
```

To re-analyse an archived run: `zstd -dc tools/atomizer/ledger/archive/<runId>.tar.zst | tar -x -C <dir>`, then point `speed.mjs` or `report.mjs` at it.

## Rules

- A proposal goes into `improvements.jsonl` before the run that tests it. An outcome is recorded whatever it says.
- Numbers carry the shared-desktop load next to them; compare paired by request, and treat single runs as probes.
- Nothing is deleted from the ledger; superseded analyses are kept with their date.
