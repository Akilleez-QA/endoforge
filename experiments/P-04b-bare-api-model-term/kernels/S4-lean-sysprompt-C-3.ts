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

// Open-addressing index on asset_id; 131072 slots keeps total heap near 32 pages.
const SLOTS: i32 = 131072;
const MASK: i32 = SLOTS - 1;
const keys = new StaticArray<i64>(SLOTS);
const vals = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(SLOTS);
const SCR: usize = memory.data(64);
const U_KG: u32 = 0x676b;
const U_LB: u32 = 0x626c;
const U_KPA: u32 = 0x61706b;
const U_BAR: u32 = 0x726162;
const U_PSI: u32 = 0x697370;
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];
const CLS = new StaticArray<ArrayBuffer>(9);
const DET = new StaticArray<ArrayBuffer>(9);
for (let i = 0; i < 9; i++) {
  CLS[i] = String.UTF8.encode(NAMES[i]);
  DET[i] = String.UTF8.encode(DETAILS[i]);
}
let gMass: f64 = 0;
let gPress: f64 = 0;

function slotOf(id: i64): i32 {
  const h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 47);
  for (let n = 0; n < SLOTS; n++) {
    const s = (h + n) & MASK;
    if (unchecked(vals[s]) == 0 || unchecked(keys[s]) == id) return s;
  }
  return -1;
}

function isWs(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// Packs a trimmed, lowercased unit of at most 4 bytes into a u32; 0 means unknown.
function unitCode(set: u32, idx: i32, f: i32): u32 {
  const n = host_record_field_str(set, idx, f, SCR, 64);
  if (n < 0) return 0;
  let a = 0;
  let b = n;
  while (a < b && isWs(<u32>load<u8>(SCR + <usize>a))) a++;
  while (b > a && isWs(<u32>load<u8>(SCR + <usize>(b - 1)))) b--;
  if (b - a > 4) return 0;
  let c: u32 = 0;
  for (let i = a; i < b; i++) {
    let ch = <u32>load<u8>(SCR + <usize>i);
    if (ch >= 65 && ch <= 90) ch += 32;
    c |= ch << (<u32>(i - a) * 8);
  }
  return c;
}

function readOk(i: i32): bool {
  const m = host_record_field_f64(0, i, 2);
  const p = host_record_field_f64(0, i, 4);
  const mu = unitCode(0, i, 3);
  const pu = unitCode(0, i, 5);
  gMass = mu == U_KG ? m : (mu == U_LB ? m * 0.45359237 : NaN);
  gPress = pu == U_KPA ? p : (pu == U_BAR ? p * 100.0 : (pu == U_PSI ? p * 6.894757293168 : NaN));
  return isFinite<f64>(gMass) && gMass >= 0 && isFinite<f64>(gPress);
}

function emit(id: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rc);
  out_set_f64(4, ck - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  const c = unchecked(CLS[cls]);
  const d = unchecked(DET[cls]);
  out_set_str(7, changetype<usize>(c), c.byteLength);
  out_set_str(8, changetype<usize>(d), d.byteLength);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const na = host_record_count(1);
  const nr = host_record_count(0);
  const ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  const id1 = host_field_kind(1, 0) == 0;
  const ok1 = id1 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  for (let s = 0; s < SLOTS; s++) unchecked(vals[s] = 0);
  let out = 0;
  if (!ok1) {
    for (let a = 0; a < na; a++) {
      emit(id1 ? host_record_field_i64(1, a, 0) : -1, -1, NaN, NaN, NaN, NaN, 0);
      out++;
    }
    return out;
  }
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(1, a, 0);
    const s = slotOf(id);
    if (s >= 0 && unchecked(vals[s]) == 0) {
      unchecked(keys[s] = id);
      unchecked(vals[s] = a + 1);
      unchecked(best[s] = -1);
    }
  }
  if (ok0) {
    for (let r = 0; r < nr; r++) {
      const s = slotOf(host_record_field_i64(0, r, 0));
      if (s < 0 || unchecked(vals[s]) == 0) continue;
      const b = unchecked(best[s]);
      if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) unchecked(best[s] = r);
    }
  }
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(1, a, 0);
    const rc = host_record_field_f64(1, a, 1);
    const rp = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    const s = slotOf(id);
    const b = ok0 && s >= 0 && unchecked(vals[s]) != 0 ? unchecked(best[s]) : -1;
    let bad = !ok0 || !isFinite<f64>(rc) || rc < 0 || !isFinite<f64>(rp) || !isFinite<f64>(tp);
    let ts: i64 = -1;
    let ck: f64 = NaN;
    let pk: f64 = NaN;
    if (b >= 0) {
      ts = host_record_field_i64(0, b, 1);
      const rok = readOk(b);
      bad = bad || !rok;
      ck = gMass;
      pk = gPress;
    }
    let cls = 8;
    const tol = max<f64>(abs_tol_kg, tp / 100.0 * rc);
    const ptol = rel_tol * abs<f64>(rp);
    if (bad) cls = 0;
    else if (b < 0) cls = 1;
    else if (as_of_ts - ts > max_age_days * 86400) cls = 2;
    else if (rc - ck > tol) cls = 3;
    else if (ck - rc > tol) cls = 4;
    else if (pk - rp > ptol) cls = 5;
    else if (rp - pk > ptol) cls = 6;
    emit(id, ts, ck, rc, pk, rp, cls);
    out++;
  }
  if (!ok0) return out;
  for (let r = 0; r < nr; r++) {
    const id = host_record_field_i64(0, r, 0);
    const s = slotOf(id);
    if (s >= 0 && unchecked(vals[s]) != 0) continue;
    const rok = readOk(r);
    emit(id, host_record_field_i64(0, r, 1), gMass, NaN, gPress, NaN, rok ? 7 : 0);
    out++;
  }
  return out;
}
