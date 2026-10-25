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
@external("host", "effect_emit") declare function effect_emit(kind: i32, payload: u32): void;

const LOG: u32 = 0;
const REG: u32 = 1;
const SCRATCH: usize = memory.data(256);
const C_MAL = 0, C_NOR = 1, C_STALE = 2, C_UNDER = 3, C_OVER = 4, C_PHI = 5, C_PLO = 6, C_ORPH = 7, C_OK = 8;
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE", "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite or absent field", "no reading for asset", "newest reading older than max age", "charge below rated beyond tolerance", "charge above rated beyond tolerance", "pressure above rated beyond rel_tol", "pressure below rated beyond rel_tol", "reading has no registered asset", "within tolerance"];

function putStr(field: i32, s: string, off: usize): void {
  let n = s.length;
  if (n > 80) n = 80;
  for (let i = 0; i < n; i++) store<u8>(SCRATCH + off + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, SCRATCH + off, n);
}

function eqLit(a: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) if ((load<u8>(SCRATCH + a + <usize>i) | 0x20) != <u8>lit.charCodeAt(i)) return false;
  return true;
}

// Returns multiplier to kg (isMass) or kPa; -1 for unknown or unreadable units.
function unitFactor(idx: i32, field: i32, isMass: bool): f64 {
  const n = host_record_field_str(LOG, idx, field, SCRATCH, 32);
  if (n < 0) return -1;
  let a: usize = 0, b: usize = <usize>n;
  while (a < b && load<u8>(SCRATCH + a) <= 32) a++;
  while (b > a && load<u8>(SCRATCH + b - 1) <= 32) b--;
  const len = <i32>(b - a);
  if (isMass) return eqLit(a, len, "kg") ? 1.0 : eqLit(a, len, "lb") ? 0.45359237 : -1;
  return eqLit(a, len, "kpa") ? 1.0 : eqLit(a, len, "bar") ? 100.0 : eqLit(a, len, "psi") ? 6.894757293168 : -1;
}

function charge(r: i32): f64 {
  const f = unitFactor(r, 3, true);
  return f < 0 ? NaN : host_record_field_f64(LOG, r, 2) * f;
}

function press(r: i32): f64 {
  const f = unitFactor(r, 5, false);
  return f < 0 ? NaN : host_record_field_f64(LOG, r, 4) * f;
}

function badReading(r: i32): bool {
  const m = host_record_field_f64(LOG, r, 2);
  return !isFinite(m) || m < 0 || !isFinite(host_record_field_f64(LOG, r, 4)) || !isFinite(charge(r)) || !isFinite(press(r));
}

function findSlot(keys: StaticArray<i64>, used: StaticArray<bool>, mask: i32, id: i64): i32 {
  let s = <i32>((id * 0x9E3779B97F4A7C15) >>> 40) & mask;
  while (used[s] && keys[s] != id) s = (s + 1) & mask;
  return s;
}

let gC: StaticArray<i32> = new StaticArray<i32>(0);
let gId: StaticArray<i64> = new StaticArray<i64>(0);

function less(a: i32, b: i32): bool {
  if (gC[a] != gC[b]) return gC[a] < gC[b];
  if (gId[a] != gId[b]) return gId[a] < gId[b];
  return a < b;
}

function sift(p: StaticArray<i32>, i: i32, n: i32): void {
  while (true) {
    let c = 2 * i + 1;
    if (c >= n) return;
    if (c + 1 < n && less(p[c], p[c + 1])) c++;
    if (!less(p[i], p[c])) return;
    const t = p[i]; p[i] = p[c]; p[c] = t;
    i = c;
  }
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const n = host_record_count(LOG), m = host_record_count(REG);
  let schemaOk = true;
  for (let f = 0; f < 7; f++) if (host_field_kind(LOG, f) != (f == 0 || f == 1 ? 0 : f == 3 || f == 5 || f == 6 ? 2 : 1)) schemaOk = false;
  for (let f = 0; f < 6; f++) if (host_field_kind(REG, f) != (f == 0 ? 0 : f == 3 || f == 4 ? 2 : 1)) schemaOk = false;
  let cap = 1;
  while (cap < 2 * m + 2) cap <<= 1;
  const keys = new StaticArray<i64>(cap), used = new StaticArray<bool>(cap), best = new StaticArray<i32>(cap);
  for (let i = 0; i < m; i++) {
    const id = host_record_field_i64(REG, i, 0), s = findSlot(keys, used, cap - 1, id);
    if (!used[s]) { used[s] = true; keys[s] = id; best[s] = -1; }
  }
  const rows = new StaticArray<i32>(m + n);
  gC = new StaticArray<i32>(m + n);
  gId = new StaticArray<i64>(m + n);
  let total = m;
  for (let j = 0; j < n; j++) {
    const id = host_record_field_i64(LOG, j, 0), s = findSlot(keys, used, cap - 1, id);
    if (!used[s]) { rows[total] = j; gId[total] = id; gC[total++] = !schemaOk || badReading(j) ? C_MAL : C_ORPH; continue; }
    const b = best[s];
    if (b < 0 || host_record_field_i64(LOG, j, 1) > host_record_field_i64(LOG, b, 1)) best[s] = j;
  }
  for (let i = 0; i < m; i++) {
    const id = host_record_field_i64(REG, i, 0), r = best[findSlot(keys, used, cap - 1, id)];
    const rc = host_record_field_f64(REG, i, 1), rp = host_record_field_f64(REG, i, 2), pct = host_record_field_f64(REG, i, 5);
    rows[i] = r; gId[i] = id;
    let c = C_OK;
    if (!schemaOk || !isFinite(rc) || !isFinite(rp) || !isFinite(pct)) c = C_MAL;
    else if (r < 0) c = C_NOR;
    else if (badReading(r)) c = C_MAL;
    else if (as_of_ts - host_record_field_i64(LOG, r, 1) > max_age_days * 86400) c = C_STALE;
    else {
      const tol = Math.max(abs_tol_kg, pct / 100.0 * Math.abs(rc)), d = charge(r) - rc, p = press(r) - rp;
      if (d < -tol) c = C_UNDER;
      else if (d > tol) c = C_OVER;
      else if (p > rel_tol * Math.abs(rp)) c = C_PHI;
      else if (p < -rel_tol * Math.abs(rp)) c = C_PLO;
    }
    gC[i] = c;
  }
  const perm = new StaticArray<i32>(total);
  for (let i = 0; i < total; i++) perm[i] = i;
  for (let i = total / 2 - 1; i >= 0; i--) sift(perm, i, total);
  for (let e = total - 1; e > 0; e--) { const t = perm[0]; perm[0] = perm[e]; perm[e] = t; sift(perm, 0, e); }
  for (let k = 0; k < total; k++) {
    const q = perm[k], r = rows[q], isAsset = q < m;
    const rc = isAsset ? host_record_field_f64(REG, q, 1) : NaN, rp = isAsset ? host_record_field_f64(REG, q, 2) : NaN;
    const ck = r >= 0 && schemaOk ? charge(r) : NaN;
    out_begin();
    out_set_i64(0, gId[q]);
    out_set_i64(1, r >= 0 && schemaOk ? host_record_field_i64(LOG, r, 1) : -1);
    out_set_f64(2, ck);
    out_set_f64(3, rc);
    out_set_f64(4, ck - rc);
    out_set_f64(5, r >= 0 && schemaOk ? press(r) : NaN);
    out_set_f64(6, rp);
    putStr(7, NAMES[gC[q]], 0);
    putStr(8, DETAILS[gC[q]], 96);
    out_commit();
  }
  // Summary effect for export.csv; payload is the output record-set handle (0).
  effect_emit(100, 0);
  return total;
}
