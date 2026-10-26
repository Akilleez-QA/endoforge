# Deadline fan-out playbook

**Purpose.** How to finish a large piece of reviewable work (a video, a set, a course scene, a code module) in minutes rather than hours, with many agents at once, and how the Endoforge tools enforce each step. Written on 2026-10-26 from the a collaborator code-red run (`/mnt/cold-steam/factory-scratch/mrton/NOTES.md`). Craig set the frame: "parralelization atomization recomination these are the problems space transformations we need to correograph perfectly", and the method: "we ALWAYS work like this, iterate measure learn improve repeat".

**Summary.**
- A deadline run is three transformations, in order, every round: **atomize**, **parallelize**, **recombine**. Two hidden ones sit inside: **projection** (evals turn a picture into numbers) and **attribution** (each finding goes back to the atom that owns it).
- Each transformation has a guarantee and a check. The hill-climb tool's fan-out mode runs each check before it moves on (`tools/hillclimb`, `mode: "fanout"`).
- Parallelize by decomposition, not competition. Duplicate workers belong only on the critical-path atom.
- The machine is not the bottleneck. Logins, rate limits and serial stages are. Recorded: 16 workers, CPU 3–19 %, load about 4.
- Every round measures itself (`rounds/rNN/LESSONS.md`). Every lesson ends as a tool or PR change, or stays listed as open.

## The operating loop: iterate, measure, learn, improve the tool, repeat

| Step | What it means | Enforced by |
|---|---|---|
| Iterate | Short rounds. Recorded: about 30 s for 56 stills in 3 aspects plus evals, so a round is bounded by agent time, not rendering. | fan-out `round` (#388); render profiles `fast`/`final` |
| Measure | Numbers, not impressions: the eval score, HARD count, per-atom pass or fail, stage timings, failed launches, retries, queue waits, load. | `rounds/rNN/LESSONS.md` and `round.json` (#391); `lessons` in every `endoforge run` receipt (#390) |
| Learn | Write each mistake down with its cost as it happens (a running `NOTES.md`), plus what the numbers show. | LESSONS.md seeds the derived lessons; the "By hand" section is for the rest |
| Improve the tool | Each lesson becomes a tool or PR change, never only a note. | `hillclimb.mjs lessons <campaign> --close <key> --by "PR #n"`; every round lists the open ones |
| Repeat | The next round starts from the new findings and the new baseline. | ratchet baseline and per-atom findings in the next prompts (#387, #388) |

## The wall-clock model

T per round = atomize + max(atom) + recombine + human gates. Speed comes from cutting the serial parts (Amdahl): atomize ahead of time, recombine incrementally, keep human gates out of the loop, and split the longest atom. `round.json` records `wallClock` (T, serial seconds, the long pole, serial share), and LESSONS.md raises `long-pole-<lane>` when one atom takes at least twice the median and `serial-share` when serial stages pass half of T (#388, #391).

## Evals come first (projection)

No critic and no fan-out before there is a numeric gate. The campus run graded looks against a critic's eye with no measured target: Recorded, 429 SAF-01 commits in 20 h and 0 of 52 scenes ready; the survey then found the best model 4 m off the LiDAR.

- A fan-out campaign must declare `evals.command`, which writes JSON findings per piece (a `findings` list, or the `rules[].failing[]` shape). Validation refuses a campaign without it (#387).
- Each round renders and evaluates **before** launching. It reuses the previous round's post-evals when nothing has changed (#388).
- Rules as code, with a ratchet: each rule has a HARD or STYLE level, a source, a test, and a baseline that no change may raise. Examples: campus site rules (#347), motion rules (#362, #366), and the fan-out ratchet (#387, #388).
- Calibrate every rule on known failures and known clean frames before trusting it. On the a collaborator run the occlusion rule caught the rack and the condenser, and b2 came out clean.
- Measure before deciding what to fix. a collaborator's "clipping" was camera staging, not geometry: the 3D interpenetration measure was 0, and the occlusion rule caught it.

## 1. Atomize

**Guarantee.** Each atom has one owner and its own files. It has a frozen contract with its neighbours (on the a collaborator run, the `TonBeat` interface), its own inputs (its stills) and its own eval findings. Atoms together cover the goal, are of similar size, and can each be checked alone. An atom you cannot evaluate locally cannot be parallelized safely.

**Check before moving on.**
- `hillclimb.mjs atomize <campaign>` (also run by `check` and at the start of every round). It fails on a file two pieces share, on a directory that holds another piece's file, and on a piece that owns a `contracts` path (#387).
- **Lock ownership before launching anything parallel**, including eval builders and tool builders. Their files go in the map, or in `contracts`.
- **Split monolithic files into per-piece modules first.** Prove the split is a no-op with a **pixel diff, not frame hashes**: PNG encoders differ run to run. Run `hillclimb.mjs prove-split <campaign> --before <stills> --after <stills>` (`scripts/pixel-diff.py`, #388). On the a collaborator run, 28 of 28 frames came out identical.
- **Seams are atoms too.** Coupling between neighbours needs an owner or a contract: b2's end pose against b3's start, voice-over against picture, the character's poses against each beat's staging. Otherwise it only shows up at recombination. A piece owns a seam by listing its eval `keys` or `rules`. A finding nobody owns is counted as `unattributed` and raised as a lesson; it is never handed to an arbitrary worker (#387, #391).
- **Re-atomize every pass.** A piece is frozen after `fanout.freezeAfter` clean rounds and is not launched. A piece whose findings cluster (at least `fanout.splitAbove` and twice the median) is flagged to be split finer (#388, #391).

## 2. Parallelize

**Guarantee.** Every atom launches cleanly on every available login, under the capacity dial, ramped while load is measured.

**Check before moving on.**
- **Discover the logins; don't assume them.** `hillclimb.mjs logins <campaign>` lists the Codex homes (`~/.codex`, `~/.codex-accounts/*`) and the Claude config dirs (`~/.claude-accts/*`) by the presence of their credential file, which is never read. It also shows the lane plan. Craig said "5 accounts"; there were 2 Codex and 3 Claude logins (#387).
- **Rotate across every login**, explicit lanes first, then least-loaded. No login sits idle. LESSONS.md raises `idle-login` when one does (#387, #391).
- **One smoke atom per engine before the wide launch.** A broken pool, login or flag then fails once, not 12 times. A failed smoke stops the round before any worktree exists (#388).
- **Wide launch under the fleet capacity dial.** Lanes start in waves sized by `fleet-disconnect ramp N`. A drain launches nothing new (#383, #388). Load and MemAvailable are sampled on every poll.
- **Match engines to atoms.** Use `engine` and `account` per piece. Prompts go **before** `-i` image flags, because `-i` takes many values (#387). `codex-pool` finds `codex` on PATH and passes stdin through (#385).
- **Competition belongs on the critical path.** Only one piece may set `speculate` (2–3 duplicates on different logins). Its first variant to land cleanly and pass its `check` wins (#387, #388). Keep compete mode for taste calls.
- **The host owns servers, browsers and renders.** Codex in its sandbox cannot bind sockets or open a browser; Recorded in a 691-session study. Workers never render; the host renders after collecting. Browsers go through the broker (#377–#382).

## 3. Recombine

**Guarantee.** Changes apply without conflict (owned files only). The whole renders. The evals score it against the ratchet before the next round. Each atom's findings go back to its owner.

**Check before moving on (all inside `round`, #388).**
1. For each landed lane, `git diff <base> -- <its files>`, untracked owned files included. Edits outside its files are reported and ignored.
2. `git apply --3way` into the integration repo, **one commit per piece**.
3. Render and evaluate the whole. Global evals catch coupling that no atom can see: continuity across cuts, pacing, total length, voice-over sync, a consistent look.
4. Ratchet against `baseline.json`. A piece whose own HARD count rose is reverted (its commit alone; files are disjoint), and the whole is evaluated again. The baseline only goes down.
5. The next round's prompts carry each piece's own findings (attribution).
6. LESSONS.md and the open-lesson list are written (#391).

**Human gates run beside the loop, never inside it.** Examples: numbers sign-off, Craig's quality OK.

### Streaming recombination (Proposed; the barrier version is what ships)

A barrier round waits for the slowest atom. The design that replaces it:
1. Each atom runs its own loop: it lands, then apply it, render only its slice (beats are time ranges of a few seconds), and evaluate that slice.
2. If it passes, freeze it. If not, relaunch it at once with its findings.
3. Global evals run on a timer against the integrated whole.

The pieces it needs already exist in #388: per-lane exit files, per-piece commits, `collect` for any subset, and `${stills}`/`${out}` expansion for a slice render. What is still missing is listed as G1 under Open questions.

## Today's mistakes and the stage that now prevents each

| # | Mistake (NOTES.md) | Stage | Prevented by |
|---|---|---|---|
| 1 | gpu-queue dir a dangling link into `/tmp` after the reboot | parallelize | gpu-queue recreates the target (#386) |
| 2 | `plate.mjs --game` relative path | parallelize | `/mnt/cold-steam/factory-scratch/mrton/plate-fix.patch`, to apply after the video (open: G5) |
| 3 | worktree without engine `node_modules` | parallelize | `fanout.links` (#388); the plate patch names the missing directory |
| 4 | competition instead of decomposition | atomize | `mode: "fanout"`, at least two pieces, `speculate` on one piece only (#387) |
| 5 | one monolithic scene file | atomize | ownership map; `prove-split` pixel diff (#388); the split itself is still manual (G2) |
| 6 | `CODEX_POOL_BIN` not set | parallelize | pool defaults to PATH (#385); lanes set it (#388); smoke launch (#388) |
| 7 | `-i` swallowed the prompt; no stdin | parallelize | prompt before `-i` (#387); stdin passed through (#385) |
| 8 | restart mid-consult; serial consult and critic stages | recombine | one critique-and-fix stage per worker (#387); evals reused (#388); `serial-share` lesson (#391) |
| 9 | eval agent and split edited the same file | atomize | ownership map and `contracts`; strays ignored and raised (#388, #391); builders outside a campaign: G3 |
| 10 | "5 accounts" were 2 Codex + 3 Claude | parallelize | `discoverLogins`, `hillclimb.mjs logins` (#387) |
| 11 | rotation left `acct2` idle | parallelize | least-loaded rotation (#387); `idle-login` lesson (#391) |
| 12 | foreground `sleep` blocked by the harness | harness | none in the tools: use a background until-loop or Monitor (G6) |
| 13 | `/poodo` is user-only | harness | none: ask Craig to type it (G6) |

## Lessons from the whole conversation, and what enforces them

| Lesson | Enforced by |
|---|---|
| Measure, then build: a numeric gate before the first critic | fan-out requires `evals.command` (#387); compete mode does not (G7) |
| Rules as code, with a ratchet | site rules (#347), motion rules (#362, #366), fan-out ratchet (#387, #388) |
| Calibrate each rule on known failures and clean frames | G8 |
| Real-time first, finals last; no plates or finals without Craig's OK | `profile: "fast"` rounds, `finalEvery`; fan-out renders `fast` only (#388); the approval itself is a human gate (LANE-RULES) |
| Fix the staging, not the symptom | evals plus attribution route findings by rule (#387) |
| Blind critics and mixed models for open-ended polish | compete mode, mixing on by default |
| Heavy CPU through `heavy-run`, GPU through `gpu-queue.py`, one guarded browser; 75 means requeue, 78 means stop | heavy-run (#323, #327), gpu-queue, `chromium-automation`; fan-out lanes run in `heavy.slice` (#388) |
| Jobs live and die with their owner | heavy-run owner binding (#359); campaigns reject `systemd-run --scope` render jobs; fan-out lane units outlive a killed driver, bounded only by `RuntimeMaxSec` (G4) |
| memguard reserves memory for the apps and the desktop | memguard (#330 and follow-ups) |
| Fleet capacity dial; drain before a reboot, resume explicitly | `fleet-disconnect` (#383); fan-out waves honour it (#388) |
| After a reboot: health, GPU, failed units, GPU queue folder, then resume one lane at a time | queue folder self-heals (#386); no single post-reboot check yet (G9) |
| Loose fleets run unnoticed | `fleet-disconnect status` (#383) |
| About 3 live Claude lanes inside the app; CLI workers in systemd units | fan-out lanes are systemd units in `heavy.slice` (#388); the in-app limit is a rule only (G10) |
| One writer per file; split first | ownership map (#387); `prove-split` (#388) |
| Small PRs, never `git add -A`, no binaries, WIP commits, resume notes | collect stages only owned files (#388); the rest is LANE-RULES and the merge train's checks rule |
| CoS bot merges the same queue; re-check before acting | the repo-root merge train (`python3 tools/merge_train.py`) re-reads each PR; agents re-check by hand (G10) |
| Report honestly; a quoted approval is not Craig's | rule only (G10) |
| The host owns servers and browsers | browser broker (#377–#382); host-side renders in fan-out (#388) |
| Safety values global, stricter wins; official brand artwork only, never on safety items; Craig's photos private | the campaign `goal` carries them into every prompt; no automated check here (G11) |
| RETA lessons stay on black; r24 look frozen; numbers and claims show CHECK until approved | put frozen files (numbers sheet, r24 assets) in `contracts`, so no piece can change them (#387, #388) |

## Runbook (one deadline round)

```sh
B=forge/endoforge/tools/hillclimb/bin/hillclimb.mjs; C=forge/endoforge/tools/hillclimb/campaigns/<campaign>.json
node $B check "$C" && node $B atomize "$C"                       # atomize: ownership map, contracts
node $B prove-split "$C" --before <old stills> --after <new stills>  # after any split
node $B logins "$C"                                               # who is available, and the lane plan
node $B smoke "$C"                                                # optional: the round smokes too
systemd-run --user --unit=hc-<id>-round --slice=heavy.slice --setenv=PATH="$PATH" -- node $B round "$C"
node $B status "$C"; node $B lessons "$C"                         # while running / afterwards
```

`campaigns/mrton-fanout.json` is the a collaborator campaign as a fan-out campaign (16 pieces, 3 contracts). It was ported from `fanout.py`.

## Open questions (gaps with no enforcement yet)

- **G1** Streaming recombination: a per-atom loop (land, apply, slice render and eval, then freeze or relaunch) and timed global evals.
- **G2** An automatic splitter for monolithic files; today the split is by hand, then proven with `prove-split`.
- **G3** Builders outside a campaign (eval and tool builders) are not in any ownership map.
- **G4** Fan-out lane units are not bound to the round driver: stopping the driver leaves lanes running until `RuntimeMaxSec`.
- **G5** `plate.mjs` absolute `--game` and the missing-`node_modules` error are a patch file, applied after the video.
- **G6** Harness lessons (no foreground `sleep`; user-only skills) have no tool.
- **G7** Compete-mode campaigns can still run without a numeric gate.
- **G8** No tool requires a rule to be calibrated on known-failing and known-clean fixtures.
- **G9** No single post-reboot readiness check (health, GPU, failed units, queue folder).
- **G10** Coordination rules are rules only: the in-app lane limit, re-checking the merge queue, honest reporting.
- **G11** Content rules (safety values, brand artwork, private photos) have no automated check in this tool.

## Sources

`/mnt/cold-steam/factory-scratch/mrton/NOTES.md` and `fanout.py` (2026-10-26), `/mnt/cold-steam/factory-scratch/wt/LANE-RULES.md`, and PRs #347, #359, #362, #366, #377–#383 and #385–#391 on Akilleez-QA/akilleez.
