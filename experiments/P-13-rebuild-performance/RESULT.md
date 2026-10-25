# P-13 clean dependency rebuild and runtime comparison

**Recorded (probe), 18 October 2026.** Authoritative attempt: `attempts/04/receipt/`. Fresh dependency reconstruction produced **151 matching dependency file/symlink entries, zero differences**, excluding npm's generated `.package-lock.json` metadata. The rebuilt, offline toolchain reproduced all **19 candidates / 242 tests**, with gate semantics and WASM hashes identical to P-09.

## Setup and preserved failures

The pinned Node base, original package lock and unchanged gate/schema were retained. No old node_modules or npm cache supplied the reconstructed dependencies. Fresh host setup used Node 22.18.0 extracted from the P-09 image, installed npm 12.0.2 (identity/version recorded), two empty config files, a new empty cache, disabled scripts and bounded registry fetches. It took 1621.95 ms. The image build then ran offline and uncached, taking 3825.29 ms. These are individual observations.

The original direct-in-Docker setup did not work:

1. Attempt 01: Docker bridge endpoint failed because `docker0` was absent. No network repair was attempted.
2. Attempt 02: explicitly host-networked npm setup stalled and hit its timeout. The initial subprocess helper killed only sudo, leaving Docker build clients running; the exact identified clients were explicitly cancelled. The failed setup and manual cleanup receipt remain available. This reproduces the client-versus-daemon ownership problem identified in the P-09 audit; it must not be described as automatic successful cleanup.
3. Attempt 03: npm rejected `/dev/null` being loaded as both user and global config. A secondary error-formatting bug obscured the exception, but raw stderr is retained. No dependencies were downloaded.
4. Attempt 04: two distinct empty npm config files, fresh host dependency fetch and offline image build passed. Timeout recording now captures output and terminates the owned subprocess group. Probe-owned Docker workloads additionally have explicit names/finally cleanup; this is not a replacement for P-12's journal/reconciliation API.

Original precommit and each amendment were hashed before their respective measurements. Earlier attempts and their runners are preserved, not overwritten. Runtime controls, workload and parity acceptance were not relaxed.

## Equal-resource observations

Ten invocations per arm on a shared desktop. Each workload instantiates the same existing CC-036 WASM module and makes 100,000 calls against an existing numeric test; every result matched. Docker workers enforce one CPU quota and 512 MiB. Bubblewrap runs inside a transient systemd user scope with the same CPU quota/memory maximum. The Docker client invocation also uses that scope; its daemon-managed workload has its own matching resource limits. Docker and host use the same Node executable, but different system libraries. The scope setup succeeded; persistent-container inspect retains actual Docker limits.

All timings below are **Recorded (probe)**, milliseconds; p95 is nearest-rank. Host time includes the transient scope and CLI invocation. Work time is measured inside the Node script around module instantiation plus calls, excluding Node startup and process exit.

| Arm | n | Host median | Host p95 | Host min/max | Work median | Work p95 | Work min/max |
|---|---:|---:|---:|---|---:|---:|---|
| Fresh bubblewrap + Node | 10 | 43.98 | 46.98 | 37.15 / 46.98 | 4.83 | 5.41 | 4.73 / 5.41 |
| Fresh Docker + Node | 10 | 495.25 | 543.74 | 483.62 / 543.74 | 4.83 | 5.66 | 4.68 / 5.66 |
| Node via exec in persistent Docker | 10 | 77.84 | 82.10 | 74.00 / 82.10 | 4.91 | 5.13 | 4.76 / 5.13 |

Persistent Docker still starts a new Node process per `exec`; this is not an in-process service benchmark. Its original container start is retained separately in `commands.json`, not included in the repeated exec times. The main successful attempt elapsed 40.55 seconds, including rebuild and replay. No confidence interval, quiet gate, randomised order or inference throughput claim is made.

## Interpretation

The dependency content and frozen outputs were reconstructed successfully. Runtime work medians were similar in this tiny workload; most measured differences arise outside that work interval. Persistent-container execution reduced repeated Docker lifecycle cost. These observations narrow P-09's startup-only comparison; they do not select a production topology or establish behaviour under concurrent model workers.

## What this does not show

This is not a clean operating-system bootstrap, bit-reproducible OCI image, cross-host/architecture test, live-agent benchmark, memory-efficiency study or hostile-isolation qualification. The installed npm CLI was recorded rather than independently provisioned; the pinned Node binary was extracted from the prebuilt image. Node 22 and npm 12 worked for this exact lockfile; general compatibility is not inferred. Original system libraries remain an environmental difference. The exact 19 original complete candidates were reused; quality and promotion evidence is unchanged.

No credentials or models were used. All measured workloads were offline; only trusted dependency setup fetched public packages. No system Docker configuration or application integration changed. No probe containers or build clients remain. Tagged images and ignored local setup work are retained. `attempts/04/receipt/summary.json`, raw commands, dependency manifests, image inspect, replay receipts and timings are the authoritative evidence.
