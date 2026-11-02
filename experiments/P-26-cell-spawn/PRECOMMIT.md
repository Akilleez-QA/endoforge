# P-26 PRECOMMIT: workcell spawn and instantiate overhead, pre-warmed cells

Written before any P-26 measurement. Code under test for the before phase: endoforge main 04d2d7e.

## Question
How much of a job's latency is cell spawn, and how much does the workcell add to WebAssembly instantiation? The P-20 addendum measured a 47.9 µs median instantiate in a thread cell against 18.6 µs for P-01 run directly, but the Node version and load differed. Since PR #41, every cell spawn on Node 26 waits for a 2 s startup timer because undici 8 never instantiates WASM lazily.

## Protocol
Main-rig, held under flock /tmp/ef-bench.lock, Node 22.23.3 and Node 26.12.0, thread and process isolation, same P-20 addendum port.
1. Spawn: 10 fresh pools of size 1 per mode. Per pool, record the first-job and second-job latency of a no-op job (the port writes one file and throws). Spawn cost = first minus second.
2. Instantiate: the P-01 stub kernel, 2000 timed instantiations after 50 warm-ups, run (a) inside a workcell through the pool and (b) directly in a plain Node process with the same port function, back to back, 3 reps each.
3. After phase, at a fix commit: the same harness, plus pools built with the pre-warm option, recording first-job latency after the pool reports ready.

## Targets for the after phase (fixed now)
S1. Node 26 spawn cost median is at most 300 ms in both modes (before: about 2 s expected).
S2. With pre-warm, first-job latency median is within 20% of second-job latency in both modes and both Node versions.
S3. The WASM guard keeps refusing an untrusted module that exceeds the cap (existing tests unchanged on Node 22 and 26 CI).
Instantiate overhead is reported, with no target: (a) minus (b) per Node version and mode.
Any miss is reported as a miss.
