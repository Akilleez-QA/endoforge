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
@external("host", "effect_emit") declare function effect_emit(kind: i32, payload: u32): void;

const MAX_A: i32 = 8192;
const HSIZE: i32 = 16384;
const MAX_O: i32 = 110000;
const SCRATCH: usize = memory.data(256);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max_age_days", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];
const hkey = new StaticArray<i64>(HSIZE);
const hval = new StaticArray<i32>(HSIZE);
const best = new StaticArray<i32>(MAX_A);
const bestTs = new StaticArray<i64>(MAX_A);
const oCls = new StaticArray<i32>(MAX_O);
const oAid = new StaticArray<i64>(MAX_O);
const oSrc = new StaticArray<i32>(MAX_O);
const ord = new StaticArray<i32>(MAX_O);

let gAbs: f64 = 0.0, gRel: f64 = 0.0, gMaxAge: i64 = 0, gAsOf: i64 = 0;
let ok0 = false, ok1 = false, idOk0 = false, idOk1 = false;
let gAid: i64 = 0, gTs: i64 = 0, gCharge: f64 = 0.0, gPres: f64 = 0.0, gRc: f64 = 0.0, gRp: f64 = 0.0, gPct: f64 = 0.0;

function slot(k: i64): i32 {
  let x = <u64>k;
  x = (x ^ (x >> 29)) * 0x9E3779B97F4A7C15;
  return <i32>(x >> 40) & (HSIZE - 1);
}

function find(k: i64): i32 {
  let h = slot(k);
  while (unchecked(hval[h]) != 0) {
    if (unchecked(hkey[h]) == k) return unchecked(hval[h]) - 1;
    h = (h + 1) & (HSIZE - 1);
  }
  return -1;
}

function insert(k: i64, a: i32): void {
  let h = slot(k);
  while (unchecked(hval[h]) != 0) {
    if (unchecked(hkey[h]) == k) return;
    h = (h + 1) & (HSIZE - 1);
  }
  unchecked(hkey[h] = k);
  unchecked(hval[h] = a + 1);
}

function eqLit(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < e - s; i++) {
    let c = <i32>load<u8>(SCRATCH + <usize>(s + i));
    if (c >= 65 && c <= 90) c |= 0x20;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(r: i32, field: i32, isMass: bool): f64 {
  let n = host_record_field_str(0, r, field, SCRATCH, 32);
  if (n < 0) return NaN;
  let s = 0, e = n;
  while (s < e && (load<u8>(SCRATCH + <usize>s) == 32 || (load<u8>(SCRATCH + <usize>s) >= 9 && load<u8>(SCRATCH + <usize>s) <= 13))) s++;
  while (e > s && (load<u8>(SCRATCH + <usize>(e - 1)) == 32 || (load<u8>(SCRATCH + <usize>(e - 1)) >= 9 && load<u8>(SCRATCH + <usize>(e - 1)) <= 13))) e--;
  if (isMass) return eqLit(s, e, "kg") ? 1.0 : eqLit(s, e, "lb") ? 0.45359237 : NaN;
  return eqLit(s, e, "kpa") ? 1.0 : eqLit(s, e, "bar") ? 100.0 : eqLit(s, e, "psi") ? 6.894757293168 : NaN;
}

function readR(r: i32): bool {
  if (!ok0) { gTs = -1; gCharge = NaN; gPres = NaN; return false; }
  gTs = host_record_field_i64(0, r, 1);
  gCharge = host_record_field_f64(0, r, 2) * unitFactor(r, 3, true);
  gPres = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
  return isFinite(gCharge) && isFinite(gPres) && gCharge >= 0.0;
}

function classify(src: i32): i32 {
  if (src < 0) {
    let r = -src - 1;
    gAid = host_record_field_i64(0, r, 0);
    gRc = NaN; gRp = NaN;
    return readR(r) ? 7 : 0;
  }
  gAid = idOk1 ? host_record_field_i64(1, src, 0) : -1;
  gRc = ok1 ? host_record_field_f64(1, src, 1) : NaN;
  gRp = ok1 ? host_record_field_f64(1, src, 2) : NaN;
  gPct = ok1 ? host_record_field_f64(1, src, 5) : NaN;
  let okA = ok1 && isFinite(gRc) && isFinite(gRp) && isFinite(gPct) && gRc >= 0.0;
  let f = idOk1 ? find(gAid) : -1;
  let r = f >= 0 ? unchecked(best[f]) : -1;
  if (r < 0) { gTs = -1; gCharge = NaN; gPres = NaN; return okA ? 1 : 0; }
  let okR = readR(r);
  if (!(okA && okR)) return 0;
  if (gAsOf - gTs > gMaxAge * 86400) return 2;
  let tol = max<f64>(gAbs, gPct / 100.0 * gRc);
  if (gRc - gCharge > tol) return 3;
  if (gCharge - gRc > tol) return 4;
  if (gPres - gRp > gRel * gRp) return 5;
  if (gRp - gPres > gRel * gRp) return 6;
  return 8;
}

function putStr(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + 64 + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH + 64, n);
}

function less(x: i32, y: i32): bool {
  let cx = unchecked(oCls[x]), cy = unchecked(oCls[y]);
  if (cx != cy) return cx < cy;
  let ax = unchecked(oAid[x]), ay = unchecked(oAid[y]);
  if (ax != ay) return ax < ay;
  return x < y;
}

function sift(start: i32, end: i32): void {
  let root = start;
  while (true) {
    let child = root * 2 + 1;
    if (child >= end) return;
    if (child + 1 < end && less(unchecked(ord[child]), unchecked(ord[child + 1]))) child++;
    if (!less(unchecked(ord[root]), unchecked(ord[child]))) return;
    let t = unchecked(ord[root]);
    unchecked(ord[root] = ord[child]);
    unchecked(ord[child] = t);
    root = child;
  }
}

function push(n: i32, src: i32): i32 {
  if (n >= MAX_O) return n;
  unchecked(oCls[n] = classify(src));
  unchecked(oAid[n] = gAid);
  unchecked(oSrc[n] = src);
  unchecked(ord[n] = n);
  return n + 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gMaxAge = max_age_days; gAsOf = as_of_ts;
  idOk0 = host_field_kind(0, 0) == 0;
  idOk1 = host_field_kind(1, 0) == 0;
  ok0 = idOk0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  ok1 = idOk1 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  let nA = min<i32>(max<i32>(host_record_count(1), 0), MAX_A);
  let nR = max<i32>(host_record_count(0), 0);
  for (let h = 0; h < HSIZE; h++) unchecked(hval[h] = 0);
  for (let a = 0; a < nA; a++) {
    unchecked(best[a] = -1);
    if (idOk1) insert(host_record_field_i64(1, a, 0), a);
  }
  // Hash index on asset_id keeps the join O(n + m); ties keep the lowest reading index.
  if (idOk0) {
    for (let r = 0; r < nR; r++) {
      let a = idOk1 ? find(host_record_field_i64(0, r, 0)) : -1;
      if (a < 0) continue;
      let ts = ok0 ? host_record_field_i64(0, r, 1) : 0;
      if (unchecked(best[a]) < 0 || ts > unchecked(bestTs[a])) {
        unchecked(best[a] = r);
        unchecked(bestTs[a] = ts);
      }
    }
  }
  let n = 0;
  for (let a = 0; a < nA; a++) n = push(n, a);
  if (idOk0) {
    for (let r = 0; r < nR; r++) {
      if (!idOk1 || find(host_record_field_i64(0, r, 0)) < 0) n = push(n, -r - 1);
    }
  }
  for (let i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
  for (let e = n - 1; e > 0; e--) {
    let t = unchecked(ord[0]);
    unchecked(ord[0] = ord[e]);
    unchecked(ord[e] = t);
    sift(0, e);
  }
  for (let i = 0; i < n; i++) {
    let o = unchecked(ord[i]);
    let c = classify(unchecked(oSrc[o]));
    out_begin();
    out_set_i64(0, gAid);
    out_set_i64(1, gTs);
    out_set_f64(2, gCharge);
    out_set_f64(3, gRc);
    out_set_f64(4, gCharge - gRc);
    out_set_f64(5, gPres);
    out_set_f64(6, gRp);
    putStr(7, unchecked(NAMES[c]));
    putStr(8, unchecked(DETAILS[c]));
    out_commit();
  }
  // Summary effect for export.csv; payload carries the committed record count.
  effect_emit(100, <u32>n);
  return n;
}
