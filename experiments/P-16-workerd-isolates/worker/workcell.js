import { runUniversalGates } from "./machinery/tools/engine/gates.mjs";
import { createHash } from "node:crypto";
import cands from "./candidates.json";
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const encode = (r) => JSON.stringify(sortKeys(r)).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const eventHash = (seq, prev, body) => createHash("sha256").update(`${seq}:${prev}:${body}`, "ascii").digest("hex");
const signature = { version: 1, name: "convertUnit", inputs: [{ path: "value", type: "number", unit: "1", domain: [0, 1000] }], output: { type: "number", unit: "1" } };
const cases = [0, 1, 7.5, 250, 999].map((x, i) => ({ id: `c${i}`, inputs: { value: x } }));
const limits = { wallMs: 1000, memoryBytes: 1048576, fuel: 1000 };
const mods = {};
for (const c of cands) if (c.wasm) mods[c.id] = (await import(`./wasm/${c.wasm}`)).default;
function port(mod) {
  const imports = WebAssembly.Module.imports(mod);
  const exp = WebAssembly.Module.exports(mod).map((e) => e.name);
  return {
    describe: () => exp.includes("convertUnit") && exp.includes("step") ? structuredClone(signature) : { ...structuredClone(signature), name: "missing" },
    run: (cand, cs) => {
      const t = Date.now();
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
      return { status: "completed", outputs, usage: { wallMs: Date.now() - t, memoryBytes: e.memory.buffer.byteLength, fuel }, effects };
    },
    scanEffects: () => imports.map((i) => `${i.module}.${i.name}`),
  };
}
let seq = 0, prev = "0".repeat(64), receipts = [], verdicts = [], hold = [];
async function unit(c, wid) {
  let verdict, gates = [];
  if (!c.wasm) verdict = "reject:compile";
  else {
    const g = await runUniversalGates({ version: 1, candidate: c.id, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ["P-16 frozen synthetic contract"] }, cases, limits, allowedEffects: [] }, port(mods[c.id]));
    verdict = g.passed ? "accept" : `reject:${g.firstFailure}`;
    gates = g.results.map((r) => [r.check, r.passed]);
  }
  const body = encode({ candidate: c.id, sourceSha256: c.sourceSha256, wasmSha256: c.wasmSha256, verdict, gates, workcell: wid });
  const hash = eventHash(seq, prev, body);
  receipts.push({ seq, previous: prev, body, hash });
  seq++; prev = hash;
  verdicts.push([c.id, verdict]);
  return verdict;
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/ping") return new Response("ok");
    if (u.pathname === "/unit") return new Response(await unit(cands[Number(u.searchParams.get("i")) % cands.length], env.WID));
    if (u.pathname === "/drain") { const r = JSON.stringify({ receipts, verdicts }); receipts = []; verdicts = []; seq = 0; prev = "0".repeat(64); return new Response(r); }
    if (u.pathname === "/alloc") {
      const mib = Number(u.searchParams.get("mib"));
      if (u.searchParams.get("kind") === "wasm") { const m = new WebAssembly.Memory({ initial: 1 }); m.grow(mib * 16); new Uint8Array(m.buffer).fill(1); hold.push(m); }
      else { for (let i = 0; i < mib; i++) { const a = new Array(131072); for (let j = 0; j < a.length; j++) a[j] = j + 0.5; hold.push(a); } }
      return new Response(`allocated ${mib}`);
    }
    return new Response("not found", { status: 404 });
  },
};
