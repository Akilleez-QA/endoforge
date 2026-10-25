const UB: usize = memory.data(32);
const OB: usize = memory.data(96);
const CAP: i32 = 32768;
const MASK: i32 = 65535;
const table = new StaticArray<i32>(65536);
const newest = new StaticArray<i32>(32768);
let gAbs: f64 = 0;
let gRel: f64 = 0;
let gAge: i64 = 0;
let gAsOf: i64 = 0;
let gOk0: bool = false;
let gOk1: bool = false;
let gKg: f64 = NaN;
let gPk: f64 = NaN;

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

function isSpace(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function lower(c: i32): i32 {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

// packs a trimmed 2-3 byte lowercase unit into an i32 key, 0 if unusable
function pack(set: u32, idx: i32, field: i32): i32 {
  let e = host_record_field_str(set, idx, field, UB, 32);
  if (e < 0) return 0;
  let s = 0;
  while (s < e && isSpace(<i32>load<u8>(UB + s))) s++;
  while (e > s && isSpace(<i32>load<u8>(UB + e - 1))) e--;
  let n = e - s;
  if (n < 2 || n > 3) return 0;
  let v = n;
  for (let k = 0; k < n; k++) v = (v << 8) | lower(<i32>load<u8>(UB + s + k));
  return v;
}

function massFactor(p: i32): f64 {
  return p == 0x026b67 ? 1.0 : p == 0x026c62 ? 0.45359237 : 0.0;
}

function pressFactor(p: i32): f64 {
  if (p == 0x036b7061) return 1.0;
  if (p == 0x03626172) return 100.0;
  return p == 0x03707369 ? 6.894757293168 : 0.0;
}

function find(id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 48);
  while (table[h] != 0) {
    let a = table[h] - 1;
    if (host_record_field_i64(1, a, 0) == id) return a;
    h = (h + 1) & MASK;
  }
  return -1;
}

function insert(id: i64, a: i32): void {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 48);
  while (table[h] != 0) h = (h + 1) & MASK;
  table[h] = a + 1;
}

// converts reading j into gKg/gPk, false if malformed
function readVals(j: i32): bool {
  let mass = host_record_field_f64(0, j, 2);
  let press = host_record_field_f64(0, j, 4);
  let mf = massFactor(pack(0, j, 3));
  let pf = pressFactor(pack(0, j, 5));
  gKg = NaN;
  gPk = NaN;
  if (mf <= 0 || pf <= 0 || !isFinite(mass) || mass < 0 || !isFinite(press)) return false;
  gKg = mass * mf;
  gPk = press * pf;
  return true;
}

function putStr(field: i32, s: string, cap: i32): void {
  let n = s.length < cap ? s.length : cap;
  for (let k = 0; k < n; k++) store<u8>(OB + k, <u8>s.charCodeAt(k));
  out_set_str(field, OB, n);
}

function emit(id: i64, ts: i64, kg: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, kg - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  putStr(7, cls, 16);
  putStr(8, det, 80);
  out_commit();
}

function assetRow(i: i32): void {
  let id = host_record_field_i64(1, i, 0);
  let rc = gOk1 ? host_record_field_f64(1, i, 1) : NaN;
  let rp = gOk1 ? host_record_field_f64(1, i, 2) : NaN;
  let tp = gOk1 ? host_record_field_f64(1, i, 5) : NaN;
  let j = newest[i];
  let ts: i64 = -1;
  let bad = !isFinite(rc) || !isFinite(rp) || !isFinite(tp);
  if (j >= 0) {
    ts = host_record_field_i64(0, j, 1);
    if (!readVals(j)) bad = true;
  } else {
    gKg = NaN;
    gPk = NaN;
  }
  let cls = "OK";
  let det = "within tolerance";
  if (bad) {
    cls = "MALFORMED";
    det = "invalid unit, value or field";
    gKg = NaN;
    gPk = NaN;
  } else if (j < 0) {
    cls = "NO_READING";
    det = "no reading for asset";
  } else if (gAsOf - ts > gAge * 86400) {
    cls = "STALE";
    det = "newest reading older than max age";
  } else {
    let d = gKg - rc;
    if (abs<f64>(d) > max<f64>(gAbs, tp / 100.0 * rc)) {
      cls = d < 0 ? "UNDERCHARGE" : "OVERCHARGE";
      det = d < 0 ? "charge below rated" : "charge above rated";
    } else if (abs<f64>(gPk - rp) > gRel * max<f64>(abs<f64>(gPk), abs<f64>(rp))) {
      cls = gPk > rp ? "PRESSURE_HIGH" : "PRESSURE_LOW";
      det = gPk > rp ? "pressure above rated" : "pressure below rated";
    }
  }
  emit(id, ts, gKg, rc, gPk, rp, cls, det);
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg;
  gRel = rel_tol;
  gAge = max_age_days;
  gAsOf = as_of_ts;
  gOk0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 &&
    host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  gOk1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 &&
    host_field_kind(1, 5) == 1;
  let n0 = host_record_count(0);
  let n1 = host_record_count(1);
  let na = n1 > CAP ? CAP : n1;
  table.fill(0);
  for (let i = 0; i < na; i++) {
    newest[i] = -1;
    if (!gOk1) continue;
    let id = host_record_field_i64(1, i, 0);
    if (find(id) < 0) insert(id, i);
  }
  if (gOk0) {
    for (let j = 0; j < n0; j++) {
      let a = find(host_record_field_i64(0, j, 0));
      if (a < 0) continue;
      let cur = newest[a];
      if (cur < 0 || host_record_field_i64(0, j, 1) > host_record_field_i64(0, cur, 1)) newest[a] = j;
    }
  }
  let count = 0;
  for (let i = 0; i < na; i++) {
    assetRow(i);
    count++;
  }
  if (gOk0) {
    for (let j = 0; j < n0; j++) {
      let id = host_record_field_i64(0, j, 0);
      if (find(id) >= 0) continue;
      let ok = readVals(j);
      let ts = host_record_field_i64(0, j, 1);
      emit(id, ts, gKg, NaN, gPk, NaN, ok ? "ORPHAN_READING" : "MALFORMED", ok ? "reading has no register entry" : "invalid unit or value");
      count++;
    }
  }
  return count;
}
