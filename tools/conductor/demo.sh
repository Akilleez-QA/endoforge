#!/bin/bash
set -eu
if [ $# -ne 1 ] || [ -e "$1" ]; then echo "usage: demo.sh <new directory>" >&2; exit 2; fi
TOOLS=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$1"; D=$(cd "$1" && pwd); cd "$D"
export HOME=$D/home ENDOFORGE_NOTIFY=none ENDOFORGE_JOBS=$D/none ENDOFORGE_VOLATILE=/nonexistent-volatile WORKER_STATE_DIR=$D/workers
mkdir -p home/.codex home/.claude-accts/a1
: > home/.codex/auth.json
echo '{"claudeAiOauth":{"accessToken":"synthetic","scopes":["user:inference"],"subscriptionType":"max"}}' > home/.claude-accts/a1/.credentials.json
cat > worker.sh <<'EOF'
#!/bin/bash
for a in "$@"; do case "$a" in *"You own ONLY"*) brief="$a";; esac; done
f=$(printf '%s\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
name=$(basename "$f" .py); op=+; [ "$name" = mul ] && op="*"
if printf '%s' "$brief" | grep -q "reverted at the collect gate"; then echo "def $name(a, b): return a $op b" > "$f"
else echo "def $name(a, b) return a $op b" > "$f"; fi
EOF
chmod +x worker.sh
mkdir -p repo/src
git -C repo init -q -b main; git -C repo config user.email demo@example.invalid; git -C repo config user.name demo
echo "# todo" > repo/src/add.py; echo "# todo" > repo/src/mul.py
git -C repo add src; git -C repo commit -qm seed
echo "Add add() and mul() to src." > REQUEST.md; echo "# notes" > NOTES.md; echo '{}' > smoke.json
cat > job.json <<EOF
{"schema":"endoforge/job/1","id":"demo","kind":"code","title":"demo","repo":"$D/repo",
 "goal":{"verbatim":"Add add() and mul() to src.","by":"operator"},
 "brief":{"objective":"two functions","acceptance":"src compiles","scope":"src only","authority":"operator","assumptions":{"stated":[],"inferred":[]}},
 "sources":[{"id":"req","primary":true,"path":"$D/REQUEST.md","governs":["code"],"what":"the request"}],
 "criteria":[{"id":"T1","statement":"src compiles","satisfiedBy":["ADD","MUL"],"requires":["edit"],"check":{"kind":"tests","run":"python3 -m py_compile src/*.py"}}],
 "atoms":[{"id":"ADD","engine":"codex","aspects":["code"],"capabilities":["edit"],"files":["src/add.py"],"sources":["req"],"checks":["T1"]},
          {"id":"MUL","engine":"claude","aspects":["code"],"capabilities":["edit"],"files":["src/mul.py"],"sources":["req"],"checks":["T1"]}],
 "gates":[],"resources":{"capacityDial":true,"throttle":"endoforge","ownerBound":true,"health":["true"]},"ratchet":{"kind":"tests"},
 "criticalPath":"ADD","rival":"by hand","deadline":"2099-01-01T00:00:00Z","notes":"$D/NOTES.md",
 "proofs":{"smoke":{"engines":{"codex":true,"claude":true},"receipt":"$D/smoke.json"}},
 "conductor":{"launcher":"local","codexPool":"$D/worker.sh","claudeBin":"$D/worker.sh","maxIterations":2,
   "gate":"python3 -m py_compile src/*.py","checks":[{"id":"T1","run":"python3 -m py_compile src/*.py"}]}}
EOF
node "$TOOLS/job/bin/job.mjs" stage job.json > /dev/null
SHA=$(sed -n 's/.*"cardSha256":"\([0-9a-f]*\)".*/\1/p' events.jsonl | tail -1)
node "$TOOLS/conductor/bin/conduct.mjs" go job.json --sha "$SHA" --by operator --words go
node "$TOOLS/conductor/bin/conduct.mjs" run job.json --tick 1 --max-ticks 30
node "$TOOLS/conductor/bin/conduct.mjs" status job.json
git -C repo log --oneline
