#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
P15=../P-15-workcell-concurrency
mkdir -p kernels worker/machinery
cp -a $P15/kernels/. kernels/
cp -a $P15/machinery/tools worker/machinery/
[ -d $P15/node_modules/assemblyscript ] || { echo "run $P15/setup.sh first"; exit 1; }
export PATH="$HOME/.local/share/mise/installs/node/26.12.0/bin:$PATH"
[ -d node_modules/workerd ] || npm install --no-audit --no-fund --save-exact workerd@1.20261101.1
mkdir -p receipt
node build.mjs > receipt/build.txt
{ node_modules/.bin/workerd --version; node -p 'require("./node_modules/workerd/package.json").version'; sha256sum "$(readlink -f node_modules/@cloudflare/workerd-linux-64/bin/workerd)"; } > receipt/workerd.txt
sha256sum package-lock.json worker/workcell.js worker/candidates.json worker/machinery/tools/engine/gates.mjs worker/machinery/tools/factory_quality/index.mjs worker/wasm/*.wasm kernels/*.ts > receipt/module-sha256.txt
