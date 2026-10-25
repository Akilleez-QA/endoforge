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

const scratch = memory.data(256);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, value, or field", "no reading for asset", "newest reading too old", "charge below rated tolerance", "charge above rated tolerance", "pressure above rated", "pressure below rated", "reading has no asset", "within tolerance"];
let gAbs: f64 = 0; let gRel: f64 = 0; let gMaxAge: i64 = 0; let gAsOf: i64 = 0;
let gKg: f64 = NaN; let gKpa: f64 = NaN; let gBad = false;

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(scratch + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, scratch, n);
}

function eq(s: usize, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(s + <usize>i);
    if (c >= 65 && c <= 90) c |= 0x20;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unit(r: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(0, r, field, scratch, 256);
  if (n < 0) return NaN;
  let s: i32 = 0; let e: i32 = n;
  while (s < e && load<u8>(scratch + <usize>s) <= 32) s++;
  while (e > s && load<u8>(scratch + <usize>(e - 1)) <= 32) e--;
  const p = scratch + <usize>s; const l = e - s;
  if (mass) return eq(p, l, "kg") ? 1.0 : eq(p, l, "lb") ? 0.45359237 : NaN;
  return eq(p, l, "kpa") ? 1.0 : eq(p, l, "bar") ? 100.0 : eq(p, l, "psi") ? 6.894757293168 : NaN;
}

function readUnits(r: i32): bool {
  const m = host_record_field_f64(0, r, 2); const p = host_record_field_f64(0, r, 4);
  gKg = m * unit(r, 3, true); gKpa = p * unit(r, 5, false);
  return isFinite(gKg) && isFinite(gKpa) && m >= 0;
}

function classify(a: i32, r: i32): i32 {
  if (gBad || (r >= 0 && !readUnits(r))) return 0;
  if (a < 0) return 7;
  const rated = host_record_field_f64(1, a, 1); const rp = host_record_field_f64(1, a, 2); const pct = host_record_field_f64(1, a, 5);
  if (!isFinite(rated) || !isFinite(rp) || !isFinite(pct) || rated < 0) return 0;
  if (r < 0) return 1;
  if (gAsOf - host_record_field_i64(0, r, 1) > gMaxAge * 86400) return 2;
  const tol = max(gAbs, pct / 100.0 * rated);
  if (rated - gKg > tol) return 3;
  if (gKg - rated > tol) return 4;
  if (gKpa - rp > gRel * rp) return 5;
  if (rp - gKpa > gRel * rp) return 6;
  return 8;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gMaxAge = max_age_days; gAsOf = as_of_ts; gBad = false;
  for (let f = 0; f < 6; f++) if (host_field_kind(0, f) < 0) gBad = true;
  for (let f = 0; f < 6; f++) if (f != 3 && f != 4 && host_field_kind(1, f) < 0) gBad = true;
  const n = host_record_count(0); const m = host_record_count(1);
  let hs = 16; while (hs < m * 2) hs <<= 1;
  const index = new StaticArray<i32>(hs); index.fill(-1);
  for (let j = 0; j < m; j++) {
    let h = <i32>(<u64>host_record_field_i64(1, j, 0) * 0x9E3779B97F4A7C15 >> 40) & (hs - 1);
    while (index[h] >= 0) h = (h + 1) & (hs - 1);
    index[h] = j;
  }
  const best = new StaticArray<i32>(m); best.fill(-1);
  const bestTs = new StaticArray<i64>(m);
  const cap = m + n;
  const outA = new StaticArray<i32>(cap); const outR = new StaticArray<i32>(cap);
  const cls = new StaticArray<i32>(cap); const aid = new StaticArray<i64>(cap);
  let cnt = m;
  for (let i = 0; i < n; i++) {
    const id = host_record_field_i64(0, i, 0); const ts = host_record_field_i64(0, i, 1);
    let h = <i32>(<u64>id * 0x9E3779B97F4A7C15 >> 40) & (hs - 1); let j = -1;
    while (index[h] >= 0) { if (host_record_field_i64(1, index[h], 0) == id) { j = index[h]; break; } h = (h + 1) & (hs - 1); }
    if (j < 0) { outA[cnt] = -1; outR[cnt] = i; aid[cnt] = id; cnt++; }
    else if (best[j] < 0 || ts > bestTs[j]) { best[j] = i; bestTs[j] = ts; }
  }
  for (let j = 0; j < m; j++) { outA[j] = j; outR[j] = best[j]; aid[j] = host_record_field_i64(1, j, 0); }
  for (let k = 0; k < cnt; k++) cls[k] = classify(outA[k], outR[k]);
  let ord = new StaticArray<i32>(cnt); let tmp = new StaticArray<i32>(cnt);
  for (let k = 0; k < cnt; k++) ord[k] = k;
  // stable bottom-up merge sort by (classification, asset_id)
  for (let w = 1; w < cnt; w <<= 1) {
    for (let lo = 0; lo < cnt; lo += 2 * w) {
      const mid = min(lo + w, cnt); const hi = min(lo + 2 * w, cnt);
      let x = lo; let y = mid; let o = lo;
      while (x < mid && y < hi) {
        const p = ord[x]; const q = ord[y];
        const takeY = cls[q] < cls[p] || (cls[q] == cls[p] && aid[q] < aid[p]);
        tmp[o++] = takeY ? ord[y++] : ord[x++];
      }
      while (x < mid) tmp[o++] = ord[x++];
      while (y < hi) tmp[o++] = ord[y++];
    }
    const t = ord; ord = tmp; tmp = t;
  }
  for (let k = 0; k < cnt; k++) {
    const e = ord[k]; const a = outA[e]; const r = outR[e]; const c = cls[e];
    gKg = NaN; gKpa = NaN;
    if (r >= 0 && !gBad) readUnits(r);
    const rated = a >= 0 ? host_record_field_f64(1, a, 1) : NaN;
    out_begin();
    out_set_i64(0, aid[e]);
    out_set_i64(1, r >= 0 ? host_record_field_i64(0, r, 1) : -1);
    out_set_f64(2, gKg);
    out_set_f64(3, rated);
    out_set_f64(4, gKg - rated);
    out_set_f64(5, gKpa);
    out_set_f64(6, a >= 0 ? host_record_field_f64(1, a, 2) : NaN);
    putStr(7, NAMES[c]);
    putStr(8, DETAILS[c]);
    out_commit();
  }
  // summary effect; payload carries committed record count for the export sink
  effect_emit(100, <u32>cnt);
  return cnt;
}
