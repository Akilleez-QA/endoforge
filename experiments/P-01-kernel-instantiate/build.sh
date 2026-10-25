#!/usr/bin/env bash
# Compile the P-01 kernel variants. Deterministic; part of setup, not measurement.
set -euo pipefail
cd "$(dirname "$0")"
ASC=node_modules/.bin/asc
mkdir -p build
# Variant A: stub runtime, 1 page (64 KiB) initial memory, no assertions (zero imports).
$ASC kernel/kernel.ts -O3 --runtime stub --noAssert --initialMemory 1  -o build/kernel-stub-1p.wasm
# Variant B: stub runtime, 16 pages (1 MiB) initial memory.
$ASC kernel/kernel.ts -O3 --runtime stub --noAssert --initialMemory 16 -o build/kernel-stub-16p.wasm
# Variant C: default (incremental GC) runtime, 1 page, for the size comparison.
$ASC kernel/kernel.ts -O3 --noAssert --initialMemory 1 -o build/kernel-default-1p.wasm
# Variant D: stub runtime with assertions kept, 1 page: shows the single `env.abort` import.
$ASC kernel/kernel.ts -O3 --runtime stub --initialMemory 1 -o build/kernel-stub-1p-assert.wasm
ls -l build/*.wasm
sha256sum build/*.wasm > receipt/wasm-sha256.txt
node -e '
const fs=require("fs");
const out={};
for (const f of fs.readdirSync("build").filter(f=>f.endsWith(".wasm"))) {
  const buf=fs.readFileSync("build/"+f);
  const m=new WebAssembly.Module(buf);
  const inst=new WebAssembly.Instance(m,{env:{abort(){throw new Error("abort")}}});
  out[f]={bytes:buf.length,imports:WebAssembly.Module.imports(m),exportCount:WebAssembly.Module.exports(m).length,initialPages:inst.exports.memory.buffer.byteLength/65536};
}
fs.writeFileSync("receipt/wasm-modules.json", JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,1));'
