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

const MAXA: i32 = 100000;
const TBITS: i32 = 17;
const TSIZE: i32 = 1 << TBITS;
const SCRATCH: usize = memory.data(64);
const keys = new StaticArray<i64>(TSIZE);
const slots = new StaticArray<i32>(TSIZE);
const best = new StaticArray<i32>(MAXA);
const CLS: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("MALFORMED"), String.UTF8.encode("NO_READING"), String.UTF8.encode("STALE"),
  String.UTF8.encode("UNDERCHARGE"), String.UTF8.encode("OVERCHARGE"), String.UTF8.encode("PRESSURE_HIGH"),
  String.UTF8.encode("PRESSURE_LOW"), String.UTF8.encode("ORPHAN_READING"), String.UTF8.encode("OK")
];
const DET: StaticArray<ArrayBuffer> = [
  String.UTF8.encode("unknown unit, negative mass, non-finite value, or absent field"),
  String.UTF8.encode("no reading for asset"), String.UTF8.encode("newest reading older than max_age_days"),
  String.UTF8.encode("charge below rated beyond tolerance"), String.UTF8.encode("charge above rated beyond tolerance"),
  String.UTF8.encode("pressure above rated beyond rel_tol"), String.UTF8.encode("pressure below rated beyond rel_tol"),
  String.UTF8.encode("reading has no asset in register"), String.UTF8.encode("within tolerance")
];

let gCkg: f64 = NaN;
let gPkpa: f64 = NaN;

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> <u64>(64 - TBITS));
}

function insert(id: i64, a: i32): void {
  let h = slotOf(id);
  while (unchecked(slots[h]) != 0) {
    if (unchecked(keys[h]) == id) return;
    h = (h + 1) & (TSIZE - 1);
  }
  unchecked(keys[h] = id);
  unchecked(slots[h] = a + 1);
}

function find(id: i64): i32 {
  let h = slotOf(id);
  let s = unchecked(slots[h]);
  while (s != 0) {
    if (unchecked(keys[h]) == id) return s - 1;
    h = (h + 1) & (TSIZE - 1);
    s = unchecked(slots[h]);
  }
  return -1;
}

function isWs(b: u8): bool {
  return b == 32 || (b >= 9 && b <= 13);
}

function unitFactor(set: u32, idx: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(set, idx, field, SCRATCH, 64);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  if (e - s < 2 || e - s > 3) return NaN;
  let w: u32 = 0;
  for (let i = s; i < e; i++) w = (w << 8) | (<u32>load<u8>(SCRATCH + <usize>i) | 0x20);
  if (mass) {
    if (w == 0x6B67) return 1.0;
    if (w == 0x6C62) return 0.45359237;
    return NaN;
  }
  if (w == 0x6B7061) return 1.0;
  if (w == 0x626172) return 100.0;
  if (w == 0x707369) return 6.894757293168;
  return NaN;
}

function convert(r: i32, s0ok: bool): bool {
  gCkg = NaN;
  gPkpa = NaN;
  if (!s0ok) return false;
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  gCkg = m * unitFactor(0, r, 3, true);
  gPkpa = p * unitFactor(0, r, 5, false);
  return isFinite<f64>(gCkg) && isFinite<f64>(gPkpa) && m >= 0;
}

function emit(id: i64, ts: i64, ckg: f64, rkg: f64, pkpa: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ckg);
  out_set_f64(3, rkg);
  out_set_f64(4, ckg - rkg);
  out_set_f64(5, pkpa);
  out_set_f64(6, rp);
  const c = unchecked(CLS[cls]);
  out_set_str(7, changetype<usize>(c), c.byteLength);
  const d = unchecked(DET[cls]);
  out_set_str(8, changetype<usize>(d), d.byteLength);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nR = host_record_count(0);
  const nA = min(host_record_count(1), MAXA);
  const s0ok = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1
    && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2 && host_field_kind(0, 6) == 2;
  const s1ok = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1
    && host_field_kind(1, 3) == 2 && host_field_kind(1, 4) == 2 && host_field_kind(1, 5) == 1;
  for (let i = 0; i < TSIZE; i++) unchecked(slots[i] = 0);
  for (let a = 0; a < nA; a++) {
    unchecked(best[a] = -1);
    insert(host_record_field_i64(1, a, 0), a);
  }
  // open-addressing index on asset_id avoids the O(n*m) nested join
  for (let r = 0; r < nR; r++) {
    const a = find(host_record_field_i64(0, r, 0));
    if (a < 0) continue;
    const b = unchecked(best[a]);
    if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) unchecked(best[a] = r);
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    const id = host_record_field_i64(1, a, 0);
    const rk = host_record_field_f64(1, a, 1);
    const rp = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    const b = unchecked(best[find(id)]);
    let ok = s1ok && isFinite<f64>(rk) && isFinite<f64>(rp) && isFinite<f64>(tp) && rk >= 0;
    let ts: i64 = -1;
    gCkg = NaN;
    gPkpa = NaN;
    if (b >= 0) {
      ts = host_record_field_i64(0, b, 1);
      if (!convert(b, s0ok)) ok = false;
    }
    let cls = 8;
    if (!ok) cls = 0;
    else if (b < 0) cls = 1;
    else if (as_of_ts - ts > max_age_days * 86400) cls = 2;
    else {
      const tol = max<f64>(abs_tol_kg, tp / 100.0 * rk);
      if (rk - gCkg > tol) cls = 3;
      else if (gCkg - rk > tol) cls = 4;
      else if (gPkpa - rp > rel_tol * rp) cls = 5;
      else if (rp - gPkpa > rel_tol * rp) cls = 6;
    }
    emit(id, ts, gCkg, rk, gPkpa, rp, cls);
    count++;
  }
  for (let r = 0; r < nR; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (find(id) >= 0) continue;
    const ok = convert(r, s0ok);
    emit(id, host_record_field_i64(0, r, 1), gCkg, NaN, gPkpa, NaN, ok ? 7 : 0);
    count++;
  }
  return count;
}
