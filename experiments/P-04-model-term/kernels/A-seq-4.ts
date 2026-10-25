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

const UB: usize = memory.data(64);
const OB: usize = memory.data(128);
const DAY: i64 = 86400;

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function eqci(p: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitFactor(idx: i32, field: i32, pressure: bool): f64 {
  const n = host_record_field_str(0, idx, field, UB, 64);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(<i32>load<u8>(UB + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(UB + <usize>(e - 1)))) e--;
  const p = UB + <usize>s;
  const m = e - s;
  if (!pressure) {
    if (eqci(p, m, "kg")) return 1.0;
    if (eqci(p, m, "lb")) return 0.45359237;
    return NaN;
  }
  if (eqci(p, m, "kpa")) return 1.0;
  if (eqci(p, m, "bar")) return 100.0;
  if (eqci(p, m, "psi")) return 6.894757293168;
  return NaN;
}

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let i = 0; i < n; i++) store<u8>(OB + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, OB, n);
}

function emit(aid: i64, ts: i64, ck: f64, rc: f64, pk: f64, rp: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ck);
  out_set_f64(3, rc);
  out_set_f64(4, ck - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

function lookup(keys: StaticArray<i64>, slots: StaticArray<i32>, mask: i32, aid: i64): i32 {
  let h = <i32>(((<u64>aid * 0x9E3779B1) >> 16) & <u64>mask);
  while (slots[h] != 0) {
    if (keys[h] == aid) return slots[h] - 1;
    h = (h + 1) & mask;
  }
  return -1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nA = max(host_record_count(1), 0);
  const nR = max(host_record_count(0), 0);
  const regOk = host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1 && host_field_kind(1, 5) == 1;
  const logKeys = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0;
  const logOk = logKeys && host_field_kind(0, 2) == 1 && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2;
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  const mask = cap - 1;
  const keys = new StaticArray<i64>(cap);
  const slots = new StaticArray<i32>(cap);
  const best = new StaticArray<i32>(max(nA, 1));
  const bestTs = new StaticArray<i64>(max(nA, 1));
  // Open-addressing index on asset_id keeps the join O(n + m)
  for (let a = 0; a < nA; a++) {
    const aid = regOk ? host_record_field_i64(1, a, 0) : -1;
    if (lookup(keys, slots, mask, aid) >= 0) continue;
    let h = <i32>(((<u64>aid * 0x9E3779B1) >> 16) & <u64>mask);
    while (slots[h] != 0) h = (h + 1) & mask;
    keys[h] = aid;
    slots[h] = a + 1;
  }
  for (let r = 0; logKeys && r < nR; r++) {
    const a = lookup(keys, slots, mask, host_record_field_i64(0, r, 0));
    if (a < 0) continue;
    const ts = host_record_field_i64(0, r, 1);
    if (best[a] == 0 || ts > bestTs[a]) { best[a] = r + 1; bestTs[a] = ts; }
  }
  let count = 0;
  for (let a = 0; a < nA; a++) {
    const aid = regOk ? host_record_field_i64(1, a, 0) : -1;
    const rc = regOk ? host_record_field_f64(1, a, 1) : NaN;
    const rp = regOk ? host_record_field_f64(1, a, 2) : NaN;
    const pct = regOk ? host_record_field_f64(1, a, 5) : NaN;
    const regBad = !regOk || !isFinite(rc) || rc < 0 || !isFinite(rp) || !isFinite(pct);
    const r = best[lookup(keys, slots, mask, aid)] - 1;
    count++;
    if (r < 0) {
      if (regBad) emit(aid, -1, NaN, rc, NaN, rp, "MALFORMED", "asset register field invalid");
      else emit(aid, -1, NaN, rc, NaN, rp, "NO_READING", "no reading for asset");
      continue;
    }
    const ts = host_record_field_i64(0, r, 1);
    const mass = host_record_field_f64(0, r, 2);
    const ck = mass * unitFactor(r, 3, false);
    const pk = host_record_field_f64(0, r, 4) * unitFactor(r, 5, true);
    const tol = max(abs_tol_kg, pct / 100.0 * rc);
    const d = ck - rc;
    let cls = "OK";
    let det = "within tolerance";
    if (regBad || !logOk || mass < 0 || !isFinite(ck) || !isFinite(pk)) { cls = "MALFORMED"; det = "unit, value, or field invalid"; }
    else if (as_of_ts - ts > max_age_days * DAY) { cls = "STALE"; det = "newest reading older than max age"; }
    else if (d < -tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (d > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (pk - rp > rel_tol * rp) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond tolerance"; }
    else if (rp - pk > rel_tol * rp) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond tolerance"; }
    emit(aid, ts, ck, rc, pk, rp, cls, det);
  }
  for (let r = 0; logKeys && r < nR; r++) {
    const aid = host_record_field_i64(0, r, 0);
    if (lookup(keys, slots, mask, aid) >= 0) continue;
    const mass = host_record_field_f64(0, r, 2);
    const ck = mass * unitFactor(r, 3, false);
    const pk = host_record_field_f64(0, r, 4) * unitFactor(r, 5, true);
    const bad = !logOk || mass < 0 || !isFinite(ck) || !isFinite(pk);
    emit(aid, host_record_field_i64(0, r, 1), ck, NaN, pk, NaN, bad ? "MALFORMED" : "ORPHAN_READING", bad ? "unit, value, or field invalid" : "reading has no registered asset");
    count++;
  }
  return count;
}
