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
const SLOT: usize = 24;
const STR_CAP: i32 = 32;
const KINDS_LOG: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const KINDS_REG: StaticArray<i32> = [0, 1, 1, 2, 2, 1];
const SCRATCH = memory.data(64);
const TEXT = memory.data(128);

let tblBase: usize = 0;
let tblBits: i32 = 0;
let gCk: f64 = 0;
let gPk: f64 = 0;

function schemaOk(set: u32, kinds: StaticArray<i32>): bool {
  for (let f = 0; f < kinds.length; f++) {
    if (host_field_kind(set, f) != unchecked(kinds[f])) return false;
  }
  return true;
}

function isSpace(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqCi(p: usize, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(set: u32, idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(set, idx, field, SCRATCH, STR_CAP);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isSpace(<i32>load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isSpace(<i32>load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  let p = SCRATCH + <usize>s;
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

function readOk(r: i32): bool {
  let m = host_record_field_f64(LOG, r, 2);
  gCk = m * unitFactor(LOG, r, 3, true);
  gPk = host_record_field_f64(LOG, r, 4) * unitFactor(LOG, r, 5, false);
  return m >= 0 && isFinite(gCk) && isFinite(gPk);
}

function className(code: i32): string {
  switch (code) {
    case 0: return "MALFORMED";
    case 1: return "NO_READING";
    case 2: return "STALE";
    case 3: return "UNDERCHARGE";
    case 4: return "OVERCHARGE";
    case 5: return "PRESSURE_HIGH";
    case 6: return "PRESSURE_LOW";
    case 7: return "ORPHAN_READING";
    default: return "OK";
  }
}

function detailText(code: i32): string {
  switch (code) {
    case 0: return "unknown unit, negative mass, or non-finite value";
    case 1: return "no reading for asset";
    case 2: return "newest reading older than max age";
    case 3: return "charge below rated beyond tolerance";
    case 4: return "charge above rated beyond tolerance";
    case 5: return "pressure above rated beyond relative tolerance";
    case 6: return "pressure below rated beyond relative tolerance";
    case 7: return "reading for unregistered asset";
    default: return "within tolerance";
  }
}

function ascii(dst: usize, s: string, cap: i32): i32 {
  let n = min(s.length, cap);
  for (let i = 0; i < n; i++) store<u8>(dst + <usize>i, <u8>s.charCodeAt(i));
  return n;
}

function emit(aid: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, code: i32, det: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rc);
  out_set_f64(4, ck - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  out_set_str(7, TEXT, ascii(TEXT, className(code), 32));
  out_set_str(8, TEXT + 32, ascii(TEXT + 32, det, 80));
  out_commit();
}

function slotAddr(key: i64, insert: bool): usize {
  let mask = (1 << tblBits) - 1;
  let i = <i32>((<u64>key * 0x9E3779B97F4A7C15) >>> <u64>(64 - tblBits));
  for (let n = 0; n <= mask; n++) {
    let a = tblBase + <usize>i * SLOT;
    if (load<i32>(a, 8) == 0) return insert ? a : 0;
    if (load<i64>(a) == key) return a;
    i = (i + 1) & mask;
  }
  return 0;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nr = max(host_record_count(LOG), 0);
  let na = max(host_record_count(REG), 0);
  let count = 0;
  if (!schemaOk(REG, KINDS_REG)) {
    let idOk = host_field_kind(REG, 0) == 0;
    for (let a = 0; a < na; a++) {
      emit(idOk ? host_record_field_i64(REG, a, 0) : -1, -1, NaN, NaN, NaN, NaN, 0, "asset register field absent");
      count++;
    }
    return count;
  }
  let logOk = schemaOk(LOG, KINDS_LOG);
  // Open-addressing index on asset_id keeps the join O(n + m)
  let bits = 4;
  while ((1 << bits) < na + (na >> 2) + 1) bits++;
  let base = (__heap_base + 7) & ~<usize>7;
  let bytes = (<usize>1 << <usize>bits) * SLOT;
  let pages = <i32>((base + bytes + 0xFFFF) >>> 16);
  if (memory.size() < pages && memory.grow(pages - memory.size()) < 0) return 0;
  memory.fill(base, 0, bytes);
  tblBase = base;
  tblBits = bits;
  for (let a = 0; a < na; a++) {
    let key = host_record_field_i64(REG, a, 0);
    let s = slotAddr(key, true);
    if (load<i32>(s, 8) == 0) {
      store<i64>(s, key);
      store<i32>(s, a + 1, 8);
      store<i32>(s, -1, 12);
    }
  }
  if (logOk) {
    for (let r = 0; r < nr; r++) {
      let s = slotAddr(host_record_field_i64(LOG, r, 0), false);
      if (s == 0) continue;
      let ts = host_record_field_i64(LOG, r, 1);
      if (load<i32>(s, 12) < 0 || ts > load<i64>(s, 16)) {
        store<i32>(s, r, 12);
        store<i64>(s, ts, 16);
      }
    }
  }
  let maxAge = max_age_days * 86400;
  for (let a = 0; a < na; a++) {
    let aid = host_record_field_i64(REG, a, 0);
    let rc = host_record_field_f64(REG, a, 1);
    let rp = host_record_field_f64(REG, a, 2);
    let tp = host_record_field_f64(REG, a, 5);
    let assetBad = !isFinite(rc) || !isFinite(rp) || !isFinite(tp) || rc < 0;
    count++;
    if (!logOk) {
      emit(aid, -1, NaN, rc, NaN, rp, 0, "refrigerant log field absent");
      continue;
    }
    let s = slotAddr(aid, false);
    let r = load<i32>(s, 12);
    if (r < 0) {
      let c = assetBad ? 0 : 1;
      emit(aid, -1, NaN, rc, NaN, rp, c, detailText(c));
      continue;
    }
    let ts = load<i64>(s, 16);
    let code = 8;
    if (!readOk(r) || assetBad) {
      code = 0;
    } else if (as_of_ts - ts > maxAge) {
      code = 2;
    } else {
      let tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
      let d = gCk - rc;
      let pd = gPk - rp;
      let pt = rel_tol * Math.max(Math.abs(gPk), Math.abs(rp));
      if (d < -tol) code = 3;
      else if (d > tol) code = 4;
      else if (pd > pt) code = 5;
      else if (-pd > pt) code = 6;
    }
    emit(aid, ts, gCk, rc, gPk, rp, code, detailText(code));
  }
  if (logOk) {
    for (let r = 0; r < nr; r++) {
      let aid = host_record_field_i64(LOG, r, 0);
      if (slotAddr(aid, false) != 0) continue;
      let code = readOk(r) ? 7 : 0;
      emit(aid, host_record_field_i64(LOG, r, 1), gCk, NaN, gPk, NaN, code, detailText(code));
      count++;
    }
  }
  return count;
}
