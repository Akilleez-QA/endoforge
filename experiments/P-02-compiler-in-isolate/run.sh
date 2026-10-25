#!/usr/bin/env bash
# P-02 measurement runner. Idempotent, no network. Requires setup.sh and gen-kernels.mjs to have run.
set -euo pipefail
cd "$(dirname "$0")"
if [ -f receipt/summary.json ]; then
  d="receipt/aborted-$(date +%Y%m%dT%H%M%S)"; mkdir -p "$d"
  mv receipt/*.jsonl receipt/summary.json receipt/env-*.json receipt/deps-check.json receipt/bwrap-*.txt "$d"/ 2>/dev/null || true
fi
./env.sh receipt/env-before.json
echo "== in-isolate compile (host fs present)"
node main.mjs --label host --out receipt/compile-host.jsonl
echo "== in-isolate compile under bwrap"
./bwrap-run.sh receipt/compile-bwrap.jsonl || echo "bwrap run failed (recorded)"
echo "== dependency surface"
node deps-check.mjs > /dev/null
./env.sh receipt/env-after.json
node summarize.mjs
