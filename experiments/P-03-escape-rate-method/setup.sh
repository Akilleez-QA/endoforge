#!/usr/bin/env bash
# P-03 has no dependencies beyond Node. This records the toolchain used.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p receipt
{ echo "node $(node --version)"; echo "sha256 of toolchain binary: $(sha256sum "$(command -v node)" | cut -d' ' -f1)"; } > receipt/toolchain.txt
echo "no external dependencies; see receipt/toolchain.txt"
