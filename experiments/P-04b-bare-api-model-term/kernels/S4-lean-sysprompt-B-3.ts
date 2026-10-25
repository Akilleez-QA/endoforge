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

const UBUF = memory.data(64);
const SBUF = memory.data(96);
const K0: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const K1: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, negative mass, non-finite or absent field", "asset has no reading", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];

let gAbs: f64 = 0.0, gRel: f64 = 0.0, gMaxAge: i64 = 0, gAsOf: i64 = 0, bad0 = false, bad1 = false;
let gId: i64 = 0, gTs: i64 = -1, gCk: f64 = NaN, gRc: f64 = NaN, gPk: f64 = NaN, gRp: f64 = NaN, gTol: f64 = NaN, gMal = false, gB: i32 = -1;
let best = new StaticArray<i32>(0);

function kindsOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let f = 0; f < kinds.length; f++) if (host_field_kind(set, f) != kinds[f]) return false;
  return true;
}

function getId(set: u32, i: i32, bad: bool): i64 {
  return bad ? <i64>i : host_record_field_i64(set, i, 0);
}

function isWs(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eq(s: usize, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let k = 0; k < len; k++) {
    let c = <u32>load<u8>(s + <usize>k);
    if (c >= 65 && c <= 90) c += 32;
    if (c != <u32>lit.charCodeAt(k)) return false;
  }
  return true;
}

function factor(i: i32, f: i32, mass: bool): f64 {
  const n = host_record_field_str(0, i, f, UBUF, 64);
  if (n < 0) return NaN;
  let s = UBUF, e = UBUF + <usize>n;
  while (s < e && isWs(load<u8>(s))) s++;
  while (e > s && isWs(load<u8>(e - 1))) e--;
  const len = <i32>(e - s);
  if (mass) return eq(s, len, "kg") ? 1.0 : eq(s, len, "lb") ? 0.45359237 : NaN;
  return eq(s, len, "kpa") ? 1.0 : eq(s, len, "bar") ? 100.0 : eq(s, len, "psi") ? 6.894757293168 : NaN;
}

function msort(ord: StaticArray<i32>, key: StaticArray<i64>, tmp: StaticArray<i32>, n: i32): void {
  for (let i = 0; i < n; i++) ord[i] = i;
  let src = ord, dst = tmp;
  for (let w = 1; w < n; w <<= 1) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const mid = min<i32>(lo + w, n), hi = min<i32>(lo + 2 * w, n);
      let i = lo, j = mid, k = lo;
      while (k < hi) dst[k++] = (i < mid && (j >= hi || key[src[i]] <= key[src[j]])) ? src[i++] : src[j++];
    }
    const t = src; src = dst; dst = t;
  }
  if (src != ord) for (let i = 0; i < n; i++) ord[i] = src[i];
}

function load(r: i32): void {
  if (r >= 0) {
    gId = getId(1, r, bad1); gB = best[r];
    gRc = bad1 ? NaN : host_record_field_f64(1, r, 1);
    gRp = bad1 ? NaN : host_record_field_f64(1, r, 2);
    const tp = bad1 ? NaN : host_record_field_f64(1, r, 5);
    gMal = bad1 || !isFinite<f64>(gRc) || gRc < 0 || !isFinite<f64>(gRp) || !isFinite<f64>(tp);
    gTol = max<f64>(gAbs, tp / 100.0 * gRc);
  } else {
    gB = -r - 1; gId = getId(0, gB, bad0); gRc = NaN; gRp = NaN; gTol = NaN; gMal = false;
  }
  if (gB < 0) { gTs = -1; gCk = NaN; gPk = NaN; return; }
  if (bad0) { gTs = -1; gCk = NaN; gPk = NaN; gMal = true; return; }
  gTs = host_record_field_i64(0, gB, 1);
  const mass = host_record_field_f64(0, gB, 2);
  gCk = mass * factor(gB, 3, true);
  gPk = host_record_field_f64(0, gB, 4) * factor(gB, 5, false);
  gMal = gMal || mass < 0 || !isFinite<f64>(gCk) || !isFinite<f64>(gPk);
}

function classify(r: i32): u8 {
  load(r);
  if (gMal) return 0;
  if (r < 0) return 7;
  if (gB < 0) return 1;
  if (gAsOf - gTs > gMaxAge * 86400) return 2;
  const d = gCk - gRc;
  if (d < -gTol) return 3;
  if (d > gTol) return 4;
  if (gPk - gRp > gRel * gRp) return 5;
  if (gRp - gPk > gRel * gRp) return 6;
  return 8;
}

function putStr(f: i32, s: string): void {
  const n = min<i32>(s.length, 80);
  for (let k = 0; k < n; k++) store<u8>(SBUF + <usize>k, <u8>s.charCodeAt(k));
  out_set_str(f, SBUF, n);
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gMaxAge = max_age_days; gAsOf = as_of_ts;
  bad0 = !kindsOk(0, K0); bad1 = !kindsOk(1, K1);
  const m = max<i32>(host_record_count(0), 0), n = max<i32>(host_record_count(1), 0);
  const rid = new StaticArray<i64>(m), rord = new StaticArray<i32>(m), aid = new StaticArray<i64>(n), aord = new StaticArray<i32>(n);
  const tmp = new StaticArray<i32>(max<i32>(m, n));
  for (let i = 0; i < m; i++) rid[i] = getId(0, i, bad0);
  for (let i = 0; i < n; i++) aid[i] = getId(1, i, bad1);
  msort(rord, rid, tmp, m); msort(aord, aid, tmp, n);
  best = new StaticArray<i32>(n);
  const rows = new StaticArray<i32>(n + m), cls = new StaticArray<u8>(n + m);
  let i = 0, j = 0, rc = 0;
  // sort-merge join on asset_id; rows >= 0 are assets, rows < 0 encode orphan readings as -(idx + 1)
  while (i < n || j < m) {
    if (j < m && (i >= n || rid[rord[j]] < aid[aord[i]])) { rows[rc++] = -rord[j] - 1; j++; continue; }
    const a = aord[i], key = aid[a];
    let b = -1, bts: i64 = 0, jj = j;
    while (jj < m && rid[rord[jj]] == key) {
      const r = rord[jj++], ts = bad0 ? <i64>0 : host_record_field_i64(0, r, 1);
      if (b < 0 || ts > bts) { b = r; bts = ts; }
    }
    best[a] = b; rows[rc++] = a; i++;
    if (i >= n || aid[aord[i]] != key) j = jj;
  }
  for (let k = 0; k < rc; k++) cls[k] = classify(rows[k]);
  let count = 0;
  for (let c: u8 = 0; c <= 8; c++) {
    for (let k = 0; k < rc; k++) {
      if (cls[k] != c) continue;
      load(rows[k]);
      out_begin();
      out_set_i64(0, gId); out_set_i64(1, gTs); out_set_f64(2, gCk); out_set_f64(3, gRc);
      out_set_f64(4, gCk - gRc); out_set_f64(5, gPk); out_set_f64(6, gRp);
      putStr(7, NAMES[c]); putStr(8, DETAILS[c]);
      out_commit();
      count++;
    }
  }
  // summary effect after last record; payload carries the committed record count
  effect_emit(100, <u32>count);
  return count;
}
