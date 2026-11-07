#!/usr/bin/env bash
# P-56 procedure. Usage: run.sh <step> with P56_OUT (outside the checkout), P56_CORPUS (P-42 receipts), P56_PREP (P-51 prep).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/../.." && pwd); tree=$P56_OUT/tree
case $1 in
  tree) # this commit plus P-51's harness, unmodified
    git -C "$repo" worktree add --detach "$tree" HEAD
    git -C "$repo" archive origin/escape-rate-probe experiments/P-51-escape-rate | tar -x -C "$tree"
    (cd "$tree" && make loop-setup) ;;
  record) node "$tree/experiments/P-56-evaluator-synthesis/record.mjs" "$P56_CORPUS" "$P56_OUT/recorded.jsonl" 6 ;;
  S1|S2)
    width=1; [ "$1" = S2 ] && width=2
    env P51_CORPUS="$P56_CORPUS" P51_PREP="$P56_PREP" P51_OUTPUT="$P56_OUT/$1" P51_SCRATCH="$P56_OUT/scratch" P51_ARMS=control,sampled,glue P51_WIDTH=14 \
      ENDOFORGE_ASC_CMD="$tree/tools/asc/node_modules/.bin/asc" ENDOFORGE_SYNTH=1 ENDOFORGE_SYNTH_WIDTH=$width \
      ENDOFORGE_SYNTH_PROVIDER="$tree/experiments/P-56-evaluator-synthesis/replay-provider.mjs" P56_RECORDED="$P56_OUT/recorded.jsonl" \
      node "$tree/experiments/P-51-escape-rate/run.mjs" ;;
  offline) node "$tree/experiments/P-56-evaluator-synthesis/offline.mjs" "$P56_CORPUS" "$P56_PREP" "$P56_OUT/recorded.jsonl" 1 "$P56_OUT/offline-S1.jsonl" ;;
  analyze) node "$tree/experiments/P-56-evaluator-synthesis/analyze.mjs" "$tree" "$P56_OUT/S1" "$P56_OUT/S2" "$P56_OUT/offline-S1.jsonl" ;;
esac
