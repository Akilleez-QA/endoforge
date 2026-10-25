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

const MAXA: i32 = 16384;
const MASK: i32 = 32767;
const BUF: usize = memory.data(64);
const TB: usize = memory.data(1024);
const CLS: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DET: StaticArray<string> = ["bad unit, value or field", "no reading for asset", "newest reading too old", "charge below rated", "charge above rated", "pressure above rated", "pressure below rated", "reading has no register entry", "within tolerance"];
const SLOT = new StaticArray<i32>(32768);
const BEST = new StaticArray<i32>(16384);
const IDS = new StaticArray<i64>(16384);
const CL = new StaticArray<i32>(9);
const DL = new StaticArray<i32>(9);
let gKg: f64 = 0;
let gKpa: f64 = 0;
let outN: i32 = 0;

function key(n: i32, a: i32, b: i32, c: i32): i32 { return (n << 24) | (a << 16) | (b << 8) | c; }

function put(s: string, at: usize): i32 {
  for (let c = 0; c < s.length; c++) store<u8>(at + <usize>c, <u8>s.charCodeAt(c));
  return s.length;
}

function slotOf(id: i64): i32 { return <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 49); }

function find(id: i64, n1: i32): i32 {
  let p = slotOf(id);
  while (unchecked(SLOT[p]) != 0) {
    const a = unchecked(SLOT[p]) - 1;
    if (unchecked(IDS[a]) == id) return a;
    p = (p + 1) & MASK;
  }
  return -1;
}

// Returns the factor to kg (mass) or kPa (pressure), or NaN for an unknown unit.
function unit(set: u32, idx: i32, field: i32, press: bool): f64 {
  const n = host_record_field_str(set, idx, field, BUF, 64);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(BUF + <usize>s))) s++;
  while (e > s && isWs(load<u8>(BUF + <usize>(e - 1)))) e--;
  const len = e - s;
  if (len < 2 || len > 3) return NaN;
  let k = len << 24;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(BUF + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    k |= c << (16 - 8 * i);
  }
  if (!press) {
    if (k == key(2, 107, 103, 0)) return 1.0;
    if (k == key(2, 108, 98, 0)) return 0.45359237;
  } else {
    if (k == key(3, 107, 112, 97)) return 1.0;
    if (k == key(3, 98, 97, 114)) return 100.0;
    if (k == key(3, 112, 115, 105)) return 6.894757293168;
  }
  return NaN;
}

function isWs(c: u8): bool { return c == 32 || (c >= 9 && c <= 13); }

function load(j: i32): bool {
  const fm = unit(0, j, 3, false);
  const fp = unit(0, j, 5, true);
  const m = host_record_field_f64(0, j, 2);
  const p = host_record_field_f64(0, j, 4);
  if (isNaN(fm) || isNaN(fp) || !isFinite(m) || !isFinite(p) || m < 0) return false;
  gKg = m * fm;
  gKpa = p * fp;
  return true;
}

function emit(id: i64, ts: i64, kg: f64, rc: f64, dl: f64, pk: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rc);
  out_set_f64(4, dl);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  out_set_str(7, TB + <usize>(cls * 32), unchecked(CL[cls]));
  out_set_str(8, TB + 512 + <usize>(cls * 96), unchecked(DL[cls]));
  out_commit();
  outN++;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  outN = 0;
  for (let k = 0; k < 9; k++) {
    CL[k] = put(CLS[k], TB + <usize>(k * 32));
    DL[k] = put(DET[k], TB + 512 + <usize>(k * 96));
  }
  SLOT.fill(0);
  BEST.fill(-1);
  const k0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  const k1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  const n0 = host_record_count(0);
  let n1 = host_record_count(1);
  if (n1 > MAXA) n1 = MAXA;
  // Open-addressing index on asset_id; the first register row wins for duplicate ids.
  for (let i = 0; i < n1; i++) {
    const id = host_record_field_i64(1, i, 0);
    IDS[i] = id;
    if (find(id, n1) >= 0) continue;
    let p = slotOf(id);
    while (SLOT[p] != 0) p = (p + 1) & MASK;
    SLOT[p] = i + 1;
  }
  for (let j = 0; j < n0 && k0; j++) {
    const a = find(host_record_field_i64(0, j, 0), n1);
    if (a < 0) continue;
    const b = BEST[a];
    if (b < 0 || host_record_field_i64(0, j, 1) > host_record_field_i64(0, b, 1)) BEST[a] = j;
  }
  for (let i = 0; i < n1; i++) {
    const id = IDS[i];
    const rc = host_record_field_f64(1, i, 1);
    const rp = host_record_field_f64(1, i, 2);
    const pct = host_record_field_f64(1, i, 5);
    const c = find(id, n1);
    const b = BEST[c];
    if (!k1 || !isFinite(rc) || rc < 0 || !isFinite(rp) || rp <= 0 || !isFinite(pct) || pct < 0) { emit(id, -1, NaN, rc, NaN, NaN, rp, 0); continue; }
    if (b < 0) { emit(id, -1, NaN, rc, NaN, NaN, rp, 1); continue; }
    const ts = host_record_field_i64(0, b, 1);
    if (!load(b)) { emit(id, ts, NaN, rc, NaN, NaN, rp, 0); continue; }
    const dl = gKg - rc;
    const tol = max(abs_tol_kg, pct / 100.0 * rc);
    const dev = gKpa - rp;
    const thr = rel_tol * rp;
    let cls = 8;
    if (as_of_ts - ts > max_age_days * 86400) cls = 2;
    else if (dl < -tol) cls = 3;
    else if (dl > tol) cls = 4;
    else if (dev > thr) cls = 5;
    else if (dev < -thr) cls = 6;
    emit(id, ts, gKg, rc, dl, gKpa, rp, cls);
  }
  for (let j = 0; j < n0; j++) {
    const id = host_record_field_i64(0, j, 0);
    if (!k0 || find(id, n1) >= 0) continue;
    const ts = host_record_field_i64(0, j, 1);
    if (load(j)) emit(id, ts, gKg, NaN, NaN, gKpa, NaN, 7);
    else emit(id, ts, NaN, NaN, NaN, NaN, NaN, 0);
  }
  return outN;
}
