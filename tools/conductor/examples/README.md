# Adopt examples

`conduct.mjs adopt` takes a job that is already running on older fan-out scripts and turns it into an
`endoforge/job/1` manifest plus Conductor state, without losing the old lanes. Everything about the old layout is data
in a map file; [lib/adopt.mjs](../lib/adopt.mjs) holds only the general mechanism.

| File | What it is |
|---|---|
| [fanout-loop.adopt-map.json](fanout-loop.adopt-map.json) | The map. `layout` gives templates for each lane's `unit`, `worktree`, `base`, `prompt`, `log` and `collected` marker over `{round}`, `{atom}` (lower case), `{ATOM}`, `{lanes}` and `{logs}`; `base` ending in `#base` reads that field of a JSON file. `atoms` are rules, first match wins: `when.files` is a regular expression over the old atom's files, `when.field` a key the old atom has; each rule gives `aspects` and `capabilities`. `primarySource`, `criticalPath` and `by` fill the matching manifest fields. |
| [fanout-loop.legacy.json](fanout-loop.legacy.json) | A synthetic old manifest: `title`, `goal`, `governing` sources, `atoms` with engine and files, and `checks`. |
| [fanout-loop.loop-state.json](fanout-loop.loop-state.json) | The old loop state per atom: `round`, `status` (`running`, `frozen` or `needs-coordinator`), `iter`, `history`. |

Try it with every path outside the source tree:

```console
$ DEMO=$(mktemp -d); mkdir -p $DEMO/lanes/2/a1 $DEMO/lanes/3 $DEMO/logs $DEMO/repo
$ echo '{"base":"abc123"}' > $DEMO/lanes/2/a1.json; touch $DEMO/lanes/3/b2.collected; echo '# notes' > $DEMO/NOTES.md
$ E=tools/conductor/examples
$ node tools/conductor/bin/conduct.mjs adopt $DEMO/job/job.json --map $E/fanout-loop.adopt-map.json \
    --legacy $E/fanout-loop.legacy.json --loop-state $E/fanout-loop.loop-state.json \
    --lanes $DEMO/lanes --logs $DEMO/logs --repo $DEMO/repo --notes $DEMO/NOTES.md --deadline 2026-12-01T00:00:00Z
adopted 3 atoms into .../job/job.json (phase staged): A1 launched, B2 checking, C3 frozen
```

`A1` is still running, so its lane (worktree, base commit, unit, log) is tracked where it stands. `B2` was already
collected by the old tool, so it goes straight to checking. `C3` keeps its frozen status. The command then lists what
the old manifest could not say; the gates refuse the go until it is filled in. The adopted job starts at `staged` and
needs the user's own go. [test/adopt-example.test.mjs](../test/adopt-example.test.mjs) runs this example.
