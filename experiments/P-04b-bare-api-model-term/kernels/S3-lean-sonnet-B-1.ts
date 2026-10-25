const SB = memory.data(64);
const OB = memory.data(96);
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

let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let ok0: bool = false;
let ok1: bool = false;

function ch(i: i32): i32 { return <i32>load<u8>(SB + <usize>i); }
function isWs(c: i32): bool { return c == 32 || (c >= 9 && c <= 13); }

function same(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) if ((ch(s + i) | 32) != lit.charCodeAt(i)) return false;
  return true;
}

function unitFactor(idx: i32, field: i32, pressure: bool): f64 {
  const n = host_record_field_str(0, idx, field, SB, 64);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(ch(s))) s++;
  while (e > s && isWs(ch(e - 1))) e--;
  if (!pressure) {
    if (same(s, e, "kg")) return 1.0;
    if (same(s, e, "lb")) return 0.45359237;
  } else {
    if (same(s, e, "kpa")) return 1.0;
    if (same(s, e, "bar")) return 100.0;
    if (same(s, e, "psi")) return 6.894757293168;
  }
  return NaN;
}

function cname(c: i32): string {
  switch (c) {
    case 1: return "MALFORMED";
    case 2: return "NO_READING";
    case 3: return "STALE";
    case 4: return "UNDERCHARGE";
    case 5: return "OVERCHARGE";
    case 6: return "PRESSURE_HIGH";
    case 7: return "PRESSURE_LOW";
    case 8: return "ORPHAN_READING";
  }
  return "OK";
}

function cdetail(c: i32): string {
  switch (c) {
    case 1: return "unknown unit, negative or non-finite value, or absent field";
    case 2: return "no reading for asset";
    case 3: return "newest reading older than max age";
    case 4: return "charge below rated beyond tolerance";
    case 5: return "charge above rated beyond tolerance";
    case 6: return "pressure above rated beyond tolerance";
    case 7: return "pressure below rated beyond tolerance";
    case 8: return "reading has no asset in register";
  }
  return "within tolerance";
}

function putStr(field: i32, s: string): void {
  const n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(OB + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OB, n);
}

function evalEntry(a: i32, r: i32, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  gCharge = NaN;
  gPress = NaN;
  let rated: f64 = NaN;
  let ratedP: f64 = NaN;
  let tolPct: f64 = 0.0;
  if (a >= 0) {
    rated = host_record_field_f64(1, a, 1);
    ratedP = host_record_field_f64(1, a, 2);
    tolPct = host_record_field_f64(1, a, 5);
    if (!ok1 || !isFinite(rated) || !isFinite(ratedP) || !isFinite(tolPct) || tolPct < 0.0) return 1;
    if (r < 0) return 2;
  }
  if (!ok0) return 1;
  const mf = unitFactor(r, 3, false);
  const pf = unitFactor(r, 5, true);
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  if (mf != mf || pf != pf || !isFinite(m) || m < 0.0 || !isFinite(p)) return 1;
  gCharge = m * mf;
  gPress = p * pf;
  if (a < 0) return 8;
  if (asOf - host_record_field_i64(0, r, 1) > maxAge * 86400) return 3;
  const delta = gCharge - rated;
  const pct = tolPct / 100.0 * rated;
  const tol = absTol > pct ? absTol : pct;
  if (delta < -tol) return 4;
  if (delta > tol) return 5;
  const diff = gPress - ratedP;
  const mx = Math.max(Math.abs(gPress), Math.abs(ratedP));
  if (Math.abs(diff) > relTol * mx) return diff > 0.0 ? 6 : 7;
  return 9;
}

function less(k1: StaticArray<i64>, k2: StaticArray<i64>, a: i32, b: i32): bool {
  if (k1[a] != k1[b]) return k1[a] < k1[b];
  if (k2[a] != k2[b]) return k2[a] < k2[b];
  return a < b;
}

function sift(ix: StaticArray<i32>, k1: StaticArray<i64>, k2: StaticArray<i64>, root: i32, end: i32): void {
  while (true) {
    let c = 2 * root + 1;
    if (c >= end) break;
    if (c + 1 < end && less(k1, k2, ix[c], ix[c + 1])) c++;
    if (!less(k1, k2, ix[root], ix[c])) break;
    const t = ix[root]; ix[root] = ix[c]; ix[c] = t;
    root = c;
  }
}

function sortIdx(ix: StaticArray<i32>, n: i32, k1: StaticArray<i64>, k2: StaticArray<i64>): void {
  for (let s = n / 2 - 1; s >= 0; s--) sift(ix, k1, k2, s, n);
  for (let e = n - 1; e > 0; e--) {
    const t = ix[0]; ix[0] = ix[e]; ix[e] = t;
    sift(ix, k1, k2, 0, e);
  }
}

function bound(ix: StaticArray<i32>, k1: StaticArray<i64>, n: i32, key: i64, upper: bool): i32 {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = k1[ix[mid]];
    if (upper ? v <= key : v < key) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nA = host_record_count(1);
  const nR = host_record_count(0);
  ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  const rk1 = new StaticArray<i64>(nR);
  const rk2 = new StaticArray<i64>(nR);
  const rix = new StaticArray<i32>(nR);
  for (let i = 0; i < nR; i++) {
    rk1[i] = host_record_field_i64(0, i, 0);
    rk2[i] = host_record_field_i64(0, i, 1);
    rix[i] = i;
  }
  sortIdx(rix, nR, rk1, rk2);
  const ak1 = new StaticArray<i64>(nA);
  const ak2 = new StaticArray<i64>(nA);
  const aix = new StaticArray<i32>(nA);
  for (let i = 0; i < nA; i++) {
    ak1[i] = host_record_field_i64(1, i, 0);
    aix[i] = i;
  }
  sortIdx(aix, nA, ak1, ak2);
  const cap = nA + nR;
  const eA = new StaticArray<i32>(cap);
  const eR = new StaticArray<i32>(cap);
  const ek1 = new StaticArray<i64>(cap);
  const ek2 = new StaticArray<i64>(cap);
  const ord = new StaticArray<i32>(cap);
  let n = 0;
  for (let i = 0; i < nA; i++) {
    const lb = bound(rix, rk1, nR, ak1[i], false);
    const ub = bound(rix, rk1, nR, ak1[i], true);
    eA[n] = i;
    eR[n] = ub > lb ? rix[ub - 1] : -1;
    ek2[n] = ak1[i];
    n++;
  }
  for (let j = 0; j < nR; j++) {
    const p = bound(aix, ak1, nA, rk1[j], false);
    if (p < nA && ak1[aix[p]] == rk1[j]) continue;
    eA[n] = -1;
    eR[n] = j;
    ek2[n] = rk1[j];
    n++;
  }
  for (let i = 0; i < n; i++) {
    ek1[i] = <i64>evalEntry(eA[i], eR[i], abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    ord[i] = i;
  }
  sortIdx(ord, n, ek1, ek2);
  for (let i = 0; i < n; i++) {
    const e = ord[i];
    const a = eA[e];
    const r = eR[e];
    const c = <i32>ek1[e];
    evalEntry(a, r, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    const rated = a >= 0 && ok1 ? host_record_field_f64(1, a, 1) : NaN;
    out_begin();
    out_set_i64(0, ek2[e]);
    out_set_i64(1, r >= 0 && ok0 ? host_record_field_i64(0, r, 1) : -1);
    out_set_f64(2, gCharge);
    out_set_f64(3, rated);
    out_set_f64(4, gCharge - rated);
    out_set_f64(5, gPress);
    out_set_f64(6, a >= 0 && ok1 ? host_record_field_f64(1, a, 2) : NaN);
    putStr(7, cname(c));
    putStr(8, cdetail(c));
    out_commit();
  }
  // payload 0 names the output record set
  effect_emit(100, 0);
  return n;
}
