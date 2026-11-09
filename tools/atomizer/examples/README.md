# Atom examples

[example.json](example.json) is the smallest `atoms.json` the [atomizer](../README.md) accepts: one acceptance item
with a manual check and one `compose` atom whose script worker writes `/out/marker.txt`. No model is involved. Copy it
to start your own graph, then change the need, the acceptance checks, the declared outputs and the workers. The rules
it must pass are in the [atomizer README](../README.md#atomsjson).

Run it with the run directory and the ledger outside the source tree:

```console
$ DEMO=$(mktemp -d)
$ export ATOMIZER_LEDGER_DIR=$DEMO/ledger ENDOFORGE_CLAUDE_ACCOUNTS=$DEMO/none
$ node tools/atomizer/bin/schedule.mjs run tools/atomizer/examples/example.json --run-dir $DEMO/run
done   complete (6 ms, attempts 1)
{"allDone":true,"wallMs":10,"sumAtomWallMs":6,"realizedSpeedup":0.6,"speedupBound":1,"statuses":{"complete":"done"},"tokens":{"input":0,"output":0,"cacheRead":0,"cacheCreate":0,"calls":0}}
$ node tools/atomizer/bin/verify.mjs $DEMO/run
{"ok":true,"fails":[],"acceptance":[{"id":"A1","ok":"not executed here"}]}
$ cat $DEMO/run/atoms/complete/out/marker.txt
complete
```

A manual acceptance check is reported as `not executed here`; use `"kind": "command"` with a `run` string for a check
`verify.mjs` runs. For a graph with real parallelism, see the ten-atom example in the atomizer README.
