#!/usr/bin/env bash
# P-04 setup: probe-local AssemblyScript for the parse gate. Pinned. Nothing global.
# Prefers the npm offline cache; falls back to the registry only if the cache misses.
set -euo pipefail
cd "$(dirname "$0")"
ASC_VERSION="0.28.20"
mkdir -p receipt
if [ ! -f node_modules/assemblyscript/package.json ]; then
  npm install --no-save --no-audit --no-fund --prefer-offline --ignore-scripts "assemblyscript@${ASC_VERSION}" 2>&1 | tail -3
fi
node -e 'const p=require("./node_modules/assemblyscript/package.json");console.log("assemblyscript",p.version)'
{
  echo "assemblyscript ${ASC_VERSION}"
  node -e 'const p=require("./node_modules/assemblyscript/package.json");console.log("resolved",p.version)'
  (cd node_modules/assemblyscript && find . -type f -name '*.js' -path './dist/*' | sort | xargs sha256sum)
  echo "claude $(claude --version 2>/dev/null | head -1)"
  echo "node $(node --version)"
} > receipt/deps.txt
echo "setup done; receipt/deps.txt written"
