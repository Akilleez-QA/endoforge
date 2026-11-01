import { Worker } from "node:worker_threads";
import fs from "node:fs";
import crypto from "node:crypto";
const [N, windowMs, outFile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const man = JSON.parse(fs.readFileSync(new URL("./kernels/manifest.json", import.meta.url)));
const candidates = [];
for (const k of man) { const source = fs.readFileSync(new URL(`./kernels/${k.name}.ts`, import.meta.url), "utf8"); candidates.push({ id: `${k.name}-na`, name: k.name, source, noAssert: true, expect: k.expectTypeError ? "reject:compile" : "accept" }); }
for (const n of ["k00", "k01"]) { const k = candidates.find((c) => c.name === n); candidates.push({ ...k, id: `${n}-effect`, source: k.source + "\n@external(\"env\", \"clock\") declare function clock(): f64;\nexport function tick(): f64 { return clock(); }\n", expect: "reject:forbidden_effects" }); }
const expect = Object.fromEntries(candidates.map((c) => [c.id, c.expect]));
const hostRss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
process.stdout.write(JSON.stringify({ type: "host-ready", hostRss }) + "\n");
const t0 = performance.now();
const workers = [], readyMs = [], errors = [];
await Promise.all(Array.from({ length: N }, (_, id) => new Promise((res) => {
  let w;
  try { w = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { id } }); } catch (e) { errors.push(String(e)); return res(); }
  workers.push(w);
  w.once("error", (e) => { errors.push(String(e)); res(); });
  w.once("message", (m) => { readyMs.push({ selfMs: m.readyMs, wallMs: performance.now() - t0 }); res(); });
})));
const allReadyMs = performance.now() - t0;
process.stdout.write(JSON.stringify({ type: "all-ready", alive: readyMs.length, allReadyMs }) + "\n");
const deadline = Date.now() + windowMs;
const tRun = performance.now();
const results = await Promise.all(workers.map((w) => new Promise((res) => { w.once("message", res); w.once("error", (e) => { errors.push(String(e)); res(null); }); w.postMessage({ type: "run", deadline, candidates }); })));
const runMs = performance.now() - tRun;
let correct = 0, accepted = 0, incorrect = 0, badChain = 0;
const lat = [], wrong = {};
for (const r of results) {
  if (!r) continue;
  let prev = "0".repeat(64);
  const okSeq = new Set();
  r.receipts.forEach((x, i) => { const h = crypto.createHash("sha256").update(`${x.seq}:${x.previous}:${x.body}`, "ascii").digest("hex"); if (x.seq === i && x.previous === prev && h === x.hash) okSeq.add(i); else badChain++; prev = x.hash; });
  r.verdicts.forEach(([id, v], i) => { const body = JSON.parse(r.receipts[i].body); if (v === expect[id] && body.verdict === v && okSeq.has(i)) { correct++; if (v === "accept") accepted++; } else { incorrect++; wrong[`${id}:${v}`] = (wrong[`${id}:${v}`] ?? 0) + 1; } });
  lat.push(...r.lat);
}
await Promise.all(workers.map((w) => w.terminate()));
fs.writeFileSync(outFile, JSON.stringify({ N, windowMs, hostRss, alive: readyMs.length, spawnErrors: errors, allReadyMs, readyMs, runMs, correct, accepted, incorrect, badChain, wrong, lat }));
process.stdout.write(JSON.stringify({ type: "done", correct, incorrect }) + "\n");
