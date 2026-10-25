// P-05 runner. Idempotent; no network (127.0.0.1 only). Writes receipt/*.json.
// Usage: node run.mjs
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { PROJECTS } from "./gen-overlay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REC = join(HERE, "receipt");
const LAB = join(os.homedir(), "Work/isolate-factory-lab");
const WORKERD = join(LAB, "adapters/executors/workerd/node_modules/@cloudflare/workerd-linux-64/bin/workerd");
const NATIVE_TSC = join(LAB, "adapters/checkers/tscrs-wasm/vendor/native/tsc");
const PORT = 48517;
const N = 20, WARM = 3;
mkdirSync(REC, { recursive: true });

const sha = (p) => execFileSync("sha256sum", [p]).toString().split(" ")[0];
const now = () => performance.now();
const summary = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, median: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
};
function env(tag) {
  const cpu = os.cpus();
  const e = {
    tag, time: new Date().toISOString(), kernel: os.release(), cpuModel: cpu[0].model, cpuCount: cpu.length,
    loadavg: os.loadavg(), memTotalBytes: os.totalmem(), memFreeBytes: os.freemem(), node: process.version, v8: process.versions.v8,
    workerd: readFileSync(join(REC, "workerd.txt"), "utf8"), nativeTsc: readFileSync(join(REC, "native-tsc.txt"), "utf8"),
    gitCommit: spawnSync("git", ["-C", join(HERE, "../.."), "rev-parse", "HEAD"]).stdout.toString().trim(),
    labCommit: spawnSync("git", ["-C", LAB, "rev-parse", "HEAD"]).stdout.toString().trim(),
    moduleHashes: Object.fromEntries(["shim.js", "core.js", "ts_rust.size.wasm", "kernel.wasm", "config.capnp"].map((f) => [f, sha(join(HERE, "worker", f))])),
    precommitSha256: readFileSync(join(REC, "precommit.sha256"), "utf8").trim(),
  };
  writeFileSync(join(REC, `env-${tag}.json`), JSON.stringify(e, null, 2));
  return e;
}
function procMem(pid) {
  const st = readFileSync(`/proc/${pid}/status`, "utf8");
  const g = (k) => Number(st.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"))?.[1] ?? NaN) * 1024;
  return { vmRssBytes: g("VmRSS"), vmHwmBytes: g("VmHWM"), rssAnonBytes: g("RssAnon"), rssFileBytes: g("RssFile"), threads: Number(st.match(/^Threads:\s+(\d+)/m)[1]) };
}
const mib = (b) => +(b / 1048576).toFixed(1);

// ---------------- workerd ----------------
async function startWorkerd(tag) {
  const cfg = readFileSync(join(HERE, "worker/config.capnp"), "utf8").replace("PORT", String(PORT));
  const cfgPath = join(HERE, "worker", `config.${tag}.capnp`);
  writeFileSync(cfgPath, cfg);
  const child = spawn(WORKERD, ["serve", cfgPath, "--experimental"], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  const t0 = now();
  for (;;) {
    if (child.exitCode !== null) throw new Error("workerd exited: " + log);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/ping`); if (r.ok) break; } catch {}
    if (now() - t0 > 15000) { child.kill(); throw new Error("workerd did not answer: " + log); }
    await new Promise((r) => setTimeout(r, 20));
  }
  return { child, startMs: now() - t0, getLog: () => log, cfgPath };
}
async function stopWorkerd(w) {
  w.child.kill("SIGTERM");
  await new Promise((r) => { w.child.once("exit", r); setTimeout(() => { try { w.child.kill("SIGKILL"); } catch {} }, 3000); });
  try { rmSync(w.cfgPath); } catch {}
}
function checkBody(p) { return JSON.stringify({ files: p.files, cwd: p.root, args: ["-p", `${p.root}/tsconfig.json`, "--pretty", "false"] }); }
async function workerdCheck(body) {
  const t0 = now();
  const r = await fetch(`http://127.0.0.1:${PORT}/check`, { method: "POST", body, headers: { "content-type": "application/json" } });
  const j = await r.json();
  const wall = now() - t0;
  if (!j.ok) throw new Error("check failed: " + JSON.stringify(j).slice(0, 500));
  return { wallMs: wall, isolateMs: j.timing.totalMs, kernelMs: j.timing.kernelMs, diagnostics: j.diagnostics, exitCode: j.exitCode };
}
const diagKey = (ds) => ds.map((d) => `${d.file}:${d.line}:${d.code}`).sort();

async function runWorkerd(projects) {
  const out = { runtime: "workerd", memory: {}, cells: {}, diagnostics: {} };
  const w = await startWorkerd("run");
  out.startMs = w.startMs;
  out.memory.idle = procMem(w.child.pid);
  // first load: one 5-file check instantiates the module the first time
  const first = await workerdCheck(checkBody(projects.five));
  out.firstCheck = first;
  out.memory.afterFirstCheck = procMem(w.child.pid);
  for (const [name, p] of Object.entries(projects)) {
    const body = checkBody(p);
    for (let i = 0; i < WARM; i++) await workerdCheck(body);
    const samples = [];
    let diags;
    for (let i = 0; i < N; i++) { const r = await workerdCheck(body); samples.push(r); diags = r.diagnostics; }
    out.cells[name] = { samples, wall: summary(samples.map((s) => s.wallMs)), isolate: summary(samples.map((s) => s.isolateMs)), kernel: summary(samples.map((s) => s.kernelMs)) };
    out.diagnostics[name] = diagKey(diags);
    out.memory[`after_${name}`] = procMem(w.child.pid);
  }
  out.memory.afterAll = procMem(w.child.pid);
  await stopWorkerd(w);
  out.log = w.getLog().slice(0, 4000);
  return out;
}

async function limitProbe() {
  // Fresh process: does --max-old-space-size=128 (or anything) stop 256 MiB of WASM memory or 200 MiB of JS heap?
  const out = {};
  for (const probe of [{ kind: "wasm", mib: 256 }, { kind: "js", mib: 200 }]) {
    const w = await startWorkerd(`limit-${probe.kind}`);
    const before = procMem(w.child.pid);
    let resp, err;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/alloc`, { method: "POST", body: JSON.stringify(probe) });
      resp = { status: r.status, body: (await r.text()).slice(0, 500) };
    } catch (e) { err = String(e.message); }
    await new Promise((r) => setTimeout(r, 200));
    const alive = w.child.exitCode === null;
    const after = alive ? procMem(w.child.pid) : null;
    out[probe.kind] = { probe, before, response: resp, fetchError: err, processAliveAfter: alive, exitCode: w.child.exitCode, after, log: w.getLog().slice(0, 1500) };
    if (alive) await stopWorkerd(w); else { try { rmSync(w.cfgPath); } catch {} }
  }
  return out;
}

// ---------------- plain Node ----------------
async function runNode(projects) {
  const core = await import(pathToFileURL(join(HERE, "worker/core.js")).href);
  const bytes = readFileSync(join(HERE, "worker/ts_rust.size.wasm"));
  const tc = now();
  const module = new WebAssembly.Module(bytes);
  const compileMs = now() - tc;
  // indexedFileSystem: import the shim's copy would need the wasm import; reuse the lab's host.mjs directly (read-only).
  const { runOnce } = await import(pathToFileURL(join(LAB, "adapters/checkers/tscrs-wasm/host.mjs")).href);
  const out = { runtime: "node", compileMs, cells: {}, diagnostics: {}, memory: {} };
  const one = (p) => {
    const t0 = now();
    const r = runOnce(core, module, { files: p.files, cwd: p.root, args: ["-p", `${p.root}/tsconfig.json`, "--pretty", "false"], fsKind: "indexed" });
    if (!r.ok) throw new Error("node run failed: " + r.error + r.stderr);
    return { wallMs: now() - t0, diagnostics: r.diagnostics.map((d) => ({ file: d.fileName ?? null, line: d.startPosition ? d.startPosition.line + 1 : 0, code: d.code })) };
  };
  out.memory.beforeChecks = procMem(process.pid);
  for (const [name, p] of Object.entries(projects)) {
    for (let i = 0; i < WARM; i++) one(p);
    const samples = []; let diags;
    for (let i = 0; i < N; i++) { const r = one(p); samples.push(r.wallMs); diags = r.diagnostics; }
    out.cells[name] = { samples, wall: summary(samples) };
    out.diagnostics[name] = diagKey(diags);
    out.memory[`after_${name}`] = procMem(process.pid);
  }
  return out;
}

// ---------------- native ----------------
function runNative(projects, threads) {
  const base = mkdtempSync("/dev/shm/p05-native-");
  const out = { runtime: `native-${threads}`, tmpfs: base, cells: {}, diagnostics: {} };
  try {
    for (const [name, p] of Object.entries(projects)) {
      const dir = join(base, name);
      for (const [path, text] of Object.entries(p.files)) {
        const dest = join(dir, path.slice(p.root.length));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, text);
      }
      const args = ["-p", dir, "--pretty", "false"];
      if (threads === "single") args.push("--singleThreaded");
      const one = () => {
        const t0 = now();
        const r = spawnSync(NATIVE_TSC, args, { encoding: "utf8", maxBuffer: 1 << 26 });
        const wall = now() - t0;
        if (r.error) throw r.error;
        // tsc text: "path(line,col): error TS2322: ..."
        const diags = [...r.stdout.matchAll(/^(\S+?)\((\d+),\d+\): (error|warning) TS(\d+):/gm)].map((m) => ({ file: m[1].replace(/^.*?\/src\//, "/proj/src/"), line: +m[2], code: +m[4] }));
        return { wallMs: wall, diags, status: r.status };
      };
      for (let i = 0; i < WARM; i++) one();
      const samples = []; let diags;
      for (let i = 0; i < N; i++) { const r = one(); samples.push(r.wallMs); diags = r.diags; }
      out.cells[name] = { samples, wall: summary(samples) };
      out.diagnostics[name] = diagKey(diags);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
  return out;
}

// ---------------- main ----------------
const before = env("before");
const projects = { five: PROJECTS.five(), fifty: PROJECTS.fifty() };
const bundleFiles = ["shim.js", "core.js", "ts_rust.size.wasm", "kernel.wasm"];
const bundle = Object.fromEntries(bundleFiles.map((f) => { const b = readFileSync(join(HERE, "worker", f)); return [f, { bytes: b.length, gzipBytes: gzipSync(b, { level: 9 }).length }]; }));
bundle.total = { bytes: Object.values(bundle).reduce((a, x) => a + x.bytes, 0), gzipBytes: Object.values(bundle).reduce((a, x) => a + x.gzipBytes, 0) };
bundle.concatGzipBytes = gzipSync(Buffer.concat(bundleFiles.map((f) => readFileSync(join(HERE, "worker", f)))), { level: 9 }).length;
const speedWasm = join(HERE, ".tools/ts_rust.speed.wasm");
bundle.speedWasmForReference = { bytes: statSync(speedWasm).size, gzipBytes: gzipSync(readFileSync(speedWasm), { level: 9 }).length };
console.error("bundle", JSON.stringify(bundle.total), "concat gzip", bundle.concatGzipBytes);

const overlay = Object.fromEntries(Object.entries(projects).map(([k, p]) => { const t = Object.values(p.files); return [k, { files: t.length, bytes: t.reduce((a, s) => a + s.length, 0), jsonBodyBytes: checkBody(p).length }]; }));

console.error("workerd…"); const workerd = await runWorkerd(projects);
console.error("limit probe…"); const limits = await limitProbe();
console.error("node…"); const node = await runNode(projects);
console.error("native single…"); const nativeSingle = runNative(projects, "single");
console.error("native default…"); const nativeDefault = runNative(projects, "default");
const after = env("after");

const agree = {};
for (const k of Object.keys(projects)) {
  const a = JSON.stringify(workerd.diagnostics[k]), b = JSON.stringify(node.diagnostics[k]), c = JSON.stringify(nativeSingle.diagnostics[k]), d = JSON.stringify(nativeDefault.diagnostics[k]);
  agree[k] = { count: workerd.diagnostics[k].length, workerd_eq_node: a === b, workerd_eq_native: a === c, native_single_eq_default: c === d, keys: workerd.diagnostics[k] };
}
const ratio = (x, y) => +(x / y).toFixed(3);
const res = {
  label: "Recorded (probe)", precommitSha256: before.precommitSha256, n: N, warmups: WARM, port: PORT, bundle, overlay,
  memoryMiB: Object.fromEntries(Object.entries(workerd.memory).map(([k, m]) => [k, { vmRss: mib(m.vmRssBytes), vmHwm: mib(m.vmHwmBytes), rssAnon: mib(m.rssAnonBytes), rssFile: mib(m.rssFileBytes), threads: m.threads }])),
  workerdStartMs: workerd.startMs, workerdFirstCheck: workerd.firstCheck.wallMs,
  latencyMs: {
    workerd_wall: { five: workerd.cells.five.wall, fifty: workerd.cells.fifty.wall },
    workerd_isolate: { five: workerd.cells.five.isolate, fifty: workerd.cells.fifty.isolate },
    node_wall: { five: node.cells.five.wall, fifty: node.cells.fifty.wall },
    native_single_wall: { five: nativeSingle.cells.five.wall, fifty: nativeSingle.cells.fifty.wall },
    native_default_wall: { five: nativeDefault.cells.five.wall, fifty: nativeDefault.cells.fifty.wall },
  },
  ratios50: {
    workerd_over_native_single: ratio(workerd.cells.fifty.wall.median, nativeSingle.cells.fifty.wall.median),
    node_over_native_single: ratio(node.cells.fifty.wall.median, nativeSingle.cells.fifty.wall.median),
    workerd_over_node: ratio(workerd.cells.fifty.wall.median, node.cells.fifty.wall.median),
    workerd_over_native_default: ratio(workerd.cells.fifty.wall.median, nativeDefault.cells.fifty.wall.median),
  },
  ratios5: {
    workerd_over_native_single: ratio(workerd.cells.five.wall.median, nativeSingle.cells.five.wall.median),
    node_over_native_single: ratio(node.cells.five.wall.median, nativeSingle.cells.five.wall.median),
  },
  diagnosticsAgreement: agree,
  limitEnforcement: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, { ...v, before: v.before && mib(v.before.vmRssBytes), after: v.after && { vmRss: mib(v.after.vmRssBytes), vmHwm: mib(v.after.vmHwmBytes) } }])),
  nodeMemoryMiB: Object.fromEntries(Object.entries(node.memory).map(([k, m]) => [k, mib(m.vmRssBytes)])),
  loadavg: { before: before.loadavg, after: after.loadavg },
  badSigns: {
    rssOver128MiB: workerd.memory.afterAll.vmRssBytes > 128 * 1048576,
    hwmOver128MiB: workerd.memory.afterAll.vmHwmBytes > 128 * 1048576,
    wasmWorkerdOver3xNative: workerd.cells.fifty.wall.median > 3 * nativeSingle.cells.fifty.wall.median,
    bundleGzipOver10MB: bundle.concatGzipBytes > 10 * 1000 * 1000,
  },
};
writeFileSync(join(REC, "summary.json"), JSON.stringify(res, null, 2));
writeFileSync(join(REC, "raw-samples.json"), JSON.stringify({ workerd: workerd.cells, node: node.cells, nativeSingle: nativeSingle.cells, nativeDefault: nativeDefault.cells, workerdMemory: workerd.memory, nodeMemory: node.memory, workerdLog: workerd.log, limits }, null, 2));
console.log(JSON.stringify({ memoryMiB: res.memoryMiB, latency50: Object.fromEntries(Object.entries(res.latencyMs).map(([k, v]) => [k, v.fifty.median])), latency5: Object.fromEntries(Object.entries(res.latencyMs).map(([k, v]) => [k, v.five.median])), ratios50: res.ratios50, bundleGzip: bundle.concatGzipBytes, agree: Object.fromEntries(Object.entries(agree).map(([k, v]) => [k, [v.count, v.workerd_eq_node, v.workerd_eq_native]])), limits: Object.fromEntries(Object.entries(res.limitEnforcement).map(([k, v]) => [k, [v.response?.status, v.processAliveAfter, v.after]])), badSigns: res.badSigns }, null, 2));
