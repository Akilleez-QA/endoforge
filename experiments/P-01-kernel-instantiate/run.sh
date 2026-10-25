#!/usr/bin/env bash
# P-01 measurement runner. Idempotent, no network. Requires setup.sh and build.sh to have run,
# and the Rust host to be built (cargo build --release --manifest-path rust-host/Cargo.toml).
set -euo pipefail
cd "$(dirname "$0")"
HOST=rust-host/target/release/p01-wasmtime-host
WT=.tools/wasmtime

# Move any earlier run's receipts aside instead of overwriting (PRECOMMIT stop rule).
if [ -f receipt/summary.json ]; then
  d="receipt/aborted-$(date +%Y%m%dT%H%M%S)"; mkdir -p "$d"
  mv receipt/*.jsonl receipt/*-bench-*.json receipt/cli-cold.json receipt/summary.json receipt/env-*.json "$d"/ 2>/dev/null || true
fi

./env.sh receipt/env-before.json

echo "== V8 instantiate + call"
for v in kernel-stub-1p kernel-stub-16p; do node node-bench.mjs "$v" 2000; done

echo "== V8 resident"
rm -f receipt/v8-resident.jsonl
for v in kernel-stub-1p kernel-stub-16p; do
  for K in 100 1000 5000; do
    for r in 0 1 2; do node --expose-gc node-resident.mjs "$v" "$K" "$r"; done
  done
done

echo "== Wasmtime CLI cold start"
node cli-cold.mjs 200

if [ -x "$HOST" ]; then
  echo "== Wasmtime crate: instantiate"
  for v in kernel-stub-1p kernel-stub-16p; do
    "$HOST" "build/$v.wasm" instantiate 2000 > "receipt/wasmtime-instantiate-$v.jsonl" 2> "receipt/wasmtime-instantiate-$v.meta.json"
    "$HOST" "build/$v.wasm" instantiate 2000 0 --pooling > "receipt/wasmtime-pooling-instantiate-$v.jsonl" 2> "receipt/wasmtime-pooling-instantiate-$v.meta.json"
  done
  echo "== Wasmtime crate: resident"
  rm -f receipt/wasmtime-resident.jsonl
  for v in kernel-stub-1p kernel-stub-16p; do
    for K in 100 1000 5000; do
      for r in 0 1 2; do
        "$HOST" "build/$v.wasm" resident "$K" "$r" | sed "s/^{/{\"variant\":\"$v\",/" | tee -a receipt/wasmtime-resident.jsonl
        "$HOST" "build/$v.wasm" resident "$K" "$r" --pooling | sed "s/^{/{\"variant\":\"$v\",/" | tee -a receipt/wasmtime-resident.jsonl
      done
    done
  done
  echo "== Wasmtime crate: call"
  "$HOST" build/kernel-stub-1p.wasm call 10000 > receipt/wasmtime-call-kernel-stub-1p.jsonl 2> receipt/wasmtime-call-kernel-stub-1p.meta.json
else
  echo "Rust host not built; recording fallback" | tee receipt/rust-host-missing.txt
fi

./env.sh receipt/env-after.json
node summarize.mjs
