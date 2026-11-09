# Split work with the atomizer

The atomizer splits a need into small atoms and runs them as a dependency graph. Atoms with no dependency between
them run at the same time. Each atom runs in its own bubblewrap sandbox with a private home and only the mounts it
declares: its inputs at `/in`, its outputs at `/out` and scratch at `/work`. An atom's worker is a fixed script, or a
Claude or Codex agent with a prompt. Outputs are checked against receipts, and every step goes to an append-only
ledger.

Use it when one need is too big for one agent turn, or when parts of it should be written by agents that must not see
each other's work, such as tests and the code they test.

This page needs bubblewrap (`bwrap`) installed. Every command was run with script workers only, so no model was
called.

## 1. Write the graph

An `atoms.json` (`endoforge/atoms/1`) names the need, the acceptance checks, and the atoms. This one builds a page
from a title and a body written by two independent atoms, then joined by a `compose` atom:

```sh
DEMO=$(mktemp -d)
cat > "$DEMO/greeting.json" <<'EOF'
{
  "schema": "endoforge/atoms/1",
  "need": { "id": "greeting", "text": "Write a greeting page with a title and a body, built from two parts." },
  "acceptance": [
    { "id": "A1", "statement": "page.txt starts with the title and ends with the body.", "check": { "kind": "command", "run": "head -1 /in/compose/page.txt | grep -q Hello" } }
  ],
  "atoms": [
    { "id": "title", "kind": "data", "contract": "Write the page title as one line.", "inputs": [{ "from": "need" }],
      "outputs": [{ "name": "title", "path": "title.txt" }], "verify": { "kind": "manual" }, "size": { "work": 1, "interface": 1 },
      "worker": { "model": "script", "command": ["sh", "-c", "echo 'Hello, EndoForge' > /out/title.txt"] } },
    { "id": "body", "kind": "data", "contract": "Write the page body as one line.", "inputs": [{ "from": "need" }],
      "outputs": [{ "name": "body", "path": "body.txt" }], "verify": { "kind": "manual" }, "size": { "work": 1, "interface": 1 },
      "worker": { "model": "script", "command": ["sh", "-c", "echo 'Built from two atoms.' > /out/body.txt"] } },
    { "id": "compose", "kind": "compose", "contract": "Join the title and the body into page.txt.",
      "inputs": [{ "from": "title", "output": "title" }, { "from": "body", "output": "body" }],
      "outputs": [{ "name": "page", "path": "page.txt" }], "verify": { "kind": "manual" }, "size": { "work": 1, "interface": 1 },
      "worker": { "model": "script", "command": ["sh", "-c", "cat /in/title/title.txt /in/body/body.txt > /out/page.txt"] } }
  ]
}
EOF
```

The rules a graph must pass, checked before anything runs:

- Each atom has an `id`, a `kind`, a `contract` of at least 20 characters, at least one output with a relative path,
  a `verify` field and a `worker`.
- `worker.model` is `script` (with a `command` array), or `sonnet`, `opus` or `codex` (with a `prompt`).
- `size.work` and `size.interface` are 1 to 5, and `size.work` is at most 3: bigger atoms must be split.
- An input names an earlier atom's output, or `need`. An input from `need` is mounted as `/in/need/NEED.md`; an
  input from atom `title` is mounted under `/in/title/`.
- There is exactly one `compose` atom (or one `direct` atom alone). No cycles, and none of the forbidden edges in
  [`tools/atomizer/policy.json`](../../../tools/atomizer/policy.json): `tests` atoms never feed `kernel` atoms or the
  reverse, and `review` atoms never see the code.

## 2. Plan it

`atomize.mjs` normally asks a model to write `atoms.json` from a need. With `--fixture` it skips the model and only
validates and plans the graph you give it:

```sh
printf 'Write a greeting page with a title and a body.\n' > "$DEMO/need.md"
node tools/atomizer/bin/atomize.mjs "$DEMO/need.md" --out "$DEMO/plan" --fixture "$DEMO/greeting.json"
```

```text
{"valid":true,"attempts":[{"wallMs":0,"atoms":3,"errors":0,"usage":null}],"plan":{"atoms":3,"total":3,"critical":2,"speedupBound":1.5,"width":2}}
```

`$DEMO/plan/plan.json` puts `title` and `body` in wave 0 and `compose` in wave 1. The critical path is two atoms
long, so three atoms of equal size can finish at most 1.5 times faster than in sequence.

## 3. Run it

Keep the ledger outside the source tree, and point the Claude account directory at an empty path so no login is
mounted:

```sh
export ATOMIZER_LEDGER_DIR=$DEMO/ledger ENDOFORGE_CLAUDE_ACCOUNTS=$DEMO/none
node tools/atomizer/bin/schedule.mjs run "$DEMO/greeting.json" --run-dir "$DEMO/run"
cat "$DEMO/run/atoms/compose/out/page.txt"
```

```text
done   title (6 ms, attempts 1)
done   body (5 ms, attempts 1)
done   compose (5 ms, attempts 1)
{"allDone":true,"wallMs":16,"sumAtomWallMs":16,"realizedSpeedup":1,"speedupBound":1.5,"statuses":{"title":"done","body":"done","compose":"done"},"tokens":{"input":0,"output":0,"cacheRead":0,"cacheCreate":0,"calls":0}}
Hello, EndoForge
Built from two atoms.
```

The run directory holds each atom's `in/`, `out/` and `work/`, plus `atoms.json`, `trace.jsonl` and `receipt/`.

## 4. Verify and report

```sh
node tools/atomizer/bin/verify.mjs "$DEMO/run"
node tools/atomizer/bin/report.mjs "$DEMO/run"
```

`verify.mjs` checks that every atom finished and its outputs match their receipts, then runs each `command`
acceptance check in a sandbox with the compose atom's outputs mounted at `/in/compose`:

```text
{"ok":true,"fails":[],"acceptance":[{"id":"A1","ok":true}]}
```

`report.mjs` prints a Markdown timeline with each atom's wall time, attempts and tokens, and the planned waves.

## What a refusal looks like

Change `title` to a `tests` atom and `body` to a `kernel` atom that reads it, and `schedule.mjs` refuses before
running anything (exit 3):

```text
{
 "ok": false,
 "errors": [
  "title (tests) -> body (kernel) is forbidden: the generator never sees the frozen tests (DEC-72, L-16)"
 ],
 "warnings": []
}
```

## Use agents as workers

Replace a script worker with a model worker:

```json
"worker": { "model": "sonnet", "prompt": "Write the page title as one line to /out/title.txt." }
```

`sonnet` and `opus` run `claude -p` with the model names in `policy.json`; `codex` runs `codex exec`. Kinds with a
fixed procedure in `policy.json` (`kernel`, `tests`, `glue`, `compose`, `repair`, `direct`, `review`, `asset`) add
that procedure to the prompt. The atomizer does not copy your own credentials into a sandbox. Claude atoms take the
next login from `ENDOFORGE_CLAUDE_ACCOUNTS` (default `~/.claude-accts`, one directory per login); with none there,
`ENDOFORGE_CREDENTIAL_HOME` names a home template to copy. `ENDOFORGE_WORKER=codex` turns every model atom into a Codex
atom launched through the account pool.

For kernels, the `compose` procedure runs `bin/compose-kernel.mjs`: it joins the contract, tests, kernel parts and glue
from their atoms, freezes the contract and tests before any code, and runs the gates.

The [atomizer README](../../../tools/atomizer/README.md) lists every script and option.
