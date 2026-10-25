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
const BITS: i32 = 17;
const CAP: i32 = 1 << BITS;
// Open-addressing index on asset_id: slot holds asset index + 1, 0 = empty
const SLOTS: usize = memory.data(CAP * 4);
// Newest reading per asset: reading index + 1, 0 = none
const BEST: usize = memory.data(CAP * 4);
const SBUF: usize = memory.data(256);

const U_KG = String.UTF8.encode("kg");
const U_LB = String.UTF8.encode("lb");
const U_KPA = String.UTF8.encode("kpa");
const U_BAR = String.UTF8.encode("bar");
const U_PSI = String.UTF8.encode("psi");
const C_MAL = String.UTF8.encode("MALFORMED");
const C_NOR = String.UTF8.encode("NO_READING");
const C_STA = String.UTF8.encode("STALE");
const C_UND = String.UTF8.encode("UNDERCHARGE");
const C_OVR = String.UTF8.encode("OVERCHARGE");
const C_PHI = String.UTF8.encode("PRESSURE_HIGH");
const C_PLO = String.UTF8.encode("PRESSURE_LOW");
const C_ORP = String.UTF8.encode("ORPHAN_READING");
const C_OK = String.UTF8.encode("OK");
const D_MAL = String.UTF8.encode("unknown unit, negative mass, non-finite value, or absent field");
const D_NOR = String.UTF8.encode("no reading found for asset");
const D_STA = String.UTF8.encode("newest reading older than max_age_days");
const D_UND = String.UTF8.encode("charge below rated beyond tolerance");
const D_OVR = String.UTF8.encode("charge above rated beyond tolerance");
const D_PHI = String.UTF8.encode("pressure above rated beyond rel_tol");
const D_PLO = String.UTF8.encode("pressure below rated beyond rel_tol");
const D_ORP = String.UTF8.encode("reading asset_id not in asset register");
const D_OK = String.UTF8.encode("within tolerance");

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> <u64>(64 - BITS));
}

function lookup(id: i64): i32 {
  let s = slotOf(id);
  while (true) {
    const v = load<i32>(SLOTS + (<usize>s << 2));
    if (v == 0) return -1;
    if (host_record_field_i64(REG, v - 1, 0) == id) return v - 1;
    s = (s + 1) & (CAP - 1);
  }
  return -1;
}

function eqi(p: usize, n: i32, s: ArrayBuffer): bool {
  if (n != s.byteLength) return false;
  const q = changetype<usize>(s);
  for (let i = 0; i < n; i++) {
    let c = load<u8>(p + i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != load<u8>(q + i)) return false;
  }
  return true;
}

// Returns conversion factor to kg (mass) or kPa (pressure), or -1 if unknown
function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(LOG, idx, field, SBUF, 256);
  if (n < 0) return -1;
  let a = 0;
  let b = n;
  while (a < b && (load<u8>(SBUF + a) <= 32)) a++;
  while (b > a && (load<u8>(SBUF + b - 1) <= 32)) b--;
  const p = SBUF + a;
  const len = b - a;
  if (mass) {
    if (eqi(p, len, U_KG)) return 1.0;
    if (eqi(p, len, U_LB)) return 0.45359237;
    return -1;
  }
  if (eqi(p, len, U_KPA)) return 1.0;
  if (eqi(p, len, U_BAR)) return 100.0;
  if (eqi(p, len, U_PSI)) return 6.894757293168;
  return -1;
}

function emit(id: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, cls: ArrayBuffer, det: ArrayBuffer): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rc);
  out_set_f64(4, ck - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  out_set_str(7, changetype<usize>(cls), cls.byteLength);
  out_set_str(8, changetype<usize>(det), det.byteLength);
  out_commit();
}

function kindsOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let f = 0; f < kinds.length; f++) if (host_field_kind(set, f) != kinds[f]) return false;
  return true;
}

function bad(x: f64): bool {
  return !isFinite(x);
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const n0 = host_record_count(LOG);
  let n1 = host_record_count(REG);
  if (n1 > (CAP >> 1)) n1 = CAP >> 1;
  const ok0 = kindsOk(LOG, [0, 0, 1, 2, 1, 2, 2]);
  const ok1 = kindsOk(REG, [0, 1, 1, 2, 2, 1]);
  memory.fill(SLOTS, 0, <usize>CAP << 2);
  memory.fill(BEST, 0, <usize>CAP << 2);
  let count = 0;
  if (!ok1) {
    for (let a = 0; a < n1; a++) { emit(-1, -1, NaN, NaN, NaN, NaN, C_MAL, D_MAL); count++; }
    return count;
  }
  for (let a = 0; a < n1; a++) {
    const id = host_record_field_i64(REG, a, 0);
    if (lookup(id) >= 0) continue;
    let s = slotOf(id);
    while (load<i32>(SLOTS + (<usize>s << 2)) != 0) s = (s + 1) & (CAP - 1);
    store<i32>(SLOTS + (<usize>s << 2), a + 1);
  }
  if (ok0) {
    for (let r = 0; r < n0; r++) {
      const a = lookup(host_record_field_i64(LOG, r, 0));
      if (a < 0) continue;
      const cur = load<i32>(BEST + (<usize>a << 2));
      if (cur == 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, cur - 1, 1)) store<i32>(BEST + (<usize>a << 2), r + 1);
    }
  }
  for (let a = 0; a < n1; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const rc = host_record_field_f64(REG, a, 1);
    const rp = host_record_field_f64(REG, a, 2);
    const tp = host_record_field_f64(REG, a, 5);
    if (!ok0) { emit(id, -1, NaN, rc, NaN, rp, C_MAL, D_MAL); count++; continue; }
    const r = load<i32>(BEST + (<usize>lookup(id) << 2)) - 1;
    if (r < 0) {
      if (bad(rc) || bad(rp) || bad(tp)) emit(id, -1, NaN, rc, NaN, rp, C_MAL, D_MAL);
      else emit(id, -1, NaN, rc, NaN, rp, C_NOR, D_NOR);
      count++;
      continue;
    }
    const ts = host_record_field_i64(LOG, r, 1);
    const m = host_record_field_f64(LOG, r, 2);
    const p = host_record_field_f64(LOG, r, 4);
    const mf = unitFactor(r, 3, true);
    const pf = unitFactor(r, 5, false);
    const ck = mf < 0 ? NaN : m * mf;
    const pk = pf < 0 ? NaN : p * pf;
    const tol = Math.max(abs_tol_kg, tp / 100.0 * Math.abs(rc));
    const d = ck - rc;
    if (mf < 0 || pf < 0 || m < 0 || bad(m) || bad(p) || bad(rc) || bad(rp) || bad(tp)) emit(id, ts, ck, rc, pk, rp, C_MAL, D_MAL);
    else if (as_of_ts - ts > max_age_days * 86400) emit(id, ts, ck, rc, pk, rp, C_STA, D_STA);
    else if (d < -tol) emit(id, ts, ck, rc, pk, rp, C_UND, D_UND);
    else if (d > tol) emit(id, ts, ck, rc, pk, rp, C_OVR, D_OVR);
    else if (pk - rp > rel_tol * Math.abs(rp)) emit(id, ts, ck, rc, pk, rp, C_PHI, D_PHI);
    else if (rp - pk > rel_tol * Math.abs(rp)) emit(id, ts, ck, rc, pk, rp, C_PLO, D_PLO);
    else emit(id, ts, ck, rc, pk, rp, C_OK, D_OK);
    count++;
  }
  if (!ok0) return count;
  for (let r = 0; r < n0; r++) {
    const id = host_record_field_i64(LOG, r, 0);
    if (lookup(id) >= 0) continue;
    const ts = host_record_field_i64(LOG, r, 1);
    const m = host_record_field_f64(LOG, r, 2);
    const p = host_record_field_f64(LOG, r, 4);
    const mf = unitFactor(r, 3, true);
    const pf = unitFactor(r, 5, false);
    const ck = mf < 0 ? NaN : m * mf;
    const pk = pf < 0 ? NaN : p * pf;
    if (mf < 0 || pf < 0 || m < 0 || bad(m) || bad(p)) emit(id, ts, ck, NaN, pk, NaN, C_MAL, D_MAL);
    else emit(id, ts, ck, NaN, pk, NaN, C_ORP, D_ORP);
    count++;
  }
  return count;
}
