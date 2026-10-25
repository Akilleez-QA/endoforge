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
const SLOTS: i32 = 32768;
const MAX_ASSETS: i32 = 16384;
const GOLD: u64 = 0x9E3779B97F4A7C15;
const HKEY = memory.data(262144, 8);
const HVAL = memory.data(131072, 4);
const BEST = memory.data(65536, 4);
const SBUF = memory.data(128);
const U_KG: i32 = 0x676b;
const U_LB: i32 = 0x626c;
const U_KPA: i32 = 0x61706b;
const U_BAR: i32 = 0x726162;
const U_PSI: i32 = 0x697370;
const C_MALFORMED: i32 = 0;
const C_NO_READING: i32 = 1;
const C_STALE: i32 = 2;
const C_UNDER: i32 = 3;
const C_OVER: i32 = 4;
const C_P_HIGH: i32 = 5;
const C_P_LOW: i32 = 6;
const C_ORPHAN: i32 = 7;
const C_OK: i32 = 8;

let gKg: f64 = 0;
let gKpa: f64 = 0;

function slot(id: i64): i32 {
  return <i32>((<u64>id * GOLD) >> 49);
}

// Open-addressing index from asset_id to register row; keeps the first row on duplicate ids.
function insert(id: i64, a: i32): void {
  let s = slot(id);
  for (let n = 0; n < SLOTS; n++) {
    let v = load<i32>(HVAL + (<usize>s << 2));
    if (v == 0) {
      store<i64>(HKEY + (<usize>s << 3), id);
      store<i32>(HVAL + (<usize>s << 2), a + 1);
      return;
    }
    if (load<i64>(HKEY + (<usize>s << 3)) == id) return;
    s = (s + 1) & (SLOTS - 1);
  }
}

function find(id: i64): i32 {
  let s = slot(id);
  for (let n = 0; n < SLOTS; n++) {
    let v = load<i32>(HVAL + (<usize>s << 2));
    if (v == 0) return -1;
    if (load<i64>(HKEY + (<usize>s << 3)) == id) return v - 1;
    s = (s + 1) & (SLOTS - 1);
  }
  return -1;
}

function isSpace(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// Packs a trimmed, lowercased unit of up to 3 bytes into an i32; -1 if unusable.
function unitCode(set: u32, idx: i32, field: i32): i32 {
  let n = host_record_field_str(set, idx, field, SBUF, 128);
  if (n < 0) return -1;
  let a = 0;
  let b = n;
  while (a < b && isSpace(<u32>load<u8>(SBUF + <usize>a))) a++;
  while (b > a && isSpace(<u32>load<u8>(SBUF + <usize>(b - 1)))) b--;
  if (b - a > 3) return -1;
  let k: u32 = 0;
  for (let i = a; i < b; i++) {
    let c = <u32>load<u8>(SBUF + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    k |= c << (<u32>(i - a) << 3);
  }
  return <i32>k;
}

function readReading(r: i32): bool {
  let m = host_record_field_f64(LOG, r, 2);
  let p = host_record_field_f64(LOG, r, 4);
  let mu = unitCode(LOG, r, 3);
  let pu = unitCode(LOG, r, 5);
  gKg = mu == U_KG ? m : mu == U_LB ? m * 0.45359237 : NaN;
  gKpa = pu == U_KPA ? p : pu == U_BAR ? p * 100.0 : pu == U_PSI ? p * 6.894757293168 : NaN;
  return isFinite<f64>(gKg) && isFinite<f64>(gKpa) && m >= 0;
}

function schemaOk(): bool {
  return host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0 && host_field_kind(LOG, 2) == 1
    && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2
    && host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1 && host_field_kind(REG, 2) == 1
    && host_field_kind(REG, 5) == 1;
}

function putStr(field: i32, s: string): void {
  let n = s.length;
  for (let i = 0; i < n; i++) store<u8>(SBUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SBUF, n);
}

function putClass(c: i32): void {
  switch (c) {
    case C_MALFORMED: { putStr(7, "MALFORMED"); putStr(8, "unknown unit, negative mass, non-finite value or absent field"); break; }
    case C_NO_READING: { putStr(7, "NO_READING"); putStr(8, "no reading recorded for asset"); break; }
    case C_STALE: { putStr(7, "STALE"); putStr(8, "newest reading older than max_age_days"); break; }
    case C_UNDER: { putStr(7, "UNDERCHARGE"); putStr(8, "charge below rated beyond tolerance"); break; }
    case C_OVER: { putStr(7, "OVERCHARGE"); putStr(8, "charge above rated beyond tolerance"); break; }
    case C_P_HIGH: { putStr(7, "PRESSURE_HIGH"); putStr(8, "pressure above rated beyond rel_tol"); break; }
    case C_P_LOW: { putStr(7, "PRESSURE_LOW"); putStr(8, "pressure below rated beyond rel_tol"); break; }
    case C_ORPHAN: { putStr(7, "ORPHAN_READING"); putStr(8, "reading asset_id not in asset register"); break; }
    default: { putStr(7, "OK"); putStr(8, "within tolerance"); }
  }
}

function emit(id: i64, ts: i64, kg: f64, rkg: f64, kpa: f64, rkpa: f64, c: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rkg);
  out_set_f64(4, kg - rkg);
  out_set_f64(5, kpa);
  out_set_f64(6, rkpa);
  putClass(c);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nR = host_record_count(LOG);
  let nA = host_record_count(REG);
  // Absent or mistyped fields, or more assets than the static index holds, mark every asset MALFORMED.
  let bad = !schemaOk() || nA > MAX_ASSETS;
  memory.fill(HVAL, 0, 131072);
  if (!bad) {
    for (let a = 0; a < nA; a++) {
      insert(host_record_field_i64(REG, a, 0), a);
      store<i32>(BEST + (<usize>a << 2), -1);
    }
    // Single pass over readings selects the newest per asset; ties keep the lower record index.
    for (let r = 0; r < nR; r++) {
      let a = find(host_record_field_i64(LOG, r, 0));
      if (a < 0) continue;
      let b = load<i32>(BEST + (<usize>a << 2));
      if (b < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, b, 1)) {
        store<i32>(BEST + (<usize>a << 2), r);
      }
    }
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    let id = host_record_field_i64(REG, a, 0);
    let rkg = host_record_field_f64(REG, a, 1);
    let rkpa = host_record_field_f64(REG, a, 2);
    let pct = host_record_field_f64(REG, a, 5);
    let b = bad ? -1 : load<i32>(BEST + (<usize>a << 2));
    let ts: i64 = -1;
    let kg: f64 = NaN;
    let kpa: f64 = NaN;
    let c = C_OK;
    if (bad || !isFinite<f64>(rkg) || !isFinite<f64>(rkpa) || !isFinite<f64>(pct) || rkg < 0) {
      c = C_MALFORMED;
    } else if (b < 0) {
      c = C_NO_READING;
    } else {
      ts = host_record_field_i64(LOG, b, 1);
      let valid = readReading(b);
      kg = gKg;
      kpa = gKpa;
      let tol = max<f64>(abs_tol_kg, pct / 100.0 * rkg);
      let dp = kpa - rkpa;
      let ptol = rel_tol * max<f64>(abs<f64>(kpa), abs<f64>(rkpa));
      if (!valid) c = C_MALFORMED;
      else if (as_of_ts - ts > max_age_days * 86400) c = C_STALE;
      else if (rkg - kg > tol) c = C_UNDER;
      else if (kg - rkg > tol) c = C_OVER;
      else if (dp > ptol) c = C_P_HIGH;
      else if (-dp > ptol) c = C_P_LOW;
    }
    emit(id, ts, kg, rkg, kpa, rkpa, c);
    count++;
  }
  if (!bad) {
    for (let r = 0; r < nR; r++) {
      let id = host_record_field_i64(LOG, r, 0);
      if (find(id) >= 0) continue;
      let valid = readReading(r);
      emit(id, host_record_field_i64(LOG, r, 1), gKg, NaN, gKpa, NaN, valid ? C_ORPHAN : C_MALFORMED);
      count++;
    }
  }
  return count;
}
