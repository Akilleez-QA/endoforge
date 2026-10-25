const LB: f64 = 0.45359237;
const PSI: f64 = 6.894757293168;
const CAP: i32 = 16384;
const MASK: i32 = 32767;
const HT = memory.data(131072);
const CANON = memory.data(65536);
const BEST = memory.data(65536);
const BTS = memory.data(131072);
const UB = memory.data(32);
const OB = memory.data(96);

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

let gCh: f64 = NaN;
let gP: f64 = NaN;

function putStr(field: i32, s: string): void {
  const n = s.length;
  for (let k = 0; k < n; k++) store<u8>(OB + <usize>k, <u8>s.charCodeAt(k));
  out_set_str(field, OB, n);
}

function emit(id: i64, ts: i64, ch: f64, rch: f64, p: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rch);
  out_set_f64(4, ch - rch);
  out_set_f64(5, p);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitCode(idx: i32, field: i32, pressure: bool): i32 {
  if (host_field_kind(0, field) != 2) return 0;
  const n = host_record_field_str(0, idx, field, UB, 16);
  if (n < 0) return 0;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(UB + <usize>s))) s++;
  while (e > s && isWs(load<u8>(UB + <usize>(e - 1)))) e--;
  const a = <i32>(load<u8>(UB + <usize>s) | 32);
  const b = <i32>(load<u8>(UB + <usize>(s + 1)) | 32);
  const c = <i32>(load<u8>(UB + <usize>(s + 2)) | 32);
  if (!pressure) {
    if (e - s != 2) return 0;
    if (a == 0x6b && b == 0x67) return 1;
    if (a == 0x6c && b == 0x62) return 2;
    return 0;
  }
  if (e - s != 3) return 0;
  if (a == 0x6b && b == 0x70 && c == 0x61) return 1;
  if (a == 0x62 && b == 0x61 && c == 0x72) return 2;
  if (a == 0x70 && b == 0x73 && c == 0x69) return 3;
  return 0;
}

function loadReading(j: i32): bool {
  gCh = NaN;
  gP = NaN;
  if (host_field_kind(0, 2) != 1 || host_field_kind(0, 4) != 1) return false;
  const cu = unitCode(j, 3, false);
  const pu = unitCode(j, 5, true);
  const m = host_record_field_f64(0, j, 2);
  const p = host_record_field_f64(0, j, 4);
  if (cu == 0 || pu == 0 || !isFinite(m) || !isFinite(p) || m < 0) return false;
  gCh = cu == 2 ? m * LB : m;
  gP = pu == 2 ? p * 100.0 : (pu == 3 ? p * PSI : p);
  return true;
}

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 48) & MASK;
}

function findAsset(id: i64): i32 {
  let h = slotOf(id);
  while (true) {
    const v = load<i32>(HT + (<usize>h << 2));
    if (v == 0) return -1;
    if (host_record_field_i64(1, v - 1, 0) == id) return v - 1;
    h = (h + 1) & MASK;
  }
  return -1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let count = 0;
  const idOk = host_field_kind(1, 0) == 0;
  const n1 = idOk ? min(host_record_count(1), CAP) : 0;
  const nr = (host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0) ? host_record_count(0) : 0;
  memory.fill(HT, 0, 131072);
  memory.fill(BEST, 0xFF, 65536);
  for (let i = 0; i < n1; i++) {
    const id = host_record_field_i64(1, i, 0);
    let h = slotOf(id);
    while (true) {
      const v = load<i32>(HT + (<usize>h << 2));
      if (v == 0) {
        store<i32>(HT + (<usize>h << 2), i + 1);
        store<i32>(CANON + (<usize>i << 2), i);
        break;
      }
      if (host_record_field_i64(1, v - 1, 0) == id) {
        store<i32>(CANON + (<usize>i << 2), v - 1);
        break;
      }
      h = (h + 1) & MASK;
    }
  }
  for (let j = 0; j < nr; j++) {
    const a = findAsset(host_record_field_i64(0, j, 0));
    if (a < 0) continue;
    const ts = host_record_field_i64(0, j, 1);
    const cur = load<i32>(BEST + (<usize>a << 2));
    if (cur < 0 || ts > load<i64>(BTS + (<usize>a << 3))) {
      store<i32>(BEST + (<usize>a << 2), j);
      store<i64>(BTS + (<usize>a << 3), ts);
    }
  }
  const ratedOk = host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  for (let i = 0; i < n1; i++) {
    const c = load<i32>(CANON + (<usize>i << 2));
    const b = load<i32>(BEST + (<usize>c << 2));
    const id = host_record_field_i64(1, i, 0);
    const rch = ratedOk ? host_record_field_f64(1, i, 1) : NaN;
    const rp = ratedOk ? host_record_field_f64(1, i, 2) : NaN;
    const tpct = ratedOk ? host_record_field_f64(1, i, 5) : NaN;
    if (b < 0) {
      emit(id, -1, NaN, rch, NaN, rp, "NO_READING", "no reading for asset");
    } else {
      const ts = load<i64>(BTS + (<usize>c << 3));
      const ok = loadReading(b) && isFinite(rch) && isFinite(rp) && isFinite(tpct) && rch >= 0;
      const tol = max(abs_tol_kg, tpct / 100.0 * rch);
      const d = gCh - rch;
      const pd = gP - rp;
      const pt = rel_tol * max(abs(gP), abs(rp));
      if (!ok) emit(id, ts, gCh, rch, gP, rp, "MALFORMED", "bad unit or non-finite value");
      else if (as_of_ts - ts > max_age_days * 86400) emit(id, ts, gCh, rch, gP, rp, "STALE", "reading older than max age");
      else if (d < -tol) emit(id, ts, gCh, rch, gP, rp, "UNDERCHARGE", "charge below rated");
      else if (d > tol) emit(id, ts, gCh, rch, gP, rp, "OVERCHARGE", "charge above rated");
      else if (pd > pt) emit(id, ts, gCh, rch, gP, rp, "PRESSURE_HIGH", "pressure above rated");
      else if (-pd > pt) emit(id, ts, gCh, rch, gP, rp, "PRESSURE_LOW", "pressure below rated");
      else emit(id, ts, gCh, rch, gP, rp, "OK", "within tolerance");
    }
    count++;
  }
  for (let j = 0; j < nr; j++) {
    const id = host_record_field_i64(0, j, 0);
    if (idOk && findAsset(id) >= 0) continue;
    const ts = host_record_field_i64(0, j, 1);
    if (loadReading(j)) emit(id, ts, gCh, NaN, gP, NaN, "ORPHAN_READING", "reading without register entry");
    else emit(id, ts, gCh, NaN, gP, NaN, "MALFORMED", "bad unit or non-finite value");
    count++;
  }
  return count;
}
