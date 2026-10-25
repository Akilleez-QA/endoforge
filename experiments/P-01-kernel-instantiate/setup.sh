#!/usr/bin/env bash
# P-01 setup: pinned, local dependencies only. Network is used here and nowhere else.
set -euo pipefail
cd "$(dirname "$0")"

AS_VERSION=0.28.20
WASMTIME_VERSION=v49.0.3
WASMTIME_ASSET="wasmtime-${WASMTIME_VERSION}-x86_64-linux.tar.xz"
WASMTIME_URL="https://github.com/bytecodealliance/wasmtime/releases/download/${WASMTIME_VERSION}/${WASMTIME_ASSET}"

mkdir -p receipt .tools

# 1. AssemblyScript compiler, local to the probe.
if [ ! -f node_modules/assemblyscript/package.json ]; then
  npm install --no-audit --no-fund --save-exact "assemblyscript@${AS_VERSION}"
fi

# 2. Wasmtime CLI release binary.
if [ ! -x .tools/wasmtime ]; then
  curl -fsSL -o ".tools/${WASMTIME_ASSET}" "$WASMTIME_URL"
  curl -fsSL -o ".tools/${WASMTIME_ASSET}.sha256" "${WASMTIME_URL}.sha256" || true
  tar -xJf ".tools/${WASMTIME_ASSET}" -C .tools
  cp ".tools/wasmtime-${WASMTIME_VERSION}-x86_64-linux/wasmtime" .tools/wasmtime
  chmod +x .tools/wasmtime
fi

# 3. Record versions and hashes.
{
  echo "assemblyscript $(node -e 'console.log(require("./node_modules/assemblyscript/package.json").version)')"
  echo "assemblyscript_tarball_sha512 $(node -e 'console.log(require("./node_modules/.package-lock.json").packages["node_modules/assemblyscript"].integrity)')"
  echo "binaryen $(node -e 'console.log(require("./node_modules/binaryen/package.json").version)')"
  echo "wasmtime_cli $(.tools/wasmtime --version)"
  echo "wasmtime_tarball_sha256 $(sha256sum ".tools/${WASMTIME_ASSET}" | cut -d' ' -f1)"
  echo "wasmtime_published_sha256 $(cut -d' ' -f1 ".tools/${WASMTIME_ASSET}.sha256" 2>/dev/null || echo unavailable)"
  echo "wasmtime_binary_sha256 $(sha256sum .tools/wasmtime | cut -d' ' -f1)"
  echo "node $(node --version)"
  echo "cargo $(cargo --version)"
  echo "rustc $(rustc --version)"
} > receipt/tool-versions.txt
cat receipt/tool-versions.txt
