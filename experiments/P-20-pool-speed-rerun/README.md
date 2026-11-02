# P-20 pool speed rerun

[PRECOMMIT.md](PRECOMMIT.md) freezes workloads and measurement rules.
[RESULT.md](RESULT.md) reports the outcome; [receipt](receipt/summary.json)
contains the aggregate and `receipt/raw/` the per-repetition data.

Run from the repository root with Node 20+, Python 3.11+, util-linux flock/taskset,
and the pinned external AssemblyScript installation. To prepare dependencies,
make an external scratch mirror of P-15 containing its setup.sh, package.json,
package-lock.json and receipt directory, symlink its kernels and machinery,
and symlink the repository as the mirror's sibling `endoforge`. Run the original
P-15 setup.sh there. An existing external node_modules can be symlinked into that
mirror; dependencies are never copied into this repository. See
[setup.json](receipt/setup.json) for the actual setup attempts and limitations.

```sh
P20_ASC=/tmp/example-p15/node_modules/assemblyscript/dist/asc.js \
P20_RECEIPT=/tmp/example-p20-receipt \
node experiments/P-20-pool-speed-rerun/run.mjs
```

The harness acquires `/tmp/ef-bench.lock` and verifies it is held before executing
any build or measurement. It refuses to overwrite a started sweep. Scratch
SQLite ledgers and frozen bundles remain outside the repository under
`/tmp/ef-p20-run-*`; receipts use synthetic candidate identities. Timing windows
are fixed by the precommit, with three repetitions unless a stop rule fires.
The scratch ledgers contain paths local to that execution and are not published.

RSS includes the supervisor and its direct children, including transient Python
validators. Heap measurements are maximum sampled JavaScript heap per cell;
they exclude external WASM memory. Ready times include lazy pool preparation and
are upper bounds on spawn-to-ready. Process counts see only the execution's PID
namespace. The residual callback confirms execution of the synthetic workload;
it does not independently establish kernel semantics.

Inspect the compiler compatibility evidence without executing its embedded WASM:

```sh
P20_ASC=/tmp/example-p15/node_modules/assemblyscript/dist/asc.js \
node experiments/P-20-pool-speed-rerun/inspect-compiler.mjs
```

[Verification receipts](receipt/verification.json) record completed checks and
full-suite interruptions. The benchmark does not bypass frozen verification or
durable ledger validation.
