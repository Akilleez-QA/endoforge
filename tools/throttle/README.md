# Throttle: heavy jobs and the GPU queue wait for headroom instead of tripping

Written 2026-10-26. Two concurrent campus renders (about 40 GB) plus RAM-backed `/tmp` drove kernel page-allocation failures and took ChatGPT down, and a GPU job pushed VRAM into the guard's kill limit. Craig: "add a way to throttle so we dont trip", "it should scale itself to fit the hardware", "gpu gets a queue too", and "performance isnt high performace if we lose system stability".

Everything here waits rather than fails, and every limit is computed from the machine it runs on.
`heavy-run` scopes use nice 10 or the inherited nice level, whichever is higher, so jobs already at nice 19 can start without privilege.

| Piece | What it does | Scaled limits (32 threads, 124 GB rig) |
|---|---|---|
| `heavy-run` | Heavy CPU/RAM jobs take a slot, wait for memory and load headroom, then run in `heavy.slice` | slots RAM/48 GB (2), reserve 12 % RAM (14 GB), load < 0.875 × threads (28) |
| `heavy.slice` | Shared ceilings for every heavy job. `heavy-run` writes it, and rewrites it when the hardware changes | MemoryHigh 45 % RAM (55G, throttles first), MemoryMax 58 % (71G, stops only slice jobs), CPUQuota 56 % of threads |
| `gpu-queue.py` | Priority queue for GPU and browser jobs. At the head it starts only with GPU and system headroom; temporary trouble means wait, a fault latch means stop. A running job that has opened no NVIDIA device after 10 min (and is not under the automation guard) gives its slot back and keeps running | VRAM < 60 % and BAR1 < 50 % of the card's totals (the guard stops at 85 % and 75 %), RAM reserve and load as above |
| `gpu-queue.py --est S` | Short lane: a job declared at `GPU_QUEUE_SHORT_SEC` (300 s) or less takes queue priority 0 and starts at the next gap between long jobs; a long ticket waiting `GPU_QUEUE_AGE_SEC` (600 s) is renamed into the same lane, arrival kept. The lane is in the ticket name, the only thing the browser guard reads, so every reader agrees on the head. `--stats [--hours 12]` reads `history.jsonl` (one line per job: wait, run, exit code) | short ≤ 300 s, ageing after 600 s |
| `workers` | The CLI-worker registry: `workers run --bot SLUG -- cmd` registers a worker (host, bot, task, repo), heartbeats while it runs and records its end; `workers list` shows running, dead (process gone or no heartbeat) and finished workers on this host and every host that pushes here (`workers push --ssh <rig>` from the Grok box). Unknown bot slugs are refused. `fleet-disconnect status` includes it. On exit `run` writes a change receipt (`workers list --receipts N`, `workers receipt ID`); a spawn-rate alarm refuses (75) a launch when this host saw 30 launches of the same bot and program in 60 s | lease 120 s, host stale after 180 s, `WORKERS_SPAWN_MAX` 30 per minute |
| `memguard.py` | Everything not started through `heavy-run`. Reserved memory (memory.low, set on every ancestor up to `user.slice`) for the Claude app, the ChatGPT/Codex app and the desktop. Any other job past 8 % of RAM gets the per-job ceiling, and if unprotected jobs together pass 45 % of RAM the largest is held at its size. Nothing is killed | Claude 12 % (15 GB), Codex 6 % (7 GB), desktop 4 % (5 GB), total 25 % (31 GB); big job > 10 GB → MemoryHigh 28 GB |
| `diskguard.py` | The system drive. Every 15 min: notify at 85 % and start the janitor (at most every 6 h). Nightly at 03:30 the janitor removes regenerable dirs (`node_modules`, `.turbo`, `.parcel-cache`, `.next`) from work folders idle 48 h, removes git worktrees that are clean and already on a remote branch, and prunes the uv, npm and pacman caches. A folder a process is using (working directory, executable, path argument or open file) is never touched. It looks at most 4 levels deep and never walks a whole tree | warn 85 %, critical 92 %, idle 48 h; idle IO, rm workers = threads / 8 (4), 2 GB |
| `agent-guard.py` | A Claude Code PreToolUse hook on every Bash command (38 ms). Refuses, with the reason and the alternative: whole-tree `git stash` / `reset --hard` / `checkout .` / `restore .` / `clean -f` in a checkout with uncommitted changes (other sessions' work); `git add -A` with no paths or `git add .`; du / ncdu / `btrfs fi du` on a drive or big shared folder, and `find` there deeper than -maxdepth 4 (points to `plocate`). `AGENT_GUARD_OK=1` in front overrides; refusals log to `~/.local/state/agent-guard/refusals.jsonl`; anything unparseable is allowed | replayed on 12,009 real commands from 3 days: 1.97 % refused, all instances of the three patterns |
| `fleet-disconnect` | The agents' capacity dial and the disconnect protocol ([FLEET-DISCONNECT.md](FLEET-DISCONNECT.md)). `ramp N` gives agents N % of the above; `drain` (0 %) refuses new work before a reboot; `wait` reports what is still in flight; `resume` restores 100 % | heavy-run slots and load limit, heavy.slice CPUQuota, and the queue's VRAM, BAR1 and load limits, all × N % |
| `throttle.mjs` | Endoforge scheduler: no new atom without headroom (one atom always runs) | reserve and load as above |
| `remote-run` | A heavy job on another host of ours (ds9). Inputs are rsynced to the same absolute paths, the job runs under that host's own `heavy-run`, outputs come back to the same local paths, and the job stops when `remote-run` does. `--in-blend` also syncs every external file a `.blend` uses. `setup` exports `origin/main` there and installs `heavy-run`, `workers` and `fleet-disconnect` (not memguard) | the host's own limits; ds9: 3 slots, load < 38.5, 22 GB reserve, heavy.slice 109 GB / about 25 cores |
| `lane-governor` | Admission for agent lanes (side sessions, subagents, scripted runs) inside the Claude app. Coordinators `acquire` a lane before starting or resuming one and wait in a queue; exit 75 means wait. Counts working sessions from the app log, lane tickets, and the app tree's RSS, growth and CLI count, plus memory and load. Calibrated on the app's own crash logs. Never stops running work | lanes min(threads/10, RAM/40 GB) (3), ≤ 8 CLIs, ≤ 6 cycle starts per 10 min and 60 s apart, tree growth < 7 % RAM per 2.5 min (8.7 GB), tree < 20 % (25 GB), reserve and load as above |

**Where it is wired in**
- `endoforge run` puts the whole run inside `heavy.slice`.
- `schedule.mjs` checks headroom before each new atom.
- `media/nh3-kit/tools/blender-cpu` queues through `heavy-run`.
- `media/nh3-kit/tools/gpu-queue.py` forwards to this queue.
- `ENDOFORGE_THROTTLE=0` turns the Endoforge side off.

**Overrides:** `HEAVY_SLOTS`, `HEAVY_RESERVE_GB`, `HEAVY_MAX_LOAD`, `HEAVY_MEM`, `ENDOFORGE_MAX_LOAD`, `ENDOFORGE_RESERVE_GB`, `GPU_QUEUE_VRAM_FRAC`, `GPU_QUEUE_BAR1_FRAC`, `GPU_QUEUE_RESERVE_GB`, `GPU_QUEUE_MAX_LOAD`, and lane-governor's `LANE_*` (listed in its header).

**Install** (once per machine; rerunning is safe): `forge/endoforge/tools/throttle/install.sh`. It puts `heavy-run` and `memguard` in `~/.local/bin`, sizes `heavy.slice`, reserves memory up to `user.slice` (sudo), and enables `memguard.service`. `heavy-run --limits` shows what this machine gets.

**Tests:** `forge/endoforge/tools/throttle/test/run.sh` covers:
- limit scaling for a rig, a laptop and a large box;
- slot and headroom waits;
- slice placement and nesting;
- scheduler headroom;
- the GPU queue: headroom, waiting out trouble, stopping on a fault;
- the lane governor: limits, every gate, app-log sensors, crash replay, tickets, queue and hook;
- the worker registry (`test/test_workers.py`): receipts without command or task text, keyed digests, the spawn gate
  under a 20-launch burst, a retry loop and changing arguments, the redaction cases from the 2026-10-27 reviews, post-job
  git that runs no job-planted fsmonitor, and death by signal reported without a Python core dump.

**Change receipts** (`~/.local/state/workers/receipts/<host>-<pid>-<start>.json`, written by `workers run`, not by the
model): bot, host, repo; HEAD and branch before and after, and `git diff --stat` of new commits and of the working
tree; `rc` or `signal`; start, end, duration; the paths named in `WORKERS_EVIDENCE` (codex-task passes its run
directory). No command or task text: the program's basename, the argument count, and HMAC-SHA256 digests of the
command and the task under a random per-host key (`digest.key` in the registry directory, mode 0600). Two runs of one
command on one host match, but a guessed secret cannot be checked against a receipt without that key. Never the
environment.
- The registry's live and history entries keep a task label: the task's first line, with secret shapes redacted (URL
  credentials, Authorization and Bearer values, KEY/TOKEN/SECRET/PASS-style assignments and flags, `-p`, and known
  token prefixes anywhere in a word), cut to 80 characters, plus the program name and argument count. **Limit:** a
  secret written as free text (`the password is hunter2`, `use API key 4f9a1c2e`) cannot be recognised reliably and
  stays in the label. Keep secrets out of task text; pass them through the environment or a file.
- Post-job git runs with no fsmonitor, hooks, external diff, textconv or optional locks, and a 5 s timeout. A clean or
  smudge filter the job defined in `.git/config` can still run (follow-up).
- The spawn-rate alarm counts this bot's launches of one program (its basename, whatever the arguments), refused ones
  included, and records each under one lock before any slow call. A burst or a retry loop is held to
  `WORKERS_SPAWN_MAX` (30) per 60 s; a caller that keeps retrying stays refused until it pauses for 60 s.
- A job killed by a signal is reported by dying of the same signal, except SIGKILL, SIGSTOP and the core-dumping
  signals (SEGV, ABRT, QUIT...), which give exit 128 + N, so the registry never dumps a Python core.

**Lanes never die with the app, and never lose their work** (2026-10-28, `lane`). The ABI set lane ran as a subagent inside the Claude desktop app, died when the app restarted, and nobody noticed for 5.5 hours; a lane waiting on its own background job leaves no stopped notice. Craig: "thats horrible, we need a way to prevent that from ever happening again", "they should not lose any data no matter what". Any agent lane that runs longer than a few minutes is started with `lane start --job DIR --name NAME --brief FILE`, never as an in-app subagent:
- The lane is a systemd user service (`lane-<job>-<name>`, Restart=on-failure) running headless Claude on the `~/.claude-accts` logins, outside the app.
- Everything is on disk as it happens:
  - every message and tool event in `<job>/lanes/<name>/stream.jsonl`;
  - the session transcript copied to `transcript.jsonl` after each run;
  - the lane's own `journal.md` (done, files, next step);
  - `events.jsonl` (runs, crashes, limits, restarts).
- Any end without `DONE` resumes the same conversation. A usage or spend limit moves the session, transcript and all, to the next login. The lane ends only with `DONE`, `NEEDS-YOU` (a desktop notification), `lane stop` or `--until`.
- `lane-watch.timer` (every 5 min, part of no app) restarts a lane whose service is gone (an app restart, a reboot) and notifies when a lane has been quiet 30 min while holding no queued job.
- `lane status` shows every lane: state, service, login, runs, crashes, minutes quiet and the last journal line.
- Tested: a fake `claude` drives crash, early-turn, limit, DONE, NEEDS-YOU, STOP and --until paths (`test/test_lane.py`). Live on main-rig, a SIGKILLed lane came back through systemd, and a removed service came back through the watchdog, resuming the same session until DONE.

**ds9, the second heavy host** (2026-10-27, Craig: "thats the idea can you get it set up? study akilleez repo and configure it"):
- ds9 is the X99 home server (Home Lab's; `aors/fleet.json` devices): Xeon E5-2699 v4, 44 threads, 188 GB, ZFS pools, and the home services (Immich, Home Assistant, Nextcloud, Netdata, Docker). It has no render GPU, so it takes CPU work: Blender builds and exports, CPU Cycles stills, photo pipelines, tests. GPU renders stay on main-rig's 4080.
- Measured on the machinery-hall frame (Cycles 32 spp + OIDN, 1080p), seconds a frame: main-rig 4080 2.2; main-rig CPU (16 threads) 42; ds9 CPU inside its heavy.slice 86. Same pixels as main-rig (mean difference 0.05/255) once every input is there.
- Access: `ssh ds9` (user `ds9`, main-rig's key; `Host ds9` in `~/.ssh/config`). The paths main-rig's jobs use exist there, owned by `ds9`: `/home/user/...` and `/mnt/cold-steam/factory-scratch/...`. Blender 5.2.2 (the same package as main-rig) is installed from the Omarchy mirror.
- Run `remote-run --host ds9 setup` after merges to refresh its code and tools; `remote-run --host ds9 status` shows its load, limits and running jobs.
- Lessons built in: ds9's ssh sessions are not in a user-manager unit, so `heavy-run` now binds only to units of the user's own manager; read-only sources (`~/Projects/nh3-kit`) used to arrive read-only and block the next sync, so copies arrive writable and a partial input sync stops the job; the first benchmark rendered the hall without its IES profiles (37 % darker), so `--in-blend` asks Blender for a file's dependencies. `~/Projects/bud` is refused by path.

**Why memguard** (added after the 00:58 crash the same night): no real job had gone through `heavy-run` yet. A Kimodo job started as its own service with no cap grew to 15 GB, and the kernel failed allocations while the Claude app's own process group sat at 30.7 GB with no reserved memory. Craig: "how did that happen you just built fixes to prevent", "and codex".

**Jobs live and die with their owner** (2026-10-26, after a stopped hill-climb round left a 19.8 GB render running for 80 minutes; Craig: "a note is insufficient bake it into architecture"):
- `heavy-run` binds each job to the unit that started it (`BindsTo=` the nearest ancestor service, else the app or terminal scope). As a service's own main process, it keeps the job inside that service. Stopping the owner stops the job either way.
- A launcher whose owner is already gone (a transient `run-*.scope` reparented to the user manager) is refused with exit 75, so a stray loop cannot start new work.
- A job ends when its main process ends (2026-10-27: photo2model's harvest was OOM-killed at 18:01, and its 10 idle worker processes kept the scope and its slot lock for 75 minutes, starving the ABI set lane). `heavy-run` stays as a small supervisor: it waits for the main process, then stops the job's scope, so anything the main process left behind is killed and the slot frees at once. The main process's exit status (137 for SIGKILL) passes through, stdin is passed on, and a TERM, INT or HUP to `heavy-run` stops its job. Only a SIGKILL to `heavy-run` itself skips this; the job then keeps its slot until it ends, as before.
- Hill-climb campaigns reject render commands wrapped in `systemd-run --scope`.
- memguard stops any `heavy-run` job whose recorded owner is no longer active, and reports (with a desktop notification) big Blender or Python processes left running by a launcher that is gone. It never kills those.

**Kernel headroom** (`memguard --install`, added after the Codex app's GPU process crashed at 01:22): the NVIDIA driver and Electron GPU processes failed large allocations while RAM was fragmented and the kernel's free pool was 66 MB. `/etc/sysctl.d/99-memguard.conf` now sets a free pool of 1 % of RAM (64 MB to 2 GB), reclaim that starts 1.5 % earlier, and proactive compaction 40.

**Why lane-governor** (2026-10-26, after the Claude app's main process died silently at 19:03 with 142 processes and 22 GB, its third crash in four days; Craig: "we crashed, running too hard"). Every side session, subagent and their jobs run inside the app's process tree. The app logs a `[process-memory]` line every minute and a line for each session cycle, and `lane-governor calibrate` replays those logs. It found 13 in-boot unclean app exits since 09-22 (reboots and quick relaunches excluded) across about 43,000 healthy minutes.
- No single number separates a crash from a busy healthy minute. Healthy minutes reached 49 GB, 292 processes and 7 working sessions, and some crashes came at 2-4 GB.
- The policy as a whole does. Before 12 of the 13 exits it held at least once in the last 10 minutes, and it held 44 % of those minutes against 3.7 % of healthy minutes. A random healthy 10-minute window holds at least once 10 % of the time.
- Per gate, as crash windows held, then crash minutes against healthy minutes: lanes 1/13, 7 % vs 0.1 %; CLIs 2/13, 10 % vs 0.4 %; burst 6/13, 25 % vs 1.6 %; growth 5/13, 5 % vs 1.0 %; tree 4/13, 7 % vs 0.4 %; memory 7/13, 14 % vs 0.6 %.
- Growth thresholds of 5 %, 7 % and 9 % of RAM were tried with bursts of 4, 6 and 8. 7 % with 6 kept the most crash minutes per healthy minute held while still covering 12 of the 13.

Usage, for a coordinator before it starts or resumes a lane: `T=$(lane-governor acquire --name audio-pass --kind subagent)`, start the lane, then `lane-governor release "$T"` when it reports back. Exit 75 means queue it and ask again later. `acquire` waits up to 540 s by default, which fits in one tool call. A `session` ticket counts only while the session starts (120 s); after that the app log shows it working. `lane-governor run --name N -- cmd` holds a lane for a scripted run. `lane-governor status` shows what holds. The once-a-minute `lane-governor-sample.timer` records the load, PSI and app-scope memory the app logs lack, so the next calibration can test those gates too. [`lane-governor.claude-hooks.json`](lane-governor.claude-hooks.json) is an opt-in Claude Code hook. It takes a ticket for every `Agent` and `start_session` call, blocks the call with the reason while the governor holds, and releases on `SubagentStop`. It is not installed by `install.sh`.

**Why diskguard** (2026-10-26, Craig: "we need to clear up space on system drive and find out how to prevent it filling up so fast"): the 3.6 TB system drive reached 89 %. Every agent work folder installs its own `node_modules` (up to 5.6 GB) and nothing removed them: 2,837 work folders, 711 created in one day, 615 worktrees of one repo. The first survey ran three whole-tree scans at once and helped crash the Claude app, so diskguard measures with statvfs, looks a few levels deep, and runs at idle IO priority. Log: `~/.local/state/diskguard/janitor.jsonl`; dry run: `diskguard janitor --worktrees` (no `--apply`).

**Why agent-guard and the slot release** (2026-10-26, Craig: "do it in code and mechanisms", "improve the system"): each came from a logged cost. A `git stash` in a shared worktree swept another session's edits; three whole-drive scans at once helped crash the Claude app; an EEVEE render with no GPU access held the only GPU slot for 28 min while the 4080 sat at 0 % and two lookdev jobs waited. Notes had not stopped any of them.

**Not covered:** a single job can still grow past the limits after it starts. `heavy.slice`'s MemoryHigh throttles that growth and MemoryMax contains it; on the GPU, the guard remains the hard stop. Admission only keeps jobs from piling up.
