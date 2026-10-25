@external("host", "host_record_count") declare function host_record_count(set: u32): i32
@external("host", "host_record_field_i64") declare function host_record_field_i64(set: u32, idx: i32, field: i32): i64
@external("host", "host_record_field_f64") declare function host_record_field_f64(set: u32, idx: i32, field: i32): f64
@external("host", "host_record_field_str") declare function host_record_field_str(set: u32, idx: i32, field: i32, dst: usize, cap: i32): i32
@external("host", "host_field_kind") declare function host_field_kind(set: u32, field: i32): i32
@external("host", "out_begin") declare function out_begin(): void
@external("host", "out_set_i64") declare function out_set_i64(field: i32, v: i64): void
@external("host", "out_set_f64") declare function out_set_f64(field: i32, v: f64): void
@external("host", "out_set_str") declare function out_set_str(field: i32, ptr: usize, len: i32): void
@external("host", "out_commit") declare function out_commit(): void

const SLOTS: i32 = 16384;
const MASK: i32 = 16383;
const MAXA: i32 = 8192;
const SB: usize = memory.data(16);
const OB: usize = memory.data(96);
const tab = new StaticArray<u8>(SLOTS);
const keys = new StaticArray<i64>(SLOTS);
const best = new StaticArray<i32>(SLOTS);
let used: i32 = 0;

function hash(id: i64): i32 {
  return ((id as u64 * 0x9E3779B97F4A7C15) >> 50) as i32;
}

function ins(id: i64): void {
  let s = hash(id);
  for (let n = 0; n < SLOTS; n++) {
    if (tab[s] == 0) {
      if (used < MAXA) { tab[s] = 1; keys[s] = id; used++; }
      return;
    }
    if (keys[s] == id) return;
    s = (s + 1) & MASK;
  }
}

function find(id: i64): i32 {
  let s = hash(id);
  for (let n = 0; n < SLOTS; n++) {
    if (tab[s] == 0) return -1;
    if (keys[s] == id) return s;
    s = (s + 1) & MASK;
  }
  return -1;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

// Returns up to 3 trimmed lowercase ASCII bytes packed little-endian, or 0 if unusable.
function unit(j: i32, f: i32): u32 {
  let n = host_record_field_str(0, j, f, SB, 16);
  if (n < 0) return 0;
  let a = 0;
  while (a < n && isWs(load<u8>(SB + (a as usize)))) a++;
  while (n > a && isWs(load<u8>(SB + ((n - 1) as usize)))) n--;
  if (n - a < 1 || n - a > 3) return 0;
  let k: u32 = 0;
  for (let i = a; i < n; i++) {
    let c = load<u8>(SB + (i as usize)) as u32;
    if (c >= 65 && c <= 90) c += 32;
    k |= c << ((8 * (i - a)) as u32);
  }
  return k;
}

function mass(j: i32): f64 {
  let v = host_record_field_f64(0, j, 2);
  let u = unit(j, 3);
  if (!isFinite(v) || v < 0) return NaN;
  if (u == 0x676b) return v;
  if (u == 0x626c) return v * 0.45359237;
  return NaN;
}

function press(j: i32): f64 {
  let v = host_record_field_f64(0, j, 4);
  let u = unit(j, 5);
  if (!isFinite(v)) return NaN;
  if (u == 0x61706b) return v;
  if (u == 0x726162) return v * 100.0;
  if (u == 0x697370) return v * 6.894757293168;
  return NaN;
}

function put(field: i32, s: string): void {
  let n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(OB + (i as usize), s.charCodeAt(i) as u8);
  out_set_str(field, OB, n);
}

function emit(id: i64, ts: i64, ch: f64, rc: f64, pk: f64, rp: f64, c: string, d: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  put(7, c);
  put(8, d);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const ok0 = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 &&
    host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  const ok1 = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 &&
    host_field_kind(1, 5) == 1;
  const na = host_record_count(1);
  const nr = ok0 ? host_record_count(0) : 0;
  let count = 0;
  used = 0;
  for (let s = 0; s < SLOTS; s++) { tab[s] = 0; best[s] = -1; }
  if (ok1) for (let i = 0; i < na; i++) ins(host_record_field_i64(1, i, 0));
  for (let j = 0; j < nr; j++) {
    const s = find(host_record_field_i64(0, j, 0));
    if (s < 0) continue;
    const b = best[s];
    if (b < 0 || host_record_field_i64(0, j, 1) > host_record_field_i64(0, b, 1)) best[s] = j;
  }
  for (let i = 0; i < na; i++) {
    const id = host_record_field_i64(1, i, 0);
    const rc = host_record_field_f64(1, i, 1);
    const rp = host_record_field_f64(1, i, 2);
    const pct = host_record_field_f64(1, i, 5);
    const s = ok1 ? find(id) : -1;
    const j = s >= 0 ? best[s] : -1;
    let ts: i64 = -1;
    let ch: f64 = NaN;
    let pk: f64 = NaN;
    if (j >= 0) { ts = host_record_field_i64(0, j, 1); ch = mass(j); pk = press(j); }
    const tol = max(abs_tol_kg, pct / 100.0 * rc);
    const bad = !ok0 || !ok1 || !isFinite(rc) || !isFinite(rp) || !isFinite(pct) || rc < 0 ||
      (j >= 0 && (!isFinite(ch) || !isFinite(pk)));
    let c = "OK";
    let d = "within tolerance";
    if (bad) { c = "MALFORMED"; d = "bad unit, negative or non-finite value"; }
    else if (j < 0) { c = "NO_READING"; d = "no reading for asset"; }
    else if (as_of_ts - ts > max_age_days * 86400) { c = "STALE"; d = "newest reading too old"; }
    else if (rc - ch > tol) { c = "UNDERCHARGE"; d = "charge below rated"; }
    else if (ch - rc > tol) { c = "OVERCHARGE"; d = "charge above rated"; }
    else if (pk - rp > rel_tol * abs(rp)) { c = "PRESSURE_HIGH"; d = "pressure above rated"; }
    else if (rp - pk > rel_tol * abs(rp)) { c = "PRESSURE_LOW"; d = "pressure below rated"; }
    emit(id, ts, ch, rc, pk, rp, c, d);
    count++;
  }
  for (let j = 0; j < nr; j++) {
    const id = host_record_field_i64(0, j, 0);
    if (find(id) >= 0) continue;
    const ch = mass(j);
    const pk = press(j);
    const bad = !isFinite(ch) || !isFinite(pk);
    emit(id, host_record_field_i64(0, j, 1), ch, NaN, pk, NaN,
      bad ? "MALFORMED" : "ORPHAN_READING", bad ? "bad unit, negative or non-finite value" : "asset not in register");
    count++;
  }
  return count;
}
