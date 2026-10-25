// Generate 20 kernel variants (100–200 lines each) from a template with different field layouts
// and arithmetic. Variants 5, 11 and 17 contain a deliberate type error so diagnostics are measured.
// Deterministic: same output every run. Writes kernels/kNN.ts and kernels/manifest.json.
import fs from "node:fs";
import crypto from "node:crypto";

const OUT = new URL("./kernels/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

const TYPE_ERROR_VARIANTS = new Set([5, 11, 17]);
const FIELD_TYPES = ["f64", "f32", "i32", "u32", "i64"];
const OPS = ["+", "-", "*"];

function gen(v) {
  const nFields = 6 + (v % 7);           // 6..12 numeric fields
  const nBuckets = 8 << (v % 3);         // 8, 16 or 32 buckets
  const fields = [];
  let off = 8;                           // 0..8 reserved: version u32, tick u32
  for (let i = 0; i < nFields; i++) {
    const t = FIELD_TYPES[(v + i) % FIELD_TYPES.length];
    const size = t === "f64" || t === "i64" ? 8 : 4;
    off = (off + size - 1) & ~(size - 1);
    fields.push({ name: `f${i}`, type: t, off, size });
    off += size;
  }
  off = (off + 7) & ~7;
  const bucketOff = off; off += nBuckets * 8;
  const countOff = off; off += nBuckets * 4;
  const checksumOff = off; off += 4;
  const stateSize = (off + 7) & ~7;
  const unitFactors = [1.0, 0.45359237 * (1 + v * 0.001), 0.001, 0.028349523125, 1000.0, 3.6e6, 1055.05585262 + v];
  const L = [];
  L.push(`// Generated kernel variant ${v}: ${nFields} fields, ${nBuckets} buckets, state ${stateSize} bytes.`);
  L.push(`// Pure functions over linear memory; no imports.`);
  L.push(`const STATE_SIZE: u32 = ${stateSize};`);
  L.push(`const OFF_TICK: u32 = 4;`);
  for (const f of fields) L.push(`const OFF_${f.name.toUpperCase()}: u32 = ${f.off};`);
  L.push(`const OFF_BUCKET: u32 = ${bucketOff};`);
  L.push(`const OFF_COUNT: u32 = ${countOff};`);
  L.push(`const OFF_CHECKSUM: u32 = ${checksumOff};`);
  L.push(`const N_BUCKETS: u32 = ${nBuckets};`);
  L.push(`const EVENT_SIZE: u32 = 32;`);
  L.push(``);
  L.push(`export function stateSize(): u32 { return STATE_SIZE; }`);
  L.push(`export function eventSize(): u32 { return EVENT_SIZE; }`);
  L.push(``);
  L.push(`export function initState(statePtr: u32): u32 {`);
  L.push(`  memory.fill(statePtr, 0, STATE_SIZE);`);
  L.push(`  store<u32>(statePtr, ${3000 + v});`);
  L.push(`  return statePtr;`);
  L.push(`}`);
  L.push(``);
  L.push(`function toBaseFactor(unit: u32): f64 {`);
  L.push(`  switch (unit) {`);
  unitFactors.forEach((f, i) => L.push(`    case ${i}: return ${f};`));
  L.push(`    default: return 0.0;`);
  L.push(`  }`);
  L.push(`}`);
  L.push(``);
  L.push(`export function convertUnit(value: f64, from: u32, to: u32): f64 {`);
  L.push(`  if (from == to) return value;`);
  L.push(`  const fa = toBaseFactor(from);`);
  L.push(`  const fb = toBaseFactor(to);`);
  L.push(`  if (fa == 0.0 || fb == 0.0) return NaN;`);
  L.push(`  return value * fa / fb${v % 2 ? " + 0.0" : ""};`);
  L.push(`}`);
  L.push(``);
  L.push(`function checksum(statePtr: u32): u32 {`);
  L.push(`  let h: u32 = ${(2166136261 ^ v) >>> 0};`);
  L.push(`  for (let i: u32 = 0; i < OFF_CHECKSUM; i++) {`);
  L.push(`    h ^= <u32>load<u8>(statePtr + i);`);
  L.push(`    h *= 16777619;`);
  L.push(`  }`);
  L.push(`  return h;`);
  L.push(`}`);
  L.push(``);
  L.push(`export function joinRecords(aPtr: u32, aCount: u32, bPtr: u32, bCount: u32, n: u32, outPtr: u32): u32 {`);
  L.push(`  const total = <f64>(aCount + bCount);`);
  L.push(`  if (total == 0.0) { memory.fill(outPtr, 0, n << 3); return outPtr; }`);
  L.push(`  const wa = <f64>aCount / total;`);
  L.push(`  const wb = <f64>bCount / total;`);
  L.push(`  for (let i: u32 = 0; i < n; i++) {`);
  L.push(`    const a = load<f64>(aPtr + (i << 3));`);
  L.push(`    const b = load<f64>(bPtr + (i << 3));`);
  L.push(`    store<f64>(outPtr + (i << 3), a * wa ${OPS[v % 3]} b * wb);`);
  L.push(`  }`);
  L.push(`  return outPtr;`);
  L.push(`}`);
  L.push(``);
  // One accessor per field.
  for (const f of fields) {
    L.push(`export function read_${f.name}(statePtr: u32): ${f.type} { return load<${f.type}>(statePtr + OFF_${f.name.toUpperCase()}); }`);
  }
  L.push(``);
  L.push(`export function step(statePtr: u32, eventPtr: u32): u32 {`);
  L.push(`  const kind = load<u32>(eventPtr);`);
  L.push(`  const unitFrom = load<u32>(eventPtr + 4);`);
  L.push(`  const unitTo = load<u32>(eventPtr + 8);`);
  L.push(`  const flags = load<u32>(eventPtr + 12);`);
  L.push(`  const value = load<f64>(eventPtr + 16);`);
  L.push(`  const value2 = load<f64>(eventPtr + 24);`);
  L.push(`  store<u32>(statePtr + OFF_TICK, load<u32>(statePtr + OFF_TICK) + 1);`);
  L.push(`  switch (kind & 7) {`);
  fields.forEach((f, i) => {
    const k = i % 8;
    const isFloat = f.type === "f64" || f.type === "f32";
    const cast = `<${f.type}>`;
    const op = OPS[(v + i) % 3];
    L.push(`    case ${k}: {`);
    if (isFloat) {
      L.push(`      const conv = convertUnit(value, unitFrom, unitTo);`);
      L.push(`      const cur = load<${f.type}>(statePtr + OFF_${f.name.toUpperCase()});`);
      L.push(`      store<${f.type}>(statePtr + OFF_${f.name.toUpperCase()}, cur ${op} ${cast}(isNaN(conv) ? value2 : conv));`);
    } else {
      L.push(`      const cur = load<${f.type}>(statePtr + OFF_${f.name.toUpperCase()});`);
      L.push(`      store<${f.type}>(statePtr + OFF_${f.name.toUpperCase()}, cur ${op} ${cast}(flags ^ ${(v * 7919 + i) >>> 0}));`);
    }
    if (TYPE_ERROR_VARIANTS.has(v) && i === 2) {
      // Deliberate type error: assigning an f64 to a u32 local without a cast.
      L.push(`      const bad: u32 = value * 2.0; // deliberate type error`);
      L.push(`      store<u32>(statePtr + OFF_TICK, bad);`);
    }
    L.push(`      break;`);
    L.push(`    }`);
  });
  L.push(`    default: break;`);
  L.push(`  }`);
  L.push(`  const slot = (kind ^ flags) % N_BUCKETS;`);
  L.push(`  const bp = statePtr + OFF_BUCKET + (slot << 3);`);
  L.push(`  const cp = statePtr + OFF_COUNT + (slot << 2);`);
  L.push(`  const c = load<u32>(cp);`);
  L.push(`  const merged = (load<f64>(bp) * <f64>c + value + value2) / <f64>(c + 2);`);
  L.push(`  store<f64>(bp, merged);`);
  L.push(`  store<u32>(cp, c + 2);`);
  L.push(`  store<u32>(statePtr + OFF_CHECKSUM, checksum(statePtr));`);
  L.push(`  return statePtr;`);
  L.push(`}`);
  L.push(``);
  L.push(`export function readChecksum(statePtr: u32): u32 { return load<u32>(statePtr + OFF_CHECKSUM); }`);
  L.push(``);
  // Padding helpers so every variant lands in the 100–200 line band.
  const target = 110 + (v * 4) % 80;
  let i = 0;
  while (L.length < target) {
    L.push(`export function helper${i}(x: f64): f64 { return x * ${(i + 1) * 1.5} ${OPS[(v + i) % 3]} ${i}.0; }`);
    i++;
  }
  return L.join("\n") + "\n";
}

const manifest = [];
for (let v = 0; v < 20; v++) {
  const name = `k${String(v).padStart(2, "0")}`;
  const src = gen(v);
  fs.writeFileSync(new URL(`${name}.ts`, OUT), src);
  manifest.push({ name, lines: src.split("\n").length - 1, bytes: Buffer.byteLength(src), sha256: crypto.createHash("sha256").update(src).digest("hex"), expectTypeError: TYPE_ERROR_VARIANTS.has(v) });
}
fs.writeFileSync(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest.map((m) => `${m.name} ${m.lines} lines${m.expectTypeError ? " (type error)" : ""}`).join("\n"));
