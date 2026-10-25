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

// Open-addressing index on asset_id keeps the join near O(n + m); assets beyond MAXA are dropped.
const MAXA: i32 = 16384;
const MASK: i32 = 32767;
const tab = new StaticArray<i32>(32768);
const best = new StaticArray<i32>(16384);
const BUF: usize = memory.data(16);
const OUT: usize = memory.data(96);
let gMass: f64 = NaN;
let gPress: f64 = NaN;
let badLog: bool = false;
let badReg: bool = false;

function isSpace(c: u32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitKey(set: u32, idx: i32, field: i32): u32 {
  const n = host_record_field_str(set, idx, field, BUF, 16);
  if (n < 0) return 0;
  let s: i32 = 0;
  let e: i32 = n;
  while (s < e && isSpace(<u32>load<u8>(BUF + <usize>s))) s++;
  while (e > s && isSpace(<u32>load<u8>(BUF + <usize>(e - 1)))) e--;
  if (e - s < 1 || e - s > 3) return 0;
  let k: u32 = 0;
  for (let i = s; i < e; i++) {
    let c = <u32>load<u8>(BUF + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    k |= c << (<u32>(i - s) * 8);
  }
  return k;
}

function massFactor(k: u32): f64 {
  return k == 0x676b ? 1.0 : k == 0x626c ? 0.45359237 : -1.0;
}

function pressFactor(k: u32): f64 {
  return k == 0x61706b ? 1.0 : k == 0x726162 ? 100.0 : k == 0x697370 ? 6.894757293168 : -1.0;
}

function loadReading(r: i32): bool {
  gMass = NaN;
  gPress = NaN;
  if (r < 0 || badLog) return false;
  const mf = massFactor(unitKey(0, r, 3));
  const pf = pressFactor(unitKey(0, r, 5));
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  if (mf < 0.0 || pf < 0.0 || !isFinite<f64>(m) || !isFinite<f64>(p) || m < 0.0) return false;
  gMass = m * mf;
  gPress = p * pf;
  return true;
}

function find(id: i64): i32 {
  let h = <i32>((<u64>id * <u64>0x9E3779B97F4A7C15) >> 49);
  for (;;) {
    const t = unchecked(tab[h]);
    if (t == 0 || host_record_field_i64(1, t - 1, 0) == id) return h;
    h = (h + 1) & MASK;
  }
  return 0;
}

function putStr(f: i32, s: string): void {
  const n = <i32>String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, OUT, false);
  out_set_str(f, OUT, n > 80 ? 80 : n);
}

function emit(id: i64, ts: i64, m: f64, rc: f64, p: f64, rp: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, m);
  out_set_f64(3, rc);
  out_set_f64(4, m - rc);
  out_set_f64(5, p);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const rawA = host_record_count(1);
  const na = rawA > MAXA ? MAXA : rawA;
  const nr = host_record_count(0);
  badLog = host_field_kind(0, 0) != 0 || host_field_kind(0, 1) != 0 || host_field_kind(0, 2) != 1 ||
    host_field_kind(0, 3) != 2 || host_field_kind(0, 4) != 1 || host_field_kind(0, 5) != 2;
  badReg = host_field_kind(1, 0) != 0 || host_field_kind(1, 1) != 1 || host_field_kind(1, 2) != 1 ||
    host_field_kind(1, 5) != 1;
  for (let i = 0; i <= MASK; i++) unchecked((tab[i] = 0));
  for (let i = 0; i < na; i++) {
    unchecked((best[i] = -1));
    const s = find(host_record_field_i64(1, i, 0));
    if (unchecked(tab[s]) == 0) unchecked((tab[s] = i + 1));
  }
  if (!badLog) {
    for (let r = 0; r < nr; r++) {
      const t = unchecked(tab[find(host_record_field_i64(0, r, 0))]);
      if (t == 0) continue;
      const b = unchecked(best[t - 1]);
      if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) unchecked((best[t - 1] = r));
    }
  }
  let count: i32 = 0;
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(1, a, 0);
    const rc = host_record_field_f64(1, a, 1);
    const rp = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    const b = unchecked(best[a]);
    const ts: i64 = b >= 0 && !badLog ? host_record_field_i64(0, b, 1) : -1;
    const ok = loadReading(b);
    const regOk = !badReg && isFinite<f64>(rc) && isFinite<f64>(rp) && isFinite<f64>(tp);
    let cls = "OK";
    let d = "within tolerance";
    if (!regOk || badLog || (b >= 0 && !ok)) {
      cls = "MALFORMED";
      d = "bad unit or non-finite value";
    } else if (b < 0) {
      cls = "NO_READING";
      d = "no reading for asset";
    } else if (as_of_ts - ts > max_age_days * 86400) {
      cls = "STALE";
      d = "newest reading older than max age";
    } else {
      const delta = gMass - rc;
      const tol = max<f64>(abs_tol_kg, tp / 100.0 * abs<f64>(rc));
      const band = rel_tol * abs<f64>(rp);
      if (delta < -tol) { cls = "UNDERCHARGE"; d = "charge below rated"; }
      else if (delta > tol) { cls = "OVERCHARGE"; d = "charge above rated"; }
      else if (gPress - rp > band) { cls = "PRESSURE_HIGH"; d = "pressure above rated"; }
      else if (rp - gPress > band) { cls = "PRESSURE_LOW"; d = "pressure below rated"; }
    }
    emit(id, ts, gMass, rc, gPress, rp, cls, d);
    count++;
  }
  if (badLog) return count;
  for (let r = 0; r < nr; r++) {
    const id = host_record_field_i64(0, r, 0);
    if (unchecked(tab[find(id)]) != 0) continue;
    const ok = loadReading(r);
    emit(id, host_record_field_i64(0, r, 1), gMass, NaN, gPress, NaN,
      ok ? "ORPHAN_READING" : "MALFORMED", ok ? "reading has no asset record" : "bad unit or non-finite value");
    count++;
  }
  return count;
}
