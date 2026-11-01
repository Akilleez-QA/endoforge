import fs from "node:fs";
import crypto from "node:crypto";
const asc = await import(new URL("../P-15-workcell-concurrency/node_modules/assemblyscript/dist/asc.js", import.meta.url));
const dir = new URL(".", import.meta.url).pathname;
const man = JSON.parse(fs.readFileSync(`${dir}kernels/manifest.json`));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const cands = [];
for (const k of man) cands.push({ id: `${k.name}-na`, name: k.name, source: fs.readFileSync(`${dir}kernels/${k.name}.ts`, "utf8"), expect: k.expectTypeError ? "reject:compile" : "accept" });
for (const n of ["k00", "k01"]) { const k = cands.find((c) => c.name === n); cands.push({ ...k, id: `${n}-effect`, source: k.source + "\n@external(\"env\", \"clock\") declare function clock(): f64;\nexport function tick(): f64 { return clock(); }\n", expect: "reject:forbidden_effects" }); }
fs.mkdirSync(`${dir}worker/wasm`, { recursive: true });
const out = [];
for (const c of cands) {
  const files = {}, ov = { [`${c.name}.ts`]: c.source };
  const r = await asc.main([`${c.name}.ts`, "-O3", "--runtime", "stub", "--noColors", "--initialMemory", "1", "--noAssert", "--outFile", "out.wasm"], { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: (f) => Object.hasOwn(ov, f) ? ov[f] : null, writeFile: (f, d) => { files[f] = d; }, listFiles: () => [] });
  const w = r.error ? null : files["out.wasm"];
  if (w) fs.writeFileSync(`${dir}worker/wasm/${c.id}.wasm`, w);
  out.push({ id: c.id, expect: c.expect, sourceSha256: sha(c.source), wasm: w ? `${c.id}.wasm` : null, wasmSha256: w ? sha(w) : null });
}
fs.writeFileSync(`${dir}worker/candidates.json`, JSON.stringify(out, null, 1));
console.log(out.map((c) => `${c.id} ${c.wasm ? "built" : "compile-reject"}`).join("\n"));
