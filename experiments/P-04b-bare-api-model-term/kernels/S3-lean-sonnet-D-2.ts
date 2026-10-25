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

const MAXA: i32 = 65536;
const SLOTS: i32 = 131072;
const MASK: i32 = 131071;
const UB: usize = memory.data(64);
const OB: usize = memory.data(96);
const slots = new StaticArray<i32>(SLOTS);
const best = new StaticArray<i32>(MAXA);
let rdOk: bool = false;
let regOk: bool = false;

function lower(b: u32): u32 {
  return b >= 65 && b <= 90 ? b + 32 : b;
}

function isWs(b: u32): bool {
  return b == 32 || (b >= 9 && b <= 13);
}

// Returns 1 kg, 2 lb, 3 kpa, 4 bar, 5 psi, 0 unknown.
function unit(set: u32, idx: i32, f: i32): i32 {
  let n = host_record_field_str(set, idx, f, UB, 32);
  if (n < 0) return 0;
  let a = 0;
  while (a < n && isWs(load<u8>(UB + a))) a++;
  while (n > a && isWs(load<u8>(UB + n - 1))) n--;
  if (n - a < 2 || n - a > 3) return 0;
  let k: u32 = 0;
  for (let i = a; i < n; i++) k = (k << 8) | lower(load<u8>(UB + i));
  if (k == 0x6b67) return 1;
  if (k == 0x6c62) return 2;
  if (k == 0x6b7061) return 3;
  if (k == 0x626172) return 4;
  if (k == 0x707369) return 5;
  return 0;
}

function readCharge(j: i32): f64 {
  if (!rdOk) return NaN;
  const m = host_record_field_f64(0, j, 2);
  const u = unit(0, j, 3);
  if (!isFinite(m) || m < 0 || (u != 1 && u != 2)) return NaN;
  return u == 2 ? m * 0.45359237 : m;
}

function readPressure(j: i32): f64 {
  if (!rdOk) return NaN;
  const p = host_record_field_f64(0, j, 4);
  const u = unit(0, j, 5);
  if (!isFinite(p) || u < 3) return NaN;
  return u == 4 ? p * 100.0 : u == 5 ? p * 6.894757293168 : p;
}

// Open-addressing probe on the asset register; returns the slot for id or the first empty slot.
function probe(id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 47);
  let s = slots[h];
  while (s != 0 && host_record_field_i64(1, s - 1, 0) != id) {
    h = (h + 1) & MASK;
    s = slots[h];
  }
  return h;
}

function putStr(f: i32, s: string): void {
  const n = s.length;
  for (let k = 0; k < n; k++) store<u8>(OB + k, <u8>s.charCodeAt(k));
  out_set_str(f, OB, n);
}

function emit(id: i64, ts: i64, ch: f64, rc: f64, pr: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pr);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const na = min(host_record_count(1), MAXA);
  const nr = host_record_count(0);
  rdOk = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1 &&
    host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  regOk = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 &&
    host_field_kind(1, 5) == 1;
  memory.fill(changetype<usize>(slots), 0, SLOTS << 2);
  for (let i = 0; i < na; i++) {
    best[i] = -1;
    const h = probe(host_record_field_i64(1, i, 0));
    if (slots[h] == 0) slots[h] = i + 1;
  }
  for (let j = 0; j < nr; j++) {
    const s = slots[probe(host_record_field_i64(0, j, 0))];
    if (s == 0) continue;
    const b = best[s - 1];
    if (b < 0 || host_record_field_i64(0, j, 1) > host_record_field_i64(0, b, 1)) best[s - 1] = j;
  }
  let out = 0;
  for (let i = 0; i < na; i++) {
    const id = host_record_field_i64(1, i, 0);
    const rc = host_record_field_f64(1, i, 1);
    const rp = host_record_field_f64(1, i, 2);
    const pct = host_record_field_f64(1, i, 5);
    const j = best[slots[probe(id)] - 1];
    let ts: i64 = -1;
    let ch: f64 = NaN;
    let pr: f64 = NaN;
    let cls = "OK";
    let det = "within tolerance";
    if (j >= 0) {
      ts = host_record_field_i64(0, j, 1);
      ch = readCharge(j);
      pr = readPressure(j);
    }
    const tol = max(abs_tol_kg, pct / 100.0 * rc);
    const dp = pr - rp;
    const lim = rel_tol * max(abs(pr), abs(rp));
    if (!regOk || !isFinite(rc) || !isFinite(rp) || !isFinite(pct) || (j >= 0 && (isNaN(ch) || isNaN(pr)))) {
      cls = "MALFORMED";
      det = "bad unit, value or field";
    } else if (j < 0) {
      cls = "NO_READING";
      det = "no reading for asset";
    } else if (as_of_ts - ts > max_age_days * 86400) {
      cls = "STALE";
      det = "newest reading older than max age";
    } else if (ch - rc < -tol) {
      cls = "UNDERCHARGE";
      det = "charge below rated beyond tolerance";
    } else if (ch - rc > tol) {
      cls = "OVERCHARGE";
      det = "charge above rated beyond tolerance";
    } else if (dp > lim) {
      cls = "PRESSURE_HIGH";
      det = "pressure above rated beyond tolerance";
    } else if (-dp > lim) {
      cls = "PRESSURE_LOW";
      det = "pressure below rated beyond tolerance";
    }
    emit(id, ts, ch, rc, pr, rp, cls, det);
    out++;
  }
  for (let j = 0; j < nr; j++) {
    const id = host_record_field_i64(0, j, 0);
    if (slots[probe(id)] != 0) continue;
    const ch = readCharge(j);
    const pr = readPressure(j);
    const bad = isNaN(ch) || isNaN(pr);
    emit(id, host_record_field_i64(0, j, 1), ch, NaN, pr, NaN,
      bad ? "MALFORMED" : "ORPHAN_READING", bad ? "bad unit, value or field" : "reading has no register entry");
    out++;
  }
  return out;
}
