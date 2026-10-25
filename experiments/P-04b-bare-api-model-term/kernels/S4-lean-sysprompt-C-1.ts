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

const SCRATCH: usize = memory.data(128);
const UNIT: usize = memory.data(32);

let gAbs: f64 = 0.05;
let gRel: f64 = 0.02;
let gMaxAge: i64 = 30;
let gAsOf: i64 = 0;
let gOk0: bool = false;
let gK0: bool = false;
let gK1: bool = false;
let tBits: i32 = 4;
let tMask: usize = 15;
let tKeys: usize = 0;
let tUsed: usize = 0;
let tBest: usize = 0;

function text(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH, n);
}

function ws(c: i32): bool { return c == 32 || (c >= 9 && c <= 13); }

function lc(i: i32): i32 { return <i32>load<u8>(UNIT + <usize>i) | 0x20; }

function unit(r: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, r, field, UNIT, 32);
  if (n < 0) return -1.0;
  let a = 0;
  let b = n;
  while (a < b && ws(<i32>load<u8>(UNIT + <usize>a))) a++;
  while (b > a && ws(<i32>load<u8>(UNIT + <usize>(b - 1)))) b--;
  let l = b - a;
  if (mass && l == 2) {
    if (lc(a) == 107 && lc(a + 1) == 103) return 1.0;
    if (lc(a) == 108 && lc(a + 1) == 98) return 0.45359237;
  }
  if (!mass && l == 3) {
    if (lc(a) == 107 && lc(a + 1) == 112 && lc(a + 2) == 97) return 1.0;
    if (lc(a) == 98 && lc(a + 1) == 97 && lc(a + 2) == 114) return 100.0;
    if (lc(a) == 112 && lc(a + 1) == 115 && lc(a + 2) == 105) return 6.894757293168;
  }
  return -1.0;
}

function key0(j: i32): i64 { return gK0 ? host_record_field_i64(0, j, 0) : -1; }

function key1(i: i32): i64 { return gK1 ? host_record_field_i64(1, i, 0) : -1; }

function ts0(j: i32): i64 { return gOk0 ? host_record_field_i64(0, j, 1) : 0; }

function find(key: i64): usize {
  let o = <usize>((<u64>key * 0x9E3779B97F4A7C15) >> <u64>(64 - tBits));
  while (load<i32>(tUsed + (o << 2)) != 0 && load<i64>(tKeys + (o << 3)) != key) o = (o + 1) & tMask;
  return o;
}

function row(id: i64, r: i32, rc: f64, rp: f64, tp: f64, bad: bool, orphan: bool): void {
  let ts: i64 = -1;
  let kg: f64 = NaN;
  let kpa: f64 = NaN;
  if (r >= 0) {
    if (!gOk0) bad = true;
    else {
      ts = host_record_field_i64(0, r, 1);
      let mf = unit(r, 3, true);
      let pf = unit(r, 5, false);
      let mass = host_record_field_f64(0, r, 2);
      let p = host_record_field_f64(0, r, 4);
      if (mf < 0 || pf < 0 || mass < 0 || !isFinite<f64>(mass) || !isFinite<f64>(p)) bad = true;
      if (mf > 0) kg = mass * mf;
      if (pf > 0) kpa = p * pf;
    }
  }
  let cls = "OK";
  let det = "within tolerance";
  let tol = max<f64>(gAbs, tp / 100.0 * rc);
  if (bad) { cls = "MALFORMED"; det = "unknown unit, negative mass, non-finite or absent field"; }
  else if (orphan) { cls = "ORPHAN_READING"; det = "reading asset_id not in register"; }
  else if (r < 0) { cls = "NO_READING"; det = "no reading for asset"; }
  else if (gAsOf - ts > gMaxAge * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
  else if (rc - kg > tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
  else if (kg - rc > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
  else if (kpa - rp > gRel * rp) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
  else if (rp - kpa > gRel * rp) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, kg - rc);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  text(7, cls);
  text(8, det);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg;
  gRel = rel_tol;
  gMaxAge = max_age_days;
  gAsOf = as_of_ts;
  let n = max<i32>(host_record_count(0), 0);
  let m = max<i32>(host_record_count(1), 0);
  gK0 = host_field_kind(0, 0) == 0;
  gK1 = host_field_kind(1, 0) == 0;
  gOk0 = gK0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2
    && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  let ok1 = gK1 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  tBits = 4;
  while ((1 << tBits) < m * 2 && tBits < 24) tBits++;
  let cap = <usize>1 << <usize>tBits;
  tMask = cap - 1;
  tKeys = (__heap_base + 7) & ~(<usize>7);
  tUsed = tKeys + (cap << 3);
  tBest = tUsed + (cap << 2);
  let pages = <i32>((tBest + (cap << 2) + 0xFFFF) >>> 16);
  let cur = memory.size();
  if (pages > cur && memory.grow(pages - cur) < 0) return 0;
  memory.fill(tUsed, 0, cap << 2);
  // open-addressing index on asset_id avoids the O(n*m) nested join
  for (let i = 0; i < m; i++) {
    let k = key1(i);
    let s = find(k);
    if (load<i32>(tUsed + (s << 2)) == 0) {
      store<i32>(tUsed + (s << 2), 1);
      store<i64>(tKeys + (s << 3), k);
      store<i32>(tBest + (s << 2), -1);
    }
  }
  for (let j = 0; j < n; j++) {
    let s = find(key0(j));
    if (load<i32>(tUsed + (s << 2)) == 0) continue;
    let b = load<i32>(tBest + (s << 2));
    if (b < 0 || ts0(j) > ts0(b)) store<i32>(tBest + (s << 2), j);
  }
  let count = 0;
  for (let i = 0; i < m; i++) {
    let k = key1(i);
    let r = load<i32>(tBest + (find(k) << 2));
    let rc: f64 = ok1 ? host_record_field_f64(1, i, 1) : NaN;
    let rp: f64 = ok1 ? host_record_field_f64(1, i, 2) : NaN;
    let tp: f64 = ok1 ? host_record_field_f64(1, i, 5) : NaN;
    let bad = !ok1 || !isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0;
    row(k, r, rc, rp, tp, bad, false);
    count++;
  }
  for (let j = 0; j < n; j++) {
    let k = key0(j);
    if (load<i32>(tUsed + (find(k) << 2)) != 0) continue;
    row(k, j, NaN, NaN, NaN, false, true);
    count++;
  }
  return count;
}
