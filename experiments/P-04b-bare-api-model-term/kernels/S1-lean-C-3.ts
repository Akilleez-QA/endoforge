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

const SCRATCH: usize = memory.data(256);
const UNIT: usize = memory.data(64);
let gCount: i32 = 0;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let gBad: bool = false;

function kindsOk(set: u32, kinds: string): bool {
  for (let f = 0; f < kinds.length; f++) {
    if (host_field_kind(set, f) != kinds.charCodeAt(f) - 48) return false;
  }
  return true;
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqLit(p: usize, n: i32, s: string): bool {
  if (n != s.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != s.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(idx: i32, field: i32): f64 {
  let n = host_record_field_str(0, idx, field, UNIT, 64);
  if (n < 0) return NaN;
  let a = 0;
  let b = n;
  while (a < b && isWs(<i32>load<u8>(UNIT + <usize>a))) a++;
  while (b > a && isWs(<i32>load<u8>(UNIT + <usize>(b - 1)))) b--;
  let p = UNIT + <usize>a;
  let len = b - a;
  if (field == 3) {
    if (eqLit(p, len, "kg")) return 1.0;
    if (eqLit(p, len, "lb")) return 0.45359237;
  } else {
    if (eqLit(p, len, "kpa")) return 1.0;
    if (eqLit(p, len, "bar")) return 100.0;
    if (eqLit(p, len, "psi")) return 6.894757293168;
  }
  return NaN;
}

function readReading(r: i32): void {
  let mass = host_record_field_f64(0, r, 2);
  let pres = host_record_field_f64(0, r, 4);
  let cf = unitFactor(r, 3);
  let pf = unitFactor(r, 5);
  gBad = !isFinite(mass) || mass < 0 || !isFinite(pres) || isNaN(cf) || isNaN(pf);
  gCharge = gBad ? NaN : mass * cf;
  gPress = gBad ? NaN : pres * pf;
}

function setStr(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH, n);
}

function emit(id: i64, ts: i64, ch: f64, rc: f64, pr: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pr);
  out_set_f64(6, rp);
  setStr(7, cls);
  setStr(8, det);
  out_commit();
  gCount++;
}

function slot(keys: StaticArray<i64>, used: StaticArray<u8>, mask: i32, k: i64): i32 {
  let h = <i32>((<u64>k * <u64>0x9E3779B97F4A7C15) >> 40) & mask;
  while (used[h] != 0 && keys[h] != k) h = (h + 1) & mask;
  return h;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gCount = 0;
  let nR = max<i32>(host_record_count(0), 0);
  let nA = max<i32>(host_record_count(1), 0);
  let ok0 = kindsOk(0, "0012122");
  let ok1 = kindsOk(1, "011221");
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  let mask = cap - 1;
  let keys = new StaticArray<i64>(cap);
  let used = new StaticArray<u8>(cap);
  let best = new StaticArray<i32>(cap);
  let bestTs = new StaticArray<i64>(cap);
  // open-addressing index on asset_id; best holds newest reading index + 1
  if (ok1) for (let a = 0; a < nA; a++) {
    let k = host_record_field_i64(1, a, 0);
    let h = slot(keys, used, mask, k);
    keys[h] = k;
    used[h] = 1;
  }
  if (ok0 && ok1) for (let r = 0; r < nR; r++) {
    let h = slot(keys, used, mask, host_record_field_i64(0, r, 0));
    if (used[h] == 0) continue;
    let ts = host_record_field_i64(0, r, 1);
    if (best[h] == 0 || ts > bestTs[h]) { best[h] = r + 1; bestTs[h] = ts; }
  }
  for (let a = 0; a < nA; a++) {
    let id: i64 = ok1 ? host_record_field_i64(1, a, 0) : -1;
    let rc: f64 = ok1 ? host_record_field_f64(1, a, 1) : NaN;
    let rp: f64 = ok1 ? host_record_field_f64(1, a, 2) : NaN;
    let tp: f64 = ok1 ? host_record_field_f64(1, a, 5) : NaN;
    let r = ok0 && ok1 ? best[slot(keys, used, mask, id)] - 1 : -1;
    let ts: i64 = -1;
    gCharge = NaN;
    gPress = NaN;
    let cls = "OK";
    let det = "within tolerance";
    if (!ok0 || !ok1 || !isFinite(rc) || rc < 0 || !isFinite(rp) || !isFinite(tp)) {
      cls = "MALFORMED"; det = "absent field or invalid register value";
    } else if (r < 0) {
      cls = "NO_READING"; det = "no reading for asset";
    } else {
      ts = host_record_field_i64(0, r, 1);
      readReading(r);
      let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
      let d = gCharge - rc;
      let pd = gPress - rp;
      let pt = rel_tol * Math.max(Math.abs(gPress), Math.abs(rp));
      if (gBad) { cls = "MALFORMED"; det = "unknown unit, negative mass, or non-finite value"; }
      else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
      else if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
      else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
      else if (pd > pt) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
      else if (pd < -pt) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    }
    emit(id, ts, gCharge, rc, gPress, rp, cls, det);
  }
  if (ok0 && ok1) for (let r = 0; r < nR; r++) {
    let k = host_record_field_i64(0, r, 0);
    if (used[slot(keys, used, mask, k)] != 0) continue;
    readReading(r);
    let ts = host_record_field_i64(0, r, 1);
    if (gBad) emit(k, ts, gCharge, NaN, gPress, NaN, "MALFORMED", "orphan reading with invalid unit or value");
    else emit(k, ts, gCharge, NaN, gPress, NaN, "ORPHAN_READING", "asset_id not in register");
  }
  return gCount;
}
