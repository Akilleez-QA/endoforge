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

const SLOTS: i32 = 65536;
const MASK: i32 = SLOTS - 1;
const keys = new StaticArray<i64>(SLOTS);
const vals = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(SLOTS);
const SCR: usize = memory.data(64);
const OUT: usize = memory.data(128);

function slotOf(id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 48) & MASK;
  while (vals[h] != 0 && keys[h] != id) h = (h + 1) & MASK;
  return h;
}

function matches(start: i32, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(SCR + <usize>(start + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

// Returns the 0-based index of the matching unit literal, or -1.
function unitCode(idx: i32, field: i32, a: string, b: string, c: string): i32 {
  let n = host_record_field_str(0, idx, field, SCR, 64);
  if (n < 0) return -1;
  let s = 0;
  while (s < n && load<u8>(SCR + <usize>s) <= 32) s++;
  while (n > s && load<u8>(SCR + <usize>(n - 1)) <= 32) n--;
  if (matches(s, n - s, a)) return 0;
  if (matches(s, n - s, b)) return 1;
  if (c.length > 0 && matches(s, n - s, c)) return 2;
  return -1;
}

function putStr(field: i32, s: string): void {
  let n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(OUT + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OUT, n);
}

function emit(aid: i64, ts: i64, ck: f64, rck: f64, pk: f64, rpk: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rck);
  out_set_f64(4, ck - rck);
  out_set_f64(5, pk);
  out_set_f64(6, rpk);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
}

function readingKg(r: i32): f64 {
  let u = unitCode(r, 3, "kg", "lb", "");
  let m = host_record_field_f64(0, r, 2);
  if (u < 0 || m < 0 || !isFinite(m)) return NaN;
  return u == 1 ? m * 0.45359237 : m;
}

function readingKpa(r: i32): f64 {
  let u = unitCode(r, 5, "kpa", "bar", "psi");
  let p = host_record_field_f64(0, r, 4);
  if (u < 0 || !isFinite(p)) return NaN;
  return u == 0 ? p : (u == 1 ? p * 100.0 : p * 6.894757293168);
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let schemaOk = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 &&
    host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2 &&
    host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  let na = min(host_record_count(1), SLOTS >> 1);
  let nr = host_record_count(0);
  for (let i = 0; i < SLOTS; i++) { vals[i] = 0; best[i] = 0; }
  for (let a = 0; a < na; a++) {
    let h = slotOf(host_record_field_i64(1, a, 0));
    if (vals[h] == 0) { keys[h] = host_record_field_i64(1, a, 0); vals[h] = a + 1; }
  }
  for (let r = 0; r < nr; r++) {
    let h = slotOf(host_record_field_i64(0, r, 0));
    if (vals[h] == 0) continue;
    let b = best[vals[h] - 1];
    if (b == 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b - 1, 1)) best[vals[h] - 1] = r + 1;
  }
  let count = 0;
  for (let a = 0; a < na; a++) {
    let aid = host_record_field_i64(1, a, 0);
    let rck = host_record_field_f64(1, a, 1);
    let rpk = host_record_field_f64(1, a, 2);
    let tp = host_record_field_f64(1, a, 5);
    let b = best[vals[slotOf(aid)] - 1] - 1;
    count++;
    if (!schemaOk || !isFinite(rck) || !isFinite(rpk) || !isFinite(tp) || rck < 0) {
      emit(aid, -1, NaN, rck, NaN, rpk, "MALFORMED", "asset register field invalid or absent");
      continue;
    }
    if (b < 0) { emit(aid, -1, NaN, rck, NaN, rpk, "NO_READING", "no reading for asset"); continue; }
    let ts = host_record_field_i64(0, b, 1);
    let ck = readingKg(b);
    let pk = readingKpa(b);
    if (isNaN(ck) || isNaN(pk)) { emit(aid, ts, ck, rck, pk, rpk, "MALFORMED", "bad unit, negative mass, or non-finite value"); continue; }
    if (as_of_ts - ts > max_age_days * 86400) { emit(aid, ts, ck, rck, pk, rpk, "STALE", "newest reading older than max_age_days"); continue; }
    let tol = max(abs_tol_kg, tp / 100.0 * rck);
    let d = ck - rck;
    if (d < -tol) emit(aid, ts, ck, rck, pk, rpk, "UNDERCHARGE", "charge below rated beyond tolerance");
    else if (d > tol) emit(aid, ts, ck, rck, pk, rpk, "OVERCHARGE", "charge above rated beyond tolerance");
    else if (pk - rpk > rel_tol * Math.abs(rpk)) emit(aid, ts, ck, rck, pk, rpk, "PRESSURE_HIGH", "pressure above rated beyond rel_tol");
    else if (rpk - pk > rel_tol * Math.abs(rpk)) emit(aid, ts, ck, rck, pk, rpk, "PRESSURE_LOW", "pressure below rated beyond rel_tol");
    else emit(aid, ts, ck, rck, pk, rpk, "OK", "within tolerance");
  }
  for (let r = 0; r < nr; r++) {
    let aid = host_record_field_i64(0, r, 0);
    if (vals[slotOf(aid)] != 0) continue;
    let ts = host_record_field_i64(0, r, 1);
    let ck = readingKg(r);
    let pk = readingKpa(r);
    count++;
    if (!schemaOk || isNaN(ck) || isNaN(pk)) emit(aid, ts, ck, NaN, pk, NaN, "MALFORMED", "orphan reading with invalid field");
    else emit(aid, ts, ck, NaN, pk, NaN, "ORPHAN_READING", "asset_id not in asset register");
  }
  return count;
}
