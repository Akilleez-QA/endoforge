# P-62 a live per-stage view names the bottleneck: result

Status: **Recorded (probe)**, 2026-11-07, Node v26.13.0, 32 threads, under `HEAVY_SLOTS=4 heavy-run`, on a desktop shared with four other experiment lanes. Stub models only, no tokens. Precommit: [PRECOMMIT.md](PRECOMMIT.md), digest in `receipt/precommit.sha256`, committed and pushed (961be32, 18:17 EST) before any acceptance measurement. Raw rows and text dumps are in [receipt/accept/](receipt/accept/).

**The view named the bottleneck correctly in all 6 controlled base runs, was right at 5 s in every run, and kept Little's Law within 2.7% for every stage. Perturbing each stage by +20% backed its verdict in R1, R2, R3 and the `cells` observation. In `main-fast` all three perturbed stages dropped throughput, so the rival wins there; the ledger's own service time rose in every one of those arms, which points at the shared disk. Overhead is unresolved: the recorder costs about 14 µs of a 210 ms candidate (0.007%), but the A/B finished 4 of 8 pairs before an hour of load above 16 stopped it, and its noise is wider than the 1% bar. On main today, at width 16 with P-57's model waits, the view says `model (population)`: 15.6 of 16 candidates sit in a model call, the ledger is 21–24% busy and the cells 3% net. With fast models it says `ledger`.**

## Bars

| # | Bar | Measured | |
|---|---|---|---|
| 1 | Overhead ≤ 1% accepted/s and ≤ 1% CPU per candidate, 8 paired runs at `cells` | 4 clean pairs (pair 4 loaded, pairs 5–7 never started: load stayed at 21–27 for 60 min and I stopped the run). Median change with `rates` on: throughput **+4.6%** (on faster), IQR 3.8 points; CPU per candidate **−2.2%**, IQR 3.6 points. Both IQRs are wider than the precommitted 2 points. Cost model: 85 ns per arrive/start/done, 30 ns per span, 0.21 ms per view; 8.4 items and 6.3 spans per candidate plus 2 views a second at 32.5 candidates/s ≈ 14 µs per candidate against 210 ms of CPU, or 0.007% | **unresolved** (not met) |
| 2 | Correct verdict in both base runs of R1, R2, R3 | 6 of 6: `ledger`, `ledger`; `tscheck`, `tscheck`; `model`, `model`. R3's bases are the reruns; the loaded originals said `model` too | **met** |
| 3 | \|L − λW\| / L ≤ 10% for every stage with ≥ 50 completions, in every base run of R1–R3 | Largest 2.7% (`cell` in `checker-base-1`); R1 ≤ 0.2%, R3 ≤ 1.1% | **met** |
| 4 | Live verdict at 5 s names the expected stage, with a published snapshot | 6 of 6 at 5.0 s, snapshot present in all; in all 35 rows with `rates` on, the verdict at 5 s matched the window's final verdict | **met** |

## Controlled verdicts

Steady window; R1 and R2 30 s, R3 115 s. "Net" is utilisation minus time a cell spends blocked on a host call.

| Run | Throughput /s | Verdict | Evidence in the view | Gross utilisation alone |
|---|---|---|---|---|
| R1 `ledger` base 0 / 1 | 6.00 / 5.00 | `ledger` (saturated) | ledger net 1.00, mean queue 8.9; cells gross 1.00, net 0.14 | ledger 1.00 tied with cell 1.00 |
| R2 `checker` base 0 / 1 | 22.9 / 26.4 | `tscheck` (saturated) | tscheck 1.00, queue 10.4–10.5, check 94% of its service; cells 0.62–0.66 | tscheck 1.00 |
| R3 `model` base 0 / 1 (reruns) | 2.43 / 2.42 | `model` (population) | 15.6 / 15.5 candidates in a model call; ledger 0.21–0.24; cells 0.08 gross, 0.03 net | ledger 0.21 |
| `main-fast` base 0 / 1 | 10.9 / 10.5 | `ledger` (saturated) | ledger net 0.98–0.99, queue 6.6–6.8, service p50 9.7 ms, mean 29 ms (fsync tail) | **cell 1.00** |
| `cells` base 0 / 1 | 32.6 / 32.4 | `cell` (saturated) | cell net 0.92, queue 9.6; compile 41% busy; ledger 0.32 on tmpfs | cell 0.99 |

The rival's first half is borne out: with a slow ledger, every cell shows gross utilisation 1.00, because the admit crossing runs inside a cell job. Gross utilisation alone would have named the cells in `main-fast` and tied them in R1. Net utilisation (blocked host-call time removed) is what separates them.

## Rival: +20% service time per stage

Change against the mean of the two base runs. A drop of 8% or more counts as moving.

| Run | Base mean /s (spread) | +20% model | +20% cell | +20% ledger | +20% tscheck | Named | |
|---|---|---|---|---|---|---|---|
| R1 `ledger` | 5.50 (18%) | +13.3% (rerun; loaded original −5.5%) | +8.5% | **−10.9%** | n/a | ledger | supported |
| R2 `checker` | 24.67 (14%) | +6.5% | +3.4% | +10.0% | **−14.2%** | tscheck | supported |
| R3 `model` | 2.42 (0.4%, reruns) | **−16.7%** (rerun; loaded original vs loaded bases −13.9%) | −1.6% | −1.6% | n/a | model | supported |
| `main-fast` | 10.72 (4%) | **−27.2%** | **−21.9%** | **−18.8%** | n/a | ledger | **rival wins** |
| `cells` | 32.50 (0.8%) | +3.8% | **−14.2%** | −1.7% | n/a | cell | supported |

- R3 and `cells` are clean: tight bases, one stage moves, by about what a strict constraint gives (+20% service → −16.7%).
- R1 and R2 support the verdict under the rule, but their two base runs differ by 18% and 14%, more than the 8% threshold, and several non-named stages *rose* by 7–13%. Those runs alone don't establish that only one stage matters. The base spread comes from the bottleneck itself: R1's ledger service mean was 53 ms in one base and 64 ms in the other (fsync on a disk other lanes were writing to); R2's tscheck service was 43.6 against 37.9 ms (CPU contention).
- `main-fast`: all three drop. The view's own ledger column shows why: mean ledger service went from 28.7–30.1 ms in the bases to 34.4–36.1 ms in all three perturbed arms, including the two that didn't touch the ledger, and CPU per candidate went from 170–195 to 324–340 ms in two of them. The disk under the ledger got slower during the run, and throughput followed it. The verdict (`ledger`) is consistent with that, but the perturbation test can't discriminate it, so by the precommitted rule this is a rival win, reported as one.

## Main now

Width 16, 4 process cells, `waits: release`, ledger on btrfs NVMe with main's bridge (P-59 not merged), no lane, model turns 2–4 s (P-57):

```
stage            srv   arr/s   done/s   util   net  queue(now/mean/grow)   L     svc p50/p95 ms    W ms   L~λW
model:spec        inf     2.4      2.4      -     -  0/0.0/0.0              7.3   3031.2/3880.1  3013.8  0%
model:impl        inf     2.8      2.8      -     -  0/0.0/0.0              8.3   2911.6/3923.7  2976.4  0%
cell                4     7.6      7.6   0.08  0.03  0/0.0/-0.0             0.3       46.9/77.6    39.8  0%
  cell.compile      4     7.6      7.6   0.03  0.03  0/0.0/0.0              0.1        0.0/45.5    13.8  -
  cell.gates        4     7.6      7.6   0.00  0.00  0/0.0/0.0              0.0         0.0/7.0     1.4  -
ledger              1     7.6      7.7   0.21  0.21  0/0.1/-0.0             0.3       13.2/67.4    36.6  0%
bottleneck: model (population) 15.6 candidates in model on average; no stage at 0.8 net utilisation with a queue
```

These runs measured main at 42ad98c plus this branch, before #109 (P-60) and #110 (P-59) merged at 18:36 during this lane. Main now has the group-commit ledger, and this table is main as it was.

At 16 in flight the loop is bound by its population: 2.42 candidates/s ≈ 16 / 6.6 s. More width is the lever, and the ledger is next. It runs at 0.21–0.24 here, and `main-fast` shows it saturating at about 10.7 candidates/s (33.8 requests/s). By Little's Law, it would saturate at roughly 16 × 10.7 / 2.42 ≈ 70 in flight with these model times. With P-59 merged, that ceiling should move up, and the view should then name the cells, as P-59 reported. That isn't measured here.

## Predictions

- Throughput R1 5–7: **held** (5.0–6.0). R2 15–21: **failed**, 22.9–26.4 (the cells weren't contending as much as in the pilot). R3 2.3–2.7: **held**. `main-fast` 9–12: **held**. `cells` 27–34: **held**.
- Verdicts: all five **held**.
- Rival: named stage drops 12–20%: **held** in R2 (14.2), R3 (16.7), `cells` (14.2); **failed** in R1 (10.9). Every other stage within ±4%: **failed** in R1, R2 and `main-fast`; held in R3 and `cells`. Gross utilisation alone names `cell` in R1 and `main-fast`: **held** for `main-fast`; in R1 it was a tie at 1.00.
- Overhead: cost model under 0.05% **held** (0.007%); A/B within ±1%: **failed**, and it was unresolved, as predicted.
- Little's Law under 5%: **held** (2.7% at most). Live correct at 5 s: **held**.

## Decision

Bars 2–4 hold, and the view is supported in R1, R2 and R3, so under the precommitted rule it becomes the first step for finding the loop's bottleneck. It stays opt-in (`createLoopPool({ rates })`), because bar 1 is unresolved: the cost model says the recorder is negligible, but the A/B on this machine couldn't show that to within 1%. Two qualifications go with the verdicts:

- A verdict tells you where the queue and the work are. On a shared disk or CPU, a confirming perturbation needs base runs tighter than the effect, which R1, R2 and `main-fast` didn't have.
- The ledger stage is one server as the supervisor sees it. With P-59's group commit, the real service is a batch, and the inferred FIFO service time will understate its capacity. That needs a check once #110 is on main.

## Limits

- Stub models, synthetic kernels, one shared host; 5 of the 40 rows were loaded: four controlled rows, rerun once and counted as the reruns, and one overhead row, dropped.
- Overhead: 4 clean pairs, not 8. Stopped by load, not by a crash.
- Cell sub-stages come from each job's own timings, not live stamps. The supervisor sees queues only in front of the bridge and the cohort, not inside them.
- The compatibility lane isn't in the agent loop on main; the harness composes it after the commit.
- The slow checker in R2 is the fresh-instance tsrs check (main has no P-60) at width 1 with padded kernels, not P-58's or P-60's measured configuration.
- Node 22 wasn't run for the experiment; tests were.
