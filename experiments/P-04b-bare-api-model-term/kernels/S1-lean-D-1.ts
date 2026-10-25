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

// Open-addressing index on asset_id: 65536 slots, keys read back from set 1
const SLOTS: i32 = 65536;
const MASK: i32 = SLOTS - 1;
const SLOT_ASSET: usize = memory.data(262144);
const SLOT_BEST: usize = memory.data(262144);
const UNIT_BUF: usize = memory.data(16);
const STR_BUF: usize = memory.data(80);

// Units packed as lowercase ASCII bytes, big-endian
const U_KG: i32 = 0x6B67;
const U_LB: i32 = 0x6C62;
const U_KPA: i32 = 0x6B7061;
const U_BAR: i32 = 0x626172;
const U_PSI: i32 = 0x707369;

let gCharge: f64 = 0;
let gPress: f64 = 0;

function findSlot(key: i64, insertIdx: i32): i32 {
  let h = <i32>((<u64>key * <u64>0x9E3779B97F4A7C15) >> 48);
  for (let n = 0; n < SLOTS; n++) {
    const p = SLOT_ASSET + (<usize>h << 2);
    const a = load<i32>(p);
    if (a < 0) {
      if (insertIdx >= 0) { store<i32>(p, insertIdx); return h; }
      return -1;
    }
    if (host_record_field_i64(1, a, 0) == key) return h;
    h = (h + 1) & MASK;
  }
  return -1;
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitCode(idx: i32, field: i32): i32 {
  const n = host_record_field_str(0, idx, field, UNIT_BUF, 16);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isWs(<i32>load<u8>(UNIT_BUF + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(UNIT_BUF + <usize>(e - 1)))) e--;
  if (e == s || e - s > 3) return -1;
  let v = 0;
  for (let i = s; i < e; i++) {
    const c = <i32>load<u8>(UNIT_BUF + <usize>i);
    v = (v << 8) | (c >= 65 && c <= 90 ? c | 32 : c);
  }
  return v;
}

function loadReading(r: i32): bool {
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  const mu = unitCode(r, 3);
  const pu = unitCode(r, 5);
  gCharge = mu == U_KG ? m : mu == U_LB ? m * 0.45359237 : NaN;
  gPress = pu == U_KPA ? p : pu == U_BAR ? p * 100.0 : pu == U_PSI ? p * 6.894757293168 : NaN;
  return isFinite<f64>(gCharge) && isFinite<f64>(gPress) && m >= 0;
}

function putStr(field: i32, s: string): void {
  const n = s.length < 80 ? s.length : 80;
  for (let i = 0; i < n; i++) store<u8>(STR_BUF + <usize>i, <u8>s.charCodeAt(i));
  out_set_str(field, STR_BUF, n);
}

function emit(aid: i64, ts: i64, ch: f64, rc: f64, pk: f64, rp: f64, cls: string, det: string): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  putStr(7, cls);
  putStr(8, det);
  out_commit();
}

function schemaOk(): bool {
  return host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1
    && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2
    && host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1
    && host_field_kind(1, 5) == 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const na = host_record_count(1);
  const nr = host_record_count(0);
  let count = 0;
  if (!schemaOk()) {
    const hasId = host_field_kind(1, 0) == 0;
    for (let a = 0; a < na; a++) {
      emit(hasId ? host_record_field_i64(1, a, 0) : -1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input field absent or wrong kind");
      count++;
    }
    return count;
  }
  for (let i = 0; i < SLOTS; i++) {
    store<i32>(SLOT_ASSET + (<usize>i << 2), -1);
    store<i32>(SLOT_BEST + (<usize>i << 2), -1);
  }
  for (let a = 0; a < na; a++) findSlot(host_record_field_i64(1, a, 0), a);
  // Newest reading per asset; ties keep the lowest record index
  for (let r = 0; r < nr; r++) {
    const s = findSlot(host_record_field_i64(0, r, 0), -1);
    if (s < 0) continue;
    const bp = SLOT_BEST + (<usize>s << 2);
    const b = load<i32>(bp);
    if (b < 0 || host_record_field_i64(0, r, 1) > host_record_field_i64(0, b, 1)) store<i32>(bp, r);
  }
  for (let a = 0; a < na; a++) {
    const aid = host_record_field_i64(1, a, 0);
    const rc = host_record_field_f64(1, a, 1);
    const rp = host_record_field_f64(1, a, 2);
    const tp = host_record_field_f64(1, a, 5);
    const ratedOk = isFinite<f64>(rc) && isFinite<f64>(rp) && isFinite<f64>(tp);
    const s = findSlot(aid, -1);
    const b = s < 0 ? -1 : load<i32>(SLOT_BEST + (<usize>s << 2));
    if (b < 0) {
      emit(aid, -1, NaN, rc, NaN, rp, ratedOk ? "NO_READING" : "MALFORMED", ratedOk ? "no reading for asset" : "non-finite rated value");
      count++;
      continue;
    }
    const ok = loadReading(b) && ratedOk;
    const ts = host_record_field_i64(0, b, 1);
    const tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
    const ptol = rel_tol * Math.abs(rp);
    let cls = "OK";
    let det = "within tolerance";
    if (!ok) { cls = "MALFORMED"; det = "bad unit, negative mass, or non-finite value"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; det = "newest reading older than max_age_days"; }
    else if (rc - gCharge > tol) { cls = "UNDERCHARGE"; det = "charge below rated beyond tolerance"; }
    else if (gCharge - rc > tol) { cls = "OVERCHARGE"; det = "charge above rated beyond tolerance"; }
    else if (gPress - rp > ptol) { cls = "PRESSURE_HIGH"; det = "pressure above rated beyond rel_tol"; }
    else if (rp - gPress > ptol) { cls = "PRESSURE_LOW"; det = "pressure below rated beyond rel_tol"; }
    emit(aid, ts, gCharge, rc, gPress, rp, cls, det);
    count++;
  }
  for (let r = 0; r < nr; r++) {
    const aid = host_record_field_i64(0, r, 0);
    if (findSlot(aid, -1) >= 0) continue;
    const ok = loadReading(r);
    emit(aid, host_record_field_i64(0, r, 1), gCharge, NaN, gPress, NaN, ok ? "ORPHAN_READING" : "MALFORMED", ok ? "asset_id not in register" : "bad unit, negative mass, or non-finite value");
    count++;
  }
  return count;
}
