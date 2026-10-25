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
const SLOTS: i32 = 65536;
const MASK: i32 = SLOTS - 1;
const MAX_ASSETS: i32 = 49152;
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const SCR: usize = memory.data(256);
const OUT: usize = memory.data(128);
const keys = new StaticArray<i64>(SLOTS);
const vals = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(MAX_ASSETS);

let gTs: i64 = -1;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gBad: bool = false;

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 48) & MASK;
}

// Open-addressing index on asset_id avoids the O(n*m) nested-loop join.
function lookup(id: i64): i32 {
  let s = slotOf(id);
  while (true) {
    const v = unchecked(vals[s]);
    if (v < 0) return -1;
    if (unchecked(keys[s]) == id) return v;
    s = (s + 1) & MASK;
  }
  return -1;
}

function insert(id: i64, a: i32): void {
  let s = slotOf(id);
  while (unchecked(vals[s]) >= 0) {
    if (unchecked(keys[s]) == id) return;
    s = (s + 1) & MASK;
  }
  unchecked(keys[s] = id);
  unchecked(vals[s] = a);
}

function kindsOk(set: u32, spec: string): bool {
  for (let i = 0; i < spec.length; i++) {
    if (host_field_kind(set, i) != spec.charCodeAt(i) - 48) return false;
  }
  return true;
}

function eqCI(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let c = <i32>load<u8>(SCR + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitCode(r: i32, field: i32, pressure: bool): i32 {
  const n = host_record_field_str(LOG, r, field, SCR, 256);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && (load<u8>(SCR + <usize>s) <= 32)) s++;
  while (e > s && (load<u8>(SCR + <usize>(e - 1)) <= 32)) e--;
  if (!pressure) return eqCI(s, e, "kg") ? 0 : eqCI(s, e, "lb") ? 1 : -1;
  return eqCI(s, e, "kpa") ? 0 : eqCI(s, e, "bar") ? 1 : eqCI(s, e, "psi") ? 2 : -1;
}

function readReading(r: i32): void {
  gTs = host_record_field_i64(LOG, r, 1);
  const m = host_record_field_f64(LOG, r, 2);
  const p = host_record_field_f64(LOG, r, 4);
  const mu = unitCode(r, 3, false);
  const pu = unitCode(r, 5, true);
  gBad = !isFinite<f64>(m) || !isFinite<f64>(p) || m < 0 || mu < 0 || pu < 0;
  gKg = mu < 0 ? NaN : mu == 1 ? m * LB_KG : m;
  gKpa = pu < 0 ? NaN : pu == 1 ? p * 100.0 : pu == 2 ? p * PSI_KPA : p;
}

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(OUT + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OUT, n);
}

function emit(id: i64, ts: i64, kg: f64, rc: f64, kpa: f64, rp: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, kg - rc);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nl = max(host_record_count(LOG), 0);
  const na = max(host_record_count(REG), 0);
  const regOk = kindsOk(REG, "011221");
  const logOk = kindsOk(LOG, "0012122");
  let count = 0;
  if (!regOk || !logOk) {
    const idOk = host_field_kind(REG, 0) == 0;
    for (let a = 0; a < na; a++) {
      emit(idOk ? host_record_field_i64(REG, a, 0) : -1, -1, NaN, NaN, NaN, NaN, "MALFORMED", regOk ? "reading log field absent" : "asset register field absent");
      count++;
    }
    return count;
  }
  for (let s = 0; s < SLOTS; s++) unchecked(vals[s] = -1);
  const lim = min(na, MAX_ASSETS);
  for (let a = 0; a < lim; a++) {
    unchecked(best[a] = -1);
    insert(host_record_field_i64(REG, a, 0), a);
  }
  for (let r = 0; r < nl; r++) {
    const k = lookup(host_record_field_i64(LOG, r, 0));
    if (k < 0) continue;
    const b = unchecked(best[k]);
    if (b < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, b, 1)) unchecked(best[k] = r);
  }
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const rc = host_record_field_f64(REG, a, 1);
    const rp = host_record_field_f64(REG, a, 2);
    const tp = host_record_field_f64(REG, a, 5);
    const k = lookup(id);
    const b = k >= 0 ? unchecked(best[k]) : -1;
    gTs = -1; gKg = NaN; gKpa = NaN; gBad = false;
    if (b >= 0) readReading(b);
    const tol = max(abs_tol_kg, tp / 100.0 * rc);
    const dp = gKpa - rp;
    let cls = "OK";
    let det = "within tolerance";
    if (k < 0) { cls = "MALFORMED"; det = "asset beyond kernel index capacity"; }
    else if (!isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0) { cls = "MALFORMED"; det = "non-finite or negative rated value"; }
    else if (b < 0) { cls = "NO_READING"; det = "no reading for asset"; }
    else if (gBad) { cls = "MALFORMED"; det = "unknown unit, negative mass, or non-finite reading"; }
    else if (as_of_ts - gTs > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
    else if (rc - gKg > tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (gKg - rc > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (dp > rel_tol * Math.abs(rp)) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
    else if (-dp > rel_tol * Math.abs(rp)) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    emit(id, gTs, gKg, rc, gKpa, rp, cls, det);
    count++;
  }
  for (let r = 0; r < nl; r++) {
    const id = host_record_field_i64(LOG, r, 0);
    if (lookup(id) >= 0) continue;
    readReading(r);
    if (gBad) emit(id, gTs, gKg, NaN, gKpa, NaN, "MALFORMED", "orphan reading with invalid unit or value");
    else emit(id, gTs, gKg, NaN, gKpa, NaN, "ORPHAN_READING", "reading asset_id not in register");
    count++;
  }
  return count;
}
