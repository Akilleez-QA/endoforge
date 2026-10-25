#!/usr/bin/env bash
# P-05 setup: copy pinned tsc-rs WASM artifacts from the lab cache (verified), locate the lab's
# workerd binary (reused by path, not reinstalled), hand-assemble a minimal kernel .wasm.
# No network. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$HOME/Work/isolate-factory-lab-cache/out-rust-1.95.0"
LAB="$HOME/Work/isolate-factory-lab"
WORKERD="$LAB/adapters/executors/workerd/node_modules/@cloudflare/workerd-linux-64/bin/workerd"
NATIVE_TSC="$LAB/adapters/checkers/tscrs-wasm/vendor/native/tsc"
mkdir -p "$HERE/.tools" "$HERE/receipt"

# 1. tsc-rs artifacts, verified against the cache's SHA256SUMS before copying.
(cd "$CACHE" && sha256sum -c SHA256SUMS >/dev/null)
for f in core.js ts_rust.size.wasm ts_rust.speed.wasm; do cp -f "$CACHE/$f" "$HERE/.tools/$f"; done
cp -f "$CACHE/SHA256SUMS" "$HERE/receipt/tscrs-artifacts.sha256"
(cd "$HERE/.tools" && sha256sum -c "$HERE/receipt/tscrs-artifacts.sha256" --ignore-missing)

# 2. workerd (lab's install; same binary the lab executor uses).
[ -x "$WORKERD" ] || { echo "workerd missing at $WORKERD" >&2; exit 1; }
{
  echo "path: $WORKERD"
  echo "version: $("$WORKERD" --version)"
  echo "sha256: $(sha256sum "$WORKERD" | cut -d' ' -f1)"
  echo "npm: workerd $(node -p "require('$LAB/adapters/executors/workerd/node_modules/workerd/package.json').version")"
} > "$HERE/receipt/workerd.txt"

# 3. native tsc-rs (byte-identical to the cache tsc; this copy has its lib files beside it).
[ -x "$NATIVE_TSC" ] || { echo "native tsc missing" >&2; exit 1; }
{
  echo "path: $NATIVE_TSC"
  echo "sha256: $(sha256sum "$NATIVE_TSC" | cut -d' ' -f1)"
  echo "cache-tsc-sha256: $(sha256sum "$CACHE/tsc" | cut -d' ' -f1)"
  echo "version: $("$NATIVE_TSC" --version 2>&1 | head -1)"
} > "$HERE/receipt/native-tsc.txt"

# 4. minimal kernel module: (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
node -e '
const b = Buffer.from([0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
  0x01,0x07,0x01,0x60,0x02,0x7f,0x7f,0x01,0x7f,      // type: (i32,i32)->i32
  0x03,0x02,0x01,0x00,                               // func: 1 of type 0
  0x07,0x07,0x01,0x03,0x61,0x64,0x64,0x00,0x00,      // export "add" func 0
  0x0a,0x09,0x01,0x07,0x00,0x20,0x00,0x20,0x01,0x6a,0x0b]); // code
new WebAssembly.Module(b); // validate
require("fs").writeFileSync(process.argv[1], b);' "$HERE/.tools/kernel.wasm"
sha256sum "$HERE/.tools/kernel.wasm" > "$HERE/receipt/kernel.sha256"

# 5. the worker bundle directory: shim + core.js + wasm modules side by side (workerd embeds by relative path).
cp -f "$HERE/.tools/core.js" "$HERE/worker/core.js"
cp -f "$HERE/.tools/ts_rust.size.wasm" "$HERE/worker/ts_rust.size.wasm"
cp -f "$HERE/.tools/kernel.wasm" "$HERE/worker/kernel.wasm"
echo "setup ok"
