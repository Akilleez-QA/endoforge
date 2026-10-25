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
const MASK: i32 = 0x1FFFF;
const MAXA: i32 = 100000;
const KG: u32 = 0x676B;
const LB: u32 = 0x626C;
const KPA: u32 = 0x61706B;
const BAR: u32 = 0x726162;
const PSI: u32 = 0x697370;
// Open-addressing index: slot -> asset index + 1, and asset index -> newest reading + 1
const VALS = memory.data(524288, 4);
const BEST = memory.data(400000, 4);
const SCR = memory.data(256);

let gTs: i64 = -1;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let logOk = false;
let count: i32 = 0;

function kind(set: u32, f: i32, k: i32): bool {
  return host_field_kind(set, f) == k;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitCode(set: u32, idx: i32, field: i32): u32 {
  let n = host_record_field_str(set, idx, field, SCR, 32);
  if (n < 0) return 0;
  let s: usize = 0;
  let e = <usize>n;
  while (s < e && isWs(load<u8>(SCR + s))) s++;
  while (e > s && isWs(load<u8>(SCR + e - 1))) e--;
  if (e - s > 3) return 0;
  let p: u32 = 0;
  for (let i: usize = s; i < e; i++) {
    let c = <u32>load<u8>(SCR + i);
    if (c >= 65 && c <= 90) c += 32;
    p |= c << (<u32>(i - s) << 3);
  }
  return p;
}

function slotOf(id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 47);
  let v = load<i32>(VALS + (<usize>h << 2));
  while (v != 0 && host_record_field_i64(REG, v - 1, 0) != id) {
    h = (h + 1) & MASK;
    v = load<i32>(VALS + (<usize>h << 2));
  }
  return h;
}

function findAsset(id: i64): i32 {
  return load<i32>(VALS + (<usize>slotOf(id) << 2)) - 1;
}

function readReading(r: i32): string {
  gCharge = NaN;
  gPress = NaN;
  gTs = host_record_field_i64(LOG, r, 1);
  if (!logOk) return "log field absent";
  let m = host_record_field_f64(LOG, r, 2);
  let p = host_record_field_f64(LOG, r, 4);
  if (!isFinite(m) || !isFinite(p)) return "non-finite reading value";
  if (m < 0) return "negative charge mass";
  let cu = unitCode(LOG, r, 3);
  if (cu == KG) gCharge = m;
  else if (cu == LB) gCharge = m * 0.45359237;
  else return "unknown charge unit";
  let pu = unitCode(LOG, r, 5);
  if (pu == KPA) gPress = p;
  else if (pu == BAR) gPress = p * 100.0;
  else if (pu == PSI) gPress = p * 6.894757293168;
  else { gCharge = NaN; return "unknown pressure unit"; }
  return "";
}

function putStr(field: i32, s: string): void {
  let n = min<i32>(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(SCR + 64 + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCR + 64, n);
}

function emit(id: i64, rc: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, gTs);
  out_set_f64(2, gCharge);
  out_set_f64(3, rc);
  out_set_f64(4, gCharge - rc);
  out_set_f64(5, gPress);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
  count++;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  count = 0;
  memory.fill(VALS, 0, 524288);
  memory.fill(BEST, 0, 400000);
  let na = host_record_count(REG);
  let nl = host_record_count(LOG);
  let regKey = kind(REG, 0, 0);
  let regOk = regKey && kind(REG, 1, 1) && kind(REG, 2, 1) && kind(REG, 3, 2) && kind(REG, 4, 2) && kind(REG, 5, 1);
  let logKey = kind(LOG, 0, 0) && kind(LOG, 1, 0);
  logOk = logKey && kind(LOG, 2, 1) && kind(LOG, 3, 2) && kind(LOG, 4, 1) && kind(LOG, 5, 2) && kind(LOG, 6, 2);
  if (regKey) {
    for (let a = 0; a < min<i32>(na, MAXA); a++) {
      let s = slotOf(host_record_field_i64(REG, a, 0));
      if (load<i32>(VALS + (<usize>s << 2)) == 0) store<i32>(VALS + (<usize>s << 2), a + 1);
    }
  }
  if (regKey && logKey) {
    for (let r = 0; r < nl; r++) {
      let a = findAsset(host_record_field_i64(LOG, r, 0));
      if (a < 0) continue;
      let p = BEST + (<usize>a << 2);
      let b = load<i32>(p) - 1;
      if (b < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, b, 1)) store<i32>(p, r + 1);
    }
  }
  for (let a = 0; a < na; a++) {
    let id: i64 = regKey ? host_record_field_i64(REG, a, 0) : -1;
    let rc = regOk ? host_record_field_f64(REG, a, 1) : NaN;
    let rp = regOk ? host_record_field_f64(REG, a, 2) : NaN;
    let tp = regOk ? host_record_field_f64(REG, a, 5) : NaN;
    let b = regKey && a < MAXA ? load<i32>(BEST + (<usize>a << 2)) - 1 : -1;
    if (b < 0) { gTs = -1; gCharge = NaN; gPress = NaN; }
    let msg = b >= 0 ? readReading(b) : "";
    let cls = "OK";
    let det = "within tolerance";
    if (!regOk || !logKey) { cls = "MALFORMED"; det = "schema field absent"; }
    else if (a >= MAXA) { cls = "MALFORMED"; det = "register exceeds capacity"; }
    else if (!isFinite(rc) || rc < 0 || !isFinite(rp) || !isFinite(tp) || tp < 0) { cls = "MALFORMED"; det = "invalid rated values"; }
    else if (msg.length > 0) { cls = "MALFORMED"; det = msg; }
    else if (b < 0) { cls = "NO_READING"; det = "no reading for asset"; }
    else if (as_of_ts - gTs > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max age"; }
    else {
      let tol = max<f64>(abs_tol_kg, tp / 100.0 * rc);
      let d = gCharge - rc;
      let pt = rel_tol * abs<f64>(rp);
      if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
      else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
      else if (gPress - rp > pt) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
      else if (rp - gPress > pt) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    }
    emit(id, rc, rp, cls, det);
  }
  if (regKey && logKey) {
    for (let r = 0; r < nl; r++) {
      let id = host_record_field_i64(LOG, r, 0);
      if (findAsset(id) >= 0) continue;
      let msg = readReading(r);
      if (msg.length > 0) emit(id, NaN, NaN, "MALFORMED", msg);
      else emit(id, NaN, NaN, "ORPHAN_READING", "no asset in register");
    }
  }
  return count;
}
