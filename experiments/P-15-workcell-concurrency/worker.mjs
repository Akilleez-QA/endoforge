import { parentPort, workerData } from "node:worker_threads";
import crypto from "node:crypto";
import v8 from "node:v8";
const t0 = performance.now();
const asc = await import("assemblyscript/asc");
const { runUniversalGates } = await import("./machinery/tools/engine/gates.mjs");
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const encode = (r) => JSON.stringify(sortKeys(r)).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const eventHash = (seq, prev, body) => crypto.createHash("sha256").update(`${seq}:${prev}:${body}`, "ascii").digest("hex");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const signature = { version: 1, name: "convertUnit", inputs: [{ path: "value", type: "number", unit: "1", domain: [0, 1000] }], output: { type: "number", unit: "1" } };
const cases = [0, 1, 7.5, 250, 999].map((x, i) => ({ id: `c${i}`, inputs: { value: x } }));
const limits = { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 };
const ready = performance.now() - t0;
parentPort.postMessage({ type: "ready", readyMs: ready, heap: v8.getHeapStatistics().used_heap_size });
async function compile(c) {
  const overlay = { [`${c.name}.ts`]: c.source };
  const out = {};
  const args = [`${c.name}.ts`, "-O3", "--runtime", "stub", "--noColors", "--initialMemory", "1", "--outFile", "out.wasm"];
  if (c.noAssert) args.push("--noAssert");
  const r = await asc.main(args, { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: (f) => Object.hasOwn(overlay, f) ? overlay[f] : null, writeFile: (f, d) => { out[f] = d; }, listFiles: () => [] });
  return r.error ? null : out["out.wasm"];
}
function port(mod) {
  const imports = WebAssembly.Module.imports(mod);
  const exp = WebAssembly.Module.exports(mod).map((e) => e.name);
  return {
    describe: () => exp.includes("convertUnit") && exp.includes("step") ? structuredClone(signature) : { ...structuredClone(signature), name: "missing" },
    run: (cand, cs, lim) => {
      const t = performance.now();
      const effects = [];
      const inst = new WebAssembly.Instance(mod, { env: { abort() { effects.push("env.abort"); }, clock() { return 0; } } });
      const e = inst.exports;
      const sp = 0, ep = e.stateSize();
      e.initState(sp);
      const dv = new DataView(e.memory.buffer);
      let fuel = 0;
      const outputs = cs.map((k) => {
        for (let i = 0; i < 20; i++) { dv.setUint32(ep, i % 4, true); dv.setUint32(ep + 4, 0, true); dv.setUint32(ep + 8, 1, true); dv.setUint32(ep + 12, 0, true); dv.setFloat64(ep + 16, k.inputs.value + i, true); dv.setFloat64(ep + 24, 1, true); e.step(sp, ep); fuel++; }
        const v = e.convertUnit(k.inputs.value, 0, 1) + e.readChecksum(sp);
        return { caseId: k.id, value: Number.isFinite(v) && !Object.is(v, -0) ? v : 0 };
      });
      return { status: "completed", outputs, usage: { wallMs: performance.now() - t, memoryBytes: e.memory.buffer.byteLength, fuel }, effects };
    },
    scanEffects: () => imports.map((i) => `${i.module}.${i.name}`),
  };
}
let seq = 0, prev = "0".repeat(64);
const receipts = [], lat = [];
async function unit(c) {
  const t = performance.now();
  const wasm = await compile(c);
  let verdict, gates = [];
  if (!wasm) verdict = "reject:compile";
  else {
    const mod = await WebAssembly.compile(wasm);
    const g = await runUniversalGates({ version: 1, candidate: c.id, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ["P-15 frozen synthetic contract"] }, cases, limits, allowedEffects: [] }, port(mod));
    verdict = g.passed ? "accept" : `reject:${g.firstFailure}`;
    gates = g.results.map((r) => [r.check, r.passed]);
  }
  const body = encode({ candidate: c.id, sourceSha256: sha(c.source), wasmSha256: wasm ? sha(wasm) : null, verdict, gates, workcell: workerData.id });
  const hash = eventHash(seq, prev, body);
  receipts.push({ seq, previous: prev, body, hash });
  seq++; prev = hash;
  lat.push(performance.now() - t);
  return verdict;
}
parentPort.on("message", async (m) => {
  if (m.type === "run") {
    const verdicts = [];
    let i = workerData.id % m.candidates.length;
    while (Date.now() < m.deadline) { const c = m.candidates[i++ % m.candidates.length]; verdicts.push([c.id, await unit(c)]); }
    parentPort.postMessage({ type: "done", verdicts, receipts, lat, heap: v8.getHeapStatistics().used_heap_size });
  }
});
