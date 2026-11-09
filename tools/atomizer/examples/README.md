# Atom examples

[example.json](example.json) is the smallest valid `atoms.json`. It has one acceptance item with a manual check and one `compose` atom whose script worker writes `/out/marker.txt`. No model is involved.

To start your own, copy it and change the need, the acceptance checks, the declared outputs and the workers. The rules it must pass are in the [atomizer README](../README.md#atomsjson).

Run it with an explicit run directory outside the source tree, and keep the ledger outside too:

```sh
DEMO=$(mktemp -d)
export ATOMIZER_LEDGER_DIR=$DEMO/ledger ENDOFORGE_CLAUDE_ACCOUNTS=$DEMO/none
node tools/atomizer/bin/schedule.mjs run tools/atomizer/examples/example.json --run-dir $DEMO/run
node tools/atomizer/bin/verify.mjs $DEMO/run
```

Both commands were run and exited 0. The marker lands in `$DEMO/run/atoms/complete/out/marker.txt`.
