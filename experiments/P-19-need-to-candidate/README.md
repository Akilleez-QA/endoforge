# P-19 need to candidate

Read [PRECOMMIT.md](PRECOMMIT.md) for the fixed question, procedure and criteria,
and [RESULT.md](RESULT.md) for measured results and architectural gaps.

From the Endoforge checkout root, with sibling `cstack/` and `poodo/` checkouts:

```sh
node experiments/P-19-need-to-candidate/run.mjs
python3 -B experiments/P-19-need-to-candidate/verify.py
```

Requires Node 20+, Python 3.11+, `flock`, and cstack's dependencies in
`$HOME/work/cstack-venv-tmp/bin/python`. The engine's existing bridges use
`python3` from PATH. Preserve the recorded receipt directory before rerunning:
the harness writes the same receipt filenames. The measured run uses no network
or model client. It launches a child through `flock /tmp/ef-bench.lock` for the
measurement loop; environment/source capture precedes lock acquisition.

[run.mjs](run.mjs) alternates 30 thread and 30 process runs, each with a fresh
size-one pool. [bridge.py](bridge.py) calls cstack's `cli.run_document`, freezes
the Endoforge evaluator, registers candidate bytes and verifies both ledgers.
[port.mjs](port.mjs) supplies actual executable checks to the real engine gates.
The frozen evaluator includes the port implementation and the six test cases.
The port accepts only the two bounded arithmetic expression forms used here;
its signature is declared and its empty effect set follows that grammar.
VM execution is not an OS sandbox. Fuel is an expression count and memory usage
is heap delta; neither is a separate enforcement mechanism.

All candidate files, evaluator trees and databases remain in per-run `/tmp/ef-p19-*`
directories, whose locations appear in raw receipts. Sanitized JSON evidence and
selected artifacts are exported under `receipt/`, as requested for this probe.
The evidence contains source and harness hashes, both ledgers' records, returned
receipt hashes, positive/negative verdicts, tests and stage timings. cstack's
source-pinned Foundation adapter performs its normal checks on every intake.
[verify.py](verify.py) independently replays the exported hash chains, checks
selected artifact hashes and recalculates the reported quantiles; use ordinary
Python execution with assertions enabled.

Only generation and final selection are synthetic: two preauthored expressions
replace the missing synthesis dispatch, and exporting the accepted frontier
replaces the missing promotion issuer. `realPromotion` remains false. The harness
does not construct a fake POODO decision or apply a lifecycle transition.
Standalone POODO is inspected as an instruction package; cstack's local
`poodo_core` supplies the executable control path with preauthored checkpoints.

The timing stages are non-overlapping. `pool_evaluate_and_append` includes worker
creation, input receipt validation, repeated frozen-content verification through
Python subprocesses, all gate/invariant/residual calls, and receipt append.
These operations cannot be separated through the current public pool interface;
the report must not attribute its aggregate time to one internal operation.
Raw JSON writing and artifact export into `receipt/` happen after total timing.
