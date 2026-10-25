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
const MASK: i32 = SLOTS - 1;
const MAXA: i32 = 16384;
const slots = memory.data(SLOTS * 4);
const best = memory.data(MAXA * 4);
const sbuf = memory.data(64);
const cbuf = memory.data(96);
const KG: i32 = 0x6b67;
const LB: i32 = 0x6c62;
const KPA: i32 = 0x6b7061;
const BAR: i32 = 0x626172;
const PSI: i32 = 0x707369;

let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gBad: bool = false;
let gWhy: string = "";

function hashId(id: i64): i32 {
  return <i32>((<u32>(id ^ (id >> 32)) * 2654435761) & <u32>MASK);
}

function lookup(id: i64): i32 {
  let h = hashId(id);
  while (true) {
    const v = load<i32>(slots + (<usize>h << 2));
    if (v == 0) return -1;
    if (host_record_field_i64(1, v - 1, 0) == id) return v - 1;
    h = (h + 1) & MASK;
  }
  return -1;
}

function unitCode(idx: i32, field: i32): i32 {
  const n = host_record_field_str(0, idx, field, sbuf, 64);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && (load<u8>(sbuf + s) == 32 || (load<u8>(sbuf + s) >= 9 && load<u8>(sbuf + s) <= 13))) s++;
  while (e > s && (load<u8>(sbuf + e - 1) == 32 || (load<u8>(sbuf + e - 1) >= 9 && load<u8>(sbuf + e - 1) <= 13))) e--;
  if (e - s == 0 || e - s > 4) return -1;
  let code = 0;
  for (let i = s; i < e; i++) {
    let c = <i32>load<u8>(sbuf + i);
    if (c >= 65 && c <= 90) c += 32;
    code = (code << 8) | c;
  }
  return code;
}

function readReading(j: i32, ok0: bool): void {
  gKg = NaN; gKpa = NaN; gBad = true; gWhy = "absent or mistyped reading field";
  if (!ok0) return;
  const m = host_record_field_f64(0, j, 2);
  const p = host_record_field_f64(0, j, 4);
  const mu = unitCode(j, 3);
  const pu = unitCode(j, 5);
  if (!isFinite(m) || !isFinite(p)) { gWhy = "non-finite charge or pressure"; return; }
  if (m < 0) { gWhy = "negative charge mass"; return; }
  if (mu == KG) gKg = m; else if (mu == LB) gKg = m * 0.45359237; else { gWhy = "unknown charge unit"; return; }
  if (pu == KPA) gKpa = p; else if (pu == BAR) gKpa = p * 100.0; else if (pu == PSI) gKpa = p * 6.894757293168;
  else { gKpa = NaN; gWhy = "unknown pressure unit"; return; }
  gBad = false; gWhy = "";
}

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(cbuf + i, <u8>s.charCodeAt(i));
  out_set_str(field, cbuf, n);
}

function emit(aid: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, aid); out_set_i64(1, ts); out_set_f64(2, kg); out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg); out_set_f64(5, kpa); out_set_f64(6, rkpa);
  putStr(7, cls); putStr(8, det);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  const ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  const nr = host_record_count(0);
  const na = min(host_record_count(1), MAXA);
  memory.fill(slots, 0, <usize>SLOTS * 4);
  // Open-addressing index on asset_id avoids the O(n*m) join; first duplicate asset wins.
  for (let i = 0; i < na; i++) {
    store<i32>(best + (<usize>i << 2), -1);
    if (!ok1 || !ok0) continue;
    const id = host_record_field_i64(1, i, 0);
    if (lookup(id) >= 0) continue;
    let h = hashId(id);
    while (load<i32>(slots + (<usize>h << 2)) != 0) h = (h + 1) & MASK;
    store<i32>(slots + (<usize>h << 2), i + 1);
  }
  for (let j = 0; ok0 && ok1 && j < nr; j++) {
    const a = lookup(host_record_field_i64(0, j, 0));
    if (a < 0) continue;
    const b = load<i32>(best + (<usize>a << 2));
    if (b < 0 || host_record_field_i64(0, j, 1) > host_record_field_i64(0, b, 1)) store<i32>(best + (<usize>a << 2), j);
  }
  let count = 0;
  for (let i = 0; i < na; i++) {
    const aid = ok1 ? host_record_field_i64(1, i, 0) : <i64>0;
    const rkg = ok1 ? host_record_field_f64(1, i, 1) : NaN;
    const rkpa = ok1 ? host_record_field_f64(1, i, 2) : NaN;
    const tpct = ok1 ? host_record_field_f64(1, i, 5) : NaN;
    const b = load<i32>(best + (<usize>i << 2));
    count++;
    if (!ok1 || !isFinite(rkg) || !isFinite(rkpa) || !isFinite(tpct)) { emit(aid, -1, NaN, rkg, NaN, rkpa, "MALFORMED", "absent or non-finite asset field"); continue; }
    if (b < 0) { emit(aid, -1, NaN, rkg, NaN, rkpa, "NO_READING", "no reading for asset"); continue; }
    const ts = host_record_field_i64(0, b, 1);
    readReading(b, ok0);
    if (gBad) { emit(aid, ts, gKg, rkg, gKpa, rkpa, "MALFORMED", gWhy); continue; }
    const tol = max(abs_tol_kg, tpct / 100.0 * rkg);
    const dk = gKg - rkg;
    const dp = gKpa - rkpa;
    if (as_of_ts - ts > max_age_days * 86400) emit(aid, ts, gKg, rkg, gKpa, rkpa, "STALE", "newest reading older than max_age_days");
    else if (-dk > tol) emit(aid, ts, gKg, rkg, gKpa, rkpa, "UNDERCHARGE", "charge below rated beyond tolerance");
    else if (dk > tol) emit(aid, ts, gKg, rkg, gKpa, rkpa, "OVERCHARGE", "charge above rated beyond tolerance");
    else if (dp > rel_tol * rkpa) emit(aid, ts, gKg, rkg, gKpa, rkpa, "PRESSURE_HIGH", "pressure above rated beyond rel_tol");
    else if (-dp > rel_tol * rkpa) emit(aid, ts, gKg, rkg, gKpa, rkpa, "PRESSURE_LOW", "pressure below rated beyond rel_tol");
    else emit(aid, ts, gKg, rkg, gKpa, rkpa, "OK", "within tolerance");
  }
  for (let j = 0; j < nr; j++) {
    const aid = ok0 ? host_record_field_i64(0, j, 0) : <i64>0;
    if (ok0 && ok1 && lookup(aid) >= 0) continue;
    const ts = ok0 ? host_record_field_i64(0, j, 1) : <i64>-1;
    readReading(j, ok0);
    count++;
    if (gBad) emit(aid, ts, gKg, NaN, gKpa, NaN, "MALFORMED", gWhy);
    else emit(aid, ts, gKg, NaN, gKpa, NaN, "ORPHAN_READING", "reading asset_id not in register");
  }
  return count;
}
