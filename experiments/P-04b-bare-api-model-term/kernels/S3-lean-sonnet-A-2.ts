const SB: usize = memory.data(128);
const UB: usize = memory.data(32);
const K0: StaticArray<i32> = [0, 0, 1, 2, 1, 2, 2];
const K1: StaticArray<i32> = [0, 1, 1, 2, 2, 1];

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

let keys: usize = 0;
let best: usize = 0;
let mask: i32 = 0;
let cnt: i32 = 0;
let gCharge: f64 = NaN;
let gPress: f64 = NaN;

// open-addressing index on asset_id keeps the join linear
function slotOf(id: i64, ins: bool): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >>> 32) & mask;
  for (let k = 0; k <= mask; k++) {
    const b = load<i32>(best + ((<usize>h) << 2));
    if (b == -2) {
      if (!ins) return -1;
      store<i64>(keys + ((<usize>h) << 3), id);
      store<i32>(best + ((<usize>h) << 2), -1);
      return h;
    }
    if (load<i64>(keys + ((<usize>h) << 3)) == id) return h;
    h = (h + 1) & mask;
  }
  return -1;
}

function kindsOk(set: u32, k: StaticArray<i32>): bool {
  for (let i = 0; i < k.length; i++) if (host_field_kind(set, i) != k[i]) return false;
  return true;
}

function low(c: i32): i32 {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

function isSpace(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// 1 kg, 2 lb, 3 kPa, 4 bar, 5 psi, 0 invalid
function unit(set: u32, idx: i32, f: i32): i32 {
  const n = host_record_field_str(set, idx, f, UB, 32);
  if (n < 0) return 0;
  let s = 0;
  let e = n;
  while (s < e && isSpace(<i32>load<u8>(UB + <usize>s))) s++;
  while (e > s && isSpace(<i32>load<u8>(UB + <usize>(e - 1)))) e--;
  const l = e - s;
  if (l < 2 || l > 3) return 0;
  const a = low(<i32>load<u8>(UB + <usize>s));
  const b = low(<i32>load<u8>(UB + <usize>(s + 1)));
  if (l == 2) {
    if (a == 107 && b == 103) return 1;
    if (a == 108 && b == 98) return 2;
    return 0;
  }
  const c = low(<i32>load<u8>(UB + <usize>(s + 2)));
  if (a == 107 && b == 112 && c == 97) return 3;
  if (a == 98 && b == 97 && c == 114) return 4;
  if (a == 112 && b == 115 && c == 105) return 5;
  return 0;
}

function readingConv(r: i32): bool {
  gCharge = NaN;
  gPress = NaN;
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  const mu = unit(0, r, 3);
  const pu = unit(0, r, 5);
  if (!isFinite(m) || m < 0 || !isFinite(p) || mu < 1 || mu > 2 || pu < 3) return false;
  gCharge = mu == 1 ? m : m * 0.45359237;
  gPress = pu == 3 ? p : (pu == 4 ? p * 100.0 : p * 6.894757293168);
  return true;
}

function setStr(field: i32, s: string): void {
  const n = s.length;
  for (let i = 0; i < n; i++) store<u8>(SB + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SB, n);
}

function emit(id: i64, ts: i64, ch: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  setStr(7, cls);
  setStr(8, det);
  out_commit();
  cnt++;
}

function asset(a: i32, absTol: f64, rel: f64, maxAge: i64, asOf: i64): void {
  const id = host_record_field_i64(1, a, 0);
  const rc = host_record_field_f64(1, a, 1);
  const rp = host_record_field_f64(1, a, 2);
  const pct = host_record_field_f64(1, a, 5);
  const bad = !isFinite(rc) || !isFinite(rp) || !isFinite(pct) || pct < 0 || rc < 0;
  const r = load<i32>(best + ((<usize>slotOf(id, false)) << 2));
  if (r < 0) {
    if (bad) emit(id, -1, NaN, rc, NaN, rp, "MALFORMED", "invalid asset register fields");
    else emit(id, -1, NaN, rc, NaN, rp, "NO_READING", "no reading for asset");
    return;
  }
  const ts = host_record_field_i64(0, r, 1);
  if (!readingConv(r) || bad) {
    emit(id, ts, gCharge, rc, gPress, rp, "MALFORMED", "bad unit, mass or pressure");
    return;
  }
  const ch = gCharge;
  const pk = gPress;
  const d = ch - rc;
  const tol = Math.max(absTol, pct / 100.0 * rc);
  const pd = Math.abs(pk - rp);
  if (asOf - ts > maxAge * 86400) emit(id, ts, ch, rc, pk, rp, "STALE", "newest reading too old");
  else if (d < 0 && -d > tol) emit(id, ts, ch, rc, pk, rp, "UNDERCHARGE", "charge below rated");
  else if (d > 0 && d > tol) emit(id, ts, ch, rc, pk, rp, "OVERCHARGE", "charge above rated");
  else if (pd > rel * Math.max(Math.abs(pk), Math.abs(rp)) && pk > rp) emit(id, ts, ch, rc, pk, rp, "PRESSURE_HIGH", "pressure above rated");
  else if (pd > rel * Math.max(Math.abs(pk), Math.abs(rp))) emit(id, ts, ch, rc, pk, rp, "PRESSURE_LOW", "pressure below rated");
  else emit(id, ts, ch, rc, pk, rp, "OK", "within tolerance");
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const n0 = host_record_count(0);
  const n1 = host_record_count(1);
  const ok0 = kindsOk(0, K0);
  const ok1 = kindsOk(1, K1);
  let cap = 16;
  while (cap < n1 * 2) cap <<= 1;
  mask = cap - 1;
  keys = heap.alloc((<usize>cap) << 3);
  best = heap.alloc((<usize>cap) << 2);
  for (let i = 0; i < cap; i++) store<i32>(best + ((<usize>i) << 2), -2);
  cnt = 0;
  if (ok1) for (let a = 0; a < n1; a++) slotOf(host_record_field_i64(1, a, 0), true);
  if (ok0 && ok1) {
    for (let r = 0; r < n0; r++) {
      const s = slotOf(host_record_field_i64(0, r, 0), false);
      if (s < 0) continue;
      const p = load<i32>(best + ((<usize>s) << 2));
      if (p < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, p, 1)) store<i32>(best + ((<usize>s) << 2), r);
    }
  }
  for (let a = 0; a < n1; a++) {
    if (!ok1) emit(0, -1, NaN, NaN, NaN, NaN, "MALFORMED", "asset register field absent");
    else if (!ok0) emit(host_record_field_i64(1, a, 0), -1, NaN, NaN, NaN, NaN, "MALFORMED", "reading log field absent");
    else asset(a, abs_tol_kg, rel_tol, max_age_days, as_of_ts);
  }
  if (ok0) {
    for (let r = 0; r < n0; r++) {
      const id = host_record_field_i64(0, r, 0);
      if (ok1 && slotOf(id, false) >= 0) continue;
      const good = readingConv(r);
      emit(id, host_record_field_i64(0, r, 1), gCharge, NaN, gPress, NaN, good ? "ORPHAN_READING" : "MALFORMED", good ? "reading for unregistered asset" : "bad unit, mass or pressure");
    }
  }
  return cnt;
}
