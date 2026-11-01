import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
const dir = new URL(".", import.meta.url).pathname;
const raw = `${dir}receipt/${process.env.ARM ? "raw-" + process.env.ARM : "raw"}`;
fs.mkdirSync(raw, { recursive: true });
const WINDOW = Number(process.env.WINDOW ?? 15000), REPS = 3, CORES = "0-27";
const ramp = process.env.RAMP ? process.env.RAMP.split(",").map(Number) : [1, 10, 50, 100, 250, 500, 1000, 2000, 4000, 8000];
const mem = () => { const t = fs.readFileSync("/proc/meminfo", "utf8"); const g = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(t)[1]) * 1024; return { total: g("MemTotal"), avail: g("MemAvailable") }; };
const codexCount = () => { try { return Number(execSync("pgrep -fc codex").toString().trim()); } catch { return 0; } };
const env = () => ({ at: new Date().toISOString(), kernel: os.release(), cpu: os.cpus()[0].model, cpus: os.cpus().length, loadavg: os.loadavg(), mem: mem(), node: process.version, codexProcs: codexCount(), lscpu: execSync("lscpu").toString(), free: execSync("free -b").toString() });
if (!process.env.ARM && !fs.existsSync(`${dir}receipt/env-before.json`)) fs.writeFileSync(`${dir}receipt/env-before.json`, JSON.stringify(env(), null, 1));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const stat = (a) => ({ n: a.length, median: q(a, 0.5), p95: q(a, 0.95), min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null });
function rep(N, r) {
  const out = `${raw}/N${N}-r${r}.json`, samp = `${raw}/N${N}-r${r}.mem.jsonl`;
  if (fs.existsSync(out)) return Promise.resolve(JSON.parse(fs.readFileSync(out)));
  return new Promise((res) => {
    const before = { loadavg: os.loadavg(), codexProcs: codexCount() };
    const ch = spawn("taskset", ["-c", CORES, process.execPath, `${dir}host.mjs`, String(N), String(WINDOW), `${out}.tmp`], { stdio: ["ignore", "pipe", "pipe"] });
    let killed = null, peak = 0, minAvail = Infinity, phase = "spawn", stderr = "";
    const ss = fs.createWriteStream(samp);
    ch.stdout.on("data", (d) => { for (const l of d.toString().split("\n").filter(Boolean)) { try { const m = JSON.parse(l); if (m.type === "all-ready") phase = "run"; } catch {} } });
    ch.stderr.on("data", (d) => { stderr += d; });
    const iv = setInterval(() => {
      let rss = 0; try { rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${ch.pid}/status`, "utf8"))[1]) * 1024; } catch {}
      const m = mem(); peak = Math.max(peak, rss); minAvail = Math.min(minAvail, m.avail);
      ss.write(JSON.stringify({ t: Date.now(), phase, rss, avail: m.avail }) + "\n");
      if (m.avail < 0.2 * m.total && !killed) { killed = "MemAvailable<20%"; ch.kill("SIGKILL"); }
    }, 200);
    ch.on("exit", (code) => {
      clearInterval(iv); ss.end();
      const after = { loadavg: os.loadavg(), codexProcs: codexCount() };
      let d = null; try { d = JSON.parse(fs.readFileSync(`${out}.tmp`)); fs.unlinkSync(`${out}.tmp`); } catch {}
      const s = { N, rep: r, code, killed, stderr: stderr.slice(0, 2000), before, after, peakRss: peak, minAvail, memTotal: mem().total };
      if (d) Object.assign(s, { alive: d.alive, spawnErrors: d.spawnErrors.length, allReadyMs: d.allReadyMs, ready: stat(d.readyMs.map((x) => x.wallMs)), readySelf: stat(d.readyMs.map((x) => x.selfMs)), lat: stat(d.lat), runMs: d.runMs, correct: d.correct, accepted: d.accepted, incorrect: d.incorrect, badChain: d.badChain, wrong: d.wrong, hostRss: d.hostRss, perIsolateRss: (peak - d.hostRss) / N, correctPerS: d.correct / (d.runMs / 1000), acceptedPerS: d.accepted / (d.runMs / 1000) });
      fs.writeFileSync(out, JSON.stringify(s));
      if (d) fs.writeFileSync(`${raw}/N${N}-r${r}.lat.json`, JSON.stringify(d.lat));
      res(s);
    });
  });
}
const steps = [];
let base = null, perIso = null, stop = null;
for (const N of ramp) {
  const m = mem();
  if (perIso && m.avail - perIso * N * 1.15 < 0.2 * m.total) { stop = { N, reason: `projected OOM risk: ${N} x ${(perIso / 2 ** 20).toFixed(1)} MiB x1.15 leaves MemAvailable < 20% (avail ${(m.avail / 2 ** 30).toFixed(1)} GiB)` }; break; }
  const reps = [];
  for (let r = 1; r <= REPS; r++) { const s = await rep(N, r); reps.push(s); console.log(JSON.stringify({ N, r, killed: s.killed, alive: s.alive, correct: s.correct, incorrect: s.incorrect, latMed: s.lat?.median, latP95: s.lat?.p95, perIsoMiB: s.perIsolateRss / 2 ** 20, peakGiB: s.peakRss / 2 ** 30, minAvailGiB: s.minAvail / 2 ** 30 })); if (s.killed || !s.alive) break; }
  steps.push({ N, reps });
  if (N === 1) base = Math.max(...reps.map((s) => s.lat?.p95 ?? 0));
  perIso = Math.max(...reps.map((s) => s.perIsolateRss || 0));
  const bad = reps.find((s) => s.killed || s.code !== 0 || s.spawnErrors || s.alive !== N || s.incorrect || s.badChain || (!process.env.ARM && base && s.lat.p95 > 10 * base));
  if (bad) { stop = { N, reason: bad.killed ?? (bad.code !== 0 ? `exit ${bad.code}` : bad.spawnErrors ? "spawn failure" : bad.alive !== N ? "not all alive" : bad.incorrect || bad.badChain ? "incorrect completions" : `p95 ${bad.lat.p95.toFixed(1)} ms > 10x baseline ${base.toFixed(1)} ms`) }; break; }
}
fs.writeFileSync(`${dir}receipt/env-after.json`, JSON.stringify(env(), null, 1));
fs.writeFileSync(`${dir}receipt/summary${process.env.ARM ? "-" + process.env.ARM : ""}.json`, JSON.stringify({ baseP95: base, stop, steps }, null, 1));
console.log(JSON.stringify({ stop }));
