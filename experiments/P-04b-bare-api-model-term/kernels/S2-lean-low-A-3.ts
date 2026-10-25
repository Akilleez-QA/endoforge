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
const SBUF: usize = memory.data(256);
const OBUF: usize = memory.data(256);
let gKg: f64 = NaN;
let gKpa: f64 = NaN;

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqUnit(n: i32, lit: string): bool {
  let s = 0;
  let e = n;
  while (s < e && isWs(<i32>load<u8>(SBUF + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(SBUF + <usize>(e - 1)))) e--;
  if (e - s != lit.length) return false;
  for (let i = 0; i < e - s; i++) {
    let c = <i32>load<u8>(SBUF + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function evalReading(i: i32): bool {
  gKg = NaN;
  gKpa = NaN;
  let m = host_record_field_f64(LOG, i, 2);
  let p = host_record_field_f64(LOG, i, 4);
  if (!isFinite<f64>(m) || !isFinite<f64>(p) || m < 0) return false;
  let n = host_record_field_str(LOG, i, 3, SBUF, 256);
  if (n < 0) return false;
  let kg: f64 = NaN;
  if (eqUnit(n, "kg")) kg = m;
  else if (eqUnit(n, "lb")) kg = m * 0.45359237;
  else return false;
  n = host_record_field_str(LOG, i, 5, SBUF, 256);
  if (n < 0) return false;
  let kpa: f64 = NaN;
  if (eqUnit(n, "kpa")) kpa = p;
  else if (eqUnit(n, "bar")) kpa = p * 100.0;
  else if (eqUnit(n, "psi")) kpa = p * 6.894757293168;
  else return false;
  gKg = kg;
  gKpa = kpa;
  return true;
}

function put(s: string, dst: usize): i32 {
  let n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(dst + <usize>i, <u8>s.charCodeAt(i));
  return n;
}

function emit(id: i64, ts: i64, kg: f64, rc: f64, kpa: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, kg - rc);
  out_set_f64(5, kpa);
  out_set_f64(6, rp);
  out_set_str(7, OBUF, put(cls, OBUF));
  out_set_str(8, OBUF + 128, put(det, OBUF + 128));
  out_commit();
}

function slotOf(id: i64, mask: i32): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 40) & mask;
}

function find(keys: StaticArray<i64>, vals: StaticArray<i32>, mask: i32, id: i64): i32 {
  let h = slotOf(id, mask);
  while (vals[h] >= 0) {
    if (keys[h] == id) return vals[h];
    h = (h + 1) & mask;
  }
  return -1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nl = host_record_count(LOG);
  let nr = host_record_count(REG);
  let logOk = true;
  let regOk = true;
  for (let f = 0; f < 7; f++) if (host_field_kind(LOG, f) < 0) logOk = false;
  for (let f = 0; f < 6; f++) if (host_field_kind(REG, f) < 0) regOk = false;
  let cap = 16;
  while (cap < nr * 2) cap <<= 1;
  let mask = cap - 1;
  let keys = new StaticArray<i64>(cap);
  let vals = new StaticArray<i32>(cap);
  for (let h = 0; h < cap; h++) vals[h] = -1;
  let best = new StaticArray<i32>(max(nr, 1));
  let bts = new StaticArray<i64>(max(nr, 1));
  for (let a = 0; a < nr; a++) {
    best[a] = -1;
    if (!regOk) continue;
    let id = host_record_field_i64(REG, a, 0);
    if (find(keys, vals, mask, id) >= 0) continue;
    let h = slotOf(id, mask);
    while (vals[h] >= 0) h = (h + 1) & mask;
    keys[h] = id;
    vals[h] = a;
  }
  if (logOk && regOk) {
    for (let r = 0; r < nl; r++) {
      let a = find(keys, vals, mask, host_record_field_i64(LOG, r, 0));
      if (a < 0) continue;
      let ts = host_record_field_i64(LOG, r, 1);
      if (best[a] < 0 || ts > bts[a]) { best[a] = r; bts[a] = ts; }
    }
  }
  let out = 0;
  for (let a = 0; a < nr; a++) {
    out++;
    if (!regOk || !logOk) { emit(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "absent field"); continue; }
    let id = host_record_field_i64(REG, a, 0);
    let rc = host_record_field_f64(REG, a, 1);
    let rp = host_record_field_f64(REG, a, 2);
    let tp = host_record_field_f64(REG, a, 5);
    if (!isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0) {
      emit(id, -1, NaN, rc, NaN, rp, "MALFORMED", "invalid register value");
      continue;
    }
    let b = best[a];
    if (b < 0) { emit(id, -1, NaN, rc, NaN, rp, "NO_READING", "no reading for asset"); continue; }
    let ts = bts[a];
    if (!evalReading(b)) { emit(id, ts, gKg, rc, gKpa, rp, "MALFORMED", "bad unit or value"); continue; }
    let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
    let d = gKg - rc;
    let pd = gKpa - rp;
    let cls = "OK";
    let det = "within tolerance";
    if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading too old"; }
    else if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated"; }
    else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated"; }
    else if (pd > rel_tol * rp) { cls = "PRESSURE_HIGH"; det = "pressure above rated"; }
    else if (pd < -rel_tol * rp) { cls = "PRESSURE_LOW"; det = "pressure below rated"; }
    emit(id, ts, gKg, rc, gKpa, rp, cls, det);
  }
  if (logOk && regOk) {
    for (let r = 0; r < nl; r++) {
      let id = host_record_field_i64(LOG, r, 0);
      if (find(keys, vals, mask, id) >= 0) continue;
      let ts = host_record_field_i64(LOG, r, 1);
      let ok = evalReading(r);
      emit(id, ts, gKg, NaN, gKpa, NaN, ok ? "ORPHAN_READING" : "MALFORMED", ok ? "asset not in register" : "bad unit or value");
      out++;
    }
  }
  return out;
}
