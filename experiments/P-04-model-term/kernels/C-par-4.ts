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
const MASK: i32 = 32767;
const MAX_ASSETS: i32 = 16384;
// Open-addressing index on asset_id: 32768 slots of key, asset index + 1, best reading
const KEYS = memory.data(262144, 8);
const AIDX = memory.data(131072, 4);
const BEST = memory.data(131072, 4);
const SCR = memory.data(32);
const TXT = memory.data(80);

let gTs: i64 = -1;
let gC: f64 = NaN;
let gP: f64 = NaN;
let gBad: string = "";

@inline function kAt(h: i32): usize { return KEYS + (<usize>h << 3); }
@inline function aAt(h: i32): usize { return AIDX + (<usize>h << 2); }
@inline function bAt(h: i32): usize { return BEST + (<usize>h << 2); }

function slotOf(key: i64): i32 {
  let h = <i32>((<u64>key * <u64>0x9E3779B97F4A7C15) >> 49);
  while (load<i32>(aAt(h)) != 0 && load<i64>(kAt(h)) != key) h = (h + 1) & MASK;
  return h;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqCi(p: usize, len: i32, w: string): bool {
  if (len != w.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != w.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(LOG, idx, field, SCR, 32);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(SCR + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCR + <usize>(e - 1)))) e--;
  let p = SCR + <usize>s;
  let len = e - s;
  if (mass) {
    if (eqCi(p, len, "kg")) return 1.0;
    if (eqCi(p, len, "lb")) return 0.45359237;
  } else {
    if (eqCi(p, len, "kpa")) return 1.0;
    if (eqCi(p, len, "bar")) return 100.0;
    if (eqCi(p, len, "psi")) return 6.894757293168;
  }
  return NaN;
}

function readRow(j: i32): void {
  gTs = host_record_field_i64(LOG, j, 1);
  let mass = host_record_field_f64(LOG, j, 2);
  let press = host_record_field_f64(LOG, j, 4);
  let cf = unitFactor(j, 3, true);
  let pf = unitFactor(j, 5, false);
  gC = mass * cf;
  gP = press * pf;
  gBad = "";
  if (isNaN(cf) || isNaN(pf)) gBad = "unknown unit string";
  else if (!isFinite(mass) || !isFinite(press)) gBad = "non-finite reading value";
  else if (mass < 0) gBad = "negative charge mass";
}

function putStr(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(TXT + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, TXT, n);
}

function emit(aid: i64, ts: i64, c: f64, rated: f64, p: f64, rp: f64, cls: string, why: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, c);
  out_set_f64(3, rated);
  out_set_f64(4, c - rated);
  out_set_f64(5, p);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, why);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let n = max<i32>(host_record_count(REG), 0);
  let m = max<i32>(host_record_count(LOG), 0);
  let ok = n <= MAX_ASSETS
    && host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0 && host_field_kind(LOG, 2) == 1
    && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2
    && host_field_kind(LOG, 6) == 2 && host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1
    && host_field_kind(REG, 2) == 1 && host_field_kind(REG, 3) == 2 && host_field_kind(REG, 4) == 2
    && host_field_kind(REG, 5) == 1;
  let cnt = 0;
  memory.fill(AIDX, 0, 131072);
  for (let i = 0; ok && i < n; i++) {
    let k = host_record_field_i64(REG, i, 0);
    let h = slotOf(k);
    if (load<i32>(aAt(h)) == 0) {
      store<i64>(kAt(h), k);
      store<i32>(aAt(h), i + 1);
      store<i32>(bAt(h), -1);
    }
  }
  // Newest reading per asset; ties keep the lowest record index
  for (let j = 0; ok && j < m; j++) {
    let h = slotOf(host_record_field_i64(LOG, j, 0));
    if (load<i32>(aAt(h)) == 0) continue;
    let b = load<i32>(bAt(h));
    if (b < 0 || host_record_field_i64(LOG, j, 1) > host_record_field_i64(LOG, b, 1)) store<i32>(bAt(h), j);
  }
  for (let i = 0; i < n; i++) {
    let aid = host_record_field_i64(REG, i, 0);
    let rated = host_record_field_f64(REG, i, 1);
    let rp = host_record_field_f64(REG, i, 2);
    let pct = host_record_field_f64(REG, i, 5);
    let b = ok ? load<i32>(bAt(slotOf(aid))) : -1;
    gTs = -1; gC = NaN; gP = NaN; gBad = "";
    if (b >= 0) readRow(b);
    let tol = Math.max(abs_tol_kg, pct / 100.0 * rated);
    let cls = "OK";
    let why = "within tolerance";
    if (!ok) { cls = "MALFORMED"; why = "absent or mistyped field, or asset capacity exceeded"; }
    else if (!isFinite(rated) || !isFinite(rp) || !isFinite(pct) || rated < 0) { cls = "MALFORMED"; why = "non-finite or negative rated value"; }
    else if (b < 0) { cls = "NO_READING"; why = "no reading for asset"; }
    else if (gBad.length > 0) { cls = "MALFORMED"; why = gBad; }
    else if (as_of_ts - gTs > max_age_days * 86400) { cls = "STALE"; why = "newest reading older than max_age_days"; }
    else if (rated - gC > tol) { cls = "UNDERCHARGE"; why = "charge below rated beyond tolerance"; }
    else if (gC - rated > tol) { cls = "OVERCHARGE"; why = "charge above rated beyond tolerance"; }
    else if (gP - rp > rel_tol * rp) { cls = "PRESSURE_HIGH"; why = "pressure above rated beyond rel_tol"; }
    else if (rp - gP > rel_tol * rp) { cls = "PRESSURE_LOW"; why = "pressure below rated beyond rel_tol"; }
    emit(aid, gTs, gC, rated, gP, rp, cls, why);
    cnt++;
  }
  for (let j = 0; ok && j < m; j++) {
    let aid = host_record_field_i64(LOG, j, 0);
    if (load<i32>(aAt(slotOf(aid))) != 0) continue;
    readRow(j);
    let bad = gBad.length > 0;
    emit(aid, gTs, gC, NaN, gP, NaN, bad ? "MALFORMED" : "ORPHAN_READING", bad ? gBad : "reading has no matching asset");
    cnt++;
  }
  return cnt;
}
