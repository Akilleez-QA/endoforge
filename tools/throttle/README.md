# Throttle: heavy jobs and the GPU queue wait for headroom instead of tripping

Written 2026-10-26. Two concurrent campus renders (about 40 GB) plus RAM-backed `/tmp` drove kernel page-allocation failures and took ChatGPT down, and a GPU job pushed VRAM into the guard's kill limit. Craig: "add a way to throttle so we dont trip", "it should scale itself to fit the hardware", "gpu gets a queue too", and "performance isnt high performace if we lose system stability".

Everything here waits rather than fails, and every limit is computed from the machine it runs on.

| Piece | What it does | Scaled limits (32 threads, 124 GB rig) |
|---|---|---|
| `heavy-run` | Heavy CPU/RAM jobs take a slot, wait for memory and load headroom, then run in `heavy.slice` | slots RAM/48 GB (2), reserve 12 % RAM (14 GB), load < 0.875 × threads (28) |
| `heavy.slice` | Shared ceilings for every heavy job. `heavy-run` writes it, and rewrites it when the hardware changes | MemoryHigh 45 % RAM (55G, throttles first), MemoryMax 58 % (71G, stops only slice jobs), CPUQuota 56 % of threads |
| `gpu-queue.py` | Priority queue for GPU and browser jobs. At the head it starts only with GPU and system headroom; temporary trouble means wait, a fault latch means stop | VRAM < 60 % and BAR1 < 50 % of the card's totals (the guard stops at 85 % and 75 %), RAM reserve and load as above |
| `throttle.mjs` | Endoforge scheduler: no new atom without headroom (one atom always runs) | reserve and load as above |

**Where it is wired in**
- `endoforge run` puts the whole run inside `heavy.slice`.
- `schedule.mjs` checks headroom before each new atom.
- `media/nh3-kit/tools/blender-cpu` queues through `heavy-run`.
- `media/nh3-kit/tools/gpu-queue.py` forwards to this queue.
- `ENDOFORGE_THROTTLE=0` turns the Endoforge side off.

**Overrides:** `HEAVY_SLOTS`, `HEAVY_RESERVE_GB`, `HEAVY_MAX_LOAD`, `HEAVY_MEM`, `ENDOFORGE_MAX_LOAD`, `ENDOFORGE_RESERVE_GB`, `GPU_QUEUE_VRAM_FRAC`, `GPU_QUEUE_BAR1_FRAC`, `GPU_QUEUE_RESERVE_GB`, `GPU_QUEUE_MAX_LOAD`.

**Install** (once per machine; rerunning is safe): `forge/endoforge/tools/throttle/install.sh`. It puts `heavy-run` in `~/.local/bin` and sizes `heavy.slice`. `heavy-run --limits` shows what this machine gets.

**Tests:** `forge/endoforge/tools/throttle/test/run.sh` covers:
- limit scaling for a rig, a laptop and a large box;
- slot and headroom waits;
- slice placement and nesting;
- scheduler headroom;
- the GPU queue: headroom, waiting out trouble, stopping on a fault.

**Not covered:** a single job can still grow past the limits after it starts. `heavy.slice`'s MemoryHigh throttles that growth and MemoryMax contains it; on the GPU, the guard remains the hard stop. Admission only keeps jobs from piling up.
