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

const LB: f64 = 0.45359237;
const PSI: f64 = 6.894757293168;
const SLOTS: i32 = 32768;
const MAXA: i32 = 16384;
const keys = new StaticArray<i64>(SLOTS);
const slot = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(MAXA);
const bestTs = new StaticArray<i64>(MAXA);
const scratch = memory.data(64);
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["bad unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];
const NB = new StaticArray<ArrayBuffer>(9);
const DB = new StaticArray<ArrayBuffer>(9);
for (let i = 0; i < 9; i++) {
  NB[i] = String.UTF8.encode(NAMES[i]);
  DB[i] = String.UTF8.encode(DETAILS[i]);
}

let gTs: i64 = -1;
let gC: f64 = NaN;
let gP: f64 = NaN;
let gBad: bool = false;

function hash(id: i64): i32 {
  return <i32>((<u64>id * <u64>0x9E3779B97F4A7C15) >> 49);
}

function find(id: i64): i32 {
  let h = hash(id);
  while (true) {
    const s = unchecked(slot[h]);
    if (s < 0 || unchecked(keys[h]) == id) return s;
    h = (h + 1) & (SLOTS - 1);
  }
}

function match(p: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitCode(r: i32, field: i32, pressure: bool): i32 {
  let n = host_record_field_str(0, r, field, scratch, 64);
  if (n < 0) return -1;
  let s: i32 = 0;
  while (s < n && load<u8>(scratch + <usize>s) <= 32) s++;
  while (n > s && load<u8>(scratch + <usize>(n - 1)) <= 32) n--;
  const p = scratch + <usize>s;
  const len = n - s;
  if (!pressure) return match(p, len, "kg") ? 0 : match(p, len, "lb") ? 1 : -1;
  return match(p, len, "kpa") ? 0 : match(p, len, "bar") ? 1 : match(p, len, "psi") ? 2 : -1;
}

function readReading(r: i32): void {
  gTs = host_record_field_i64(0, r, 1);
  const m = host_record_field_f64(0, r, 2);
  const mu = unitCode(r, 3, false);
  const p = host_record_field_f64(0, r, 4);
  const pu = unitCode(r, 5, true);
  gC = mu == 0 ? m : mu == 1 ? m * LB : NaN;
  gP = pu == 0 ? p : pu == 1 ? p * 100.0 : pu == 2 ? p * PSI : NaN;
  gBad = mu < 0 || pu < 0 || !isFinite(m) || !isFinite(p) || m < 0.0;
}

function emit(id: i64, rc: f64, rp: f64, k: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, gTs);
  out_set_f64(2, gC);
  out_set_f64(3, rc);
  out_set_f64(4, gC - rc);
  out_set_f64(5, gP);
  out_set_f64(6, rp);
  out_set_str(7, changetype<usize>(NB[k]), NB[k].byteLength);
  out_set_str(8, changetype<usize>(DB[k]), DB[k].byteLength);
  out_commit();
}

function kindsOk(): bool {
  return host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2 && host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const ok = kindsOk();
  const nR = host_record_count(0);
  const nA = min(host_record_count(1), MAXA);
  let count: i32 = 0;
  for (let i = 0; i < SLOTS; i++) unchecked(slot[i] = -1);
  for (let a = 0; a < nA; a++) {
    gTs = -1; gC = NaN; gP = NaN;
    if (!ok) { emit(-1, NaN, NaN, 0); count++; continue; }
    const id = host_record_field_i64(1, a, 0);
    unchecked(best[a] = -1);
    let h = hash(id);
    while (unchecked(slot[h]) >= 0 && unchecked(keys[h]) != id) h = (h + 1) & (SLOTS - 1);
    if (unchecked(slot[h]) < 0) { unchecked(keys[h] = id); unchecked(slot[h] = a); }
  }
  if (!ok) return count;
  // index lookup keeps the join O(n + m) instead of a nested loop
  for (let r = 0; r < nR; r++) {
    const a = find(host_record_field_i64(0, r, 0));
    const ts = host_record_field_i64(0, r, 1);
    if (a >= 0 && (unchecked(best[a]) < 0 || ts > unchecked(bestTs[a]))) { unchecked(best[a] = r); unchecked(bestTs[a] = ts); }
  }
  for (let a = 0; a < nA; a++) {
    const id = host_record_field_i64(1, a, 0);
    const rc = host_record_field_f64(1, a, 1);
    const rp = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    const r = unchecked(best[a]);
    if (r < 0) { gTs = -1; gC = NaN; gP = NaN; gBad = false; } else readReading(r);
    let k: i32 = 8;
    if (gBad || !isFinite(rc) || !isFinite(rp) || !isFinite(tp) || rc < 0.0) k = 0;
    else if (r < 0) k = 1;
    else if (as_of_ts - gTs > max_age_days * 86400) k = 2;
    else {
      const tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
      const d = gC - rc;
      const pt = rel_tol * Math.abs(rp);
      if (d < -tol) k = 3;
      else if (d > tol) k = 4;
      else if (gP - rp > pt) k = 5;
      else if (rp - gP > pt) k = 6;
    }
    emit(id, rc, rp, k);
    count++;
  }
  for (let r = 0; r < nR; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (find(id) >= 0) continue;
    readReading(r);
    emit(id, NaN, NaN, gBad ? 0 : 7);
    count++;
  }
  return count;
}
