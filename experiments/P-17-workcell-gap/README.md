# P-17 workcell gap 10-50

The harness is the P-15 harness unchanged (`experiments/P-15-workcell-concurrency/`: `setup.sh`, `run.mjs`, `host.mjs`, `worker.mjs`, `kernels/`, `machinery/`). Reproduce from that directory:

```
ARM=gap RAMP=10,12,16,20,24,28,32,40,50 node run.mjs
```

Records: `PRECOMMIT.md`, `RESULT.md`, `receipt/`. Per-rep latency arrays and 200 ms memory samples were kept on main-rig and are not committed.
