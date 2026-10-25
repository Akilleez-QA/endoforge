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

const DAY: i64 = 86400;
const ubuf: usize = memory.data(64);
const sbuf: usize = memory.data(256);
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let ok0: bool = false;
let ok1: bool = false;
let tab: StaticArray<i32> = new StaticArray<i32>(0);
let tmask: i32 = 0;

function isSpace(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// Returns 0 kg, 1 lb, 2 kPa, 3 bar, 4 psi, or -1 if unknown or truncated.
function unitCode(set: u32, idx: i32, field: i32): i32 {
  let n = host_record_field_str(set, idx, field, ubuf, 64);
  if (n < 0) return -1;
  let s = 0;
  while (s < n && isSpace(<i32>load<u8>(ubuf + <usize>s))) s++;
  while (n > s && isSpace(<i32>load<u8>(ubuf + <usize>(n - 1)))) n--;
  if (n - s < 2 || n - s > 3) return -1;
  let key: i32 = 0;
  for (let i = s; i < n; i++) {
    let c = <i32>load<u8>(ubuf + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    key = (key << 8) | c;
  }
  if (key == 0x6b67) return 0;
  if (key == 0x6c62) return 1;
  if (key == 0x6b7061) return 2;
  if (key == 0x626172) return 3;
  if (key == 0x707369) return 4;
  return -1;
}

// Converts reading idx into gKg and gKpa; false means MALFORMED.
function conv(idx: i32): bool {
  if (!ok0) return false;
  const m = host_record_field_f64(0, idx, 2);
  const p = host_record_field_f64(0, idx, 4);
  const mu = unitCode(0, idx, 3);
  const pu = unitCode(0, idx, 5);
  if (mu < 0 || mu > 1 || pu < 2) return false;
  if (!isFinite(m) || !isFinite(p) || m < 0) return false;
  const kg = mu == 0 ? m : m * 0.45359237;
  const kpa = pu == 2 ? p : (pu == 3 ? p * 100.0 : p * 6.894757293168);
  if (!isFinite(kg) || !isFinite(kpa)) return false;
  gKg = kg;
  gKpa = kpa;
  return true;
}

function put(dst: usize, s: string): i32 {
  const n = s.length;
  for (let i = 0; i < n; i++) store<u8>(dst + <usize>i, <u8>s.charCodeAt(i));
  return n;
}

function emit(id: i64, ts: i64, kg: f64, rk: f64, p: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, kg);
  out_set_f64(3, rk);
  out_set_f64(4, kg - rk);
  out_set_f64(5, p);
  out_set_f64(6, rp);
  out_set_str(7, sbuf, put(sbuf, cls));
  out_set_str(8, sbuf + 32, put(sbuf + 32, det));
  out_commit();
}

// Open-addressing slot for an asset id; the slot is empty or holds that id.
function find(id: i64): i32 {
  let slot = <i32>(<u64>(id * 0x9E3779B97F4A7C15) >> 40) & tmask;
  while (true) {
    const a = unchecked(tab[slot]);
    if (a == 0 || host_record_field_i64(1, a - 1, 0) == id) return slot;
    slot = (slot + 1) & tmask;
  }
  return slot;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const n = max<i32>(host_record_count(1), 0);
  const m = max<i32>(host_record_count(0), 0);
  ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 &&
    host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 &&
    host_field_kind(1, 5) == 1;
  let cap = 16;
  while (cap < n * 2) cap <<= 1;
  tab = new StaticArray<i32>(cap);
  tmask = cap - 1;
  const rep = new StaticArray<i32>(n);
  const best = new StaticArray<i32>(n);
  for (let i = 0; i < n; i++) {
    const slot = find(host_record_field_i64(1, i, 0));
    const a = tab[slot];
    if (a == 0) { tab[slot] = i + 1; rep[i] = i; } else rep[i] = a - 1;
    best[i] = -1;
  }
  for (let r = 0; r < m; r++) {
    const a = tab[find(host_record_field_i64(0, r, 0))] - 1;
    if (a < 0) continue;
    const b = best[a];
    if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) best[a] = r;
  }
  let count = 0;
  for (let i = 0; i < n; i++) {
    const rk = host_record_field_f64(1, i, 1);
    const rp = host_record_field_f64(1, i, 2);
    const tp = host_record_field_f64(1, i, 5);
    const r = best[rep[i]];
    gKg = NaN;
    gKpa = NaN;
    const good = r >= 0 && conv(r);
    const ts: i64 = r >= 0 ? host_record_field_i64(0, r, 1) : -1;
    let cls = "OK";
    let det = "within tolerance";
    if (!ok1 || !isFinite(rk) || !isFinite(rp) || !isFinite(tp)) { cls = "MALFORMED"; det = "bad asset register field"; }
    else if (r < 0) { cls = "NO_READING"; det = "no reading for asset"; }
    else if (!good) { cls = "MALFORMED"; det = "bad reading field or unit"; }
    else if (as_of_ts - ts > max_age_days * DAY) { cls = "STALE"; det = "newest reading older than max age"; }
    else {
      const tol = Math.max(abs_tol_kg, tp / 100.0 * rk);
      const d = gKg - rk;
      if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
      else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
      else if (Math.abs(gKpa - rp) > rel_tol * Math.max(Math.abs(gKpa), Math.abs(rp))) {
        if (gKpa > rp) { cls = "PRESSURE_HIGH"; det = "pressure above rated"; }
        else { cls = "PRESSURE_LOW"; det = "pressure below rated"; }
      }
    }
    emit(host_record_field_i64(1, i, 0), ts, gKg, rk, gKpa, rp, cls, det);
    count++;
  }
  for (let r = 0; r < m; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (tab[find(id)] != 0) continue;
    gKg = NaN;
    gKpa = NaN;
    const good = conv(r);
    emit(id, host_record_field_i64(0, r, 1), gKg, NaN, gKpa, NaN,
      good ? "ORPHAN_READING" : "MALFORMED", good ? "reading has no asset record" : "bad reading field or unit");
    count++;
  }
  return count;
}
