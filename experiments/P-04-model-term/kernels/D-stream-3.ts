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

const READ: u32 = 0;
const REG: u32 = 1;
const UBUF: usize = memory.data(64);
const SBUF: usize = memory.data(256);
const LB_KG: f64 = 0.45359237;
const BAR_KPA: f64 = 100.0;
const PSI_KPA: f64 = 6.894757293168;

let gCount: i32 = 0;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gWhy: string = "";
let s0ok: bool = false;

function isSpace(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function matches(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let ch = <u32>load<u8>(UBUF + <usize>(s + i));
    if (ch >= 65 && ch <= 90) ch += 32;
    if (ch != <u32>lit.charCodeAt(i)) return false;
  }
  return true;
}

// Returns index of the matching lowercase unit literal, or -1.
function unitCode(idx: i32, field: i32, a: string, b: string, c: string, count: i32): i32 {
  const n = host_record_field_str(READ, idx, field, UBUF, 64);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isSpace(<u32>load<u8>(UBUF + <usize>s))) s++;
  while (e > s && isSpace(<u32>load<u8>(UBUF + <usize>(e - 1)))) e--;
  if (matches(s, e, a)) return 0;
  if (matches(s, e, b)) return 1;
  if (count > 2 && matches(s, e, c)) return 2;
  return -1;
}

function putStr(field: i32, s: string): void {
  const n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(SBUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SBUF, n);
}

function emit(id: i64, ts: i64, kg: f64, rated: f64, kpa: f64, rp: f64, cls: string, why: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rated);
  out_set_f64(4, kg - rated);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, why);
  out_commit();
  gCount++;
}

function readReading(r: i32): bool {
  gKg = NaN;
  gKpa = NaN;
  if (!s0ok) { gWhy = "reading field absent"; return false; }
  const m = host_record_field_f64(READ, r, 2);
  const p = host_record_field_f64(READ, r, 4);
  const cu = unitCode(r, 3, "kg", "lb", "", 2);
  const pu = unitCode(r, 5, "kpa", "bar", "psi", 3);
  if (cu < 0 || pu < 0) { gWhy = "unknown unit"; return false; }
  if (!isFinite(m) || !isFinite(p)) { gWhy = "non-finite value"; return false; }
  if (m < 0) { gWhy = "negative mass"; return false; }
  gKg = cu == 1 ? m * LB_KG : m;
  gKpa = pu == 0 ? p : (pu == 1 ? p * BAR_KPA : p * PSI_KPA);
  return true;
}

function hashOf(id: i64, mask: i32): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 32) & mask;
}

function find(keys: StaticArray<i64>, slot: StaticArray<i32>, mask: i32, id: i64): i32 {
  let h = hashOf(id, mask);
  while (slot[h] >= 0) {
    if (keys[h] == id) return slot[h];
    h = (h + 1) & mask;
  }
  return -1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gCount = 0;
  const id0ok = host_field_kind(READ, 0) == 0 && host_field_kind(READ, 1) == 0;
  s0ok = id0ok && host_field_kind(READ, 2) == 1 && host_field_kind(READ, 3) == 2 && host_field_kind(READ, 4) == 1 && host_field_kind(READ, 5) == 2;
  const s1ok = host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1 && host_field_kind(REG, 2) == 1 && host_field_kind(REG, 5) == 1;
  let nr = host_record_count(READ);
  let na = host_record_count(REG);
  if (nr < 0) nr = 0;
  if (na < 0 || host_field_kind(REG, 0) != 0) na = 0;
  let cap = 16;
  while (cap < na * 2) cap <<= 1;
  const mask = cap - 1;
  // Open-addressing index on asset_id avoids the O(n*m) join.
  const keys = new StaticArray<i64>(cap);
  const slot = new StaticArray<i32>(cap);
  for (let i = 0; i < cap; i++) slot[i] = -1;
  const sz = na > 0 ? na : 1;
  const best = new StaticArray<i32>(sz);
  const bestTs = new StaticArray<i64>(sz);
  for (let a = 0; a < na; a++) {
    best[a] = -1;
    const id = host_record_field_i64(REG, a, 0);
    let h = hashOf(id, mask);
    while (slot[h] >= 0 && keys[h] != id) h = (h + 1) & mask;
    if (slot[h] < 0) { slot[h] = a; keys[h] = id; }
  }
  if (id0ok) {
    for (let r = 0; r < nr; r++) {
      const a = find(keys, slot, mask, host_record_field_i64(READ, r, 0));
      const ts = host_record_field_i64(READ, r, 1);
      if (a >= 0 && (best[a] < 0 || ts > bestTs[a])) { best[a] = r; bestTs[a] = ts; }
    }
  }
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const b = best[a];
    const ts: i64 = b >= 0 ? bestTs[a] : -1;
    const rated = s1ok ? host_record_field_f64(REG, a, 1) : NaN;
    const rp = s1ok ? host_record_field_f64(REG, a, 2) : NaN;
    const tp = s1ok ? host_record_field_f64(REG, a, 5) : NaN;
    if (!isFinite(rated) || !isFinite(rp) || !isFinite(tp) || rated < 0) { emit(id, ts, NaN, rated, NaN, rp, "MALFORMED", "asset register invalid"); continue; }
    if (b < 0) { emit(id, -1, NaN, rated, NaN, rp, "NO_READING", "no reading for asset"); continue; }
    if (!readReading(b)) { emit(id, ts, NaN, rated, NaN, rp, "MALFORMED", gWhy); continue; }
    const kg = gKg;
    const kpa = gKpa;
    const tol = Math.max(abs_tol_kg, tp / 100.0 * rated);
    const d = kg - rated;
    const pt = rel_tol * Math.max(Math.abs(kpa), Math.abs(rp));
    if (as_of_ts - ts > max_age_days * 86400) emit(id, ts, kg, rated, kpa, rp, "STALE", "newest reading too old");
    else if (d < -tol) emit(id, ts, kg, rated, kpa, rp, "UNDERCHARGE", "charge below rated tolerance");
    else if (d > tol) emit(id, ts, kg, rated, kpa, rp, "OVERCHARGE", "charge above rated tolerance");
    else if (kpa - rp > pt) emit(id, ts, kg, rated, kpa, rp, "PRESSURE_HIGH", "pressure above rated tolerance");
    else if (rp - kpa > pt) emit(id, ts, kg, rated, kpa, rp, "PRESSURE_LOW", "pressure below rated tolerance");
    else emit(id, ts, kg, rated, kpa, rp, "OK", "within tolerance");
  }
  for (let r = 0; r < nr; r++) {
    if (!id0ok) { emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "reading key field absent"); continue; }
    const id = host_record_field_i64(READ, r, 0);
    if (find(keys, slot, mask, id) >= 0) continue;
    const ts = host_record_field_i64(READ, r, 1);
    if (readReading(r)) emit(id, ts, gKg, NaN, gKpa, NaN, "ORPHAN_READING", "no register entry");
    else emit(id, ts, NaN, NaN, NaN, NaN, "MALFORMED", gWhy);
  }
  return gCount;
}
