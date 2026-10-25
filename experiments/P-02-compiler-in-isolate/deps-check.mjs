// Dependency-surface check for the AssemblyScript compiler in a fresh process (main thread).
// Records which Node built-ins loading `assemblyscript/asc` pulls in, whether --noEmit works
// over in-memory callbacks, and the compiler bundle sizes.
import fs from "node:fs";
import { execSync } from "node:child_process";

const dir = new URL("./", import.meta.url);
const before = new Set(process.moduleLoadList);
const t0 = process.hrtime.bigint();
const asc = await import("assemblyscript/asc");
const loadNs = Number(process.hrtime.bigint() - t0);
const newly = process.moduleLoadList.filter((m) => !before.has(m));

// Does asc touch fs/path/process at load? Inspect the bundle text for the conditional import.
const ascSrc = fs.readFileSync(new URL("node_modules/assemblyscript/dist/asc.js", dir), "utf8");
const conditionalImport = /await import\("fs"\)/.test(ascSrc) && /\[object process\]/.test(ascSrc);

// noEmit check over in-memory map.
const src = fs.readFileSync(new URL("kernels/k00.ts", dir), "utf8");
const diags = [];
const r = await asc.main(["k00.ts", "-O3", "--runtime", "stub", "--noEmit"], {
  readFile: (f) => (f === "k00.ts" ? src : null), writeFile: () => { throw new Error("writeFile called under --noEmit"); }, listFiles: () => [],
  reportDiagnostic: (d) => diags.push(d.message),
});
const bundle = fs.readFileSync(new URL("receipt/compiler-bundle-sizes.txt", dir), "utf8").trim().split("\n").map((l) => { const [s, p] = l.split(" "); return { path: p, bytes: Number(s) }; });
const total = bundle.reduce((a, b) => a + b.bytes, 0);
const out = {
  ascVersion: asc.version, loadNs,
  newlyLoadedBuiltins: newly.filter((m) => m.startsWith("NativeModule")).map((m) => m.replace("NativeModule ", "")),
  newlyLoadedInternalBindings: newly.filter((m) => m.startsWith("Internal Binding")).map((m) => m.replace("Internal Binding ", "")),
  ascUsesConditionalNodeImports: conditionalImport,
  noEmitOk: !r.error, noEmitDiagnostics: diags, noEmitReadCount: r.stats.readCount, noEmitWriteCount: r.stats.writeCount,
  bundle, bundleTotalBytes: total,
  nodeModulesDiskBytes: Number(execSync("du -sb node_modules | cut -f1", { cwd: dir.pathname, encoding: "utf8" }).trim()),
};
fs.writeFileSync(new URL("receipt/deps-check.json", dir), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
