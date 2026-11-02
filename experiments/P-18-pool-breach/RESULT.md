# P-18 pool breach — result

Recorded probe, started 2026-11-02T00:08:13.087Z, Node v22.23.3, N=8.
The precommit digest `50b85ec46dc181e1fade229e8090d3b4ad70c1c4450668d18cc5727be9c37339` was recorded in
[precommit.sha256](receipt/precommit.sha256) before the first execution.
[Runtime digests](receipt/runtime.sha256) identify the final measured implementation.

| Mode | Breach | Workcells lost | Siblings lost | Verified receipts | Whole arm ms |
|---|---|---|---|---|---|
| thread | heap | 1 | 0 / 7 | 17 | 1407 |
| thread | wasm_memory | 1 | 0 / 7 | 17 | 1706 |
| process | heap | 1 | 0 / 7 | 17 | 2078 |
| process | wasm_memory | 1 | 0 / 7 | 17 | 1590 |

Every arm had eight distinct initial workcells, seven healthy siblings held
mid-job, and a distinct replacement completing the native evaluator report.
Each healthy report included the passing candidate and forbidden-effects
rejection. All four Python ledger chains replayed successfully; returned hashes
matched stored hashes (68 receipts total). Process breaches returned `rejected`
with `heap`/`wasm_memory`; thread breaches returned `outcome_unknown`/`limit`.
Both process arms recorded `cgroup: "unavailable"` on this read-only cgroup mount.

The [harness](run.mjs) ran once initially, once after cgroup setup refinement,
and once with the final frozen cgroup configuration. All three executions had
the same loss/chain results; [initial](receipt/initial-summary.json) and
[interim](receipt/interim-summary.json) records are retained. The table uses the
[final summary](receipt/summary.json). Reproduce from the repository root with
`node experiments/P-18-pool-breach/run.mjs`; it verifies the precommit first.
Temporary fixture ledgers and barriers are created under `/tmp` and removed.

## What it does not show

- Delegated cgroup enforcement: memory/cpu/pids controls could not be exercised here.
- Native-allocation, aggregate WASM/RSS, global OOM, hostile-port or OS sandbox containment.
- Allocation of 256 MiB: the WASM guard rejected the requested growth before allocation.
- Performance qualification: whole-arm times include startup, ledger work and shutdown
  on a shared desktop, including concurrent tests. These are small synthetic checks,
  with 24/4 MiB heap settings and a 64 MiB WASM cap, rather than P-16's workerd deployment.
