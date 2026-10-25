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

const UNIT_BUF: usize = memory.data(64);
const TEXT_BUF: usize = memory.data(96);
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const BAD_READING = "bad unit, negative mass, or non-finite value";

// Open-addressing index on asset_id; reused across runs to bound memory under the stub runtime
let keys = new StaticArray<i64>(0);
let used = new StaticArray<bool>(0);
let bestIdx = new StaticArray<i32>(0);
let mask: i32 = 0;
let rKg: f64 = NaN;
let rKpa: f64 = NaN;

function slotOf(key: i64): i32 {
  let h = <i32>((<u64>key * 0x9E3779B97F4A7C15) >>> 32) & mask;
  while (used[h] && keys[h] != key) h = (h + 1) & mask;
  return h;
}

function kindsMatch(set: u32, spec: i32, n: i32): bool {
  for (let f = 0; f < n; f++) if (host_field_kind(set, f) != ((spec >> (f * 2)) & 3)) return false;
  return true;
}

function isWs(c: u8): bool { return c == 32 || (c >= 9 && c <= 13); }

// Trimmed, lowercased unit packed little-endian into a u32; 0 when unusable
function unitPack(set: u32, idx: i32, field: i32): u32 {
  let n = host_record_field_str(set, idx, field, UNIT_BUF, 64);
  let s = 0;
  while (s < n && isWs(load<u8>(UNIT_BUF + <usize>s))) s++;
  while (n > s && isWs(load<u8>(UNIT_BUF + <usize>(n - 1)))) n--;
  if (n - s < 1 || n - s > 3) return 0;
  let p: u32 = 0;
  for (let i = s; i < n; i++) {
    let c = <u32>load<u8>(UNIT_BUF + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    p |= c << (<u32>(i - s) * 8);
  }
  return p;
}

function readReading(r: i32): bool {
  let m = host_record_field_f64(0, r, 2);
  let p = host_record_field_f64(0, r, 4);
  let mu = unitPack(0, r, 3);
  let pu = unitPack(0, r, 5);
  rKg = mu == 0x676B ? m : mu == 0x626C ? m * LB_KG : NaN;
  rKpa = pu == 0x61706B ? p : pu == 0x726162 ? p * 100.0 : pu == 0x697370 ? p * PSI_KPA : NaN;
  return isFinite(rKg) && isFinite(rKpa) && rKg >= 0;
}

function putText(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(TEXT_BUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, TEXT_BUF, n);
}

function emit(id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, cls: string, why: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  putText(7, cls);
  putText(8, why);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nr = max<i32>(host_record_count(0), 0);
  let na = max<i32>(host_record_count(1), 0);
  if (!kindsMatch(0, 0x2990, 7) || !kindsMatch(1, 0x694, 6)) {
    let idOk = host_field_kind(1, 0) == 0;
    for (let a = 0; a < na; a++) emit(idOk ? host_record_field_i64(1, a, 0) : -1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input field absent or wrong kind");
    return na;
  }
  let cap = 16;
  while (cap < na * 2) cap <<= 1;
  if (keys.length < cap) {
    keys = new StaticArray<i64>(cap);
    used = new StaticArray<bool>(cap);
    bestIdx = new StaticArray<i32>(cap);
  }
  mask = cap - 1;
  for (let i = 0; i < cap; i++) used[i] = false;
  for (let a = 0; a < na; a++) {
    let id = host_record_field_i64(1, a, 0);
    let h = slotOf(id);
    if (!used[h]) { used[h] = true; keys[h] = id; bestIdx[h] = -1; }
  }
  for (let r = 0; r < nr; r++) {
    let h = slotOf(host_record_field_i64(0, r, 0));
    if (!used[h]) continue;
    let b = bestIdx[h];
    if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) bestIdx[h] = r;
  }
  for (let a = 0; a < na; a++) {
    let id = host_record_field_i64(1, a, 0);
    let rkg = host_record_field_f64(1, a, 1);
    let rkpa = host_record_field_f64(1, a, 2);
    let pct = host_record_field_f64(1, a, 5);
    let r = bestIdx[slotOf(id)];
    let good = isFinite(rkg) && isFinite(rkpa) && isFinite(pct) && rkg >= 0;
    let ts: i64 = -1;
    rKg = NaN;
    rKpa = NaN;
    if (r >= 0) { ts = host_record_field_i64(0, r, 1); good = readReading(r) && good; }
    let tol = Math.max(abs_tol_kg, pct / 100.0 * rkg);
    let d = rKg - rkg;
    let ptol = rel_tol * Math.abs(rkpa);
    let cls = "OK", why = "within tolerance";
    if (!good) { cls = "MALFORMED"; why = BAD_READING; }
    else if (r < 0) { cls = "NO_READING"; why = "no reading for asset"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; why = "newest reading older than max_age_days"; }
    else if (-d > tol) { cls = "UNDERCHARGE"; why = "charge below rated beyond tolerance"; }
    else if (d > tol) { cls = "OVERCHARGE"; why = "charge above rated beyond tolerance"; }
    else if (rKpa - rkpa > ptol) { cls = "PRESSURE_HIGH"; why = "pressure above rated beyond rel_tol"; }
    else if (rkpa - rKpa > ptol) { cls = "PRESSURE_LOW"; why = "pressure below rated beyond rel_tol"; }
    emit(id, ts, rKg, rkg, rKpa, rkpa, cls, why);
  }
  let orphans = 0;
  for (let r = 0; r < nr; r++) {
    let id = host_record_field_i64(0, r, 0);
    if (used[slotOf(id)]) continue;
    let good = readReading(r);
    emit(id, host_record_field_i64(0, r, 1), rKg, NaN, rKpa, NaN, good ? "ORPHAN_READING" : "MALFORMED", good ? "asset_id not in register" : BAD_READING);
    orphans++;
  }
  return na + orphans;
}
