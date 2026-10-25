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

// Open-addressing index on asset_id: 65536 slots, about 16 pages total.
const SLOTS: i32 = 65536;
const MASK: i32 = SLOTS - 1;
const keys = new StaticArray<i64>(SLOTS);
const used = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(SLOTS);
const BUF = memory.data(32);
const TXT = memory.data(96);

function slotOf(id: i64, insert: bool): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 48) & MASK;
  for (let p = 0; p < SLOTS; p++) {
    if (unchecked(used[h]) == 0) {
      if (!insert) return -1;
      unchecked(used[h] = 1);
      unchecked(keys[h] = id);
      unchecked(best[h] = -1);
      return h;
    }
    if (unchecked(keys[h]) == id) return h;
    h = (h + 1) & MASK;
  }
  return -1;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function matchCI(s: i32, e: i32, t: string): bool {
  if (e - s != t.length) return false;
  for (let k = 0; k < t.length; k++) {
    let c = <i32>load<u8>(BUF + <usize>(s + k));
    if (c >= 65 && c <= 90) c += 32;
    if (c != t.charCodeAt(k)) return false;
  }
  return true;
}

function unitIdx(i: i32, f: i32, a: string, b: string, c: string): i32 {
  let n = host_record_field_str(0, i, f, BUF, 32);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(BUF + <usize>s))) s++;
  while (e > s && isWs(load<u8>(BUF + <usize>(e - 1)))) e--;
  if (matchCI(s, e, a)) return 0;
  if (matchCI(s, e, b)) return 1;
  if (c.length > 0 && matchCI(s, e, c)) return 2;
  return -1;
}

function readCharge(i: i32): f64 {
  let u = unitIdx(i, 3, "kg", "lb", "");
  let m = host_record_field_f64(0, i, 2);
  if (u < 0 || !isFinite(m) || m < 0) return NaN;
  return u == 1 ? m * 0.45359237 : m;
}

function readPressure(i: i32): f64 {
  let u = unitIdx(i, 5, "kpa", "bar", "psi");
  let p = host_record_field_f64(0, i, 4);
  if (u < 0 || !isFinite(p)) return NaN;
  return u == 0 ? p : u == 1 ? p * 100.0 : p * 6.894757293168;
}

function putAscii(s: string, dst: usize): i32 {
  let n = s.length < 80 ? s.length : 80;
  for (let k = 0; k < n; k++) store<u8>(dst + <usize>k, <u8>s.charCodeAt(k));
  return n;
}

function emit(id: i64, ts: i64, ckg: f64, rkg: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ckg);
  out_set_f64(3, rkg);
  out_set_f64(4, ckg - rkg);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  out_set_str(7, TXT, putAscii(cls, TXT));
  out_set_str(8, TXT, putAscii(det, TXT));
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nr = host_record_count(0);
  let na = host_record_count(1);
  let ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1
    && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  let ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1
    && host_field_kind(1, 5) == 1;
  let hasId1 = host_field_kind(1, 0) == 0;
  for (let h = 0; h < SLOTS; h++) unchecked(used[h] = 0);
  if (ok1) for (let a = 0; a < na; a++) slotOf(host_record_field_i64(1, a, 0), true);
  if (ok0) for (let i = 0; i < nr; i++) {
    let h = slotOf(host_record_field_i64(0, i, 0), false);
    if (h < 0) continue;
    let b = unchecked(best[h]);
    if (b < 0 || host_record_field_i64(0, i, 1) > host_record_field_i64(0, b, 1)) unchecked(best[h] = i);
  }
  let count = 0;
  for (let a = 0; a < na; a++) {
    let id: i64 = hasId1 ? host_record_field_i64(1, a, 0) : -1;
    let rkg = ok1 ? host_record_field_f64(1, a, 1) : NaN;
    let rp = ok1 ? host_record_field_f64(1, a, 2) : NaN;
    let tp = ok1 ? host_record_field_f64(1, a, 5) : NaN;
    count++;
    if (!ok1 || !ok0 || !isFinite(rkg) || !isFinite(rp) || !isFinite(tp) || rkg < 0) {
      emit(id, -1, NaN, rkg, NaN, rp, "MALFORMED", "absent field or invalid register value");
      continue;
    }
    let r = unchecked(best[slotOf(id, false)]);
    if (r < 0) {
      emit(id, -1, NaN, rkg, NaN, rp, "NO_READING", "no reading for asset");
      continue;
    }
    let ts = host_record_field_i64(0, r, 1);
    let ckg = readCharge(r);
    let pk = readPressure(r);
    let tol = Math.max(abs_tol_kg, tp / 100.0 * rkg);
    let d = ckg - rkg;
    let cls = "OK";
    let det = "within tolerance";
    if (isNaN(ckg) || isNaN(pk)) { cls = "MALFORMED"; det = "unknown unit, negative mass, or non-finite value"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
    else if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (pk - rp > rel_tol * rp) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
    else if (rp - pk > rel_tol * rp) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    emit(id, ts, ckg, rkg, pk, rp, cls, det);
  }
  if (ok0) for (let i = 0; i < nr; i++) {
    let id = host_record_field_i64(0, i, 0);
    if (slotOf(id, false) >= 0) continue;
    let ckg = readCharge(i);
    let pk = readPressure(i);
    let bad = isNaN(ckg) || isNaN(pk);
    emit(id, host_record_field_i64(0, i, 1), ckg, NaN, pk, NaN, bad ? "MALFORMED" : "ORPHAN_READING",
      bad ? "unknown unit, negative mass, or non-finite value" : "reading has no asset in register");
    count++;
  }
  return count;
}
