import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
const dir = new URL(".", import.meta.url).pathname;
const raw = `${dir}receipt/raw`;
fs.mkdirSync(raw, { recursive: true });
const WD = `${dir}node_modules/.bin/workerd`, CORES = "0-27", BASE = 47200, WINDOW = 15000, REPS = 3, FLAG = "--max-old-space-size=128";
const cands = JSON.parse(fs.readFileSync(`${dir}worker/candidates.json`));
const expect = Object.fromEntries(cands.map((c) => [c.id, c.expect]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const memAvail = () => Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8"))[1]) * 1024;
const rssOf = (pid) => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]) * 1024; } catch { return null; } };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const stat = (a) => ({ n: a.length, median: q(a, 0.5), p95: q(a, 0.95), min: a.length ? Math.min(...a) : null, max: a.length ? Math.max(...a) : null });
const get = async (i, path, ms = 30000) => { try { const r = await fetch(`http://127.0.0.1:${BASE + i}${path}`, { signal: AbortSignal.timeout(ms) }); return { status: r.status, text: await r.text() }; } catch (e) { return { error: String(e.cause?.code ?? e.name) }; } };
async function start(N) {
  execSync(`${process.execPath} ${dir}gen-config.mjs ${N} ${BASE} ${dir}worker/config.run.capnp ${FLAG}`);
  const t0 = performance.now();
  const ch = spawn("taskset", ["-c", CORES, WD, "serve", "config.run.capnp"], { cwd: `${dir}worker`, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; ch.stdout.on("data", (d) => { log += d; }); ch.stderr.on("data", (d) => { log += d; });
  let exit = null; ch.on("exit", (c, s) => { exit = { code: c, signal: s, atMs: performance.now() - t0 }; });
  const ready = [];
  for (let i = 0; i < N; i++) { while ((await get(i, "/ping", 2000)).text !== "ok") { if (exit || performance.now() - t0 > 120000) return { ch, fail: true, log: () => log, exit: () => exit }; await sleep(20); } ready.push(performance.now() - t0); }
  return { ch, ready, log: () => log, exit: () => exit };
}
const stop = async (w) => { if (!w.exit()) { w.ch.kill("SIGTERM"); await sleep(500); } };
async function rep(N, r) {
  const out = `${raw}/N${N}-r${r}.json`;
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out));
  const w = await start(N);
  const idleRss = rssOf(w.ch.pid);
  let peak = idleRss, minAvail = memAvail();
  const iv = setInterval(() => { peak = Math.max(peak, rssOf(w.ch.pid) ?? 0); minAvail = Math.min(minAvail, memAvail()); }, 200);
  const lat = [], errors = [];
  const deadline = Date.now() + WINDOW, t = performance.now();
  await Promise.all(Array.from({ length: N }, async (_, i) => { let k = i; while (Date.now() < deadline) { const s = performance.now(); const res = await get(i, `/unit?i=${k++}`); if (res.error) { errors.push(res.error); break; } lat.push(performance.now() - s); } }));
  const runMs = performance.now() - t;
  let correct = 0, accepted = 0, incorrect = 0, badChain = 0;
  for (let i = 0; i < N; i++) {
    const d = await get(i, "/drain"); if (d.error) { errors.push(d.error); continue; }
    const { receipts, verdicts } = JSON.parse(d.text);
    let prev = "0".repeat(64);
    receipts.forEach((x, j) => { const h = crypto.createHash("sha256").update(`${x.seq}:${x.previous}:${x.body}`, "ascii").digest("hex"); const ok = x.seq === j && x.previous === prev && h === x.hash; if (!ok) badChain++; prev = x.hash; const [id, v] = verdicts[j]; if (ok && v === expect[id] && JSON.parse(x.body).verdict === v) { correct++; if (v === "accept") accepted++; } else incorrect++; });
  }
  clearInterval(iv);
  const s = { N, rep: r, alive: w.ready?.length ?? 0, ready: stat(w.ready ?? []), lat: stat(lat), runMs, correct, accepted, incorrect, badChain, errors: errors.length, correctPerS: correct / (runMs / 1000), acceptedPerS: accepted / (runMs / 1000), idleRss, peakRss: peak, rssPerIsolate: peak / N, minAvail, loadavg: os.loadavg(), exit: w.exit() };
  await stop(w);
  fs.writeFileSync(out, JSON.stringify(s));
  return s;
}
async function limit(kind, mib, N, r) {
  const out = `${raw}/limit-${kind}${mib}-N${N}-r${r}.json`;
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out));
  const w = await start(N);
  const before = rssOf(w.ch.pid);
  const pre = await Promise.all(Array.from({ length: N }, (_, i) => get(i, "/unit?i=0")));
  const t = performance.now();
  const res = await get(0, `/alloc?kind=${kind}&mib=${mib}`, 60000);
  const allocMs = performance.now() - t;
  await sleep(1000);
  const after = rssOf(w.ch.pid);
  const post = await Promise.all(Array.from({ length: N }, (_, i) => get(i, "/unit?i=0", 10000)));
  const s = { kind, mib, N, rep: r, flag: FLAG, rssBefore: before, rssAfter: after, allocMs, breacher: res, preOk: pre.filter((x) => x.text === "accept").length, postOk: post.filter((x) => x.text === "accept").length, postSurvivorsOk: post.slice(1).filter((x) => x.text === "accept").length, postErrors: post.map((x) => x.error ?? null), exit: w.exit(), log: w.log().slice(-1500) };
  await stop(w);
  fs.writeFileSync(out, JSON.stringify(s));
  return s;
}
const ramp = (process.env.RAMP ?? "1,10,20,50").split(",").map(Number);
const steps = [], limits = [];
for (const N of ramp) { const reps = []; for (let r = 1; r <= REPS; r++) { const s = await rep(N, r); reps.push(s); console.log(JSON.stringify({ N, r, alive: s.alive, correct: s.correct, incorrect: s.incorrect, acc: s.acceptedPerS.toFixed(1), p50: s.lat.median?.toFixed(1), p95: s.lat.p95?.toFixed(1), peakMiB: (s.peakRss / 2 ** 20).toFixed(0), errors: s.errors })); if (s.incorrect || s.badChain || s.errors || s.alive !== N) break; } steps.push({ N, reps }); }
for (const [kind, mib] of [["js", 200], ["wasm", 256]]) for (let r = 1; r <= REPS; r++) { const s = await limit(kind, mib, 10, r); limits.push(s); console.log(JSON.stringify({ kind, mib, r, breacher: s.breacher, exit: s.exit, postSurvivorsOk: s.postSurvivorsOk, rssBeforeMiB: (s.rssBefore / 2 ** 20).toFixed(0), rssAfterMiB: s.rssAfter && (s.rssAfter / 2 ** 20).toFixed(0) })); }
fs.writeFileSync(`${dir}receipt/summary.json`, JSON.stringify({ steps, limits }, null, 1));
