@external("host", "host_record_count") declare function host_record_count(set: u32): i32;
@external("host", "host_record_field_i64") declare function host_record_field_i64(set: u32, idx: i32, field: i32): i64;
@external("host", "host_record_field_f64") declare function host_record_field_f64(set: u32, idx: i32, field: i32): f64;
@external("host", "host_record_field_str") declare function host_record_field_str(set: u32, idx: i32, field: i32, dst: usize, cap: i32): i32;
@external("host", "host_field_kind") declare function host_field_kind(set: u32, field: i32): i32;
@external("host", "out_begin") declare function out_begin(): void;
@external("host", "out_set_i64") declare function out_set_i64(field: i32, v: i64): void;
@external("host", "out_set_f64") declare function out_set_f64(field: i32, v: f64): void;
@external("host", "out_set_str") declare function out_set_str(field: i32, ptr: usize, len: i32): void;
@external("host", "out_commit") declare function out_commit(): void;
@external("host", "effect_emit") declare function effect_emit(kind: i32, payload: u32): void;

const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const SCRATCH: usize = memory.data(256);
const LOG_KINDS: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const REG_KINDS: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];

let nA: i32 = 0;
let badLog = false;
let badReg = false;
let best = new StaticArray<i32>(0);
let bestTs = new StaticArray<i64>(0);
let orph = new StaticArray<i32>(0);
let cls = new StaticArray<i32>(0);
let key = new StaticArray<i64>(0);
let gId: i64 = 0;
let gTs: i64 = -1;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let gRatedC: f64 = NaN;
let gRatedP: f64 = NaN;

function schemaOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let i = 0; i < kinds.length; i++) if (host_field_kind(set, i) != kinds[i]) return false;
  return true;
}

function isWs(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// Returns 1/2 for kg/lb or 1/2/3 for kPa/bar/psi; 0 means unknown.
function unitCode(r: i32, field: i32, mass: bool): i32 {
  const n = host_record_field_str(0, r, field, SCRATCH, 256);
  if (n < 0) return 0;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  if (e - s < 2 || e - s > 3) return 0;
  let v: u32 = 0;
  for (let i = s; i < e; i++) {
    let c = <u32>load<u8>(SCRATCH + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    v |= c << (<u32>(i - s) * 8);
  }
  if (mass) return v == 0x676b ? 1 : v == 0x626c ? 2 : 0;
  return v == 0x61706b ? 1 : v == 0x726162 ? 2 : v == 0x697370 ? 3 : 0;
}

function evalRow(row: i32, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  const orphan = row >= nA;
  gTs = -1; gCharge = NaN; gPress = NaN; gRatedC = NaN; gRatedP = NaN;
  let tolPct: f64 = 0;
  let r = orphan ? unchecked(orph[row - nA]) : unchecked(best[row]);
  let mal = false;
  if (orphan) gId = host_record_field_i64(0, r, 0);
  else {
    gId = host_record_field_i64(1, row, 0);
    gRatedC = host_record_field_f64(1, row, 1);
    gRatedP = host_record_field_f64(1, row, 2);
    tolPct = host_record_field_f64(1, row, 5);
    mal = badReg || !isFinite(gRatedC) || !isFinite(gRatedP) || !isFinite(tolPct);
  }
  if (r >= 0) {
    gTs = host_record_field_i64(0, r, 1);
    const m = host_record_field_f64(0, r, 2);
    const p = host_record_field_f64(0, r, 4);
    const cu = unitCode(r, 3, true);
    const pu = unitCode(r, 5, false);
    if (badLog || cu == 0 || pu == 0 || !isFinite(m) || !isFinite(p) || m < 0) mal = true;
    else {
      gCharge = cu == 2 ? m * LB_KG : m;
      gPress = pu == 2 ? p * 100.0 : pu == 3 ? p * PSI_KPA : p;
    }
  }
  if (mal) return 0;
  if (orphan) return 7;
  if (r < 0) return 1;
  if (asOf - gTs > maxAge * 86400) return 2;
  const tol = max<f64>(absTol, tolPct / 100.0 * gRatedC);
  const d = gCharge - gRatedC;
  if (d < -tol) return 3;
  if (d > tol) return 4;
  const pd = gPress - gRatedP;
  const lim = relTol * gRatedP;
  if (pd > lim) return 5;
  if (pd < -lim) return 6;
  return 8;
}

function less(a: i32, b: i32): bool {
  const ca = unchecked(cls[a]), cb = unchecked(cls[b]);
  if (ca != cb) return ca < cb;
  const ka = unchecked(key[a]), kb = unchecked(key[b]);
  if (ka != kb) return ka < kb;
  return a < b;
}

function sift(o: StaticArray<i32>, i: i32, n: i32): void {
  while (true) {
    let m = i;
    const l = 2 * i + 1;
    if (l < n && less(unchecked(o[m]), unchecked(o[l]))) m = l;
    if (l + 1 < n && less(unchecked(o[m]), unchecked(o[l + 1]))) m = l + 1;
    if (m == i) return;
    const t = unchecked(o[i]); unchecked(o[i] = o[m]); unchecked(o[m] = t);
    i = m;
  }
}

function putStr(field: i32, s: string): void {
  for (let i = 0; i < s.length; i++) store<u8>(SCRATCH + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH, s.length);
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  badLog = !schemaOk(0, LOG_KINDS);
  badReg = !schemaOk(1, REG_KINDS);
  nA = max<i32>(host_record_count(1), 0);
  const nR = max<i32>(host_record_count(0), 0);
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new StaticArray<i32>(cap);
  for (let i = 0; i < cap; i++) unchecked(table[i] = -1);
  best = new StaticArray<i32>(nA);
  bestTs = new StaticArray<i64>(nA);
  orph = new StaticArray<i32>(nR);
  // Open-addressing index on asset_id; first register row wins on duplicates.
  for (let a = 0; a < nA; a++) {
    unchecked(best[a] = -1);
    const id = host_record_field_i64(1, a, 0);
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 40) & mask;
    while (unchecked(table[h]) >= 0 && host_record_field_i64(1, unchecked(table[h]), 0) != id) h = (h + 1) & mask;
    if (unchecked(table[h]) < 0) unchecked(table[h] = a);
  }
  let nO = 0;
  for (let r = 0; r < nR; r++) {
    const id = host_record_field_i64(0, r, 0);
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 40) & mask;
    while (unchecked(table[h]) >= 0 && host_record_field_i64(1, unchecked(table[h]), 0) != id) h = (h + 1) & mask;
    const a = unchecked(table[h]);
    if (a < 0) { unchecked(orph[nO++] = r); continue; }
    const ts = host_record_field_i64(0, r, 1);
    if (unchecked(best[a]) < 0 || ts > unchecked(bestTs[a])) { unchecked(best[a] = r); unchecked(bestTs[a] = ts); }
  }
  const total = nA + nO;
  cls = new StaticArray<i32>(total);
  key = new StaticArray<i64>(total);
  const order = new StaticArray<i32>(total);
  for (let i = 0; i < total; i++) {
    unchecked(cls[i] = evalRow(i, abs_tol_kg, rel_tol, max_age_days, as_of_ts));
    unchecked(key[i] = gId);
    unchecked(order[i] = i);
  }
  // Heapsort by (classification rank, asset_id, row) for a deterministic total order.
  for (let i = total / 2 - 1; i >= 0; i--) sift(order, i, total);
  for (let n = total - 1; n > 0; n--) {
    const t = unchecked(order[0]); unchecked(order[0] = order[n]); unchecked(order[n] = t);
    sift(order, 0, n);
  }
  for (let k = 0; k < total; k++) {
    const row = unchecked(order[k]);
    const c = evalRow(row, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    out_begin();
    out_set_i64(0, gId);
    out_set_i64(1, gTs);
    out_set_f64(2, gCharge);
    out_set_f64(3, gRatedC);
    out_set_f64(4, gCharge - gRatedC);
    out_set_f64(5, gPress);
    out_set_f64(6, gRatedP);
    putStr(7, NAMES[c]);
    putStr(8, DETAILS[c]);
    out_commit();
  }
  // Summary effect after the last record; payload carries the committed record count.
  effect_emit(100, <u32>total);
  return total;
}
