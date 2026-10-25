# P-11: archive-only recovery qualified in an empty private image store

**Recorded (probe), 18 October 2026.** The authoritative third attempt restored P-09's image and input archives into a new Docker image store with its own containerd, then recompiled and gated all **19 candidates / 242 tests**. Every semantic result, process exit and WASM SHA-256 matched **each of P-09's three arms**. No original checkout or image cache was mounted into execution.

The image identity was derived from archived config content, then inspected and executed after load: `sha256:5407fa2b6f7fac21ef527ce0be5bfce9b3034cd5b8e9818435b8100389826e28`. `receipt/isolated-run/empty-store.json` records zero images and containers before loading; `private-containerd-empty.txt.json` records an empty private containerd image listing. The private containerd socket/root/state and Docker root/exec/socket/pidfile were distinct from the system service. Docker additionally ran in a new network namespace. Worker containers had networking disabled, a read-only root, non-root UID, dropped capabilities, no-new-privileges and resource limits.

Every restored input matched the P-09 input manifest. A byte-corrupted input-archive copy failed SHA-256 validation **before extraction, daemon launch or workloads**. Original P-09 archives and every original receipt file remained hash-identical. Cleanup receipts show no remaining private containers, both owned daemons exited and their state stores removed. A repeated `run.sh` invocation refused the existing attempt and left its receipts byte-identical (`receipt/repeat-refusal.json`).

## What this does not show

This is the **same physical host**, Linux/AMD64, using prebuilt archive contents. It does not establish cross-machine/architecture recovery, reproducible image rebuild, encrypted/authenticated backups, live campaign/checkpoint recovery, model authentication, new evaluations, quality improvement, TX9 adoption, nested bubblewrap or a hostile-escape security claim. Trusted host comparison code reads old receipts; only the restored candidate directory enters workload mounts. Hash integrity uses existing trusted receipt digests and does not prevent substitution of both archive and digest.

The trusted replay gate sees the whole restored candidate tree, as P-09 did; this does not test private generator/evaluator workers. vfs is deliberately used for transparent empty-store qualification and differs from the source daemon's storage; timing is descriptive on a busy shared desktop.

## Attempts and measurements

Three attempts are retained without overwriting earlier evidence:

1. `receipt/`: all parity checks passed against an empty vfs image store, but Docker automatically attached system containerd. This is **not** full independent runtime evidence. The observed cross-runtime events motivated correction.
2. `receipt/private-run/`: explicit private containerd started, but Docker failed before load/workloads because its callback Unix socket path was too long. Both owned processes and stores were cleaned.
3. `receipt/isolated-run/`: authoritative qualification, private containerd and short paths, Docker in a fresh network namespace. All acceptance checks passed.

No network repair, original image deletion, system daemon reconfiguration or unrelated container mutation was performed. The first attempt shared a runtime service; no claim is made that its side effects were fully observed. The third isolates the daemon's network namespace as an additional precaution.

Authoritative elapsed time: **49.48 s**. Per-candidate compile/gate invocation times, milliseconds: n=19, median **2290.36**, p95 **2696.17**, min **1889.81**, max **2696.17**. p95 is nearest rank and equals max at this n. These are probe observations, without confidence intervals or benchmark comparability.

## Interpretation and evidence

P-09's image-cache recovery gap is closed for this host: the saved archives alone supplied a running toolchain and matching frozen replay in an initially empty, separately owned runtime. Cross-machine recovery and operational campaign resume remain independent questions.

Each attempt's precommit and exact runner hashes are retained before execution. `PRECOMMIT-isolated.md`, `run-isolated.py` and `receipt/isolated-run/` define the authoritative run. Exact commands, outputs, environment before/after, archive manifest/metadata, loaded image inspection, candidate results, integrity control, cleanup and summary are retained. `choices.md` records implementation decisions and mistakes. All source material is preserved. `work/`, `work-private/` and `w3/` retain ignored archive/input copies; generated daemon stores were removed. Archives are unencrypted and contain private request text, but no agent credentials.

`bash setup.sh` checks installed prerequisites without downloads; `bash run.sh` refuses this completed run. For another attempt, prepare a new empty probe/attempt location, update path-derived runner settings, precommit/hash before measurement and preserve all prior receipts.
