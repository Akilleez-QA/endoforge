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

const SLOTS: i32 = 32768;
const KEYS = memory.data(262144);
const ASSET = memory.data(131072);
const BEST = memory.data(131072);
const SBUF = memory.data(64);
const C_MALFORMED = 0, C_NO_READING = 1, C_STALE = 2, C_UNDER = 3, C_OVER = 4, C_PHIGH = 5, C_PLOW = 6, C_ORPHAN = 7, C_OK = 8;
const NAMES: StaticArray<ArrayBuffer> = new StaticArray<ArrayBuffer>(9);
const DETAILS: StaticArray<ArrayBuffer> = new StaticArray<ArrayBuffer>(9);
let inited = false;

function initStrings(): void {
  const n = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
  const d = ["unknown unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading for unregistered asset", "within tolerance"];
  for (let i = 0; i < 9; i++) {
    NAMES[i] = String.UTF8.encode(n[i]);
    DETAILS[i] = String.UTF8.encode(d[i]);
  }
  inited = true;
}

function slotOf(id: i64): i32 {
  return <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 49) & (SLOTS - 1);
}

function find(id: i64, insertIdx: i32): i32 {
  let s = slotOf(id);
  for (let p = 0; p < SLOTS; p++) {
    const a = load<i32>(ASSET + (<usize>s << 2));
    if (a == 0) {
      if (insertIdx < 0) return -1;
      store<i64>(KEYS + (<usize>s << 3), id);
      store<i32>(ASSET + (<usize>s << 2), insertIdx + 1);
      return s;
    }
    if (load<i64>(KEYS + (<usize>s << 3)) == id) return s;
    s = (s + 1) & (SLOTS - 1);
  }
  return -1;
}

function lower(c: i32): i32 {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

function matches(start: i32, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let i = 0; i < len; i++) {
    if (lower(<i32>load<u8>(SBUF + <usize>(start + i))) != lit.charCodeAt(i)) return false;
  }
  return true;
}

// returns conversion factor to kg or kPa, or NaN if unknown/truncated
function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(0, idx, field, SBUF, 64);
  if (n < 0) return NaN;
  let a = 0, b = n;
  while (a < b && load<u8>(SBUF + <usize>a) <= 32) a++;
  while (b > a && load<u8>(SBUF + <usize>(b - 1)) <= 32) b--;
  if (mass) {
    if (matches(a, b - a, "kg")) return 1.0;
    if (matches(a, b - a, "lb")) return 0.45359237;
  } else {
    if (matches(a, b - a, "kpa")) return 1.0;
    if (matches(a, b - a, "bar")) return 100.0;
    if (matches(a, b - a, "psi")) return 6.894757293168;
  }
  return NaN;
}

function emit(id: i64, ts: i64, ck: f64, rck: f64, pk: f64, rpk: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rck);
  out_set_f64(4, ck - rck);
  out_set_f64(5, pk);
  out_set_f64(6, rpk);
  out_set_str(7, changetype<usize>(NAMES[cls]), NAMES[cls].byteLength);
  out_set_str(8, changetype<usize>(DETAILS[cls]), DETAILS[cls].byteLength);
  out_commit();
}

function setOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let f = 0; f < kinds.length; f++) if (host_field_kind(set, f) != kinds[f]) return false;
  return true;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  if (!inited) initStrings();
  memory.fill(ASSET, 0, 131072);
  memory.fill(BEST, 0, 131072);
  const ok0 = setOk(0, [0, 0, 1, 2, 1, 2, 2]);
  const ok1 = setOk(1, [0, 1, 1, 2, 2, 1]);
  const nA = host_record_count(1), nR = host_record_count(0);
  for (let i = 0; i < nA; i++) find(host_record_field_i64(1, i, 0), i);
  // index newest reading per asset; ties keep the lowest record index
  for (let r = 0; r < nR; r++) {
    const s = find(host_record_field_i64(0, r, 0), -1);
    if (s < 0) continue;
    const b = load<i32>(BEST + (<usize>s << 2));
    if (b == 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b - 1, 1)) store<i32>(BEST + (<usize>s << 2), r + 1);
  }
  let count = 0;
  for (let i = 0; i < nA; i++) {
    const id = host_record_field_i64(1, i, 0);
    const rck = ok1 ? host_record_field_f64(1, i, 1) : NaN;
    const rpk = ok1 ? host_record_field_f64(1, i, 2) : NaN;
    const tp = ok1 ? host_record_field_f64(1, i, 5) : NaN;
    const s = find(id, -1);
    const b = s < 0 ? 0 : load<i32>(BEST + (<usize>s << 2));
    let ts: i64 = -1, ck = NaN, pk = NaN, cls = C_OK;
    if (b > 0 && ok0) {
      ts = host_record_field_i64(0, b - 1, 1);
      const m = host_record_field_f64(0, b - 1, 2);
      ck = m * unitFactor(b - 1, 3, true);
      pk = host_record_field_f64(0, b - 1, 4) * unitFactor(b - 1, 5, false);
      if (m < 0) cls = C_MALFORMED;
    }
    const tol = Math.max(abs_tol_kg, tp / 100.0 * rck);
    if (!ok1 || !isFinite(rck) || !isFinite(rpk) || !isFinite(tp) || (b > 0 && (!ok0 || !isFinite(ck) || !isFinite(pk)))) cls = C_MALFORMED;
    else if (cls == C_MALFORMED) cls = C_MALFORMED;
    else if (b == 0) cls = C_NO_READING;
    else if (as_of_ts - ts > max_age_days * 86400) cls = C_STALE;
    else if (rck - ck > tol) cls = C_UNDER;
    else if (ck - rck > tol) cls = C_OVER;
    else if (pk - rpk > rel_tol * Math.abs(rpk)) cls = C_PHIGH;
    else if (rpk - pk > rel_tol * Math.abs(rpk)) cls = C_PLOW;
    emit(id, ts, ck, rck, pk, rpk, cls);
    count++;
  }
  for (let r = 0; r < nR; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (find(id, -1) >= 0) continue;
    let ts: i64 = -1, ck = NaN, pk = NaN, cls = C_ORPHAN;
    if (ok0) {
      ts = host_record_field_i64(0, r, 1);
      const m = host_record_field_f64(0, r, 2);
      ck = m * unitFactor(r, 3, true);
      pk = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
      if (m < 0 || !isFinite(ck) || !isFinite(pk)) cls = C_MALFORMED;
    } else cls = C_MALFORMED;
    emit(id, ts, ck, NaN, pk, NaN, cls);
    count++;
  }
  return count;
}
