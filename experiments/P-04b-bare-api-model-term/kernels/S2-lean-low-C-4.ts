import { memory } from "memory";

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
const SB: usize = memory.data(256);
const HA: usize = memory.data(16384 * 4);
const HB: usize = memory.data(16384 * 4);
const HK: usize = memory.data(16384 * 8);
let gCk: f64 = 0.0;
let gPk: f64 = 0.0;
let gBad: bool = false;
let schemaBad: bool = false;

function slotOf(key: i64): i32 {
  return <i32>((<u64>key * 0x9E3779B97F4A7C15) >> 50);
}

function find(key: i64): i32 {
  let s = slotOf(key);
  while (load<i32>(HA + (<usize>s << 2)) != 0) {
    if (load<i64>(HK + (<usize>s << 3)) == key) return s;
    s = (s + 1) & (SLOTS - 1);
  }
  return -1 - s;
}

function unitCode(idx: i32, field: i32): i32 {
  const n = host_record_field_str(0, idx, field, SB, 256);
  if (n < 0) return -1;
  let a = 0;
  let b = n;
  while (a < b && (load<u8>(SB + a) == 32 || (load<u8>(SB + a) >= 9 && load<u8>(SB + a) <= 13))) a++;
  while (b > a && (load<u8>(SB + b - 1) == 32 || (load<u8>(SB + b - 1) >= 9 && load<u8>(SB + b - 1) <= 13))) b--;
  if (b - a < 2 || b - a > 3) return -1;
  let code = 0;
  for (let i = a; i < b; i++) {
    let c = <i32>load<u8>(SB + i);
    if (c >= 65 && c <= 90) c += 32;
    code |= c << ((i - a) * 8);
  }
  return code;
}

function readReading(r: i32): void {
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  const mu = unitCode(r, 3);
  const pu = unitCode(r, 5);
  gBad = schemaBad || !isFinite<f64>(m) || !isFinite<f64>(p) || m < 0.0;
  gCk = mu == 0x676b ? m : mu == 0x626c ? m * 0.45359237 : f64.NaN;
  gPk = pu == 0x61706b ? p : pu == 0x726162 ? p * 100.0 : pu == 0x697370 ? p * 6.894757293168 : f64.NaN;
  if (isNaN<f64>(gCk) || isNaN<f64>(gPk)) gBad = true;
}

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SB + i, <u8>s.charCodeAt(i));
  out_set_str(field, SB, n);
}

function emit(aid: i64, ts: i64, ck: f64, rck: f64, pk: f64, rpk: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rck);
  out_set_f64(4, ck - rck);
  out_set_f64(5, pk);
  out_set_f64(6, rpk);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  memory.fill(HA, 0, <usize>SLOTS * 4);
  memory.fill(HB, 0, <usize>SLOTS * 4);
  schemaBad = host_field_kind(0, 0) != 0 || host_field_kind(0, 1) != 0 || host_field_kind(0, 2) != 1 || host_field_kind(0, 3) != 2 || host_field_kind(0, 4) != 1 || host_field_kind(0, 5) != 2;
  const assetBad = host_field_kind(1, 0) != 0 || host_field_kind(1, 1) != 1 || host_field_kind(1, 2) != 1 || host_field_kind(1, 5) != 1;
  const nR = host_record_count(0);
  const nA = host_record_count(1);
  let used = 0;
  for (let a = 0; a < nA && used < (SLOTS * 3) / 4; a++) {
    const key = host_record_field_i64(1, a, 0);
    const s = find(key);
    if (s >= 0) continue;
    store<i32>(HA + (<usize>(-1 - s) << 2), a + 1);
    store<i64>(HK + (<usize>(-1 - s) << 3), key);
    used++;
  }
  for (let r = 0; r < nR; r++) {
    const s = find(host_record_field_i64(0, r, 0));
    if (s < 0) continue;
    const best = load<i32>(HB + (<usize>s << 2));
    if (best == 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, best - 1, 1)) store<i32>(HB + (<usize>s << 2), r + 1);
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    const aid = host_record_field_i64(1, a, 0);
    const rck = host_record_field_f64(1, a, 1);
    const rpk = host_record_field_f64(1, a, 2);
    const pct = host_record_field_f64(1, a, 5);
    const s = find(aid);
    const best = s >= 0 && load<i32>(HA + (<usize>s << 2)) == a + 1 ? load<i32>(HB + (<usize>s << 2)) : 0;
    const badA = assetBad || !isFinite<f64>(rck) || !isFinite<f64>(rpk) || !isFinite<f64>(pct) || rck < 0.0;
    if (best == 0) {
      emit(aid, -1, f64.NaN, rck, f64.NaN, rpk, badA ? "MALFORMED" : "NO_READING", badA ? "invalid asset record" : "no reading for asset");
      count++;
      continue;
    }
    const ts = host_record_field_i64(0, best - 1, 1);
    readReading(best - 1);
    const tol = max(abs_tol_kg, pct / 100.0 * rck);
    let cls = "OK";
    let det = "within tolerance";
    if (gBad || badA) { cls = "MALFORMED"; det = "bad unit, value, or field"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading too old"; }
    else if (rck - gCk > tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (gCk - rck > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (gPk - rpk > rel_tol * rpk) { cls = "PRESSURE_HIGH"; det = "pressure above rated"; }
    else if (rpk - gPk > rel_tol * rpk) { cls = "PRESSURE_LOW"; det = "pressure below rated"; }
    emit(aid, ts, gCk, rck, gPk, rpk, cls, det);
    count++;
  }
  for (let r = 0; r < nR; r++) {
    const aid = host_record_field_i64(0, r, 0);
    if (find(aid) >= 0) continue;
    readReading(r);
    emit(aid, host_record_field_i64(0, r, 1), gCk, f64.NaN, gPk, f64.NaN, gBad ? "MALFORMED" : "ORPHAN_READING", gBad ? "bad unit, value, or field" : "asset not in register");
    count++;
  }
  return count;
}
