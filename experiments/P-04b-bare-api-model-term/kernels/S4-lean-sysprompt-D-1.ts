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
const KG_PER_LB: f64 = 0.45359237;
const KPA_PER_BAR: f64 = 100.0;
const KPA_PER_PSI: f64 = 6.894757293168;
const HASH_K: i64 = 0x5851F42D4C957F2D;
const SBUF = memory.data(256);
const OBUF = memory.data(96);

let gCount: i32 = 0;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;
let gBad: bool = false;

function kindsOk(set: u32, spec: string): bool {
  for (let f = 0; f < spec.length; f++) {
    if (host_field_kind(set, f) != spec.charCodeAt(f) - 48) return false;
  }
  return true;
}

function isSpace(b: i32): bool {
  return b == 32 || (b >= 9 && b <= 13);
}

function matches(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let b = <i32>load<u8>(SBUF + <usize>(s + i));
    if (b >= 65 && b <= 90) b += 32;
    if (b != lit.charCodeAt(i)) return false;
  }
  return true;
}

// Returns 0, 1, or 2 for the matching lowercase literal; -1 if unknown or truncated.
function unitCode(set: u32, idx: i32, field: i32, a: string, b: string, c: string): i32 {
  let n = host_record_field_str(set, idx, field, SBUF, 256);
  if (n < 0 || n > 256) return -1;
  let s = 0;
  let e = n;
  while (s < e && isSpace(<i32>load<u8>(SBUF + <usize>s))) s++;
  while (e > s && isSpace(<i32>load<u8>(SBUF + <usize>(e - 1)))) e--;
  if (e == s) return -1;
  if (matches(s, e, a)) return 0;
  if (matches(s, e, b)) return 1;
  if (matches(s, e, c)) return 2;
  return -1;
}

function readReading(i: i32): void {
  let m = host_record_field_f64(LOG, i, 2);
  let p = host_record_field_f64(LOG, i, 4);
  let mu = unitCode(LOG, i, 3, "kg", "lb", "");
  let pu = unitCode(LOG, i, 5, "kpa", "bar", "psi");
  gBad = mu < 0 || pu < 0 || !isFinite(m) || !isFinite(p) || m < 0.0;
  gCharge = mu == 0 ? m : (mu == 1 ? m * KG_PER_LB : NaN);
  gPress = pu == 0 ? p : (pu == 1 ? p * KPA_PER_BAR : (pu == 2 ? p * KPA_PER_PSI : NaN));
}

function putStr(field: i32, s: string): void {
  let n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(OBUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OBUF, n);
}

function emitRow(id: i64, ts: i64, ch: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
  gCount++;
}

// Open-addressing probe: returns the slot holding key k, or the empty slot where it belongs.
function probe(keys: StaticArray<i64>, used: StaticArray<i32>, k: i64, mask: i32): i32 {
  let h = <i32>((k * HASH_K) >>> 32) & mask;
  while (unchecked(used[h]) != 0 && unchecked(keys[h]) != k) h = (h + 1) & mask;
  return h;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gCount = 0;
  if (!kindsOk(LOG, "0012122") || !kindsOk(REG, "011221")) {
    emitRow(-1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input field absent or mistyped");
    return gCount;
  }
  let n0 = host_record_count(LOG);
  let n1 = host_record_count(REG);
  if (n0 < 0) n0 = 0;
  if (n1 < 0) n1 = 0;
  let cap = 16;
  while (cap < n1 * 2) cap <<= 1;
  let mask = cap - 1;
  let keys = new StaticArray<i64>(cap);
  let used = new StaticArray<i32>(cap);
  let best = new StaticArray<i32>(cap);
  let bestTs = new StaticArray<i64>(cap);
  for (let j = 0; j < n1; j++) {
    let k = host_record_field_i64(REG, j, 0);
    let s = probe(keys, used, k, mask);
    if (unchecked(used[s]) == 0) { unchecked(keys[s] = k); unchecked(used[s] = j + 1); }
  }
  for (let i = 0; i < n0; i++) {
    let s = probe(keys, used, host_record_field_i64(LOG, i, 0), mask);
    if (unchecked(used[s]) == 0) continue;
    let ts = host_record_field_i64(LOG, i, 1);
    if (unchecked(best[s]) == 0 || ts > unchecked(bestTs[s])) { unchecked(best[s] = i + 1); unchecked(bestTs[s] = ts); }
  }
  for (let j = 0; j < n1; j++) {
    let id = host_record_field_i64(REG, j, 0);
    let rc = host_record_field_f64(REG, j, 1);
    let rp = host_record_field_f64(REG, j, 2);
    let tp = host_record_field_f64(REG, j, 5);
    let badA = !isFinite(rc) || !isFinite(rp) || !isFinite(tp) || rc < 0.0;
    let s = probe(keys, used, id, mask);
    let r = unchecked(best[s]) - 1;
    if (r < 0) {
      if (badA) emitRow(id, -1, NaN, rc, NaN, rp, "MALFORMED", "register values invalid");
      else emitRow(id, -1, NaN, rc, NaN, rp, "NO_READING", "no reading for asset");
      continue;
    }
    let ts = unchecked(bestTs[s]);
    readReading(r);
    let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
    let ptol = rel_tol * Math.abs(rp);
    let cls = "OK";
    let det = "within tolerance";
    if (badA) { cls = "MALFORMED"; det = "register values invalid"; }
    else if (gBad) { cls = "MALFORMED"; det = "unknown unit, negative mass, or non-finite value"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
    else if (rc - gCharge > tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (gCharge - rc > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (gPress - rp > ptol) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
    else if (rp - gPress > ptol) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    emitRow(id, ts, gCharge, rc, gPress, rp, cls, det);
  }
  for (let i = 0; i < n0; i++) {
    let k = host_record_field_i64(LOG, i, 0);
    if (unchecked(used[probe(keys, used, k, mask)]) != 0) continue;
    readReading(i);
    let ts = host_record_field_i64(LOG, i, 1);
    if (gBad) emitRow(k, ts, gCharge, NaN, gPress, NaN, "MALFORMED", "orphan reading with invalid unit or value");
    else emitRow(k, ts, gCharge, NaN, gPress, NaN, "ORPHAN_READING", "asset_id not in register");
  }
  return gCount;
}
