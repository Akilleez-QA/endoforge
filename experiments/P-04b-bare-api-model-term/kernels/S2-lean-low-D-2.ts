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

const CAP: i32 = 32768;
const MAXA: i32 = 16384;
const KEYS: usize = memory.data(262144);
const VALS: usize = memory.data(131072);
const BEST: usize = memory.data(65536);
const SBUF: usize = memory.data(64);
const OBUF: usize = memory.data(128);
let ok0: bool = true;
let ok1: bool = true;

function kindsOk(set: u32, spec: string): bool {
  for (let i = 0; i < spec.length; i++) {
    if (host_field_kind(set, i) != spec.charCodeAt(i) - 48) return false;
  }
  return true;
}

function slotOf(key: i64): i32 {
  return <i32>((<u64>key * 0x9E3779B97F4A7C15) >> 49) & (CAP - 1);
}

function insert(key: i64, idx: i32): void {
  let s = slotOf(key);
  while (true) {
    let v = load<i32>(VALS + (<usize>s << 2));
    if (v == 0) { store<i64>(KEYS + (<usize>s << 3), key); store<i32>(VALS + (<usize>s << 2), idx + 1); return; }
    if (load<i64>(KEYS + (<usize>s << 3)) == key) return;
    s = (s + 1) & (CAP - 1);
  }
}

function findAsset(key: i64, na: i32): i32 {
  let s = slotOf(key);
  while (true) {
    let v = load<i32>(VALS + (<usize>s << 2));
    if (v == 0) break;
    if (load<i64>(KEYS + (<usize>s << 3)) == key) return v - 1;
    s = (s + 1) & (CAP - 1);
  }
  // Assets beyond the index capacity fall back to a linear scan.
  for (let i = MAXA; i < na; i++) if (host_record_field_i64(1, i, 0) == key) return i;
  return -1;
}

function isWs(c: u32): bool { return c == 32 || (c >= 9 && c <= 13); }

function eqUnit(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let i = 0; i < lit.length; i++) {
    let c = <i32>load<u8>(SBUF + <usize>(s + i));
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  let n = host_record_field_str(0, idx, field, SBUF, 64);
  if (n < 0) return NaN;
  let s = 0, e = n;
  while (s < e && isWs(load<u8>(SBUF + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SBUF + <usize>(e - 1)))) e--;
  if (mass) {
    if (eqUnit(s, e, "kg")) return 1.0;
    if (eqUnit(s, e, "lb")) return 0.45359237;
  } else {
    if (eqUnit(s, e, "kpa")) return 1.0;
    if (eqUnit(s, e, "bar")) return 100.0;
    if (eqUnit(s, e, "psi")) return 6.894757293168;
  }
  return NaN;
}

function putStr(field: i32, s: string): void {
  for (let i = 0; i < s.length; i++) store<u8>(OBUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OBUF, s.length);
}

function emit(aid: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, aid); out_set_i64(1, ts); out_set_f64(2, ck); out_set_f64(3, rc);
  out_set_f64(4, ck - rc); out_set_f64(5, pk); out_set_f64(6, rp);
  putStr(7, cls); putStr(8, det);
  out_commit();
}

function readingBad(r: i32): bool {
  let m = host_record_field_f64(0, r, 2), p = host_record_field_f64(0, r, 4);
  return !ok0 || !isFinite(m) || m < 0 || !isFinite(p) || !isFinite(unitFactor(r, 3, true)) || !isFinite(unitFactor(r, 5, false));
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  ok0 = kindsOk(0, "0012122");
  ok1 = kindsOk(1, "011221");
  let na = host_record_count(1), nr = host_record_count(0), count = 0;
  memory.fill(VALS, 0, <usize>CAP << 2);
  memory.fill(BEST, 0, <usize>MAXA << 2);
  for (let a = 0; a < na && a < MAXA; a++) insert(host_record_field_i64(1, a, 0), a);
  // Overflow assets (index >= MAXA) get their newest reading by rescanning set 0.
  for (let r = 0; r < nr; r++) {
    let a = findAsset(host_record_field_i64(0, r, 0), na);
    if (a < 0 || a >= MAXA) continue;
    let b = load<i32>(BEST + (<usize>a << 2));
    if (b == 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b - 1, 1)) store<i32>(BEST + (<usize>a << 2), r + 1);
  }
  for (let a = 0; a < na; a++) {
    let aid = host_record_field_i64(1, a, 0);
    let rc = host_record_field_f64(1, a, 1), rp = host_record_field_f64(1, a, 2), tp = host_record_field_f64(1, a, 5);
    let r = -1;
    if (a < MAXA) r = load<i32>(BEST + (<usize>a << 2)) - 1;
    else for (let i = 0; i < nr; i++) if (host_record_field_i64(0, i, 0) == aid && (r < 0 || host_record_field_i64(0, i, 1) > host_record_field_i64(0, r, 1))) r = i;
    let ts: i64 = -1, ck = NaN, pk = NaN;
    if (r >= 0) {
      ts = host_record_field_i64(0, r, 1);
      ck = host_record_field_f64(0, r, 2) * unitFactor(r, 3, true);
      pk = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
    }
    let tol = Math.max(abs_tol_kg, tp / 100.0 * Math.abs(rc));
    if (!ok1 || !isFinite(rc) || rc < 0 || !isFinite(rp) || !isFinite(tp) || (r >= 0 && readingBad(r))) emit(aid, ts, ck, rc, pk, rp, "MALFORMED", "unknown unit, negative mass, non-finite or absent field");
    else if (r < 0) emit(aid, ts, ck, rc, pk, rp, "NO_READING", "no reading for asset");
    else if (as_of_ts - ts > max_age_days * 86400) emit(aid, ts, ck, rc, pk, rp, "STALE", "newest reading older than max_age_days");
    else if (rc - ck > tol) emit(aid, ts, ck, rc, pk, rp, "UNDERCHARGE", "charge below rated beyond tolerance");
    else if (ck - rc > tol) emit(aid, ts, ck, rc, pk, rp, "OVERCHARGE", "charge above rated beyond tolerance");
    else if (pk - rp > rel_tol * Math.abs(rp)) emit(aid, ts, ck, rc, pk, rp, "PRESSURE_HIGH", "pressure above rated beyond rel_tol");
    else if (rp - pk > rel_tol * Math.abs(rp)) emit(aid, ts, ck, rc, pk, rp, "PRESSURE_LOW", "pressure below rated beyond rel_tol");
    else emit(aid, ts, ck, rc, pk, rp, "OK", "within tolerance");
    count++;
  }
  for (let r = 0; r < nr; r++) {
    let aid = host_record_field_i64(0, r, 0);
    if (findAsset(aid, na) >= 0) continue;
    let ts = host_record_field_i64(0, r, 1);
    let ck = host_record_field_f64(0, r, 2) * unitFactor(r, 3, true);
    let pk = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
    if (readingBad(r)) emit(aid, ts, ck, NaN, pk, NaN, "MALFORMED", "unknown unit, negative mass, non-finite or absent field");
    else emit(aid, ts, ck, NaN, pk, NaN, "ORPHAN_READING", "asset_id not in asset register");
    count++;
  }
  return count;
}
