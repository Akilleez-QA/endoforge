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
const SCRATCH: usize = memory.data(64);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading asset_id not in register", "within tolerance"];
const LOG_KINDS: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const REG_KINDS: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
let encNames = new StaticArray<ArrayBuffer>(9);
let encDetails = new StaticArray<ArrayBuffer>(9);
let curKg: f64 = NaN;
let curKpa: f64 = NaN;

function kindsOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let f = 0; f < kinds.length; f++) if (host_field_kind(set, f) != kinds[f]) return false;
  return true;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqUnit(p: usize, len: i32, s: string): bool {
  if (len != s.length) return false;
  for (let i = 0; i < len; i++) if (<i32>load<u8>(p + <usize>i) != s.charCodeAt(i)) return false;
  return true;
}

function unitFactor(idx: i32, field: i32, pressure: bool): f64 {
  let n = host_record_field_str(LOG, idx, field, SCRATCH, 64);
  if (n < 0) return -1;
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
  if (!pressure) {
    if (eqUnit(p, len, "kg")) return 1.0;
    if (eqUnit(p, len, "lb")) return 0.45359237;
  } else {
    if (eqUnit(p, len, "kpa")) return 1.0;
    if (eqUnit(p, len, "bar")) return 100.0;
    if (eqUnit(p, len, "psi")) return 6.894757293168;
  }
  return -1;
}

function loadReading(idx: i32, logOk: bool): bool {
  curKg = NaN;
  curKpa = NaN;
  if (!logOk) return false;
  let m = host_record_field_f64(LOG, idx, 2);
  let pr = host_record_field_f64(LOG, idx, 4);
  let mf = unitFactor(idx, 3, false);
  let pf = unitFactor(idx, 5, true);
  if (!isFinite<f64>(m) || !isFinite<f64>(pr) || m < 0 || mf < 0 || pf < 0) return false;
  curKg = m * mf;
  curKpa = pr * pf;
  return true;
}

function emit(asset: i64, ts: i64, rated: f64, ratedP: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, asset);
  out_set_i64(1, ts);
  out_set_f64(2, curKg);
  out_set_f64(3, rated);
  out_set_f64(4, curKg - rated);
  out_set_f64(5, curKpa);
  out_set_f64(6, ratedP);
  out_set_str(7, changetype<usize>(encNames[cls]), encNames[cls].byteLength);
  out_set_str(8, changetype<usize>(encDetails[cls]), encDetails[cls].byteLength);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  for (let i = 0; i < 9; i++) {
    encNames[i] = String.UTF8.encode(NAMES[i]);
    encDetails[i] = String.UTF8.encode(DETAILS[i]);
  }
  let nL = host_record_count(LOG);
  let nA = host_record_count(REG);
  if (nL < 0) nL = 0;
  if (nA < 0) nA = 0;
  let logOk = kindsOk(LOG, LOG_KINDS);
  let regOk = kindsOk(REG, REG_KINDS);
  // Open-addressing index on asset_id avoids an O(n*m) join.
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  let keys = new StaticArray<i64>(cap);
  let slots = new StaticArray<i32>(cap);
  for (let a = 0; a < nA; a++) {
    let id = regOk ? host_record_field_i64(REG, a, 0) : <i64>a;
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 40) & (cap - 1);
    while (slots[h] != 0 && keys[h] != id) h = (h + 1) & (cap - 1);
    if (slots[h] == 0) { keys[h] = id; slots[h] = a + 1; }
  }
  let best = new StaticArray<i32>(max(nA, 1));
  let bestTs = new StaticArray<i64>(max(nA, 1));
  for (let a = 0; a < nA; a++) best[a] = -1;
  let owner = new StaticArray<i32>(max(nL, 1));
  for (let r = 0; r < nL; r++) {
    owner[r] = -1;
    if (!logOk || !regOk) continue;
    let id = host_record_field_i64(LOG, r, 0);
    let ts = host_record_field_i64(LOG, r, 1);
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 40) & (cap - 1);
    while (slots[h] != 0 && keys[h] != id) h = (h + 1) & (cap - 1);
    if (slots[h] == 0) continue;
    let a = slots[h] - 1;
    owner[r] = a;
    if (best[a] < 0 || ts > bestTs[a]) { best[a] = r; bestTs[a] = ts; }
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    let id = regOk ? host_record_field_i64(REG, a, 0) : -1;
    let rated = regOk ? host_record_field_f64(REG, a, 1) : NaN;
    let ratedP = regOk ? host_record_field_f64(REG, a, 2) : NaN;
    let pct = regOk ? host_record_field_f64(REG, a, 5) : NaN;
    let r = best[a];
    let ts: i64 = r >= 0 ? bestTs[a] : -1;
    let good = r >= 0 ? loadReading(r, logOk) : (curKg = NaN, curKpa = NaN, true);
    let cls = 8;
    let tol = max(abs_tol_kg, pct / 100.0 * rated);
    if (!regOk || !good || !isFinite<f64>(rated) || !isFinite<f64>(ratedP) || !isFinite<f64>(pct)) cls = 0;
    else if (r < 0) cls = 1;
    else if (as_of_ts - ts > max_age_days * 86400) cls = 2;
    else if (rated - curKg > tol) cls = 3;
    else if (curKg - rated > tol) cls = 4;
    else if (curKpa - ratedP > rel_tol * ratedP) cls = 5;
    else if (ratedP - curKpa > rel_tol * ratedP) cls = 6;
    emit(id, ts, rated, ratedP, cls);
    count++;
  }
  for (let r = 0; r < nL; r++) {
    if (logOk && regOk && owner[r] >= 0) continue;
    let good = loadReading(r, logOk);
    let id = logOk ? host_record_field_i64(LOG, r, 0) : -1;
    let ts = logOk ? host_record_field_i64(LOG, r, 1) : -1;
    emit(id, ts, NaN, NaN, good && regOk ? 7 : 0);
    count++;
  }
  return count;
}
