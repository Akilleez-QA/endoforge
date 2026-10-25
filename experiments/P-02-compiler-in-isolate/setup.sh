#!/usr/bin/env bash
# P-02 setup: pinned, local dependencies only. Network is used here and nowhere else.
set -euo pipefail
cd "$(dirname "$0")"
AS_VERSION=0.28.20
mkdir -p receipt
if [ ! -f node_modules/assemblyscript/package.json ]; then
  npm install --no-audit --no-fund --save-exact "assemblyscript@${AS_VERSION}"
fi
{
  echo "assemblyscript $(node -e 'console.log(require("./node_modules/assemblyscript/package.json").version)')"
  echo "assemblyscript_integrity $(node -e 'console.log(require("./node_modules/.package-lock.json").packages["node_modules/assemblyscript"].integrity)')"
  echo "binaryen $(node -e 'console.log(require("./node_modules/binaryen/package.json").version)')"
  echo "binaryen_integrity $(node -e 'console.log(require("./node_modules/.package-lock.json").packages["node_modules/binaryen"].integrity)')"
  echo "node $(node --version)"
  echo "bwrap $(bwrap --version)"
} > receipt/tool-versions.txt
# Compiler bundle sizes and hashes (the files asc actually loads).
( cd node_modules && find assemblyscript/dist binaryen/index.js -type f \( -name '*.js' -o -name '*.wasm' \) -print0 | xargs -0 sha256sum ) > receipt/compiler-bundle-sha256.txt
( cd node_modules && find assemblyscript/dist binaryen/index.js -type f \( -name '*.js' -o -name '*.wasm' \) -printf '%s %p\n' ) > receipt/compiler-bundle-sizes.txt
cat receipt/tool-versions.txt; cat receipt/compiler-bundle-sizes.txt
