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

// Open-addressing index on asset_id: 32768 slots of key, newest timestamp, and state.
const CAP: i32 = 32768;
const KEYS = memory.data(262144, 8);
const BTS = memory.data(262144, 8);
const STATE = memory.data(131072, 4);
const SBUF = memory.data(256);

const C_MAL = String.UTF8.encode("MALFORMED");
const C_NOREAD = String.UTF8.encode("NO_READING");
const C_STALE = String.UTF8.encode("STALE");
const C_UNDER = String.UTF8.encode("UNDERCHARGE");
const C_OVER = String.UTF8.encode("OVERCHARGE");
const C_PHIGH = String.UTF8.encode("PRESSURE_HIGH");
const C_PLOW = String.UTF8.encode("PRESSURE_LOW");
const C_ORPHAN = String.UTF8.encode("ORPHAN_READING");
const C_OK = String.UTF8.encode("OK");
const D_ABSENT = String.UTF8.encode("absent or mistyped field");
const D_NONFIN = String.UTF8.encode("non-finite value");
const D_UNIT = String.UTF8.encode("unknown unit string");
const D_NEG = String.UTF8.encode("negative charge mass");
const D_NOREAD = String.UTF8.encode("no reading for asset");
const D_STALE = String.UTF8.encode("newest reading older than max age");
const D_UNDER = String.UTF8.encode("charge below rated beyond tolerance");
const D_OVER = String.UTF8.encode("charge above rated beyond tolerance");
const D_PHIGH = String.UTF8.encode("pressure above rated beyond tolerance");
const D_PLOW = String.UTF8.encode("pressure below rated beyond tolerance");
const D_ORPHAN = String.UTF8.encode("reading has no registered asset");
const D_OK = String.UTF8.encode("within tolerance");

let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gFull: bool = false;

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * <u64>0x9E3779B97F4A7C15) >> 49);
}

function find(id: i64, insert: bool): i32 {
  let h = slotOf(id);
  for (let k = 0; k < CAP; k++) {
    let st = load<i32>(STATE + (<usize>h << 2));
    if (st == 0) {
      if (!insert) return -1;
      store<i64>(KEYS + (<usize>h << 3), id);
      store<i32>(STATE + (<usize>h << 2), 1);
      return h;
    }
    if (load<i64>(KEYS + (<usize>h << 3)) == id) return h;
    h = (h + 1) & (CAP - 1);
  }
  return -1;
}

function bestFor(id: i64, n0: i32): i32 {
  let s = find(id, false);
  if (s >= 0) {
    let st = load<i32>(STATE + (<usize>s << 2));
    return st >= 2 ? st - 2 : -1;
  }
  if (!gFull) return -1;
  // Nested-loop fallback only when the index overflows CAP distinct assets.
  let best = -1;
  let bts: i64 = 0;
  for (let j = 0; j < n0; j++) {
    if (host_record_field_i64(0, j, 0) != id) continue;
    let ts = host_record_field_i64(0, j, 1);
    if (best < 0 || ts > bts) { best = j; bts = ts; }
  }
  return best;
}

function hasAsset(id: i64, n1: i32): bool {
  if (find(id, false) >= 0) return true;
  if (!gFull) return false;
  for (let i = 0; i < n1; i++) if (host_record_field_i64(1, i, 0) == id) return true;
  return false;
}

function eqi(p: usize, n: i32, s: string): bool {
  if (n != s.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != s.charCodeAt(i)) return false;
  }
  return true;
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitOf(j: i32, field: i32, a: string, b: string, c: string): i32 {
  let n = host_record_field_str(0, j, field, SBUF, 256);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isWs(<i32>load<u8>(SBUF + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(SBUF + <usize>(e - 1)))) e--;
  let p = SBUF + <usize>s;
  if (eqi(p, e - s, a)) return 0;
  if (eqi(p, e - s, b)) return 1;
  if (c.length > 0 && eqi(p, e - s, c)) return 2;
  return -1;
}

function convert(j: i32): ArrayBuffer | null {
  gKg = NaN;
  gKpa = NaN;
  let m = host_record_field_f64(0, j, 2);
  let p = host_record_field_f64(0, j, 4);
  let cu = unitOf(j, 3, "kg", "lb", "");
  let pu = unitOf(j, 5, "kpa", "bar", "psi");
  if (!isFinite(m) || !isFinite(p)) return D_NONFIN;
  if (cu < 0 || pu < 0) return D_UNIT;
  if (m < 0) return D_NEG;
  gKg = cu == 1 ? m * 0.45359237 : m;
  gKpa = pu == 1 ? p * 100.0 : (pu == 2 ? p * 6.894757293168 : p);
  return null;
}

function emit(id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, cls: ArrayBuffer, det: ArrayBuffer): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  out_set_str(7, changetype<usize>(cls), cls.byteLength);
  out_set_str(8, changetype<usize>(det), det.byteLength);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let n0 = max<i32>(host_record_count(0), 0);
  let n1 = max<i32>(host_record_count(1), 0);
  let ok0 = n0 == 0 || (host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2 && host_field_kind(0, 6) == 2);
  let ok1 = n1 == 0 || (host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 3) == 2 && host_field_kind(1, 4) == 2 && host_field_kind(1, 5) == 1);
  memory.fill(STATE, 0, 131072);
  gFull = false;
  if (ok0 && ok1) {
    for (let i = 0; i < n1; i++) if (find(host_record_field_i64(1, i, 0), true) < 0) gFull = true;
    for (let j = 0; j < n0; j++) {
      let s = find(host_record_field_i64(0, j, 0), false);
      if (s < 0) continue;
      let ts = host_record_field_i64(0, j, 1);
      if (load<i32>(STATE + (<usize>s << 2)) == 1 || ts > load<i64>(BTS + (<usize>s << 3))) {
        store<i32>(STATE + (<usize>s << 2), j + 2);
        store<i64>(BTS + (<usize>s << 3), ts);
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n1; i++) {
    let id = host_record_field_i64(1, i, 0);
    let rkg = host_record_field_f64(1, i, 1);
    let rkpa = host_record_field_f64(1, i, 2);
    let pct = host_record_field_f64(1, i, 5);
    count++;
    if (!ok0 || !ok1) { emit(id, -1, NaN, rkg, NaN, rkpa, C_MAL, D_ABSENT); continue; }
    if (!isFinite(rkg) || !isFinite(rkpa) || !isFinite(pct)) { emit(id, -1, NaN, rkg, NaN, rkpa, C_MAL, D_NONFIN); continue; }
    let r = bestFor(id, n0);
    if (r < 0) { emit(id, -1, NaN, rkg, NaN, rkpa, C_NOREAD, D_NOREAD); continue; }
    let ts = host_record_field_i64(0, r, 1);
    let bad = convert(r);
    let cls = C_OK;
    let det = D_OK;
    let tol = max<f64>(abs_tol_kg, pct / 100.0 * abs<f64>(rkg));
    let d = gKg - rkg;
    let ptol = rel_tol * abs<f64>(rkpa);
    if (bad !== null) { cls = C_MAL; det = changetype<ArrayBuffer>(bad); }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = C_STALE; det = D_STALE; }
    else if (d < -tol) { cls = C_UNDER; det = D_UNDER; }
    else if (d > tol) { cls = C_OVER; det = D_OVER; }
    else if (gKpa - rkpa > ptol) { cls = C_PHIGH; det = D_PHIGH; }
    else if (rkpa - gKpa > ptol) { cls = C_PLOW; det = D_PLOW; }
    emit(id, ts, gKg, rkg, gKpa, rkpa, cls, det);
  }
  if (!ok0 || !ok1) return count;
  for (let j = 0; j < n0; j++) {
    let id = host_record_field_i64(0, j, 0);
    if (hasAsset(id, n1)) continue;
    let bad = convert(j);
    let ts = host_record_field_i64(0, j, 1);
    if (bad !== null) emit(id, ts, gKg, NaN, gKpa, NaN, C_MAL, changetype<ArrayBuffer>(bad));
    else emit(id, ts, gKg, NaN, gKpa, NaN, C_ORPHAN, D_ORPHAN);
    count++;
  }
  return count;
}
