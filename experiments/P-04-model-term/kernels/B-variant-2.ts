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

const LOG: u32 = 0;
const REG: u32 = 1;
// Host-assigned handle of the committed output record set.
const OUT_HANDLE: u32 = 2;
const SCR: usize = memory.data(256);
const LOG_KINDS: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const REG_KINDS: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond relative tolerance", "pressure below rated beyond relative tolerance", "reading has no registered asset", "within tolerance"];

let strPtr = new StaticArray<usize>(18);
let strLen = new StaticArray<i32>(18);
let inited = false;
let logOk = false;
let regOk = false;
let keys = new StaticArray<i64>(0);
let slot = new StaticArray<i32>(0);
let best = new StaticArray<i32>(0);
let rowRank = new StaticArray<i32>(0);
let rowId = new StaticArray<i64>(0);
let rowSrc = new StaticArray<i32>(0);
let gTs: i64 = -1;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let gRated: f64 = NaN;
let gRatedP: f64 = NaN;

function init(): void {
  if (inited) return;
  for (let i = 0; i < 9; i++) {
    strPtr[i] = changetype<usize>(String.UTF8.encode(NAMES[i]));
    strLen[i] = String.UTF8.byteLength(NAMES[i]);
    strPtr[i + 9] = changetype<usize>(String.UTF8.encode(DETAILS[i]));
    strLen[i + 9] = String.UTF8.byteLength(DETAILS[i]);
  }
  inited = true;
}

function kindsOk(set: u32, k: StaticArray<i32>): bool {
  for (let i = 0; i < k.length; i++) if (host_field_kind(set, i) != k[i]) return false;
  return true;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eq(p: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(r: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(LOG, r, field, SCR, 256);
  if (n < 0) return NaN;
  let s = 0;
  while (s < n && isWs(load<u8>(SCR + s))) s++;
  while (n > s && isWs(load<u8>(SCR + n - 1))) n--;
  let p = SCR + s;
  let len = n - s;
  if (mass) return eq(p, len, "kg") ? 1.0 : eq(p, len, "lb") ? 0.45359237 : NaN;
  return eq(p, len, "kpa") ? 1.0 : eq(p, len, "bar") ? 100.0 : eq(p, len, "psi") ? 6.894757293168 : NaN;
}

function classify(a: i32, r: i32, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  gTs = -1; gCharge = NaN; gPress = NaN; gRated = NaN; gRatedP = NaN;
  let tolPct: f64 = 0;
  if (a >= 0) {
    if (!regOk) return 0;
    gRated = host_record_field_f64(REG, a, 1);
    gRatedP = host_record_field_f64(REG, a, 2);
    tolPct = host_record_field_f64(REG, a, 5);
    if (!isFinite(gRated) || !isFinite(gRatedP) || !isFinite(tolPct) || gRated < 0) return 0;
  }
  if (r < 0) return 1;
  if (!logOk) return 0;
  gTs = host_record_field_i64(LOG, r, 1);
  let m = host_record_field_f64(LOG, r, 2);
  let p = host_record_field_f64(LOG, r, 4);
  let mf = unitFactor(r, 3, true);
  let pf = unitFactor(r, 5, false);
  if (!isFinite(m) || !isFinite(p) || isNaN(mf) || isNaN(pf) || m < 0) return 0;
  gCharge = m * mf;
  gPress = p * pf;
  if (a < 0) return 7;
  if (asOf - gTs > maxAge * 86400) return 2;
  let tol = Math.max(absTol, tolPct / 100 * gRated);
  if (gCharge < gRated - tol) return 3;
  if (gCharge > gRated + tol) return 4;
  if (gPress > gRatedP * (1 + relTol)) return 5;
  if (gPress < gRatedP * (1 - relTol)) return 6;
  return 8;
}

function find(id: i64, mask: i32): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 40) & mask;
  while (slot[h] >= 0 && keys[h] != id) h = (h + 1) & mask;
  return h;
}

function less(x: i32, y: i32): bool {
  if (rowRank[x] != rowRank[y]) return rowRank[x] < rowRank[y];
  if (rowId[x] != rowId[y]) return rowId[x] < rowId[y];
  return x < y;
}

function sift(o: StaticArray<i32>, s: i32, n: i32): void {
  let root = s;
  while (true) {
    let c = root * 2 + 1;
    if (c >= n) break;
    if (c + 1 < n && less(o[c], o[c + 1])) c++;
    if (!less(o[root], o[c])) break;
    let t = o[root]; o[root] = o[c]; o[c] = t;
    root = c;
  }
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  init();
  logOk = kindsOk(LOG, LOG_KINDS);
  regOk = kindsOk(REG, REG_KINDS);
  let nL = max(host_record_count(LOG), 0);
  let nR = max(host_record_count(REG), 0);
  let cap = 16;
  while (cap < nR * 2) cap <<= 1;
  let mask = cap - 1;
  keys = new StaticArray<i64>(cap);
  slot = new StaticArray<i32>(cap);
  best = new StaticArray<i32>(cap);
  for (let i = 0; i < cap; i++) { slot[i] = -1; best[i] = -1; }
  rowRank = new StaticArray<i32>(nR + nL);
  rowId = new StaticArray<i64>(nR + nL);
  rowSrc = new StaticArray<i32>(nR + nL);
  for (let a = 0; a < nR; a++) {
    let id = host_record_field_i64(REG, a, 0);
    let h = find(id, mask);
    if (slot[h] < 0) { keys[h] = id; slot[h] = a; }
  }
  for (let r = 0; r < nL; r++) {
    let h = find(host_record_field_i64(LOG, r, 0), mask);
    if (slot[h] < 0) continue;
    let b = best[h];
    if (b < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, b, 1)) best[h] = r;
  }
  let n = 0;
  for (let a = 0; a < nR; a++) {
    let id = host_record_field_i64(REG, a, 0);
    rowRank[n] = classify(a, best[find(id, mask)], abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    rowId[n] = id; rowSrc[n] = a; n++;
  }
  for (let r = 0; r < nL; r++) {
    let id = host_record_field_i64(LOG, r, 0);
    if (slot[find(id, mask)] >= 0) continue;
    rowRank[n] = classify(-1, r, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    rowId[n] = id; rowSrc[n] = -(r + 1); n++;
  }
  let order = new StaticArray<i32>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n / 2 - 1; i >= 0; i--) sift(order, i, n);
  for (let e = n - 1; e > 0; e--) {
    let t = order[0]; order[0] = order[e]; order[e] = t;
    sift(order, 0, e);
  }
  for (let k = 0; k < n; k++) {
    let x = order[k];
    let s = rowSrc[x];
    let a = s >= 0 ? s : -1;
    let r = s >= 0 ? best[find(rowId[x], mask)] : -s - 1;
    let c = classify(a, r, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    out_begin();
    out_set_i64(0, rowId[x]);
    out_set_i64(1, gTs);
    out_set_f64(2, gCharge);
    out_set_f64(3, gRated);
    out_set_f64(4, gCharge - gRated);
    out_set_f64(5, gPress);
    out_set_f64(6, gRatedP);
    out_set_str(7, strPtr[c], strLen[c]);
    out_set_str(8, strPtr[c + 9], strLen[c + 9]);
    out_commit();
  }
  effect_emit(100, OUT_HANDLE);
  return n;
}
