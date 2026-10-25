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

const SCRATCH = memory.data(256);
const OUTBUF = memory.data(128);
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const MAL: i32 = 0, NO_READING: i32 = 1, STALE: i32 = 2, UNDER: i32 = 3, OVER: i32 = 4;
const P_HIGH: i32 = 5, P_LOW: i32 = 6, ORPHAN: i32 = 7, OK: i32 = 8;
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE",
  "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite or absent field",
  "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance",
  "charge above rated beyond tolerance", "pressure above rated beyond rel_tol",
  "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];

let logOk = false;
let gTs: i64 = -1;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqi(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < e - s; i++) {
    let c: i32 = load<u8>(SCRATCH + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

// Returns the conversion factor for the unit string, or NaN if unknown or truncated.
function unitFactor(r: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, r, field, SCRATCH, 256);
  if (n < 0) return NaN;
  let s = 0;
  while (s < n && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  let e = n;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  if (mass) return eqi(s, e, "kg") ? 1.0 : eqi(s, e, "lb") ? LB_KG : NaN;
  return eqi(s, e, "kpa") ? 1.0 : eqi(s, e, "bar") ? 100.0 : eqi(s, e, "psi") ? PSI_KPA : NaN;
}

function evalReading(r: i32): bool {
  gTs = host_record_field_i64(0, r, 1);
  gKg = NaN;
  gKpa = NaN;
  if (!logOk) return false;
  let m = host_record_field_f64(0, r, 2);
  let mf = unitFactor(r, 3, true);
  let p = host_record_field_f64(0, r, 4);
  let pf = unitFactor(r, 5, false);
  gKg = m * mf;
  gKpa = p * pf;
  return isFinite(m) && m >= 0 && isFinite(p) && isFinite(mf) && isFinite(pf);
}

function putStr(field: i32, s: string): void {
  let n = s.length;
  for (let i = 0; i < n; i++) store<u8>(OUTBUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OUTBUF, n);
}

function emit(id: i64, ts: i64, kg: f64, rc: f64, kpa: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, kg - rc);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  putStr(7, unchecked(NAMES[cls]));
  putStr(8, unchecked(DETAILS[cls]));
  out_commit();
}

function slotOf(keys: StaticArray<i64>, used: StaticArray<bool>, mask: i32, k: i64): i32 {
  let h = <i32>(k ^ (k >>> 32)) * 0x45D9F3B;
  let s = (h ^ (h >>> 15)) & mask;
  while (unchecked(used[s]) && unchecked(keys[s]) != k) s = (s + 1) & mask;
  return s;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let n0 = host_record_count(0);
  let n1 = host_record_count(1);
  if (n0 < 0) n0 = 0;
  if (n1 < 0) n1 = 0;
  if (host_field_kind(0, 0) != 0 || host_field_kind(0, 1) != 0 || host_field_kind(1, 0) != 0) {
    emit(-1, -1, NaN, NaN, NaN, NaN, MAL);
    return 1;
  }
  logOk = host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1
    && host_field_kind(0, 5) == 2 && host_field_kind(0, 6) == 2;
  let regOk = host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 3) == 2
    && host_field_kind(1, 4) == 2 && host_field_kind(1, 5) == 1;
  // Open-addressing index on asset_id holding the newest reading per asset.
  let bits = 4;
  while ((1 << bits) < n1 * 2) bits++;
  let cap = 1 << bits, mask = cap - 1;
  let keys = new StaticArray<i64>(cap);
  let used = new StaticArray<bool>(cap);
  let best = new StaticArray<i32>(cap);
  let bestTs = new StaticArray<i64>(cap);
  for (let a = 0; a < n1; a++) {
    let k = host_record_field_i64(1, a, 0);
    let s = slotOf(keys, used, mask, k);
    if (!unchecked(used[s])) {
      unchecked(used[s] = true);
      unchecked(keys[s] = k);
      unchecked(best[s] = -1);
    }
  }
  for (let r = 0; r < n0; r++) {
    let s = slotOf(keys, used, mask, host_record_field_i64(0, r, 0));
    if (!unchecked(used[s])) continue;
    let ts = host_record_field_i64(0, r, 1);
    if (unchecked(best[s]) < 0 || ts > unchecked(bestTs[s])) {
      unchecked(best[s] = r);
      unchecked(bestTs[s] = ts);
    }
  }
  let count = 0;
  for (let a = 0; a < n1; a++) {
    let k = host_record_field_i64(1, a, 0);
    let r = unchecked(best[slotOf(keys, used, mask, k)]);
    let rc = regOk ? host_record_field_f64(1, a, 1) : NaN;
    let rp = regOk ? host_record_field_f64(1, a, 2) : NaN;
    let tp = regOk ? host_record_field_f64(1, a, 5) : NaN;
    let regBad = !isFinite(rc) || rc < 0 || !isFinite(rp) || !isFinite(tp);
    let cls = OK;
    if (r < 0) {
      gTs = -1;
      gKg = NaN;
      gKpa = NaN;
      cls = regBad ? MAL : NO_READING;
    } else if (!evalReading(r) || regBad) {
      cls = MAL;
    } else if (as_of_ts - gTs > max_age_days * 86400) {
      cls = STALE;
    } else {
      let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
      let d = gKg - rc;
      if (d < -tol) cls = UNDER;
      else if (d > tol) cls = OVER;
      else if (gKpa - rp > rel_tol * rp) cls = P_HIGH;
      else if (rp - gKpa > rel_tol * rp) cls = P_LOW;
    }
    emit(k, gTs, gKg, rc, gKpa, rp, cls);
    count++;
  }
  for (let r = 0; r < n0; r++) {
    let k = host_record_field_i64(0, r, 0);
    if (unchecked(used[slotOf(keys, used, mask, k)])) continue;
    let ok = evalReading(r);
    emit(k, gTs, gKg, NaN, gKpa, NaN, ok ? ORPHAN : MAL);
    count++;
  }
  return count;
}
