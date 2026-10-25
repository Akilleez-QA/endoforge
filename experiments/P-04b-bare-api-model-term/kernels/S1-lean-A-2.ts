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

const SLOTS: i32 = 16384;
const SCRATCH = memory.data(256);
// Open-addressing index: per slot i32 asset+1, i32 best reading+1
const TABLE = memory.data(131072);
const CLS: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DET: StaticArray<string> = ["invalid unit, value, or field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];

let useIndex = false;
let badR = false;
let badA = false;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;

function kindsOk(set: u32, code: string): bool {
  for (let i = 0; i < code.length; i++) if (host_field_kind(set, i) != code.charCodeAt(i) - 48) return false;
  return true;
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eq(p: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) if ((<i32>load<u8>(p + <usize>i) | 0x20) != lit.charCodeAt(i)) return false;
  return true;
}

function unitFactor(r: i32, f: i32, mass: bool): f64 {
  let e = host_record_field_str(0, r, f, SCRATCH, 32);
  if (e < 0) return NaN;
  let s: i32 = 0;
  while (s < e && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  const p = SCRATCH + <usize>s;
  const n = e - s;
  if (mass) {
    if (eq(p, n, "kg")) return 1.0;
    if (eq(p, n, "lb")) return 0.45359237;
  } else {
    if (eq(p, n, "kpa")) return 1.0;
    if (eq(p, n, "bar")) return 100.0;
    if (eq(p, n, "psi")) return 6.894757293168;
  }
  return NaN;
}

function loadReading(r: i32): bool {
  gKg = NaN;
  gKpa = NaN;
  if (badR) return false;
  const m = host_record_field_f64(0, r, 2);
  gKg = m * unitFactor(r, 3, true);
  gKpa = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
  return isFinite(gKg) && isFinite(gKpa) && m >= 0;
}

function hash(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 50);
}

function probe(id: i64): usize {
  let s = hash(id);
  let v = load<i32>(TABLE + <usize>s * 8);
  while (v != 0 && host_record_field_i64(1, v - 1, 0) != id) {
    s = (s + 1) & (SLOTS - 1);
    v = load<i32>(TABLE + <usize>s * 8);
  }
  return TABLE + <usize>s * 8;
}

function bestOf(id: i64, nr: i32): i32 {
  if (useIndex) {
    const p = probe(id);
    return load<i32>(p) == 0 ? -1 : load<i32>(p + 4) - 1;
  }
  let b = -1;
  // O(n*m) fallback only when the asset count exceeds index capacity
  for (let r = 0; r < nr; r++) {
    if (host_record_field_i64(0, r, 0) == id && (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1))) b = r;
  }
  return b;
}

function hasAsset(id: i64, na: i32): bool {
  if (useIndex) return load<i32>(probe(id)) != 0;
  for (let a = 0; a < na; a++) if (host_record_field_i64(1, a, 0) == id) return true;
  return false;
}

function put(field: i32, s: string): void {
  const n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + 128 + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH + 128, n);
}

function emit(c: i32, id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  put(7, CLS[c]);
  put(8, DET[c]);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nr = max<i32>(0, host_record_count(0));
  const na = max<i32>(0, host_record_count(1));
  badR = !kindsOk(0, "0012122");
  badA = !kindsOk(1, "011221");
  useIndex = na <= SLOTS / 2;
  memory.fill(TABLE, 0, 131072);
  if (useIndex) {
    for (let a = 0; a < na; a++) {
      const p = probe(host_record_field_i64(1, a, 0));
      if (load<i32>(p) == 0) store<i32>(p, a + 1);
    }
    for (let r = 0; r < nr; r++) {
      const p = probe(host_record_field_i64(0, r, 0));
      const b = load<i32>(p + 4);
      if (load<i32>(p) != 0 && (b == 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b - 1, 1))) store<i32>(p + 4, r + 1);
    }
  }
  let count = 0;
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(1, a, 0);
    const rkg = host_record_field_f64(1, a, 1);
    const rkpa = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    let ok = !badA && isFinite(rkg) && rkg >= 0 && isFinite(rkpa) && isFinite(tp);
    const b = bestOf(id, nr);
    let ts: i64 = -1;
    gKg = NaN;
    gKpa = NaN;
    if (b >= 0) {
      ts = host_record_field_i64(0, b, 1);
      ok = loadReading(b) && ok;
    }
    let c = 8;
    const tol = max<f64>(abs_tol_kg, tp / 100.0 * rkg);
    if (!ok) c = 0;
    else if (b < 0) c = 1;
    else if (as_of_ts - ts > max_age_days * 86400) c = 2;
    else if (rkg - gKg > tol) c = 3;
    else if (gKg - rkg > tol) c = 4;
    else if (gKpa - rkpa > rel_tol * rkpa) c = 5;
    else if (rkpa - gKpa > rel_tol * rkpa) c = 6;
    emit(c, id, ts, gKg, rkg, gKpa, rkpa);
    count++;
  }
  for (let r = 0; r < nr; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (hasAsset(id, na)) continue;
    const ok = loadReading(r);
    emit(ok ? 7 : 0, id, host_record_field_i64(0, r, 1), gKg, NaN, gKpa, NaN);
    count++;
  }
  return count;
}
