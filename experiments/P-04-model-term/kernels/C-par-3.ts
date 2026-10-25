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
const U_KG: i32 = (2 << 24) | 0x676b;
const U_LB: i32 = (2 << 24) | 0x626c;
const U_KPA: i32 = (3 << 24) | 0x61706b;
const U_BAR: i32 = (3 << 24) | 0x726162;
const U_PSI: i32 = (3 << 24) | 0x697370;
const C_MALFORMED: i32 = 0;
const C_NO_READING: i32 = 1;
const C_STALE: i32 = 2;
const C_UNDER: i32 = 3;
const C_OVER: i32 = 4;
const C_P_HIGH: i32 = 5;
const C_P_LOW: i32 = 6;
const C_ORPHAN: i32 = 7;
const C_OK: i32 = 8;
const LOG_KINDS: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const REG_KINDS: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const NAMES: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("MALFORMED"), String.UTF8.encode("NO_READING"), String.UTF8.encode("STALE"),
  String.UTF8.encode("UNDERCHARGE"), String.UTF8.encode("OVERCHARGE"), String.UTF8.encode("PRESSURE_HIGH"),
  String.UTF8.encode("PRESSURE_LOW"), String.UTF8.encode("ORPHAN_READING"), String.UTF8.encode("OK")
];
const DETAILS: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("unknown unit, negative mass, non-finite value, or absent field"),
  String.UTF8.encode("no reading found for asset"), String.UTF8.encode("newest reading older than max_age_days"),
  String.UTF8.encode("charge below rated beyond tolerance"), String.UTF8.encode("charge above rated beyond tolerance"),
  String.UTF8.encode("pressure above rated beyond rel_tol"), String.UTF8.encode("pressure below rated beyond rel_tol"),
  String.UTF8.encode("reading has no matching asset"), String.UTF8.encode("within tolerance")
];

let rTs: i64 = 0;
let rKg: f64 = NaN;
let rKpa: f64 = NaN;
let rBad: bool = false;

function isWs(b: i32): bool {
  return b == 32 || (b >= 9 && b <= 13);
}

// Packs a trimmed, lowercased unit of 1..3 bytes with its length; -1 if invalid
function unitKey(set: u32, idx: i32, field: i32): i32 {
  const n = host_record_field_str(set, idx, field, SCRATCH, 256);
  if (n < 0) return -1;
  let s: i32 = 0;
  let e: i32 = n;
  while (s < e && isWs(<i32>load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  const len = e - s;
  if (len < 1 || len > 3) return -1;
  let key: i32 = len << 24;
  for (let i: i32 = 0; i < len; i++) {
    let b = <i32>load<u8>(SCRATCH + <usize>(s + i));
    if (b >= 65 && b <= 90) b |= 32;
    key |= b << (i * 8);
  }
  return key;
}

function setOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let i: i32 = 0; i < kinds.length; i++) {
    if (host_field_kind(set, i) != kinds[i]) return false;
  }
  return true;
}

function loadReading(i: i32): void {
  rTs = host_record_field_i64(LOG, i, 1);
  const m = host_record_field_f64(LOG, i, 2);
  const p = host_record_field_f64(LOG, i, 4);
  const cu = unitKey(LOG, i, 3);
  const pu = unitKey(LOG, i, 5);
  rKg = cu == U_KG ? m : cu == U_LB ? m * LB_KG : NaN;
  rKpa = pu == U_KPA ? p : pu == U_BAR ? p * 100.0 : pu == U_PSI ? p * PSI_KPA : NaN;
  rBad = !isFinite(rKg) || !isFinite(rKpa) || m < 0.0;
}

function emit(id: i64, ts: i64, kg: f64, rated: f64, kpa: f64, ratedP: f64, c: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rated);
  out_set_f64(4, kg - rated);
  out_set_f64(5, kpa);
  out_set_f64(6, ratedP);
  const n = NAMES[c];
  out_set_str(7, changetype<usize>(n), n.byteLength);
  const d = DETAILS[c];
  out_set_str(8, changetype<usize>(d), d.byteLength);
  out_commit();
}

function classify(rated: f64, ratedP: f64, pct: f64, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  if (asOf - rTs > maxAge * 86400) return C_STALE;
  const tol = Math.max(absTol, pct / 100.0 * rated);
  if (rated - rKg > tol) return C_UNDER;
  if (rKg - rated > tol) return C_OVER;
  const pt = relTol * ratedP;
  if (rKpa - ratedP > pt) return C_P_HIGH;
  if (ratedP - rKpa > pt) return C_P_LOW;
  return C_OK;
}

// Open-addressing probe over asset_id; returns the matching or first empty slot
function slotOf(keys: StaticArray<i64>, used: StaticArray<i32>, mask: i32, id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 32) & mask;
  while (used[h] != 0 && keys[h] != id) h = (h + 1) & mask;
  return h;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nr = host_record_count(LOG);
  const na = host_record_count(REG);
  const ok0 = nr <= 0 || setOk(LOG, LOG_KINDS);
  let out: i32 = 0;
  // An invalid register schema makes every asset row MALFORMED and prevents the join
  if (!setOk(REG, REG_KINDS)) {
    for (let a: i32 = 0; a < na; a++) emit(-1, -1, NaN, NaN, NaN, NaN, C_MALFORMED);
    return na > 0 ? na : 0;
  }
  let cap: i32 = 16;
  while (cap < na * 2) cap <<= 1;
  const mask = cap - 1;
  const keys = new StaticArray<i64>(cap);
  const used = new StaticArray<i32>(cap);
  const best = new StaticArray<i32>(cap);
  const bestTs = new StaticArray<i64>(cap);
  for (let a: i32 = 0; a < na; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const h = slotOf(keys, used, mask, id);
    if (used[h] == 0) { used[h] = 1; keys[h] = id; }
  }
  // Single pass keeps the newest reading per asset; ties keep the lowest index
  if (ok0) {
    for (let r: i32 = 0; r < nr; r++) {
      const h = slotOf(keys, used, mask, host_record_field_i64(LOG, r, 0));
      if (used[h] == 0) continue;
      const ts = host_record_field_i64(LOG, r, 1);
      if (best[h] == 0 || ts > bestTs[h]) { best[h] = r + 1; bestTs[h] = ts; }
    }
  }
  for (let a: i32 = 0; a < na; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const rated = host_record_field_f64(REG, a, 1);
    const ratedP = host_record_field_f64(REG, a, 2);
    const pct = host_record_field_f64(REG, a, 5);
    const badA = !isFinite(rated) || rated < 0.0 || !isFinite(ratedP) || ratedP < 0.0 || !isFinite(pct) || pct < 0.0;
    const h = slotOf(keys, used, mask, id);
    if (!ok0) {
      emit(id, -1, NaN, rated, NaN, ratedP, C_MALFORMED);
    } else if (best[h] == 0) {
      emit(id, -1, NaN, rated, NaN, ratedP, badA ? C_MALFORMED : C_NO_READING);
    } else {
      loadReading(best[h] - 1);
      const c = badA || rBad ? C_MALFORMED : classify(rated, ratedP, pct, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
      emit(id, rTs, rKg, rated, rKpa, ratedP, c);
    }
    out++;
  }
  if (ok0) {
    for (let r: i32 = 0; r < nr; r++) {
      const id = host_record_field_i64(LOG, r, 0);
      if (used[slotOf(keys, used, mask, id)] != 0) continue;
      loadReading(r);
      emit(id, rTs, rKg, NaN, rKpa, NaN, rBad ? C_MALFORMED : C_ORPHAN);
      out++;
    }
  }
  return out;
}
