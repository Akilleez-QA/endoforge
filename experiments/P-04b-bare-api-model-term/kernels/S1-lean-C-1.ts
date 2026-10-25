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

const LOG: u32 = 0;
const REG: u32 = 1;
const CAP: i32 = 32768;
const MAXA: i32 = 16384;
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const DAY: i64 = 86400;

// open-addressing index on asset_id; slot holds asset index + 1, 0 = empty
const keys = new StaticArray<i64>(CAP);
const slot = new StaticArray<i32>(CAP);
const best = new StaticArray<i32>(MAXA);
const unitBuf = memory.data(64);
const strBuf = memory.data(256);

let rKg: f64 = NaN;
let rKpa: f64 = NaN;
let rBad = false;

function hashOf(k: i64): i32 {
  return <i32>((<u64>k * 0x9E3779B97F4A7C15) >> 49) & (CAP - 1);
}

function lookup(k: i64): i32 {
  let h = hashOf(k);
  while (unchecked(slot[h]) != 0) {
    if (unchecked(keys[h]) == k) return unchecked(slot[h]) - 1;
    h = (h + 1) & (CAP - 1);
  }
  return -1;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// copies a unit string into unitBuf trimmed and lowercased; -1 if truncated
function readUnit(i: i32, field: i32): i32 {
  const n = host_record_field_str(LOG, i, field, unitBuf, 32);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(unitBuf + <usize>s))) s++;
  while (e > s && isWs(load<u8>(unitBuf + <usize>(e - 1)))) e--;
  for (let j = s; j < e; j++) {
    const c = load<u8>(unitBuf + <usize>j);
    store<u8>(unitBuf + <usize>(j - s), c >= 65 && c <= 90 ? c + 32 : c);
  }
  return e - s;
}

function isLit(n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let j = 0; j < n; j++) {
    if (load<u8>(unitBuf + <usize>j) != <u8>lit.charCodeAt(j)) return false;
  }
  return true;
}

function readReading(i: i32): void {
  const m = host_record_field_f64(LOG, i, 2);
  const p = host_record_field_f64(LOG, i, 4);
  rBad = !isFinite(m) || m < 0 || !isFinite(p);
  let n = readUnit(i, 3);
  rKg = isLit(n, "kg") ? m : isLit(n, "lb") ? m * LB_KG : NaN;
  n = readUnit(i, 5);
  rKpa = isLit(n, "kpa") ? p : isLit(n, "bar") ? p * 100.0 : isLit(n, "psi") ? p * PSI_KPA : NaN;
  if (isNaN(rKg) || isNaN(rKpa)) rBad = true;
}

function putStr(field: i32, s: string): void {
  const n = String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, strBuf);
  out_set_str(field, strBuf, <i32>n);
}

function emit(aid: i64, ts: i64, kg: f64, rk: f64, kpa: f64, rp: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rk);
  out_set_f64(4, kg - rk);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

function schemaOk(): bool {
  return host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0 && host_field_kind(LOG, 2) == 1
    && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2
    && host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1 && host_field_kind(REG, 2) == 1
    && host_field_kind(REG, 5) == 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nA = host_record_count(REG);
  const nR = host_record_count(LOG);
  if (!schemaOk() || nA < 0 || nA > MAXA || nR < 0 || !isFinite(abs_tol_kg) || !isFinite(rel_tol)) {
    emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input schema, size, or parameters invalid");
    return 1;
  }
  for (let h = 0; h < CAP; h++) unchecked(slot[h] = 0);
  for (let a = 0; a < nA; a++) {
    unchecked(best[a] = -1);
    const k = host_record_field_i64(REG, a, 0);
    let h = hashOf(k);
    while (unchecked(slot[h]) != 0 && unchecked(keys[h]) != k) h = (h + 1) & (CAP - 1);
    if (unchecked(slot[h]) == 0) {
      unchecked(keys[h] = k);
      unchecked(slot[h] = a + 1);
    }
  }
  // newest reading per asset_id; ties keep the lowest record index
  for (let i = 0; i < nR; i++) {
    const a = lookup(host_record_field_i64(LOG, i, 0));
    if (a < 0) continue;
    const b = unchecked(best[a]);
    if (b < 0 || host_record_field_i64(LOG, i, 1) > host_record_field_i64(LOG, b, 1)) unchecked(best[a] = i);
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    const aid = host_record_field_i64(REG, a, 0);
    const rk = host_record_field_f64(REG, a, 1);
    const rp = host_record_field_f64(REG, a, 2);
    const tp = host_record_field_f64(REG, a, 5);
    const b = unchecked(best[lookup(aid)]);
    const ts: i64 = b < 0 ? -1 : host_record_field_i64(LOG, b, 1);
    rKg = NaN;
    rKpa = NaN;
    rBad = false;
    if (b >= 0) readReading(b);
    const regBad = !isFinite(rk) || rk < 0 || !isFinite(rp) || !isFinite(tp);
    const tol = Math.max(abs_tol_kg, tp / 100.0 * rk);
    const delta = rKg - rk;
    const ptol = rel_tol * Math.abs(rp);
    let cls = "OK";
    let detail = "within tolerance";
    if (regBad) { cls = "MALFORMED"; detail = "asset register value invalid"; }
    else if (rBad) { cls = "MALFORMED"; detail = "reading unit or value invalid"; }
    else if (b < 0) { cls = "NO_READING"; detail = "no reading for asset"; }
    else if (as_of_ts - ts > max_age_days * DAY) { cls = "STALE"; detail = "newest reading older than max_age_days"; }
    else if (delta < -tol) { cls = "UNDERCHARGE"; detail = "charge below rated beyond tolerance"; }
    else if (delta > tol) { cls = "OVERCHARGE"; detail = "charge above rated beyond tolerance"; }
    else if (rKpa - rp > ptol) { cls = "PRESSURE_HIGH"; detail = "pressure above rated beyond rel_tol"; }
    else if (rp - rKpa > ptol) { cls = "PRESSURE_LOW"; detail = "pressure below rated beyond rel_tol"; }
    emit(aid, ts, rKg, rk, rKpa, rp, cls, detail);
    count++;
  }
  for (let i = 0; i < nR; i++) {
    const aid = host_record_field_i64(LOG, i, 0);
    if (lookup(aid) >= 0) continue;
    readReading(i);
    const ts = host_record_field_i64(LOG, i, 1);
    if (rBad) emit(aid, ts, rKg, NaN, rKpa, NaN, "MALFORMED", "orphan reading unit or value invalid");
    else emit(aid, ts, rKg, NaN, rKpa, NaN, "ORPHAN_READING", "asset_id not in asset register");
    count++;
  }
  return count;
}
