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

const LOG: u32 = 0;
const REG: u32 = 1;
const SCRATCH: usize = memory.data(256);
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;

let gKeys: StaticArray<i64> = new StaticArray<i64>(0);
let gBest: StaticArray<i32> = new StaticArray<i32>(0);
let gTs: StaticArray<i64> = new StaticArray<i64>(0);
let gBits: i32 = 1;
let gMask: i32 = 1;
let gLogOk: bool = false;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gBad: bool = false;

function emitStr(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH, n);
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqCi(off: i32, len: i32, w: string): bool {
  if (len != w.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(SCRATCH + <usize>(off + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != w.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(LOG, idx, field, SCRATCH, 64);
  if (n < 0) return NaN;
  let a = 0;
  let b = n;
  while (a < b && isWs(<i32>load<u8>(SCRATCH + <usize>a))) a++;
  while (b > a && isWs(<i32>load<u8>(SCRATCH + <usize>(b - 1)))) b--;
  let len = b - a;
  if (mass) {
    if (eqCi(a, len, "kg")) return 1.0;
    if (eqCi(a, len, "lb")) return LB_KG;
  } else {
    if (eqCi(a, len, "kpa")) return 1.0;
    if (eqCi(a, len, "bar")) return 100.0;
    if (eqCi(a, len, "psi")) return PSI_KPA;
  }
  return NaN;
}

function loadReading(i: i32): void {
  gBad = true;
  gKg = NaN;
  gKpa = NaN;
  if (!gLogOk) return;
  let mf = unitFactor(i, 3, true);
  let pf = unitFactor(i, 5, false);
  let m = host_record_field_f64(LOG, i, 2);
  let p = host_record_field_f64(LOG, i, 4);
  if (isNaN(mf) || isNaN(pf) || !isFinite(m) || !isFinite(p) || m < 0) return;
  gBad = false;
  gKg = m * mf;
  gKpa = p * pf;
}

function findSlot(key: i64): i32 {
  let s = <i32>((<u64>key * <u64>0x9E3779B97F4A7C15) >> <u64>(64 - gBits));
  while (gBest[s] != -2 && gKeys[s] != key) s = (s + 1) & gMask;
  return s;
}

function emitRow(id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, cls: string, why: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  emitStr(7, cls);
  emitStr(8, why);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let logKey = host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0;
  gLogOk = logKey && host_field_kind(LOG, 2) == 1 && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2;
  let regKey = host_field_kind(REG, 0) == 0;
  let regOk = regKey && host_field_kind(REG, 1) == 1 && host_field_kind(REG, 2) == 1 && host_field_kind(REG, 5) == 1;
  let nL = max<i32>(host_record_count(LOG), 0);
  let nA = max<i32>(host_record_count(REG), 0);
  // open-addressing index on asset_id avoids an O(n*m) join
  gBits = 1;
  while ((1 << gBits) < (nA << 1)) gBits++;
  let cap = 1 << gBits;
  gMask = cap - 1;
  gKeys = new StaticArray<i64>(cap);
  gBest = new StaticArray<i32>(cap);
  gTs = new StaticArray<i64>(cap);
  for (let s = 0; s < cap; s++) gBest[s] = -2;
  if (regKey) {
    for (let a = 0; a < nA; a++) {
      let key = host_record_field_i64(REG, a, 0);
      let s = findSlot(key);
      if (gBest[s] == -2) { gKeys[s] = key; gBest[s] = -1; }
    }
  }
  if (logKey) {
    for (let r = 0; r < nL; r++) {
      let s = findSlot(host_record_field_i64(LOG, r, 0));
      if (gBest[s] == -2) continue;
      let ts = host_record_field_i64(LOG, r, 1);
      if (gBest[s] < 0 || ts > gTs[s]) { gBest[s] = r; gTs[s] = ts; }
    }
  }
  let n = 0;
  for (let a = 0; a < nA; a++) {
    let id: i64 = regKey ? host_record_field_i64(REG, a, 0) : -1;
    let rkg = regOk ? host_record_field_f64(REG, a, 1) : NaN;
    let rkpa = regOk ? host_record_field_f64(REG, a, 2) : NaN;
    let tolp = regOk ? host_record_field_f64(REG, a, 5) : NaN;
    n++;
    if (!isFinite(rkg) || !isFinite(rkpa) || !isFinite(tolp) || rkg < 0) {
      emitRow(id, -1, NaN, rkg, NaN, rkpa, "MALFORMED", "asset register field absent, negative or non-finite");
      continue;
    }
    let b = gBest[findSlot(id)];
    if (b < 0) {
      emitRow(id, -1, NaN, rkg, NaN, rkpa, "NO_READING", "no reading found for asset");
      continue;
    }
    let ts = host_record_field_i64(LOG, b, 1);
    loadReading(b);
    let cls = "OK";
    let why = "within tolerance";
    let tol = max<f64>(abs_tol_kg, tolp / 100.0 * rkg);
    let d = gKg - rkg;
    let ptol = rel_tol * abs<f64>(rkpa);
    if (gBad) { cls = "MALFORMED"; why = "unknown unit, negative mass or non-finite value"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; why = "newest reading older than max_age_days"; }
    else if (d < -tol) { cls = "UNDERCHARGE"; why = "charge below rated by more than tolerance"; }
    else if (d > tol) { cls = "OVERCHARGE"; why = "charge above rated by more than tolerance"; }
    else if (gKpa - rkpa > ptol) { cls = "PRESSURE_HIGH"; why = "pressure above rated by more than rel_tol"; }
    else if (rkpa - gKpa > ptol) { cls = "PRESSURE_LOW"; why = "pressure below rated by more than rel_tol"; }
    emitRow(id, ts, gKg, rkg, gKpa, rkpa, cls, why);
  }
  for (let r = 0; r < nL; r++) {
    let key: i64 = -1;
    let ts: i64 = -1;
    if (logKey) {
      key = host_record_field_i64(LOG, r, 0);
      if (gBest[findSlot(key)] != -2) continue;
      ts = host_record_field_i64(LOG, r, 1);
    }
    loadReading(r);
    if (gBad) emitRow(key, ts, gKg, NaN, gKpa, NaN, "MALFORMED", "orphan reading with unknown unit or bad value");
    else emitRow(key, ts, gKg, NaN, gKpa, NaN, "ORPHAN_READING", "reading asset_id not in asset register");
    n++;
  }
  return n;
}
