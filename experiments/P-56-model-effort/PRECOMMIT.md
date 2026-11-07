# P-56 model and effort through the in-isolate loop: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before the first experiment call. Its SHA-256 is in [receipt/precommit.sha256](receipt/precommit.sha256), and [run.mjs](run.mjs) refuses to run when the file differs.

Question: which model and effort give enough intelligence for X1 work through the fixed agent loop of P-50 (`ENDOFORGE_LOOP=agent`, `agentLimits` 6 turns and 64,000 tokens per stage, process cell, warm transport), at the best speed? Craig's decisions: model experiments are approved; `claude -p` is a transport only; speed is spent only past good-enough intelligence; intelligence is measured by failed code candidates and escapes.

Unit of success, from Edition 3: an independently accepted capability per unit of total cost. Here "independently accepted" means promoted by the unchanged gates and, where a held-out set exists, passing it. Total cost is wall time, the model's and the loop's, of every run including the ones that fail.

## Account

Every call runs as `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR=<nh3 account directory>`, subscription sign-in, no API keys or billing. `run.mjs` refuses if any of those three variables is set, runs `claude auth status` before each stage and every 20 runs and stops unless `loggedIn` is true and `authMethod` is `claude.ai`, and records each turn's init `apiKeySource`, which the transport already requires to be `none`. The transport builds the child's environment from an allow-list plus `CLAUDE_CONFIG_DIR`; a check before the pilot runs it with a stand-in command and a credential-shaped variable in the parent, and stops unless the child sees the account directory and no credential-shaped name. A usage limit stops the run: two consecutive runs with a transport error halt it, and no other account is used.

## Arms

`claude -p` aliases `haiku`, `sonnet`, `opus`, which resolved on 2026-11-07 to `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`, with `--effort`:

| Arm | Model | Effort |
|---|---|---|
| `haiku-low`, `haiku-high` | haiku | low, high |
| `sonnet-low`, `sonnet-medium`, `sonnet-high` | sonnet | low, medium, high |
| `opus-low`, `opus-medium`, `opus-high` | opus | low, medium, high |

`xhigh` and `max` are left out: they only matter if `opus-high` isn't good enough, and then they're a follow-up.

## Needs

- **R**: the twenty P-21/P-22 requests, `NEED.md` verbatim from the 2026-10-18 atomizer `baseline-20` runs. They have no ground truth, so they measure promotion, failed candidates, repair and time, not escapes.
- **H**: ten fixed-interface requests in [needs.mjs](needs.mjs), each derived from one or two R requests. Each names its exports, parameter order, units, formula with constants, and trap rule, so a held-out value follows from the text. Each has 7 to 11 held-out tests (88 in all) computed by a reference function, with relative tolerance 1e-6, including boundary inputs that must not trap and inputs just outside that must. The model never sees them. The model still writes and freezes its own tests; held-out tests run after promotion, on the promoted candidate's own wasm, with the unchanged gate code ([heldout.mjs](heldout.mjs)). [selftest.mjs](selftest.mjs) is the control: hand-written correct kernels for H01, H05 and H10 pass, and seeded wrong ones (a constant off, a bound exclusive, a missing trap) fail.

Limit: H needs and their references were written by Opus 5.5, which is also an arm. The values follow from formulas stated in the need, not from the author's knowledge, but the choice of edge cases shares that model's prior.

## Stages

- **Pilot**: needs C-015, CC-036, CC-011, CC-014, CC-025 (the first five in P-21's order) and H01, H03, H06, H08, H10 (the odd-numbered H), × all eight arms, one rep, 80 runs.
- **Main**: all 30 needs × the arms kept, `reps` per arm–need pair, sized from the pilot as below. The decision uses main runs only; the pilot is reported separately.
- Order: (need, arm, rep) shuffled with a seed of this file's hash and the stage name. Width 2: two runs at once, never the same arm at once, each with a fresh warm transport for its arm and a process cell from a pool reused across runs. Transport startup is recorded and not counted in wall time.

## Sizing (main)

From the pilot: arms whose accepted rate is more than 30 points below the best are dropped. For each kept arm, the runs needed for a standard error of the mean wall time at 10% of the mean is (CV/0.10)², where CV is the pilot's per-run wall CV for that arm. `reps` is the smallest number covering the largest such count over 30 needs, capped at 3 and at what the remaining call budget allows at 1.25× the pilot's mean calls per run. If the budget allows no full rep, main runs one rep of the 20 needs not in the pilot if that fits, and otherwise stops at the pilot. `analyze.mjs <output> pilot sizing` computes this; the result is recorded in an amendment before main starts.

## Measures, per run and per arm

- Promoted (unchanged gates), accepted (promoted, and held-out clean for H).
- First-pass accepted rate: accepted with the first checked code candidate passing.
- Failed code candidates: implementation-stage check rounds that failed (`rounds` from the cell; specification checks are not code candidates). Reported as a total and per accepted capability.
- Repair rounds: check rounds after the first, mean per run.
- Escapes: H runs promoted by the gates that fail any held-out test, over H runs promoted.
- Wall time of `runNeed` (p50, p95, mean, SD), model time (inside the transport), non-model time (wall minus model), seconds per accepted capability (sum of wall over all runs of the arm, divided by accepted).
- Usage as the CLI reports it: turns, tokens (input, output, cache creation and reads, thinking), and `total_cost_usd`, which on a subscription is a list-price equivalent and not a charge.
- 1-minute load average at each run's start and end. A run above 16 at either is labelled loaded. Model time isn't local; non-model figures from loaded runs are labelled as such.

## Decision rule (main runs, fixed now, computed by [analyze.mjs](analyze.mjs))

An arm is good enough when all three hold:

1. **Quality**: accepted rate at least the best arm's minus 10 points.
2. **Escapes**: escape rate at most the lowest arm's plus 5 points. An arm with no promoted H run fails this.
3. **Failed candidates**: failed code candidates per accepted capability at most the lowest arm's plus 0.5.

Among good-enough arms, recommend the one with the fewest seconds per accepted capability. Arms within 10% of that are tied, and the tie goes to the lowest list-equivalent cost per accepted capability. If no arm is good enough, nothing is recommended and the result says which gate each arm failed.

## Budget

At most 2,400 model calls (transport turns) for pilot and main together, counted by the runner, which won't start a run that could take it past the budget (a run is at most 12 turns: 6 per stage). Setup before this file: 1 auth-check call and 4 probe calls (three trivial `--effort low` calls and a 3-turn transport probe), outside the budget and in the receipt.

## Predictions

1. Haiku arms fail at least one gate; `haiku-low` fails quality.
2. Within each model, high effort is at least 30% slower in seconds per accepted capability than low, and gains no more than 5 points of accepted rate.
3. `opus-low` is within 5 points of `opus-high` on accepted rate.
4. The recommendation is a Sonnet arm, at low or medium effort.
5. Escape rate is under 10% for every non-Haiku arm.
6. Non-model time p50 per run is under 2 s on every arm; model time is over 90% of wall.
7. Median turns per run are between 2 and 4.

## Failure meaning

Misses are reported as misses, with no retuning of the rule, the needs, the loop or the arms after the first call. A run that fails is a recorded failure: no retries, no exclusions. Changes after this point go in a dated amendment below, before the runs they affect.

## Limits

One account, one machine, one day; the subscription service's own latency varies over the day, which the interleaved order spreads across arms but doesn't remove. 30 needs is a small sample. R needs have no ground truth. Wall time includes the loop's fixed limits: an arm that runs out of turns or tokens fails there, which is a property of this loop and not of the model in general.

## Amendment 1, 2026-11-07, before the first experiment call

The first pilot launch stopped before any model call: the seeded shuffle in `run.mjs` let its state go negative, which produced undefined items. The runner had already passed the auth check and the environment check (the child saw the account directory and no credential-shaped name). The fix keeps the state unsigned; nothing else changes. The order is still seeded by this file's hash and the stage name, so it changes with this amendment.
