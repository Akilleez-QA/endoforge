#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(cd "$here/../.." && pwd); tree=$P65_OUT/tree
synth=$repo/experiments/P-56-evaluator-synthesis
case $1 in
  tree)
    git -C "$repo" worktree add --detach "$tree" HEAD
    git -C "$repo" archive origin/escape-rate-probe experiments/P-51-escape-rate | tar -x -C "$tree"
    (cd "$tree" && make loop-setup) ;;
  U1|U2)
    width=1; arms=control; [ "$1" = U2 ] && { width=2; arms=control,sampled,glue; }
    env P51_CORPUS="$P65_CORPUS" P51_PREP="$P65_PREP" P51_OUTPUT="$P65_OUT/$1" P51_SCRATCH="$P65_OUT/scratch-$1" P51_ARMS=$arms P51_WIDTH=14 \
      ENDOFORGE_ASC_CMD="$tree/tools/asc/node_modules/.bin/asc" ENDOFORGE_SYNTH=1 ENDOFORGE_SYNTH_WIDTH=$width \
      ENDOFORGE_SYNTH_PROVIDER="$tree/experiments/P-56-evaluator-synthesis/replay-provider.mjs" P56_RECORDED="$P65_RECORDED" \
      node "$tree/experiments/P-51-escape-rate/run.mjs" ;;
  offline)
    node "$tree/experiments/P-65-unit-gate/gates-offline.mjs" "$P65_CORPUS" "$P65_PREP" "$P65_OUT/gates-offline.jsonl" control,kernel,glue
    node "$tree/experiments/P-56-evaluator-synthesis/offline.mjs" "$P65_CORPUS" "$P65_PREP" "$P65_RECORDED" 2 "$P65_OUT/offline-S2.jsonl" > "$P65_OUT/offline-S2.summary.json" ;;
  analyze) node "$tree/experiments/P-65-unit-gate/analyze.mjs" "$tree" "$P65_OUT" "$P65_S2A" ;;
esac
