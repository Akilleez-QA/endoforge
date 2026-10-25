// Output order: classification rank (section 6 order), then asset_id, then entry index; overrides 1.10 and the T5 order as requested
// Effect 100 payload is the committed record count; the output record-set handle is not exposed to the kernel
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
const SCRATCH: usize = memory.data(256);
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
let gAbs: f64 = 0.05;
let gRel: f64 = 0.02;
let gMaxAge: i64 = 30;
let gAsOf: i64 = 0;
let rank = new StaticArray<i32>(0);
let ea = new StaticArray<i32>(0);
let er = new StaticArray<i32>(0);
let key = new StaticArray<i64>(0);

function eqi(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let c = <i32>load<u8>(SCRATCH + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitCode(r: i32, f: i32): i32 {
  let n = host_record_field_str(LOG, r, f, SCRATCH, 256);
  if (n < 0) return 0;
  let s = 0;
  let e = n;
  while (s < e && (load<u8>(SCRATCH + <usize>s) == 32 || (load<u8>(SCRATCH + <usize>s) >= 9 && load<u8>(SCRATCH + <usize>s) <= 13))) s++;
  while (e > s && (load<u8>(SCRATCH + <usize>(e - 1)) == 32 || (load<u8>(SCRATCH + <usize>(e - 1)) >= 9 && load<u8>(SCRATCH + <usize>(e - 1)) <= 13))) e--;
  if (f == 3) return eqi(s, e, "kg") ? 1 : eqi(s, e, "lb") ? 2 : 0;
  return eqi(s, e, "kpa") ? 1 : eqi(s, e, "bar") ? 2 : eqi(s, e, "psi") ? 3 : 0;
}

function kgOf(r: i32): f64 {
  let u = unitCode(r, 3);
  let m = host_record_field_f64(LOG, r, 2);
  return u == 1 ? m : u == 2 ? m * LB_KG : NaN;
}

function kpaOf(r: i32): f64 {
  let u = unitCode(r, 5);
  let p = host_record_field_f64(LOG, r, 4);
  return u == 1 ? p : u == 2 ? p * 100.0 : u == 3 ? p * PSI_KPA : NaN;
}

function readingBad(r: i32): bool {
  let m = host_record_field_f64(LOG, r, 2);
  return !isFinite<f64>(kgOf(r)) || !isFinite<f64>(kpaOf(r)) || m < 0;
}

function classify(a: i32, r: i32): i32 {
  let rc = host_record_field_f64(REG, a, 1);
  let rp = host_record_field_f64(REG, a, 2);
  let tp = host_record_field_f64(REG, a, 5);
  if (!isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0) return 0;
  if (r < 0) return 1;
  if (readingBad(r)) return 0;
  if (gAsOf - host_record_field_i64(LOG, r, 1) > gMaxAge * 86400) return 2;
  let kg = kgOf(r);
  let tol = Math.max(gAbs, tp / 100.0 * rc);
  if (rc - kg > tol) return 3;
  if (kg - rc > tol) return 4;
  let p = kpaOf(r);
  if (p - rp > gRel * Math.abs(rp)) return 5;
  if (rp - p > gRel * Math.abs(rp)) return 6;
  return 8;
}

function schemaOk(): bool {
  return host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0 && host_field_kind(LOG, 2) == 1
    && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2
    && host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1 && host_field_kind(REG, 2) == 1
    && host_field_kind(REG, 5) == 1;
}

function less(x: i32, y: i32): bool {
  if (rank[x] != rank[y]) return rank[x] < rank[y];
  if (key[x] != key[y]) return key[x] < key[y];
  return x < y;
}

function sift(o: StaticArray<i32>, i: i32, n: i32): void {
  while (true) {
    let c = 2 * i + 1;
    if (c >= n) return;
    if (c + 1 < n && less(o[c], o[c + 1])) c++;
    if (!less(o[i], o[c])) return;
    let t = o[i];
    o[i] = o[c];
    o[c] = t;
    i = c;
  }
}

function slot(id: i64, mask: i32): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 32) & mask;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg;
  gRel = rel_tol;
  gMaxAge = max_age_days;
  gAsOf = as_of_ts;
  let names: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
  let details: StaticArray<string> = ["unknown unit, negative mass, non-finite value, or absent field", "no reading for asset", "newest reading older than max_age_days", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];
  let nb = new StaticArray<ArrayBuffer>(9);
  let db = new StaticArray<ArrayBuffer>(9);
  for (let i = 0; i < 9; i++) {
    nb[i] = String.UTF8.encode(names[i]);
    db[i] = String.UTF8.encode(details[i]);
  }
  let ok = schemaOk();
  let m = max(host_record_count(REG), 0);
  let n = ok ? max(host_record_count(LOG), 0) : 0;
  let cap = 16;
  while (cap < m * 2) cap <<= 1;
  let mask = cap - 1;
  let tab = new StaticArray<i32>(cap);
  for (let i = 0; i < cap; i++) tab[i] = -1;
  let best = new StaticArray<i32>(m);
  let bestTs = new StaticArray<i64>(m);
  for (let a = 0; a < m; a++) {
    best[a] = -1;
    if (!ok) continue;
    let id = host_record_field_i64(REG, a, 0);
    let h = slot(id, mask);
    while (tab[h] >= 0 && host_record_field_i64(REG, tab[h], 0) != id) h = (h + 1) & mask;
    if (tab[h] < 0) tab[h] = a;
  }
  let orph = new StaticArray<i32>(n);
  let no = 0;
  for (let r = 0; r < n; r++) {
    let id = host_record_field_i64(LOG, r, 0);
    let h = slot(id, mask);
    while (tab[h] >= 0 && host_record_field_i64(REG, tab[h], 0) != id) h = (h + 1) & mask;
    let a = tab[h];
    if (a < 0) {
      orph[no++] = r;
      continue;
    }
    let ts = host_record_field_i64(LOG, r, 1);
    if (best[a] < 0 || ts > bestTs[a]) {
      best[a] = r;
      bestTs[a] = ts;
    }
  }
  let total = m + no;
  rank = new StaticArray<i32>(total);
  ea = new StaticArray<i32>(total);
  er = new StaticArray<i32>(total);
  key = new StaticArray<i64>(total);
  let ord = new StaticArray<i32>(total);
  for (let a = 0; a < m; a++) {
    ea[a] = a;
    er[a] = best[a];
    rank[a] = ok ? classify(a, best[a]) : 0;
    key[a] = host_field_kind(REG, 0) == 0 ? host_record_field_i64(REG, a, 0) : -1;
  }
  for (let j = 0; j < no; j++) {
    let k = m + j;
    ea[k] = -1;
    er[k] = orph[j];
    rank[k] = readingBad(orph[j]) ? 0 : 7;
    key[k] = host_record_field_i64(LOG, orph[j], 0);
  }
  for (let i = 0; i < total; i++) ord[i] = i;
  for (let i = total / 2 - 1; i >= 0; i--) sift(ord, i, total);
  for (let e = total - 1; e > 0; e--) {
    let t = ord[0];
    ord[0] = ord[e];
    ord[e] = t;
    sift(ord, 0, e);
  }
  for (let i = 0; i < total; i++) {
    let k = ord[i];
    let a = ea[k];
    let r = er[k];
    let c = rank[k];
    let kg = r >= 0 ? kgOf(r) : NaN;
    let rc = a >= 0 && ok ? host_record_field_f64(REG, a, 1) : NaN;
    out_begin();
    out_set_i64(0, key[k]);
    out_set_i64(1, r >= 0 ? host_record_field_i64(LOG, r, 1) : -1);
    out_set_f64(2, kg);
    out_set_f64(3, rc);
    out_set_f64(4, kg - rc);
    out_set_f64(5, r >= 0 ? kpaOf(r) : NaN);
    out_set_f64(6, a >= 0 && ok ? host_record_field_f64(REG, a, 2) : NaN);
    out_set_str(7, changetype<usize>(nb[c]), nb[c].byteLength);
    out_set_str(8, changetype<usize>(db[c]), db[c].byteLength);
    out_commit();
  }
  effect_emit(100, <u32>total);
  return total;
}
