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

const SLOTS: i32 = 32768;
const CAP: i32 = 16384;
const KEYS: usize = memory.data(SLOTS * 8, 8);
const VALS: usize = memory.data(SLOTS * 4, 4);
const BEST: usize = memory.data(CAP * 4, 4);
const BTS: usize = memory.data(CAP * 8, 8);
const BUF: usize = memory.data(128, 8);

let gTs: i64 = -1;
let gCk: f64 = NaN;
let gPk: f64 = NaN;

function slotOf(k: i64): i32 {
  let i = <i32>((<u32>(k ^ (k >>> 32)) * <u32>0x9E3779B1) >>> 17);
  for (let n = 0; n < SLOTS; n++) {
    if (load<i32>(VALS + (<usize>i << 2)) == 0 || load<i64>(KEYS + (<usize>i << 3)) == k) return i;
    i = (i + 1) & (SLOTS - 1);
  }
  return -1;
}

function lookup(k: i64): i32 {
  let s = slotOf(k);
  return s < 0 ? -1 : load<i32>(VALS + (<usize>s << 2)) - 1;
}

function isWs(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitFactor(idx: i32, field: i32): f64 {
  let n = host_record_field_str(0, idx, field, BUF, 16);
  if (n < 0) return NaN;
  let a = 0;
  let b = n;
  while (a < b && isWs(<u32>load<u8>(BUF + <usize>a))) a++;
  while (b > a && isWs(<u32>load<u8>(BUF + <usize>(b - 1)))) b--;
  if (b - a > 3) return NaN;
  let w: u32 = 0;
  for (let i = a; i < b; i++) w = (w << 8) | (<u32>load<u8>(BUF + <usize>i) | 0x20);
  if (field == 3) return w == 0x6B67 ? 1.0 : w == 0x6C62 ? 0.45359237 : NaN;
  return w == 0x6B7061 ? 1.0 : w == 0x626172 ? 100.0 : w == 0x707369 ? 6.894757293168 : NaN;
}

function checkReading(r: i32): string {
  gTs = host_record_field_i64(0, r, 1);
  let m = host_record_field_f64(0, r, 2);
  let p = host_record_field_f64(0, r, 4);
  let mf = unitFactor(r, 3);
  let pf = unitFactor(r, 5);
  gCk = m * mf;
  gPk = p * pf;
  if (isNaN(mf)) return "unknown charge unit";
  if (isNaN(pf)) return "unknown pressure unit";
  if (!isFinite(m) || !isFinite(p)) return "non-finite reading value";
  if (m < 0) return "negative charge mass";
  return "";
}

function putStr(field: i32, s: string): void {
  let n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(BUF + 32 + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, BUF + 32, n);
}

function emit(aid: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rc);
  out_set_f64(4, ck - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let n0 = host_record_count(0);
  let n1 = host_record_count(1);
  if (n0 < 0) n0 = 0;
  if (n1 < 0) n1 = 0;
  let ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1
    && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  let ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1
    && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  if (!ok1) {
    emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "asset register schema invalid");
    return 1;
  }
  memory.fill(VALS, 0, <usize>SLOTS << 2);
  // open-addressing index on asset_id keeps the join O(n + m)
  for (let i = 0; i < n1 && i < CAP; i++) {
    let k = host_record_field_i64(1, i, 0);
    let s = slotOf(k);
    if (s >= 0 && load<i32>(VALS + (<usize>s << 2)) == 0) {
      store<i64>(KEYS + (<usize>s << 3), k);
      store<i32>(VALS + (<usize>s << 2), i + 1);
    }
    store<i32>(BEST + (<usize>i << 2), -1);
  }
  if (ok0) {
    for (let r = 0; r < n0; r++) {
      let a = lookup(host_record_field_i64(0, r, 0));
      if (a < 0) continue;
      let ts = host_record_field_i64(0, r, 1);
      if (load<i32>(BEST + (<usize>a << 2)) < 0 || ts > load<i64>(BTS + (<usize>a << 3))) {
        store<i32>(BEST + (<usize>a << 2), r);
        store<i64>(BTS + (<usize>a << 3), ts);
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n1; i++) {
    let aid = host_record_field_i64(1, i, 0);
    let rc = host_record_field_f64(1, i, 1);
    let rp = host_record_field_f64(1, i, 2);
    let tp = host_record_field_f64(1, i, 5);
    count++;
    if (i >= CAP) { emit(aid, -1, NaN, rc, NaN, rp, "MALFORMED", "asset capacity exceeded"); continue; }
    if (!isFinite(rc) || !isFinite(rp) || !isFinite(tp) || rc < 0) {
      emit(aid, -1, NaN, rc, NaN, rp, "MALFORMED", "asset register value invalid");
      continue;
    }
    if (!ok0) { emit(aid, -1, NaN, rc, NaN, rp, "MALFORMED", "reading log schema invalid"); continue; }
    let a = lookup(aid);
    let r = a < 0 ? -1 : load<i32>(BEST + (<usize>a << 2));
    if (r < 0) { emit(aid, -1, NaN, rc, NaN, rp, "NO_READING", "no reading for asset"); continue; }
    let det = checkReading(r);
    let ck = gCk;
    let pk = gPk;
    let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
    let ptol = rel_tol * Math.abs(rp);
    if (det.length > 0) emit(aid, gTs, ck, rc, pk, rp, "MALFORMED", det);
    else if (as_of_ts - gTs > max_age_days * 86400) emit(aid, gTs, ck, rc, pk, rp, "STALE", "newest reading older than max age");
    else if (rc - ck > tol) emit(aid, gTs, ck, rc, pk, rp, "UNDERCHARGE", "charge below rated beyond tolerance");
    else if (ck - rc > tol) emit(aid, gTs, ck, rc, pk, rp, "OVERCHARGE", "charge above rated beyond tolerance");
    else if (pk - rp > ptol) emit(aid, gTs, ck, rc, pk, rp, "PRESSURE_HIGH", "pressure above rated beyond rel_tol");
    else if (rp - pk > ptol) emit(aid, gTs, ck, rc, pk, rp, "PRESSURE_LOW", "pressure below rated beyond rel_tol");
    else emit(aid, gTs, ck, rc, pk, rp, "OK", "within tolerance");
  }
  if (!ok0) return count;
  for (let r = 0; r < n0; r++) {
    let k = host_record_field_i64(0, r, 0);
    if (lookup(k) >= 0) continue;
    let det = checkReading(r);
    if (det.length > 0) emit(k, gTs, gCk, NaN, gPk, NaN, "MALFORMED", det);
    else emit(k, gTs, gCk, NaN, gPk, NaN, "ORPHAN_READING", "reading has no registered asset");
    count++;
  }
  return count;
}
