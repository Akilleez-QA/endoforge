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

const C_MAL: i32 = 0;
const C_NOREAD: i32 = 1;
const C_STALE: i32 = 2;
const C_UNDER: i32 = 3;
const C_OVER: i32 = 4;
const C_PHIGH: i32 = 5;
const C_PLOW: i32 = 6;
const C_ORPHAN: i32 = 7;
const C_OK: i32 = 8;
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
// Open-addressing index on asset_id; capacity 16384 slots
const SLOTS: i32 = 16384;
const MASK: i32 = SLOTS - 1;
const KEYS = memory.data(SLOTS * 8, 8);
const AIDX = memory.data(SLOTS * 4, 4);
const BEST = memory.data(SLOTS * 4, 4);
const BTS = memory.data(SLOTS * 8, 8);
const SCRATCH = memory.data(64, 8);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite value, or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond relative tolerance", "pressure below rated beyond relative tolerance", "reading has no matching asset", "within tolerance"];
const CLS = new StaticArray<ArrayBuffer>(9);
const DET = new StaticArray<ArrayBuffer>(9);
let gTs: i64 = -1;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;

function init(): void {
  for (let i = 0; i < 9; i++) {
    CLS[i] = String.UTF8.encode(NAMES[i]);
    DET[i] = String.UTF8.encode(DETAILS[i]);
  }
}
init();

function kindsMatch(set: u32, spec: string): bool {
  for (let i = 0; i < spec.length; i++) if (host_field_kind(set, i) != spec.charCodeAt(i) - 48) return false;
  return true;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function matches(p: usize, len: i32, s: string): bool {
  if (len != s.length) return false;
  for (let i = 0; i < len; i++) if (<i32>load<u8>(p + <usize>i) != s.charCodeAt(i)) return false;
  return true;
}

function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, idx, field, SCRATCH, 32);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  for (let i = s; i < e; i++) {
    let c = load<u8>(SCRATCH + <usize>i);
    if (c >= 65 && c <= 90) store<u8>(SCRATCH + <usize>i, c + 32);
  }
  let p = SCRATCH + <usize>s;
  let len = e - s;
  if (mass) return matches(p, len, "kg") ? 1.0 : matches(p, len, "lb") ? LB_KG : NaN;
  return matches(p, len, "kpa") ? 1.0 : matches(p, len, "bar") ? 100.0 : matches(p, len, "psi") ? PSI_KPA : NaN;
}

function readReading(i: i32): bool {
  gTs = host_record_field_i64(0, i, 1);
  let m = host_record_field_f64(0, i, 2);
  gKg = m * unitFactor(i, 3, true);
  gKpa = host_record_field_f64(0, i, 4) * unitFactor(i, 5, false);
  return isFinite(m) && m >= 0 && isFinite(gKg) && isFinite(gKpa);
}

function slotOf(key: i64, insert: bool): i32 {
  let h = <i32>((<u64>key * 0x9E3779B97F4A7C15) >> 50) & MASK;
  for (let n = 0; n < SLOTS; n++) {
    if (load<i32>(AIDX + (<usize>h << 2)) == 0) return insert ? h : -1;
    if (load<i64>(KEYS + (<usize>h << 3)) == key) return h;
    h = (h + 1) & MASK;
  }
  return -1;
}

function emit(aid: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, c: i32): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  let b = CLS[c];
  out_set_str(7, changetype<usize>(b), b.byteLength);
  let d = DET[c];
  out_set_str(8, changetype<usize>(d), d.byteLength);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  memory.fill(AIDX, 0, <usize>SLOTS * 4);
  memory.fill(BEST, 0, <usize>SLOTS * 4);
  let n0 = host_record_count(0);
  let n1 = host_record_count(1);
  if (!kindsMatch(1, "011221")) {
    emit(-1, -1, NaN, NaN, NaN, NaN, C_MAL);
    return 1;
  }
  let ok0 = kindsMatch(0, "0012122");
  for (let i = 0; i < n1; i++) {
    let key = host_record_field_i64(1, i, 0);
    let s = slotOf(key, true);
    if (s >= 0 && load<i32>(AIDX + (<usize>s << 2)) == 0) {
      store<i64>(KEYS + (<usize>s << 3), key);
      store<i32>(AIDX + (<usize>s << 2), i + 1);
    }
  }
  if (ok0) {
    for (let j = 0; j < n0; j++) {
      let s = slotOf(host_record_field_i64(0, j, 0), false);
      if (s < 0) continue;
      let ts = host_record_field_i64(0, j, 1);
      if (load<i32>(BEST + (<usize>s << 2)) == 0 || ts > load<i64>(BTS + (<usize>s << 3))) {
        store<i32>(BEST + (<usize>s << 2), j + 1);
        store<i64>(BTS + (<usize>s << 3), ts);
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n1; i++) {
    let aid = host_record_field_i64(1, i, 0);
    let rkg = host_record_field_f64(1, i, 1);
    let rkpa = host_record_field_f64(1, i, 2);
    let tp = host_record_field_f64(1, i, 5);
    let s = slotOf(aid, false);
    let b = s >= 0 ? load<i32>(BEST + (<usize>s << 2)) : 0;
    gTs = -1;
    gKg = NaN;
    gKpa = NaN;
    let rok = b > 0 ? readReading(b - 1) : true;
    let assetOk = isFinite(rkg) && isFinite(rkpa) && isFinite(tp) && rkg >= 0;
    let c = C_OK;
    if (!ok0 || !assetOk || !rok) c = C_MAL;
    else if (b == 0) c = C_NOREAD;
    else if (as_of_ts - gTs > max_age_days * 86400) c = C_STALE;
    else {
      let tol = Math.max(abs_tol_kg, tp / 100.0 * rkg);
      let d = gKg - rkg;
      let ptol = rel_tol * Math.abs(rkpa);
      if (d < -tol) c = C_UNDER;
      else if (d > tol) c = C_OVER;
      else if (gKpa - rkpa > ptol) c = C_PHIGH;
      else if (rkpa - gKpa > ptol) c = C_PLOW;
    }
    emit(aid, gTs, gKg, rkg, gKpa, rkpa, c);
    count++;
  }
  if (ok0) {
    for (let j = 0; j < n0; j++) {
      let aid = host_record_field_i64(0, j, 0);
      if (slotOf(aid, false) >= 0) continue;
      let c = readReading(j) ? C_ORPHAN : C_MAL;
      emit(aid, gTs, gKg, NaN, gKpa, NaN, c);
      count++;
    }
  }
  return count;
}
