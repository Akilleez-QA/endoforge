#!/usr/bin/env bash
# P-04b setup: probe-local AssemblyScript for the parse gate. Pinned. Nothing global.
# (The @anthropic-ai/sdk 0.135.0 install from the original precommit is no longer needed: the API arms were
# dropped by amendment 1. If present it is listed in deps.txt for the record.)
set -euo pipefail
cd "$(dirname "$0")"
ASC_VERSION="0.28.20"
mkdir -p receipt kernels
if [ ! -f node_modules/assemblyscript/package.json ]; then
  npm install --no-save --no-audit --no-fund --prefer-offline --ignore-scripts "assemblyscript@${ASC_VERSION}" 2>&1 | tail -3
fi
{
  echo "assemblyscript ${ASC_VERSION}"
  node -e 'const p=require("./node_modules/assemblyscript/package.json");console.log("assemblyscript resolved",p.version)'
  [ -f node_modules/@anthropic-ai/sdk/package.json ] && node -e 'const p=require("./node_modules/@anthropic-ai/sdk/package.json");console.log("@anthropic-ai/sdk resolved (unused after amendment 1)",p.version)'
  (cd node_modules/assemblyscript && find . -type f -name '*.js' -path './dist/*' | sort | xargs sha256sum)
  echo "claude $(claude --version 2>/dev/null | head -1)"
  echo "node $(node --version)"
} > receipt/deps.txt
cat receipt/deps.txt | head -3
echo "setup done; receipt/deps.txt written"
