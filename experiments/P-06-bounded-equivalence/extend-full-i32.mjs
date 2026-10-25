// Post-precommit extension (labelled as such in RESULT.md): the two saturating combinations
// (bar -> kPa, basis 0 and 1) over the FULL i32 value range, AS vs Rust, pairwise. Not part of the precommitted procedure.
import { readFileSync, writeFileSync } from "node:fs";
const load = (n) => new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL(`./build/${n}`, import.meta.url))), {}).exports.convert;
const as = load("convert.as.wasm"), rs = load("convert.rs.wasm");
const out = { label: "Recorded (probe) — extension beyond PRECOMMIT.md", combos: [], loadavgBefore: readFileSync("/proc/loadavg", "utf8").trim() };
for (const [f, t, b] of [[2, 0, 0], [2, 0, 1]]) {
  const t0 = performance.now(); let n = 0, first = null;
  for (let v = -2147483648; v <= 2147483647; v++) { const x = as(v, f, t, b), y = rs(v, f, t, b); if (x !== y) { n++; if (!first) first = { value: v, as: x, rs: y }; } }
  const ms = performance.now() - t0;
  out.combos.push({ from: f, to: t, basis: b, inputs: 2 ** 32, disagreements: n, first, wallMs: Math.round(ms), callsPerSecondBoth: Math.round((2 * 2 ** 32) / (ms / 1000)) });
  console.error(JSON.stringify(out.combos.at(-1)));
}
out.loadavgAfter = readFileSync("/proc/loadavg", "utf8").trim();
writeFileSync(new URL("./receipt/extension-full-i32.json", import.meta.url), JSON.stringify(out, null, 2));
