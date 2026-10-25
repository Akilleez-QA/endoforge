#!/usr/bin/env bash
# P-06 setup: build the AssemblyScript and Rust kernels to WASM, derive the seeded-fault copy, record toolchains.
# Network only in the (already-run) dependency step: `npm install` (assemblyscript 0.28.9) and
# `rustup target add wasm32-unknown-unknown`. Everything else is offline and idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
mkdir -p build receipt
[ -x node_modules/.bin/asc ] || npm install --no-audit --no-fund
rustup target list --installed | grep -q '^wasm32-unknown-unknown$' || rustup target add wasm32-unknown-unknown

# AssemblyScript
node_modules/.bin/asc as/convert.ts -O3 --noAssert --runtime stub \
  -o build/convert.as.wasm -t build/convert.as.wat

# Rust
export CARGO_TARGET_DIR="$HERE/rust/target"
(cd rust && cargo build --release --target wasm32-unknown-unknown --quiet)
cp -f rust/target/wasm32-unknown-unknown/release/p06_convert.wasm build/convert.rs.wasm

# Seeded fault: a copy of the Rust kernel with round-half-even replaced by truncation toward zero.
mkdir -p rust-faulty/src
sed 's/name = "p06-convert"/name = "p06-convert-faulty"/' rust/Cargo.toml > rust-faulty/Cargo.toml
# Replace the euclidean floor + half-even block with plain truncating division.
python3 - "$HERE/rust/src/lib.rs" "$HERE/rust-faulty/src/lib.rs" <<'EOF'
import re, sys
src = open(sys.argv[1]).read()
start = src.index("    let mut q = num.div_euclid(den);")
end = src.index("    q.clamp(")
faulty = src[:start] + "    let q = num / den; // SEEDED FAULT: truncation toward zero instead of round-half-even\n" + src[end:]
faulty = faulty.replace("use core::cmp::Ordering;\n", "")
open(sys.argv[2], "w").write(faulty)
EOF
(cd rust-faulty && cargo build --release --target wasm32-unknown-unknown --quiet)
cp -f rust/target/wasm32-unknown-unknown/release/p06_convert_faulty.wasm build/convert.rs-faulty.wasm
diff -u rust/src/lib.rs rust-faulty/src/lib.rs > receipt/seeded-fault.diff || true

# Record toolchains and module hashes
{
  echo "assemblyscript: $(node -p "require('./node_modules/assemblyscript/package.json').version")"
  echo "asc flags: -O3 --noAssert --runtime stub"
  echo "rustc: $(rustc --version)"
  echo "cargo: $(cargo --version)"
  echo "rust target: wasm32-unknown-unknown ($(rustup target list --installed | grep wasm32-unknown-unknown))"
  echo "rust profile: release, opt-level 3, lto, codegen-units 1, panic abort, strip"
  echo "node: $(node --version)"
} > receipt/toolchain.txt
sha256sum build/*.wasm as/convert.ts rust/src/lib.rs rust-faulty/src/lib.rs > receipt/modules.sha256
ls -l build/*.wasm
echo "setup ok"
