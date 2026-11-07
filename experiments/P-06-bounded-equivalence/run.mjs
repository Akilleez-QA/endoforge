// P-06 runner: bounded exhaustive equivalence check of two WASM kernels, plus BigInt oracle and seeded fault.
// Usage: node run.mjs <runTag>    (writes receipt/<runTag>.json and receipt/env-<runTag>-{before,after}.json)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REC = join(HERE, "receipt");
const TAG = process.argv[2] ?? "run";
mkdirSync(REC, { recursive: true });
const sha = (p) => execFileSync("sha256sum", [p]).toString().split(" ")[0];
const LO = -(2 ** 20), HI = 2 ** 20; // value range
const COMBOS = [];
for (let f = 0; f < 4; f++) for (let t = 0; t < 4; t++) for (let b = 0; b < 2; b++) COMBOS.push([f, t, b]);
const DOMAIN = COMBOS.length * (HI - LO);

function env(tag) {
  const e = {
    tag, time: new Date().toISOString(), kernel: os.release(), cpuModel: os.cpus()[0].model, cpuCount: os.cpus().length, loadavg: os.loadavg(),
    memTotalBytes: os.totalmem(), memFreeBytes: os.freemem(), node: process.version, v8: process.versions.v8,
    toolchain: readFileSync(join(REC, "toolchain.txt"), "utf8"), modules: readFileSync(join(REC, "modules.sha256"), "utf8"),
    gitCommit: spawnSync("git", ["-C", join(HERE, "../.."), "rev-parse", "HEAD"]).stdout.toString().trim(),
    precommitSha256: readFileSync(join(REC, "precommit.sha256"), "utf8").trim(), contractSha256: readFileSync(join(REC, "contract.sha256"), "utf8").trim(),
  };
  writeFileSync(join(REC, `env-${TAG}-${tag}.json`), JSON.stringify(e, null, 2));
  return e;
}
function load(name) {
  const p = join(HERE, "build", name);
  const bytes = readFileSync(p);
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  if (typeof inst.exports.convert !== "function") throw new Error(`${name}: no convert export`);
  return { name, bytes: bytes.length, sha256: sha(p), convert: inst.exports.convert };
}

// ---- BigInt oracle, written from CONTRACT.md ----
const K = [1_000_000n, 6_894_757n, 100_000_000n, 3_386_389n];
const I32_MIN = -2147483648n, I32_MAX = 2147483647n;
function oracle(value, from, to, basis) {
  if (from < 0 || from > 3 || to < 0 || to > 3 || basis < 0 || basis > 1) return Number(I32_MIN);
  let num = BigInt(value) * K[from] + (basis === 1 ? 101_325n * K[0] : 0n);
  const den = K[to];
  let f = num / den; let r = num % den; // BigInt division truncates toward zero
  if (r < 0n) { r += den; f -= 1n; }
  let q = f;
  if (2n * r > den || (2n * r === den && (f & 1n) !== 0n)) q = f + 1n;
  if (q > I32_MAX) q = I32_MAX; if (q < I32_MIN + 1n) q = I32_MIN + 1n;
  return Number(q);
}

// ---- exhaustive pairwise check over the bounded domain ----
function pairwise(A, B) {
  const t0 = performance.now();
  let disagreements = 0;
  const perCombo = [];
  for (const [f, t, b] of COMBOS) {
    const a = A.convert, c = B.convert;
    let n = 0; const first = [];
    for (let v = LO; v < HI; v++) {
      const x = a(v, f, t, b), y = c(v, f, t, b);
      if (x !== y) { n++; if (first.length < 20) first.push({ value: v, [A.name]: x, [B.name]: y, oracle: oracle(v, f, t, b) }); }
    }
    disagreements += n;
    perCombo.push({ from: f, to: t, basis: b, disagreements: n, first });
  }
  const wallMs = performance.now() - t0;
  return { pair: [A.name, B.name], inputs: DOMAIN, disagreements, wallMs, callsPerSecondBothModules: Math.round((2 * DOMAIN) / (wallMs / 1000)), perCombo };
}
// ---- single-module throughput over the same domain (result folded into a checksum so the call is not elided) ----
function throughput(M, passes = 3) {
  const times = [];
  let acc = 0;
  for (let p = 0; p < passes; p++) {
    const t0 = performance.now();
    const fn = M.convert;
    for (const [f, t, b] of COMBOS) for (let v = LO; v < HI; v++) acc = (acc + fn(v, f, t, b)) | 0;
    times.push(performance.now() - t0);
  }
  const s = [...times].sort((a, b) => a - b);
  return { module: M.name, passes, wallMsEach: times, medianWallMs: s[Math.floor(s.length / 2)], callsPerSecond: Math.round(DOMAIN / (s[Math.floor(s.length / 2)] / 1000)), checksum: acc };
}
// ---- oracle sample: edges and pseudo-random values, all combos; counts wrong answers per module ----
function oracleSample(mods) {
  let seed = 20261017;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const values = new Set([0, 1, -1, 50, -50, 150, -150, 500, 1000, LO, LO - 1, HI, HI - 1, 2147483647, -2147483648, 2147483646, -2147483647, 21474836, -21474836, 21474837, -21474837]);
  while (values.size < 200_000 + 21) values.add(Math.floor(rnd() * 2 ** 32) | 0);
  const out = Object.fromEntries(mods.map((m) => [m.name, { checked: 0, wrong: 0, first: [] }]));
  for (const [f, t, b] of COMBOS) for (const v of values) {
    const o = oracle(v, f, t, b);
    for (const m of mods) {
      const x = m.convert(v, f, t, b); const r = out[m.name]; r.checked++;
      if (x !== o) { r.wrong++; if (r.first.length < 10) r.first.push({ value: v, from: f, to: t, basis: b, got: x, oracle: o }); }
    }
  }
  return { valuesPerCombo: values.size, results: out };
}
// ---- invalid codes ----
function invalidCodes(mods) {
  const out = Object.fromEntries(mods.map((m) => [m.name, { checked: 0, wrong: 0, first: [] }]));
  const units = [0, 1, 2, 3, 4, 5, 6, 7, 255, -1], bases = [0, 1, 2, 3, 255, -1];
  for (const f of units) for (const t of units) for (const b of bases) {
    if (f >= 0 && f <= 3 && t >= 0 && t <= 3 && b >= 0 && b <= 1) continue;
    for (let v = -4096; v < 4096; v++) {
      for (const m of mods) { const r = out[m.name]; r.checked++; const x = m.convert(v, f, t, b); if (x !== -2147483648) { r.wrong++; if (r.first.length < 5) r.first.push({ value: v, from: f, to: t, basis: b, got: x }); } }
    }
  }
  return out;
}

const before = env("before");
const AS = load("convert.as.wasm"), RS = load("convert.rs.wasm"), RSF = load("convert.rs-faulty.wasm");
console.error("pairwise AS vs RS…");
const equivalence = pairwise(AS, RS);
console.error(`  disagreements ${equivalence.disagreements} in ${equivalence.wallMs.toFixed(0)} ms`);
console.error("oracle sample…");
const sample = oracleSample([AS, RS]);
const invalid = invalidCodes([AS, RS]);
console.error("throughput…");
const thr = { as: throughput(AS), rs: throughput(RS) };
console.error("seeded fault RS-faulty vs RS…");
const fault = pairwise(RSF, RS);
let firstExposing = null;
for (const c of fault.perCombo) if (c.first.length) { const cand = { from: c.from, to: c.to, basis: c.basis, ...c.first[0] }; if (!firstExposing) firstExposing = cand; }
const after = env("after");
const derivedFullI32 = { inputs: 32 * 2 ** 32, note: "Derived from measured pairwise calls/s; not run", hoursAtMeasuredPairwiseRate: +((32 * 2 ** 32 * 2) / equivalence.callsPerSecondBothModules / 3600).toFixed(2) };
const res = {
  label: "Recorded (probe)", tag: TAG, precommitSha256: before.precommitSha256, contractSha256: before.contractSha256,
  modules: { as: { bytes: AS.bytes, sha256: AS.sha256 }, rs: { bytes: RS.bytes, sha256: RS.sha256 }, rsFaulty: { bytes: RSF.bytes, sha256: RSF.sha256 } },
  domain: { valueRange: [LO, HI], combos: COMBOS.length, inputs: DOMAIN },
  equivalence: { ...equivalence, perCombo: equivalence.perCombo.filter((c) => c.disagreements > 0) },
  oracleSample: sample, invalidCodes: invalid, throughput: thr,
  seededFault: { pair: fault.pair, inputs: fault.inputs, exposingInputs: fault.disagreements, fractionOfDomain: +(fault.disagreements / fault.inputs).toFixed(4), wallMs: fault.wallMs, firstExposing, perCombo: fault.perCombo.map(({ first, ...c }) => ({ ...c, first: first.slice(0, 2) })) },
  derivedFullI32, loadavg: { before: before.loadavg, after: after.loadavg },
};
writeFileSync(join(REC, `${TAG}.json`), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ inputs: DOMAIN, disagreements: equivalence.disagreements, wallMs: Math.round(equivalence.wallMs), callsPerSecond: { pairwiseBoth: equivalence.callsPerSecondBothModules, as: thr.as.callsPerSecond, rs: thr.rs.callsPerSecond }, oracleWrong: Object.fromEntries(Object.entries(sample.results).map(([k, v]) => [k, v.wrong])), invalidWrong: Object.fromEntries(Object.entries(invalid).map(([k, v]) => [k, v.wrong])), seededFault: { exposing: fault.disagreements, fraction: res.seededFault.fractionOfDomain, first: firstExposing }, perComboDisagreements: res.equivalence.perCombo.map((c) => [c.from, c.to, c.basis, c.disagreements, c.first[0]]) }, null, 1));
