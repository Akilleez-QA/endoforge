# Throttle: heavy jobs and the GPU queue wait for headroom instead of tripping

Written 2026-10-26. Two concurrent campus renders (about 40 GB) plus RAM-backed `/tmp` drove kernel page-allocation failures and took ChatGPT down, and a GPU job pushed VRAM into the guard's kill limit. Craig: "add a way to throttle so we dont trip", "it should scale itself to fit the hardware", "gpu gets a queue too", and "performance isnt high performace if we lose system stability".

Everything here waits rather than fails, and every limit is computed from the machine it runs on.
`heavy-run` scopes use nice 10 or the inherited nice level, whichever is higher, so jobs already at nice 19 can start without privilege.

| Piece | What it does | Scaled limits (32 threads, 124 GB rig) |
|---|---|---|
| `heavy-run` | Heavy CPU/RAM jobs take a slot, wait for memory and load headroom, then run in `heavy.slice` | slots RAM/48 GB (2), reserve 12 % RAM (14 GB), load < 0.875 × threads (28) |
| `heavy.slice` | Shared ceilings for every heavy job. `heavy-run` writes it, and rewrites it when the hardware changes | MemoryHigh 45 % RAM (55G, throttles first), MemoryMax 58 % (71G, stops only slice jobs), CPUQuota 56 % of threads |
| `gpu-queue.py` | Priority queue for GPU and browser jobs. At the head it starts only with GPU and system headroom; temporary trouble means wait, a fault latch means stop | VRAM < 60 % and BAR1 < 50 % of the card's totals (the guard stops at 85 % and 75 %), RAM reserve and load as above |
| `gpu-queue.py --est S` | Short lane: a job declared at `GPU_QUEUE_SHORT_SEC` (300 s) or less takes queue priority 0 and starts at the next gap between long jobs; a long ticket waiting `GPU_QUEUE_AGE_SEC` (600 s) is renamed into the same lane, arrival kept. The lane is in the ticket name, the only thing the browser guard reads, so every reader agrees on the head. `--stats [--hours 12]` reads `history.jsonl` (one line per job: wait, run, exit code) | short ≤ 300 s, ageing after 600 s |
| `workers` | The CLI-worker registry: `workers run --bot SLUG -- cmd` registers a worker (host, bot, task, repo), heartbeats while it runs and records its end; `workers list` shows running, dead (process gone or no heartbeat) and finished workers on this host and every host that pushes here (`workers push --ssh <rig>` from the Grok box). Unknown bot slugs are refused. `fleet-disconnect status` includes it | lease 120 s, host stale after 180 s |
| `memguard.py` | Everything not started through `heavy-run`. Reserved memory (memory.low, set on every ancestor up to `user.slice`) for the Claude app, the ChatGPT/Codex app and the desktop. Any other job past 8 % of RAM gets the per-job ceiling, and if unprotected jobs together pass 45 % of RAM the largest is held at its size. Nothing is killed | Claude 12 % (15 GB), Codex 6 % (7 GB), desktop 4 % (5 GB), total 25 % (31 GB); big job > 10 GB → MemoryHigh 28 GB |
| `fleet-disconnect` | The agents' capacity dial and the disconnect protocol ([FLEET-DISCONNECT.md](FLEET-DISCONNECT.md)). `ramp N` gives agents N % of the above; `drain` (0 %) refuses new work before a reboot; `wait` reports what is still in flight; `resume` restores 100 % | heavy-run slots and load limit, heavy.slice CPUQuota, and the queue's VRAM, BAR1 and load limits, all × N % |
| `throttle.mjs` | Endoforge scheduler: no new atom without headroom (one atom always runs) | reserve and load as above |
| `remote-run` | A heavy job on another host of ours (ds9). Inputs are rsynced to the same absolute paths, the job runs under that host's own `heavy-run`, outputs come back to the same local paths, and the job stops when `remote-run` does. `--in-blend` also syncs every external file a `.blend` uses. `setup` exports `origin/main` there and installs `heavy-run`, `workers` and `fleet-disconnect` (not memguard) | the host's own limits; ds9: 3 slots, load < 38.5, 22 GB reserve, heavy.slice 109 GB / about 25 cores |

**Where it is wired in**
- `endoforge run` puts the whole run inside `heavy.slice`.
- `schedule.mjs` checks headroom before each new atom.
- `media/nh3-kit/tools/blender-cpu` queues through `heavy-run`.
- `media/nh3-kit/tools/gpu-queue.py` forwards to this queue.
- `ENDOFORGE_THROTTLE=0` turns the Endoforge side off.

**Overrides:** `HEAVY_SLOTS`, `HEAVY_RESERVE_GB`, `HEAVY_MAX_LOAD`, `HEAVY_MEM`, `ENDOFORGE_MAX_LOAD`, `ENDOFORGE_RESERVE_GB`, `GPU_QUEUE_VRAM_FRAC`, `GPU_QUEUE_BAR1_FRAC`, `GPU_QUEUE_RESERVE_GB`, `GPU_QUEUE_MAX_LOAD`.

**Install** (once per machine; rerunning is safe): `forge/endoforge/tools/throttle/install.sh`. It puts `heavy-run` and `memguard` in `~/.local/bin`, sizes `heavy.slice`, reserves memory up to `user.slice` (sudo), and enables `memguard.service`. `heavy-run --limits` shows what this machine gets.

**Tests:** `forge/endoforge/tools/throttle/test/run.sh` covers:
- limit scaling for a rig, a laptop and a large box;
- slot and headroom waits;
- slice placement and nesting;
- scheduler headroom;
- the GPU queue: headroom, waiting out trouble, stopping on a fault.

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

**Not covered:** a single job can still grow past the limits after it starts. `heavy.slice`'s MemoryHigh throttles that growth and MemoryMax contains it; on the GPU, the guard remains the hard stop. Admission only keeps jobs from piling up.
