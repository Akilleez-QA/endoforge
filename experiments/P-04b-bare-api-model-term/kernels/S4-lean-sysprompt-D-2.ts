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

const SCRATCH: usize = memory.data(64);
const LOG_KINDS: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const ASSET_KINDS: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const C_MALFORMED: i32 = 0;
const C_NO_READING: i32 = 1;
const C_STALE: i32 = 2;
const C_UNDER: i32 = 3;
const C_OVER: i32 = 4;
const C_PHIGH: i32 = 5;
const C_PLOW: i32 = 6;
const C_ORPHAN: i32 = 7;
const C_OK: i32 = 8;
const CLASS: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("MALFORMED"), String.UTF8.encode("NO_READING"), String.UTF8.encode("STALE"),
  String.UTF8.encode("UNDERCHARGE"), String.UTF8.encode("OVERCHARGE"), String.UTF8.encode("PRESSURE_HIGH"),
  String.UTF8.encode("PRESSURE_LOW"), String.UTF8.encode("ORPHAN_READING"), String.UTF8.encode("OK")
];
const DETAIL: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("unknown unit, negative mass, non-finite or absent field"),
  String.UTF8.encode("no reading found for asset"),
  String.UTF8.encode("newest reading older than max_age_days"),
  String.UTF8.encode("charge below rated beyond tolerance"),
  String.UTF8.encode("charge above rated beyond tolerance"),
  String.UTF8.encode("pressure above rated beyond rel_tol"),
  String.UTF8.encode("pressure below rated beyond rel_tol"),
  String.UTF8.encode("reading asset_id not in asset register"),
  String.UTF8.encode("within tolerance")
];

let keys = new StaticArray<i64>(0);
let slots = new StaticArray<i32>(0);
let best = new StaticArray<i32>(0);
let bestTs = new StaticArray<i64>(0);
let bits: i32 = 4;
let gTs: i64 = -1;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gBad: bool = false;
let emitted: i32 = 0;

function isSpace(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, idx, field, SCRATCH, 64);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isSpace(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isSpace(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  let len = e - s;
  if (len < 2 || len > 3) return NaN;
  let code: u32 = 0;
  for (let i = s; i < e; i++) code = (code << 8) | (<u32>load<u8>(SCRATCH + <usize>i) | 0x20);
  if (mass) {
    if (len == 2 && code == 0x6B67) return 1.0;
    if (len == 2 && code == 0x6C62) return 0.45359237;
    return NaN;
  }
  if (len == 3 && code == 0x6B7061) return 1.0;
  if (len == 3 && code == 0x626172) return 100.0;
  if (len == 3 && code == 0x707369) return 6.894757293168;
  return NaN;
}

function find(key: i64): i32 {
  let mask = slots.length - 1;
  let h = <i32>((<u64>key * 0x9E3779B97F4A7C15) >> <u64>(64 - bits)) & mask;
  while (slots[h] != 0 && keys[h] != key) h = (h + 1) & mask;
  return h;
}

function readReading(r: i32): void {
  gTs = host_record_field_i64(0, r, 1);
  let m = host_record_field_f64(0, r, 2);
  let p = host_record_field_f64(0, r, 4);
  let fm = unitFactor(r, 3, true);
  let fp = unitFactor(r, 5, false);
  gKg = m * fm;
  gKpa = p * fp;
  gBad = !isFinite<f64>(m) || m < 0 || !isFinite<f64>(p) || isNaN<f64>(fm) || isNaN<f64>(fp);
}

function outside(a: f64, b: f64, rel: f64): bool {
  return !(abs<f64>(a - b) <= rel * max<f64>(abs<f64>(a), abs<f64>(b)));
}

function emit(aid: i64, ts: i64, ckg: f64, rc: f64, pk: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ckg);
  out_set_f64(3, rc);
  out_set_f64(4, ckg - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  let c = CLASS[cls];
  let d = DETAIL[cls];
  out_set_str(7, changetype<usize>(c), c.byteLength);
  out_set_str(8, changetype<usize>(d), d.byteLength);
  out_commit();
  emitted++;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  emitted = 0;
  let nl = max<i32>(host_record_count(0), 0);
  let na = max<i32>(host_record_count(1), 0);
  let schemaOk = true;
  for (let f = 0; f < 7; f++) if (host_field_kind(0, f) != LOG_KINDS[f]) schemaOk = false;
  for (let f = 0; f < 6; f++) if (host_field_kind(1, f) != ASSET_KINDS[f]) schemaOk = false;
  if (!schemaOk) {
    emit(-1, -1, NaN, NaN, NaN, NaN, C_MALFORMED);
    return emitted;
  }
  let cap = 16;
  while (cap < na * 2) cap <<= 1;
  bits = ctz<i32>(cap);
  keys = new StaticArray<i64>(cap);
  slots = new StaticArray<i32>(cap);
  best = new StaticArray<i32>(cap);
  bestTs = new StaticArray<i64>(cap);
  // open-addressing index on asset_id avoids the O(n*m) nested-loop join
  for (let i = 0; i < na; i++) {
    let aid = host_record_field_i64(1, i, 0);
    let h = find(aid);
    if (slots[h] == 0) { slots[h] = i + 1; keys[h] = aid; }
  }
  for (let j = 0; j < nl; j++) {
    let h = find(host_record_field_i64(0, j, 0));
    if (slots[h] == 0) continue;
    let ts = host_record_field_i64(0, j, 1);
    if (best[h] == 0 || ts > bestTs[h]) { best[h] = j + 1; bestTs[h] = ts; }
  }
  for (let i = 0; i < na; i++) {
    let aid = host_record_field_i64(1, i, 0);
    let rc = host_record_field_f64(1, i, 1);
    let rp = host_record_field_f64(1, i, 2);
    let tp = host_record_field_f64(1, i, 5);
    let b = best[find(aid)];
    let assetBad = !isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0;
    gTs = -1; gKg = NaN; gKpa = NaN; gBad = false;
    if (b != 0) readReading(b - 1);
    let tol = max<f64>(abs_tol_kg, tp / 100.0 * rc);
    let delta = gKg - rc;
    let cls = C_OK;
    if (assetBad || gBad) cls = C_MALFORMED;
    else if (b == 0) cls = C_NO_READING;
    else if (as_of_ts - gTs > max_age_days * 86400) cls = C_STALE;
    else if (delta < -tol) cls = C_UNDER;
    else if (delta > tol) cls = C_OVER;
    else if (gKpa > rp && outside(gKpa, rp, rel_tol)) cls = C_PHIGH;
    else if (gKpa < rp && outside(gKpa, rp, rel_tol)) cls = C_PLOW;
    emit(aid, gTs, gKg, rc, gKpa, rp, cls);
  }
  for (let j = 0; j < nl; j++) {
    let aid = host_record_field_i64(0, j, 0);
    if (slots[find(aid)] != 0) continue;
    readReading(j);
    emit(aid, gTs, gKg, NaN, gKpa, NaN, gBad ? C_MALFORMED : C_ORPHAN);
  }
  return emitted;
}
