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
// Assumed host handle of the committed output record set, consumed by export.csv
const OUT_SET: u32 = 2;
const SCRATCH = memory.data(256);
const C_MALFORMED: u8 = 0, C_NONE: u8 = 1, C_STALE: u8 = 2, C_UNDER: u8 = 3, C_OVER: u8 = 4;
const C_PHIGH: u8 = 5, C_PLOW: u8 = 6, C_ORPHAN: u8 = 7, C_OK: u8 = 8;
const NAMES: StaticArray<string> = ["MALFORMED", "NO_READING", "STALE", "UNDERCHARGE", "OVERCHARGE",
  "PRESSURE_HIGH", "PRESSURE_LOW", "ORPHAN_READING", "OK"];
const DETAILS: StaticArray<string> = ["unknown unit, negative mass, non-finite value, or absent field",
  "no reading for asset", "newest reading older than max_age_days", "charge below rated by more than tolerance",
  "charge above rated by more than tolerance", "pressure above rated by more than rel_tol",
  "pressure below rated by more than rel_tol", "reading asset_id not in asset register", "within tolerance"];

let absTol: f64 = 0, relTol: f64 = 0, maxAge: i64 = 0, asOf: i64 = 0;
let nA: i32 = 0, schemaBad: bool = false;
let gTs: i64 = 0, gCharge: f64 = 0, gPress: f64 = 0;
let gRated: f64 = 0, gRatedP: f64 = 0, gTolPct: f64 = 0;
let best = new StaticArray<i32>(0);
let orph = new StaticArray<i32>(0);
let rowKey = new StaticArray<i64>(0);
let rowCls = new StaticArray<u8>(0);

function isWs(c: u32): bool { return c == 32 || (c >= 9 && c <= 13); }

function eqCI(p: usize, len: i32, lit: string): bool {
  if (len != lit.length) return false;
  for (let i = 0; i < len; i++) {
    let c = <u32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != <u32>lit.charCodeAt(i)) return false;
  }
  return true;
}

// Returns the factor to kg (mass) or kPa (pressure), or 0 for an unknown unit
function unitFactor(idx: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(LOG, idx, field, SCRATCH, 256);
  if (n < 0) return 0;
  let s = 0, e = n;
  while (s < e && isWs(load<u8>(SCRATCH + <usize>s))) s++;
  while (e > s && isWs(load<u8>(SCRATCH + <usize>(e - 1)))) e--;
  const p = SCRATCH + <usize>s, len = e - s;
  if (mass) {
    if (eqCI(p, len, "kg")) return 1.0;
    if (eqCI(p, len, "lb")) return 0.45359237;
  } else {
    if (eqCI(p, len, "kpa")) return 1.0;
    if (eqCI(p, len, "bar")) return 100.0;
    if (eqCI(p, len, "psi")) return 6.894757293168;
  }
  return 0;
}

function loadReading(i: i32): bool {
  gTs = host_record_field_i64(LOG, i, 1);
  const m = host_record_field_f64(LOG, i, 2), p = host_record_field_f64(LOG, i, 4);
  const fm = unitFactor(i, 3, true), fp = unitFactor(i, 5, false);
  gCharge = fm != 0 ? m * fm : NaN;
  gPress = fp != 0 ? p * fp : NaN;
  return fm != 0 && fp != 0 && m >= 0 && isFinite(m) && isFinite(p);
}

function loadAsset(a: i32): bool {
  gRated = host_record_field_f64(REG, a, 1);
  gRatedP = host_record_field_f64(REG, a, 2);
  gTolPct = host_record_field_f64(REG, a, 5);
  return isFinite(gRated) && isFinite(gRatedP) && isFinite(gTolPct);
}

function classify(r: i32): u8 {
  if (schemaBad) return C_MALFORMED;
  if (r >= nA) return loadReading(orph[r - nA]) ? C_ORPHAN : C_MALFORMED;
  const okA = loadAsset(r), b = best[r];
  if (b < 0) return okA ? C_NONE : C_MALFORMED;
  if (!loadReading(b) || !okA) return C_MALFORMED;
  if (asOf - gTs > maxAge * 86400) return C_STALE;
  const tol = Math.max(absTol, gTolPct / 100 * gRated), d = gCharge - gRated;
  if (-d > tol) return C_UNDER;
  if (d > tol) return C_OVER;
  const dp = gPress - gRatedP, pt = relTol * Math.abs(gRatedP);
  if (dp > pt) return C_PHIGH;
  if (-dp > pt) return C_PLOW;
  return C_OK;
}

function putAscii(s: string): i32 {
  for (let i = 0; i < s.length; i++) store<u8>(SCRATCH + <usize>i, <u8>s.charCodeAt(i));
  return s.length;
}

function emit(r: i32): void {
  const c = rowCls[r];
  let ts: i64 = -1, ch = NaN, pk = NaN, rc = NaN, rp = NaN;
  if (r < nA) {
    loadAsset(r);
    rc = gRated;
    rp = gRatedP;
    if (best[r] >= 0) { loadReading(best[r]); ts = gTs; ch = gCharge; pk = gPress; }
  } else {
    loadReading(orph[r - nA]);
    ts = gTs; ch = gCharge; pk = gPress;
  }
  out_begin();
  out_set_i64(0, rowKey[r]);
  out_set_i64(1, ts);
  out_set_f64(2, ch);
  out_set_f64(3, rc);
  out_set_f64(4, ch - rc);
  out_set_f64(5, pk);
  out_set_f64(6, rp);
  out_set_str(7, SCRATCH, putAscii(NAMES[c]));
  out_set_str(8, SCRATCH, putAscii(DETAILS[c]));
  out_commit();
}

// Output order per task: classification rank (section 6 order), then asset_id, then source row
function less(a: i32, b: i32): bool {
  const ca = rowCls[a], cb = rowCls[b];
  if (ca != cb) return ca < cb;
  const ka = rowKey[a], kb = rowKey[b];
  if (ka != kb) return ka < kb;
  return a < b;
}

function sift(o: StaticArray<i32>, i: i32, n: i32): void {
  while (true) {
    let m = i;
    const l = 2 * i + 1, r = l + 1;
    if (l < n && less(o[m], o[l])) m = l;
    if (r < n && less(o[m], o[r])) m = r;
    if (m == i) return;
    const t = o[i]; o[i] = o[m]; o[m] = t; i = m;
  }
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  absTol = abs_tol_kg; relTol = rel_tol; maxAge = max_age_days; asOf = as_of_ts;
  const ok0 = host_field_kind(LOG, 0) == 0 && host_field_kind(LOG, 1) == 0 && host_field_kind(LOG, 2) == 1
    && host_field_kind(LOG, 3) == 2 && host_field_kind(LOG, 4) == 1 && host_field_kind(LOG, 5) == 2;
  const ok1 = host_field_kind(REG, 0) == 0 && host_field_kind(REG, 1) == 1
    && host_field_kind(REG, 2) == 1 && host_field_kind(REG, 5) == 1;
  schemaBad = !ok0 || !ok1;
  nA = ok1 ? max(host_record_count(REG), 0) : 0;
  const nR = ok0 ? max(host_record_count(LOG), 0) : 0;
  rowKey = new StaticArray<i64>(nA + nR);
  best = new StaticArray<i32>(nA);
  const bestTs = new StaticArray<i64>(nA);
  orph = new StaticArray<i32>(nR);
  let cap = 16;
  while (cap < nA * 2) cap <<= 1;
  const slots = new StaticArray<i32>(cap), mask = cap - 1;
  // Open-addressing index on asset_id; slot value is asset index + 1, 0 means empty
  for (let a = 0; a < nA; a++) {
    const id = host_record_field_i64(REG, a, 0);
    rowKey[a] = id;
    best[a] = -1;
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 32) & mask;
    while (slots[h] != 0 && rowKey[slots[h] - 1] != id) h = (h + 1) & mask;
    if (slots[h] == 0) slots[h] = a + 1;
  }
  let nO = 0;
  for (let i = 0; i < nR; i++) {
    const id = host_record_field_i64(LOG, i, 0), ts = host_record_field_i64(LOG, i, 1);
    let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 32) & mask;
    while (slots[h] != 0 && rowKey[slots[h] - 1] != id) h = (h + 1) & mask;
    const a = slots[h] - 1;
    if (a < 0) { orph[nO] = i; rowKey[nA + nO] = id; nO++; }
    else if (best[a] < 0 || ts > bestTs[a]) { best[a] = i; bestTs[a] = ts; }
  }
  const n = nA + nO;
  rowCls = new StaticArray<u8>(n);
  const order = new StaticArray<i32>(n);
  for (let r = 0; r < n; r++) { rowCls[r] = classify(r); order[r] = r; }
  for (let i = n / 2 - 1; i >= 0; i--) sift(order, i, n);
  for (let e = n - 1; e > 0; e--) {
    const t = order[0]; order[0] = order[e]; order[e] = t;
    sift(order, 0, e);
  }
  for (let k = 0; k < n; k++) emit(order[k]);
  effect_emit(100, OUT_SET);
  return n;
}
