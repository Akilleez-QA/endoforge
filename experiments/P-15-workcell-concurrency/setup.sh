#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/share/mise/installs/node/26.12.0/bin:$PATH"
[ -f package.json ] || echo '{"private":true,"dependencies":{"assemblyscript":"0.28.20"}}' > package.json
[ -d node_modules/assemblyscript ] || npm install --no-audit --no-fund --save-exact assemblyscript@0.28.20
node -e 'console.log(JSON.stringify({assemblyscript:require("./node_modules/assemblyscript/package.json").version,binaryen:require("./node_modules/binaryen/package.json").version}))' > receipt/deps.json
sha256sum package-lock.json node_modules/assemblyscript/dist/asc.js node_modules/binaryen/index.js machinery/tools/engine/gates.mjs machinery/tools/factory_quality/index.mjs kernels/*.ts > receipt/module-sha256.txt
git -C ../endoforge rev-parse HEAD > receipt/endoforge-commit.txt
