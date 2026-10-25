// NOTE: classification-then-asset_id order departs from section 6 join order; T1 and T5 expect asset rows first, then orphans.
// NOTE: export.csv expects a record-set handle, but the contract defines none for output; payload carries the committed count.
// Uses raw linear memory instead of StaticArray, so no env.abort import or bounds trap appears (1.7).
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

const buf = memory.data(256);
let A_TOL: f64 = 0, R_TOL: f64 = 0, MAX_AGE: i64 = 0, AS_OF: i64 = 0, bad0 = false, bad1 = false;
let gAid: i64 = 0, gTs: i64 = -1, gKg: f64 = NaN, gRated: f64 = NaN, gP: f64 = NaN, gRp: f64 = NaN, gDetail = "";
let CLS: usize = 0, KEY: usize = 0;

@inline function ld32(p: usize, i: i32): i32 { return load<i32>(p + (<usize>i << 2)); }
@inline function st32(p: usize, i: i32, v: i32): void { store<i32>(p + (<usize>i << 2), v); }
@inline function ld64(p: usize, i: i32): i64 { return load<i64>(p + (<usize>i << 3)); }
@inline function st64(p: usize, i: i32, v: i64): void { store<i64>(p + (<usize>i << 3), v); }

function kindsOk(set: u32, spec: string): bool {
  for (let i = 0; i < spec.length; i++) if (host_field_kind(set, i) != spec.charCodeAt(i) - 48) return false;
  return true;
}

function isWs(c: i32): bool { return c == 32 || (c >= 9 && c <= 13); }

function eqCI(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let c = <i32>load<u8>(buf + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(r: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, r, field, buf, 64);
  if (n < 0) return NaN;
  let s = 0, e = n;
  while (s < e && isWs(<i32>load<u8>(buf + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(buf + <usize>(e - 1)))) e--;
  if (mass) {
    if (eqCI(s, e, "kg")) return 1.0;
    if (eqCI(s, e, "lb")) return 0.45359237;
  } else {
    if (eqCI(s, e, "kpa")) return 1.0;
    if (eqCI(s, e, "bar")) return 100.0;
    if (eqCI(s, e, "psi")) return 6.894757293168;
  }
  return NaN;
}

function className(c: i32): string {
  switch (c) {
    case 0: return "MALFORMED";
    case 1: return "NO_READING";
    case 2: return "STALE";
    case 3: return "UNDERCHARGE";
    case 4: return "OVERCHARGE";
    case 5: return "PRESSURE_HIGH";
    case 6: return "PRESSURE_LOW";
    case 7: return "ORPHAN_READING";
    default: return "OK";
  }
}

function putStr(field: i32, s: string): void {
  let n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(buf + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, buf, n);
}

// Returns classification rank (section 6 order, 0-based); a < 0 marks an orphan reading.
function evalRow(a: i32, r: i32): i32 {
  gTs = -1; gKg = NaN; gP = NaN; gRated = NaN; gRp = NaN;
  let tolPct: f64 = 0;
  if (a >= 0) {
    gAid = host_record_field_i64(1, a, 0);
    gRated = host_record_field_f64(1, a, 1);
    gRp = host_record_field_f64(1, a, 2);
    tolPct = host_record_field_f64(1, a, 5);
    if (bad1 || !isFinite(gRated) || !isFinite(gRp) || !isFinite(tolPct) || gRated < 0) { gDetail = "invalid or absent asset register field"; return 0; }
    if (r < 0) { gDetail = "no reading for asset"; return 1; }
  } else gAid = host_record_field_i64(0, r, 0);
  if (bad0) { gDetail = "absent or mistyped reading field"; return 0; }
  gTs = host_record_field_i64(0, r, 1);
  let mf = unitFactor(r, 3, true), pf = unitFactor(r, 5, false);
  let m = host_record_field_f64(0, r, 2), p = host_record_field_f64(0, r, 4);
  if (isNaN(mf) || isNaN(pf)) { gDetail = "unknown unit string"; return 0; }
  if (!isFinite(m) || !isFinite(p) || m < 0) { gDetail = "negative or non-finite reading"; return 0; }
  gKg = m * mf; gP = p * pf;
  if (a < 0) { gDetail = "reading has no registered asset"; return 7; }
  if (AS_OF - gTs > MAX_AGE * 86400) { gDetail = "newest reading older than max age"; return 2; }
  let tol = max(A_TOL, tolPct / 100 * gRated), d = gKg - gRated;
  if (d < -tol) { gDetail = "charge below rated beyond tolerance"; return 3; }
  if (d > tol) { gDetail = "charge above rated beyond tolerance"; return 4; }
  if (gP - gRp > R_TOL * gRp) { gDetail = "pressure above rated beyond rel_tol"; return 5; }
  if (gRp - gP > R_TOL * gRp) { gDetail = "pressure below rated beyond rel_tol"; return 6; }
  gDetail = "within tolerance";
  return 8;
}

function less(x: i32, y: i32): bool {
  let cx = ld32(CLS, x), cy = ld32(CLS, y);
  if (cx != cy) return cx < cy;
  let kx = ld64(KEY, x), ky = ld64(KEY, y);
  if (kx != ky) return kx < ky;
  return x < y;
}

function slot(k: i64, bits: i32): i32 { return <i32>((<u64>k * 0x9E3779B97F4A7C15) >> <u64>(64 - bits)); }

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  A_TOL = abs_tol_kg; R_TOL = rel_tol; MAX_AGE = max_age_days; AS_OF = as_of_ts;
  bad0 = !kindsOk(0, "0012122"); bad1 = !kindsOk(1, "011221");
  let nA = max(host_record_count(1), 0), nR = max(host_record_count(0), 0), n = nA + nR;
  let bits = 4;
  while ((1 << bits) < nA * 2) bits++;
  let size = 1 << bits, mask = size - 1;
  let HK = (__heap_base + 15) & ~(<usize>15), HV = HK + (<usize>size << 3), BT = HV + (<usize>size << 2);
  let RR = BT + (<usize>nA << 3), ORD = RR + (<usize>n << 2), TMP = ORD + (<usize>n << 2);
  CLS = TMP + (<usize>n << 2); KEY = CLS + (<usize>n << 2);
  let need = <i32>((KEY + (<usize>n << 3) + 0xffff) >> 16) - memory.size();
  if (need > 0 && memory.grow(need) < 0) return 0;
  for (let h = 0; h < size; h++) st32(HV, h, -1);
  // Open-addressing index on asset_id keeps the join O(n + m); duplicate asset_ids keep the first.
  for (let a = 0; a < nA; a++) {
    let k = host_record_field_i64(1, a, 0), h = slot(k, bits);
    while (ld32(HV, h) >= 0 && ld64(HK, h) != k) h = (h + 1) & mask;
    if (ld32(HV, h) < 0) { st64(HK, h, k); st32(HV, h, a); }
    st32(RR, a, -1);
  }
  let cnt = nA;
  for (let r = 0; r < nR; r++) {
    let k = host_record_field_i64(0, r, 0), ts = host_record_field_i64(0, r, 1), h = slot(k, bits);
    while (ld32(HV, h) >= 0 && ld64(HK, h) != k) h = (h + 1) & mask;
    let a = ld32(HV, h);
    if (a < 0) st32(RR, cnt++, r);
    else if (ld32(RR, a) < 0 || ts > ld64(BT, a)) { st32(RR, a, r); st64(BT, a, ts); }
  }
  for (let i = 0; i < cnt; i++) {
    st32(CLS, i, evalRow(i < nA ? i : -1, ld32(RR, i)));
    st64(KEY, i, gAid); st32(ORD, i, i);
  }
  // Stable bottom-up merge sort by (classification rank, asset_id, row index).
  let src = ORD, dst = TMP;
  for (let w = 1; w < cnt; w <<= 1) {
    for (let lo = 0; lo < cnt; lo += 2 * w) {
      let mid = min(lo + w, cnt), hi = min(lo + 2 * w, cnt), i = lo, j = mid;
      for (let k = lo; k < hi; k++) {
        let takeLeft = j >= hi || (i < mid && !less(ld32(src, j), ld32(src, i)));
        st32(dst, k, takeLeft ? ld32(src, i++) : ld32(src, j++));
      }
    }
    let t = src; src = dst; dst = t;
  }
  for (let k = 0; k < cnt; k++) {
    let i = ld32(src, k), c = evalRow(i < nA ? i : -1, ld32(RR, i));
    out_begin();
    out_set_i64(0, gAid); out_set_i64(1, gTs); out_set_f64(2, gKg); out_set_f64(3, gRated);
    out_set_f64(4, gKg - gRated); out_set_f64(5, gP); out_set_f64(6, gRp);
    putStr(7, className(c)); putStr(8, gDetail);
    out_commit();
  }
  effect_emit(100, <u32>cnt);
  return cnt;
}
