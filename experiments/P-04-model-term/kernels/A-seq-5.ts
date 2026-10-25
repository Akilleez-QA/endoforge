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

const SCR: usize = memory.data(256);
const UNIT: usize = memory.data(64);
let keys: usize = 0;
let vals: usize = 0;
let best: usize = 0;
let mask: u64 = 0;

function put(s: string, dst: usize): i32 {
  let n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(dst + <usize>i, <u8>s.charCodeAt(i));
  return n;
}

function isWs(c: i32): bool { return c == 32 || (c >= 9 && c <= 13); }

function unitIs(n: i32, lit: string): bool {
  if (n < 0) return false;
  let s = 0, e = n;
  while (s < e && isWs(load<u8>(UNIT + <usize>s))) s++;
  while (e > s && isWs(load<u8>(UNIT + <usize>(e - 1)))) e--;
  if (e - s != lit.length) return false;
  for (let i = 0; i < e - s; i++) {
    let c = <i32>load<u8>(UNIT + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function chargeKg(r: i32): f64 {
  let m = host_record_field_f64(0, r, 2);
  let n = host_record_field_str(0, r, 3, UNIT, 64);
  if (!isFinite(m) || m < 0) return NaN;
  if (unitIs(n, "kg")) return m;
  return unitIs(n, "lb") ? m * 0.45359237 : NaN;
}

function pressKpa(r: i32): f64 {
  let p = host_record_field_f64(0, r, 4);
  let n = host_record_field_str(0, r, 5, UNIT, 64);
  if (!isFinite(p)) return NaN;
  if (unitIs(n, "kpa")) return p;
  if (unitIs(n, "bar")) return p * 100.0;
  return unitIs(n, "psi") ? p * 6.894757293168 : NaN;
}

function slot(id: i64): u64 { return ((<u64>id * 0x9E3779B97F4A7C15) >> 32) & mask; }

function find(id: i64): i32 {
  let s = slot(id);
  while (true) {
    let v = load<i32>(vals + <usize>(s << 2));
    if (v < 0 || load<i64>(keys + <usize>(s << 3)) == id) return v;
    s = (s + 1) & mask;
  }
  return -1;
}

function emit(id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id); out_set_i64(1, ts); out_set_f64(2, kg); out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg); out_set_f64(5, kpa); out_set_f64(6, rkpa);
  out_set_str(7, SCR, put(cls, SCR));
  out_set_str(8, SCR + 128, put(det, SCR + 128));
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let logOk = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  let regOk = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  if (!logOk || !regOk) { emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input schema field absent or wrong kind"); return 1; }
  let nA = host_record_count(1), nR = host_record_count(0), out = 0;
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  mask = <u64>(cap - 1);
  keys = (__heap_base + 7) & ~<usize>7;
  vals = keys + <usize>cap * 8;
  best = vals + <usize>cap * 4;
  let end = best + <usize>nA * 4;
  let need = <i32>((end + 0xFFFF) >> 16) - memory.size();
  if (need > 0 && memory.grow(need) < 0) { emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input exceeds memory bound"); return 1; }
  memory.fill(vals, 0xFF, <usize>cap * 4);
  memory.fill(best, 0xFF, <usize>nA * 4);
  // open-addressing index on asset_id; duplicate register ids share the first row's readings
  for (let i = 0; i < nA; i++) {
    let id = host_record_field_i64(1, i, 0), s = slot(id);
    while (true) {
      let v = load<i32>(vals + <usize>(s << 2));
      if (v < 0) { store<i64>(keys + <usize>(s << 3), id); store<i32>(vals + <usize>(s << 2), i); break; }
      if (load<i64>(keys + <usize>(s << 3)) == id) break;
      s = (s + 1) & mask;
    }
  }
  for (let r = 0; r < nR; r++) {
    let a = find(host_record_field_i64(0, r, 0));
    if (a < 0) continue;
    let b = load<i32>(best + <usize>(a << 2));
    if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) store<i32>(best + <usize>(a << 2), r);
  }
  for (let i = 0; i < nA; i++) {
    let id = host_record_field_i64(1, i, 0);
    let rkg = host_record_field_f64(1, i, 1), rkpa = host_record_field_f64(1, i, 2), pct = host_record_field_f64(1, i, 5);
    let r = load<i32>(best + <usize>(find(id) << 2));
    let ts: i64 = -1, kg = NaN, kpa = NaN;
    if (r >= 0) { ts = host_record_field_i64(0, r, 1); kg = chargeKg(r); kpa = pressKpa(r); }
    let cls = "OK", det = "within tolerance";
    let tol = Math.max(abs_tol_kg, pct / 100.0 * rkg), d = kg - rkg, dp = Math.abs(kpa - rkpa);
    if (!isFinite(rkg) || !isFinite(rkpa) || !isFinite(pct) || rkg < 0 || (r >= 0 && (isNaN(kg) || isNaN(kpa)))) { cls = "MALFORMED"; det = "bad unit, negative mass, or non-finite value"; }
    else if (r < 0) { cls = "NO_READING"; det = "no reading for asset"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max age"; }
    else if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (kpa > rkpa && dp > rel_tol * Math.max(Math.abs(kpa), Math.abs(rkpa))) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
    else if (kpa < rkpa && dp > rel_tol * Math.max(Math.abs(kpa), Math.abs(rkpa))) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    emit(id, ts, kg, rkg, kpa, rkpa, cls, det);
    out++;
  }
  for (let r = 0; r < nR; r++) {
    let id = host_record_field_i64(0, r, 0);
    if (find(id) >= 0) continue;
    let kg = chargeKg(r), kpa = pressKpa(r), bad = isNaN(kg) || isNaN(kpa);
    emit(id, host_record_field_i64(0, r, 1), kg, NaN, kpa, NaN, bad ? "MALFORMED" : "ORPHAN_READING", bad ? "orphan reading with bad unit or value" : "reading has no registered asset");
    out++;
  }
  return out;
}
