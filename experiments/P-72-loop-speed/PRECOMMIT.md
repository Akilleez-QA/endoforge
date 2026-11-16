# P-72 time to a promoted candidate, by system lever: precommit

Label: **Proposed** procedure, frozen before the first experiment call. Its SHA-256 goes in `receipt/precommit.sha256`, and the runner, written after this file, refuses to run when the file differs. No arm below is run, and no result is looked at, before this file and its hash are committed and pushed.

Question: which changes to the loop itself, not to the model, shorten the expected time from a need to a promoted candidate, counting every failure that forces a retry as that item's whole time again, without letting more wrong candidates through? The maintainer's framing: the target is the best trade-off between the time an attempt takes and how often it fails; only physics limits it; refine the system before using faster models.

## What the loop spends its time on today

From [P-66](../P-66-best-of-n/RESULT.md)'s `sonnet-low` runs ([receipt](../P-66-best-of-n/receipt/rows.jsonl), 184 promoted runs that needed no repair): the specification reply took a median 15.5 s for 2,122 output tokens and the implementation reply 6.3 s for 1,006, at about 150 output tokens a second; the two calls were 98.6% of a need's 22.3 s median, and everything else about 0.3 s. The arm's failures were concentrated, not spread: 4 of the 6 classified failures were wrong frozen values (`frozen-wrong`), each repeating the same failing test until the turn limit; one need, H05, failed G8 on the first check in all 10 of its runs, because G8 probed infinities its contract never named; and 15 of 209 promoted `sonnet-low` runs spent a turn after a check that had already passed.

## Model, account and budget

All arms use one model and effort, `claude-sonnet-5-5` at low effort, the arm P-66's decision rule chose. Model changes are out of scope by the maintainer's direction.

Model calls only through `claude -p` (the warm transport) on the default subscription login, with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` unset, which the runner checks; `claude auth status` must report `loggedIn` true and `authMethod` `claude.ai` before the run and before every need. No API keys, no API billing.

**Budget: at most 1,300 model calls (transport turns).** The runner counts each call and refuses any past 1,300; a need with a refused call is incomplete and left out of every analysis. Expected use: 5 arms × 4 runs × 27 needs = 540 runs at about 2.2 calls each, about 1,190 calls. Smoke runs use a stand-in CLI and make no model calls. A halt: two consecutive needs each with two or more transport errors other than the loop's own token budget.

## Arms

Every arm is the P-50 agent loop (`ENDOFORGE_LOOP=agent`, 6 turns and 64,000 tokens per stage, process cell, `waits: 'hold'` as in P-66), on a commit recorded in the run record. Per need, the 20 runs (4 per arm) start in an order shuffled with a seed of this file's hash, so load falls on all arms alike.

| Arm | Loop |
|---|---|
| `main` | `main` at `f834d21` |
| `fixed` | `main` plus the three repair-loop fixes: a passing check ends the turn (PR #164), G8 probes only the non-finite kinds a contract names (PR #165), and two identical failures stop the repair turns (the stop-identical PR) |
| `oracle` | `fixed` with `limits.oracle` on |
| `overlap` | `fixed`, with the implementation call started as soon as the specification reply's capability block has arrived and given `CONTRACT.md` only, never `tests.json`; its code is compiled and checked only after the freeze, and the freeze rules are unchanged |
| `compact` | `fixed`, with `tests.json` written in a compact table form that the freeze expands to today's JSON before freezing, so the gates see the same tests |

`overlap` and `compact` are built behind flags before the run, off by default. If either cannot be built without changing what the gates check, it is dropped from the run before the first call and this file gets an amendment saying so.

Two further levers are measured without model calls, from the `fixed` runs: **hedging** (start a second attempt only when the first passes its arm's p90 time) and **best of 2 with cancel on first pass** are replayed from the four `fixed` runs per need, as P-66 replayed best of n, and labelled as replays.

## Needs, order and splits

The 27 needs P-66 ran ([P-56 needs](../P-56-model-effort/needs.mjs)), in P-66's seeded order, with P-56's held-out tests for H needs. Needs run in order until the budget refuses a call. The two needs whose frozen tests P-66 classified as wrong (H02, H08) stay in: they are the failure class two of the arms target.

## Measures (computed by `analyze.mjs`, written before the run)

1. **Expected time to a promoted candidate**, per need and arm: the mean wall time of a run divided by the share of runs promoted, so a failed run costs its whole time again. Reported per arm as the mean over needs, with p50 and p90 of promoted runs' wall time.
2. Pass rate per need and arm.
3. Model calls, output tokens and LEU per promoted candidate.
4. Escapes: promoted H-need candidates that fail a held-out test.
5. First-check pass rate: the share of runs whose first implementation check passes G4 and G7, the measure that decides whether blind implementation in `overlap` costs repairs.
6. Extra turns by cause: G8 first-check failures, turns after a passing check, repeated identical failures, oracle flags.
7. For `oracle`: flags, corrections and refusals, and every corrected value checked against the need's reference.
8. The G8 failure text and the oracle's flag text for every run, which P-66 did not store.

## Decision rules

Every comparison is paired by need; its interval is a bootstrap 95% interval clustered by need (10,000 resamples, seed from this file's hash). "Not worse on pass" means the pass rate is at most 2 points lower; "no more escapes" means no more escaped candidates than the comparison arm.

1. **`fixed` against `main`**: the three fixes stay recommended for merge if `fixed` is not worse on pass and has no more escapes. Its change in expected time is reported, not judged.
2. **`oracle` against `fixed`**: `limits.oracle` defaults to on if the mean paired change in expected time is below zero with an upper bound under +0.5 s, `oracle` is not worse on pass, has no more escapes, and no correction froze a value its reference contradicts. This replaces P-69 to P-71's false-flag bar as the rule for this default, because a false flag costs one specification turn and a wrong frozen value costs the whole need.
3. **`overlap` against `fixed`**: implementation overlap is adopted as the default only if the mean paired change in expected time is at most −2 s with an upper bound below zero, `overlap` is not worse on pass and has no more escapes, and the freeze rule in [candidate-loop.md](../../docs/architecture/candidate-loop.md) is amended to say that code may be written before the freeze but is never shown the tests and never checked before it. Otherwise it stays behind its flag.
4. **`compact` against `fixed`**: the compact form defaults to on if the mean paired change in expected time is below zero with an upper bound below zero, and it is not worse on pass.
5. Arms that pass are combined only in a later experiment; this one does not decide the combination.

## Strongest rival and how it is discriminated

Rival: model time dominates so completely that these levers are lost in run-to-run variation, and any difference is noise or load. Discriminated by the paired, interleaved design and the clustered interval: a lever is adopted only when its interval excludes no change in the stated direction. For `overlap`, the specific rival is that code written without seeing the tests fails its first check often enough to cancel the saved time; measure 5 tests it directly.

## Predictions

1. `fixed` against `main`: expected time 1 to 4 s lower per need on average, from G8 turns on H05-like needs, turns after a passing check, and early stops on wrong frozen values; pass rate unchanged or higher.
2. `oracle` against `fixed`: change in expected time between −1 and +1 s, with fewer needs lost to wrong frozen values; uncertain in sign.
3. `overlap` against `fixed`: expected time 4 to 7 s lower at p50; first-check pass rate at most 10 points lower.
4. `compact` against `fixed`: expected time 1 to 3 s lower, from fewer specification output tokens.
5. Hedging replay: p90 time lower than `fixed` at under half the extra calls of best of 2.

## What a miss means

Misses are reported as misses. No retuning of the rules, the needs, the arms or the analysis after the first call. Changes after this point go in a dated amendment at the end of this file, committed before the runs or analysis they affect.

## Load and timing

1-minute load average at each run's start and end. A run above 16 at either is labelled loaded and reported; the decision rules use all complete needs, because time to promotion is mostly remote model time and arms are interleaved per need.

## Stop condition

The run stops at the call budget, at the end of the need list, at the halt rule, or for an arm at its first escape, which stops that arm and is reported. Analysis uses complete needs only.

## Limits

One model, one account, one machine. Four runs per need and arm, so per-need pass rates are coarse, and differences in expected time under about 1 s are not expected to be distinguishable. The replayed levers are replays, not live runs. Needs and references were written by a model; H needs carry held-out tests, R needs do not.
