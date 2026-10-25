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

const LOG: u32 = 0;
const REG: u32 = 1;
const OUT_SET: u32 = 2;
const MAXA: i32 = 32768;
const HSIZE: i32 = 65536;
const MAXO: i32 = 140000;
const htab = new StaticArray<i32>(HSIZE);
const newest = new StaticArray<i32>(MAXA);
const rowRef = new StaticArray<i32>(MAXO);
const rowCls = new StaticArray<i32>(MAXO);
const rowId = new StaticArray<i64>(MAXO);
const ord = new StaticArray<i32>(MAXO);
const ubuf = memory.data(64);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, value or field", "no reading for asset", "newest reading too old", "charge below rated", "charge above rated", "pressure above rated", "pressure below rated", "reading has no asset", "within tolerance"];
const nameBuf = new StaticArray<ArrayBuffer>(9);
const detBuf = new StaticArray<ArrayBuffer>(9);
let gAbs: f64 = 0; let gRel: f64 = 0; let gAge: i64 = 0; let gNow: i64 = 0; let schemaBad = false;

function isWs(b: u32): bool { return b == 32 || (b >= 9 && b <= 13); }

function unitFactor(idx: i32, field: i32, pressure: bool): f64 {
  const n = host_record_field_str(LOG, idx, field, ubuf, 64);
  if (n < 0) return -1;
  let s = 0; let e = n;
  while (s < e && isWs(<u32>load<u8>(ubuf + s))) s++;
  while (e > s && isWs(<u32>load<u8>(ubuf + e - 1))) e--;
  if (e - s < 2 || e - s > 3) return -1;
  let code: u32 = 0;
  for (let i = s; i < e; i++) {
    let b = <u32>load<u8>(ubuf + i);
    if (b >= 65 && b <= 90) b += 32;
    code = (code << 8) | b;
  }
  if (!pressure) return code == 0x6b67 ? 1.0 : code == 0x6c62 ? 0.45359237 : -1;
  return code == 0x6b7061 ? 1.0 : code == 0x626172 ? 100.0 : code == 0x707369 ? 6.894757293168 : -1;
}

function massKg(r: i32): f64 {
  const f = unitFactor(r, 3, false); const m = host_record_field_f64(LOG, r, 2);
  return f < 0 || !isFinite(m) || m < 0 ? NaN : m * f;
}

function pressKpa(r: i32): f64 {
  const f = unitFactor(r, 5, true); const p = host_record_field_f64(LOG, r, 4);
  return f < 0 || !isFinite(p) ? NaN : p * f;
}

function classify(a: i32, r: i32): i32 {
  if (schemaBad) return 0;
  const rc = host_record_field_f64(REG, a, 1); const rp = host_record_field_f64(REG, a, 2); const tp = host_record_field_f64(REG, a, 5);
  if (!isFinite(rc) || !isFinite(rp) || !isFinite(tp)) return 0;
  if (r < 0) return 1;
  const m = massKg(r); const p = pressKpa(r);
  if (isNaN(m) || isNaN(p)) return 0;
  if (gNow - host_record_field_i64(LOG, r, 1) > gAge * 86400) return 2;
  const tol = Math.max(gAbs, tp / 100 * Math.abs(rc)); const d = m - rc;
  if (d < -tol) return 3;
  if (d > tol) return 4;
  if (p - rp > gRel * Math.abs(rp)) return 5;
  if (rp - p > gRel * Math.abs(rp)) return 6;
  return 8;
}

function hslot(id: i64): i32 { return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 48) & (HSIZE - 1); }

function less(x: i32, y: i32): bool {
  const cx = rowCls[x]; const cy = rowCls[y];
  if (cx != cy) return cx < cy;
  const ix = rowId[x]; const iy = rowId[y];
  return ix != iy ? ix < iy : x < y;
}

function sift(start: i32, end: i32): void {
  let root = start;
  while (2 * root + 1 < end) {
    let c = 2 * root + 1;
    if (c + 1 < end && less(ord[c], ord[c + 1])) c++;
    if (!less(ord[root], ord[c])) return;
    const t = ord[root]; ord[root] = ord[c]; ord[c] = t; root = c;
  }
}

function putStr(field: i32, b: ArrayBuffer): void { out_set_str(field, changetype<usize>(b), b.byteLength); }

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gAge = max_age_days; gNow = as_of_ts;
  for (let i = 0; i < 9; i++) { nameBuf[i] = String.UTF8.encode(NAMES[i]); detBuf[i] = String.UTF8.encode(DETAILS[i]); }
  schemaBad = host_field_kind(LOG, 0) != 0 || host_field_kind(LOG, 1) != 0 || host_field_kind(LOG, 2) != 1 || host_field_kind(LOG, 3) != 2
    || host_field_kind(LOG, 4) != 1 || host_field_kind(LOG, 5) != 2 || host_field_kind(REG, 0) != 0 || host_field_kind(REG, 1) != 1
    || host_field_kind(REG, 2) != 1 || host_field_kind(REG, 5) != 1;
  const na = min(host_record_count(REG), MAXA); const nr = host_record_count(LOG);
  for (let i = 0; i < HSIZE; i++) htab[i] = -1;
  // open-addressing index on asset_id avoids the O(n*m) join
  for (let a = 0; a < na; a++) {
    newest[a] = -1;
    const id = host_record_field_i64(REG, a, 0); let h = hslot(id);
    while (htab[h] >= 0 && host_record_field_i64(REG, htab[h], 0) != id) h = (h + 1) & (HSIZE - 1);
    if (htab[h] < 0) htab[h] = a;
  }
  let n = na;
  for (let r = 0; r < nr; r++) {
    const id = host_record_field_i64(LOG, r, 0); let h = hslot(id);
    while (htab[h] >= 0 && host_record_field_i64(REG, htab[h], 0) != id) h = (h + 1) & (HSIZE - 1);
    const a = htab[h];
    if (a >= 0) {
      const cur = newest[a];
      if (cur < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, cur, 1)) newest[a] = r;
    } else if (n < MAXO) {
      rowRef[n] = -(r + 1); rowId[n] = id;
      rowCls[n] = schemaBad || isNaN(massKg(r)) || isNaN(pressKpa(r)) ? 0 : 7; n++;
    }
  }
  for (let a = 0; a < na; a++) { rowRef[a] = a; rowId[a] = host_record_field_i64(REG, a, 0); rowCls[a] = classify(a, newest[a]); }
  for (let i = 0; i < n; i++) ord[i] = i;
  for (let s = n / 2 - 1; s >= 0; s--) sift(s, n);
  for (let e = n - 1; e > 0; e--) { const t = ord[0]; ord[0] = ord[e]; ord[e] = t; sift(0, e); }
  for (let k = 0; k < n; k++) {
    const row = ord[k]; const ref = rowRef[row]; const cls = rowCls[row];
    const r = ref >= 0 ? newest[ref] : -ref - 1;
    const rc = ref >= 0 ? host_record_field_f64(REG, ref, 1) : NaN;
    const rp = ref >= 0 ? host_record_field_f64(REG, ref, 2) : NaN;
    const m = r >= 0 ? massKg(r) : NaN;
    out_begin();
    out_set_i64(0, rowId[row]);
    out_set_i64(1, r >= 0 ? host_record_field_i64(LOG, r, 1) : -1);
    out_set_f64(2, m); out_set_f64(3, rc); out_set_f64(4, m - rc);
    out_set_f64(5, r >= 0 ? pressKpa(r) : NaN); out_set_f64(6, rp);
    putStr(7, nameBuf[cls]); putStr(8, detBuf[cls]);
    out_commit();
  }
  effect_emit(100, OUT_SET);
  return n;
}
