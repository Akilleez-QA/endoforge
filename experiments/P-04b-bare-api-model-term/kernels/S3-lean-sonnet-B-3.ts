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

const BUF: usize = memory.data(64);
const NAN: f64 = 0.0 / 0.0;
let gAbs: f64 = 0;
let gRel: f64 = 0;
let gAge: i64 = 0;
let gAsOf: i64 = 0;
let gCls: i32 = 8;
let gCharge: f64 = NAN;
let gPress: f64 = NAN;
let gRated: f64 = NAN;
let gRatedP: f64 = NAN;
let gMode: i32 = 0;
let gAid = new StaticArray<i64>(0);
let gOrd = new StaticArray<i32>(0);
let rCls = new StaticArray<i32>(0);
let rId = new StaticArray<i64>(0);
let strPtr = new StaticArray<usize>(18);
let strLen = new StaticArray<i32>(18);

function fin(x: f64): bool { return x - x == 0; }

// Returns the kg or kPa factor for a unit string field, or NaN if unknown.
function unit(set: u32, idx: i32, field: i32, mass: bool): f64 {
  if (host_field_kind(set, field) != 2) return NAN;
  const n = host_record_field_str(set, idx, field, BUF, 32);
  if (n < 0) return NAN;
  let s = 0;
  let e = n;
  while (s < e && (load<u8>(BUF + s) == 32 || (load<u8>(BUF + s) >= 9 && load<u8>(BUF + s) <= 13))) s++;
  while (e > s && (load<u8>(BUF + e - 1) == 32 || (load<u8>(BUF + e - 1) >= 9 && load<u8>(BUF + e - 1) <= 13))) e--;
  if (e == s || e - s > 3) return NAN;
  let key: i32 = 0;
  for (let i = s; i < e; i++) {
    let c: i32 = load<u8>(BUF + i);
    if (c >= 65 && c <= 90) c += 32;
    key |= c << ((i - s) * 8);
  }
  if (mass) return key == 0x676b ? 1.0 : (key == 0x626c ? 0.45359237 : NAN);
  return key == 0x61706b ? 1.0 : (key == 0x726162 ? 100.0 : (key == 0x697370 ? 6.894757293168 : NAN));
}

// Classes: 0 MALFORMED 1 NO_READING 2 STALE 3 UNDER 4 OVER 5 P_HIGH 6 P_LOW 7 ORPHAN 8 OK.
function evalRow(a: i32, r: i32): void {
  gCharge = NAN; gPress = NAN; gRated = NAN; gRatedP = NAN; gCls = 8;
  let tp: f64 = 0;
  let bad = false;
  if (a >= 0) {
    if (host_field_kind(1, 1) != 1 || host_field_kind(1, 2) != 1 || host_field_kind(1, 5) != 1) bad = true;
    else {
      gRated = host_record_field_f64(1, a, 1);
      gRatedP = host_record_field_f64(1, a, 2);
      tp = host_record_field_f64(1, a, 5);
      if (!fin(gRated) || !fin(gRatedP) || !fin(tp) || gRated < 0) bad = true;
    }
  }
  if (r >= 0) {
    if (host_field_kind(0, 1) != 0 || host_field_kind(0, 2) != 1 || host_field_kind(0, 4) != 1) bad = true;
    else {
      const m = unit(0, r, 3, true);
      const p = unit(0, r, 5, false);
      const cm = host_record_field_f64(0, r, 2);
      const cp = host_record_field_f64(0, r, 4);
      if (!fin(m) || !fin(p) || !fin(cm) || !fin(cp) || cm < 0) bad = true;
      else { gCharge = cm * m; gPress = cp * p; }
    }
  }
  if (bad) { gCharge = NAN; gPress = NAN; gCls = 0; return; }
  if (r < 0) { gCls = 1; return; }
  if (a < 0) { gCls = 7; return; }
  if (gAsOf - host_record_field_i64(0, r, 1) > gAge * 86400) { gCls = 2; return; }
  const tol = Math.max(gAbs, tp / 100.0 * gRated);
  const d = gCharge - gRated;
  if (d < -tol) { gCls = 3; return; }
  if (d > tol) { gCls = 4; return; }
  const dp = gPress - gRatedP;
  const lim = gRel * Math.abs(gRatedP);
  if (dp > lim) gCls = 5;
  else if (dp < -lim) gCls = 6;
}

function lt(x: i32, y: i32): bool {
  if (gMode == 0) return gAid[x] < gAid[y] || (gAid[x] == gAid[y] && x < y);
  if (rCls[x] != rCls[y]) return rCls[x] < rCls[y];
  if (rId[x] != rId[y]) return rId[x] < rId[y];
  return x < y;
}

function sift(v: StaticArray<i32>, s: i32, n: i32): void {
  let root = s;
  while (true) {
    let c = 2 * root + 1;
    if (c >= n) break;
    if (c + 1 < n && lt(v[c], v[c + 1])) c++;
    if (!lt(v[root], v[c])) break;
    const t = v[root]; v[root] = v[c]; v[c] = t;
    root = c;
  }
}

function hsort(v: StaticArray<i32>, n: i32): void {
  for (let i = (n >> 1) - 1; i >= 0; i--) sift(v, i, n);
  for (let e = n - 1; e > 0; e--) {
    const t = v[0]; v[0] = v[e]; v[e] = t;
    sift(v, 0, e);
  }
}

function put(i: i32, s: string): void {
  const b = String.UTF8.encode(s);
  strPtr[i] = changetype<usize>(b);
  strLen[i] = b.byteLength;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gAge = max_age_days; gAsOf = as_of_ts;
  const na = max<i32>(host_record_count(1), 0);
  const nr = max<i32>(host_record_count(0), 0);
  put(0, "MALFORMED"); put(1, "NO_READING"); put(2, "STALE"); put(3, "UNDERCHARGE"); put(4, "OVERCHARGE");
  put(5, "PRESSURE_HIGH"); put(6, "PRESSURE_LOW"); put(7, "ORPHAN_READING"); put(8, "OK");
  put(9, "bad unit, negative or non-finite value"); put(10, "no reading for asset"); put(11, "newest reading older than max age");
  put(12, "charge below rated"); put(13, "charge above rated"); put(14, "pressure above rated");
  put(15, "pressure below rated"); put(16, "reading has no asset record"); put(17, "within tolerance");
  gAid = new StaticArray<i64>(na);
  gOrd = new StaticArray<i32>(na);
  const best = new StaticArray<i32>(na);
  const rA = new StaticArray<i32>(na + nr);
  const rR = new StaticArray<i32>(na + nr);
  rCls = new StaticArray<i32>(na + nr);
  rId = new StaticArray<i64>(na + nr);
  for (let i = 0; i < na; i++) { gAid[i] = host_record_field_i64(1, i, 0); gOrd[i] = i; best[i] = -1; }
  gMode = 0;
  hsort(gOrd, na);
  let no = 0;
  for (let r = 0; r < nr; r++) {
    const id = host_record_field_i64(0, r, 0);
    const ts = host_record_field_i64(0, r, 1);
    let lo = 0;
    let hi = na;
    while (lo < hi) { const m = (lo + hi) >> 1; if (gAid[gOrd[m]] < id) lo = m + 1; else hi = m; }
    let found = false;
    while (lo < na && gAid[gOrd[lo]] == id) {
      const a = gOrd[lo];
      found = true;
      if (best[a] < 0 || ts > host_record_field_i64(0, best[a], 1)) best[a] = r;
      lo++;
    }
    if (!found) { rA[na + no] = -1; rR[na + no] = r; rId[na + no] = id; no++; }
  }
  const total = na + no;
  for (let i = 0; i < total; i++) {
    if (i < na) { rA[i] = i; rR[i] = best[i]; rId[i] = gAid[i]; }
    evalRow(rA[i], rR[i]);
    rCls[i] = gCls;
  }
  const perm = new StaticArray<i32>(total);
  for (let i = 0; i < total; i++) perm[i] = i;
  gMode = 1;
  hsort(perm, total);
  for (let k = 0; k < total; k++) {
    const p = perm[k];
    const r = rR[p];
    evalRow(rA[p], r);
    out_begin();
    out_set_i64(0, rId[p]);
    out_set_i64(1, r >= 0 ? host_record_field_i64(0, r, 1) : -1);
    out_set_f64(2, gCharge);
    out_set_f64(3, gRated);
    out_set_f64(4, gCharge - gRated);
    out_set_f64(5, gPress);
    out_set_f64(6, gRatedP);
    out_set_str(7, strPtr[gCls], strLen[gCls]);
    out_set_str(8, strPtr[9 + gCls], strLen[9 + gCls]);
    out_commit();
  }
  effect_emit(100, total as u32);
  return total;
}
