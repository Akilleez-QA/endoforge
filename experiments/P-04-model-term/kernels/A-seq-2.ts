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

const LOG: u32 = 0;
const REG: u32 = 1;
const MASK: i32 = 32767;
const MAX_ASSETS: i32 = 16384;
const GOLD: u64 = 0x9E3779B97F4A7C15;
const KEYS = memory.data(262144, 8);
const OWNER = memory.data(131072, 4);
const BEST = memory.data(131072, 4);
const SBUF = memory.data(64);
const OBUF = memory.data(96);

function kindsOk(set: u32, kinds: string): bool {
  for (let f = 0; f < kinds.length; f++) {
    if (host_field_kind(set, f) != kinds.charCodeAt(f) - 48) return false;
  }
  return true;
}

// Open-addressing probe: returns the slot holding k or the first empty slot.
function find(k: i64): i32 {
  let h = <i32>((<u64>k * GOLD) >> 49) & MASK;
  while (load<i32>(OWNER + (<usize>h << 2)) != -1) {
    if (load<i64>(KEYS + (<usize>h << 3)) == k) return h;
    h = (h + 1) & MASK;
  }
  return h;
}

function isWs(c: u8): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitFactor(set: u32, idx: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(set, idx, field, SBUF, 32);
  if (n < 0) return NaN;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(SBUF + s))) s++;
  while (e > s && isWs(load<u8>(SBUF + e - 1))) e--;
  if (mass) {
    if (unitIs(s, e, "kg")) return 1.0;
    if (unitIs(s, e, "lb")) return 0.45359237;
  } else {
    if (unitIs(s, e, "kpa")) return 1.0;
    if (unitIs(s, e, "bar")) return 100.0;
    if (unitIs(s, e, "psi")) return 6.894757293168;
  }
  return NaN;
}

function unitIs(s: i32, e: i32, lit: string): bool {
  if (e - s != lit.length) return false;
  for (let j = 0; j < lit.length; j++) {
    let c = <i32>load<u8>(SBUF + s + j);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(j)) return false;
  }
  return true;
}

function putStr(field: i32, s: string): void {
  const n = min(s.length, 80);
  for (let j = 0; j < n; j++) store<u8>(OBUF + j, <u8>s.charCodeAt(j));
  out_set_str(field, OBUF, n);
}

function emitRow(id: i64, ts: i64, ckg: f64, rated: f64, pkpa: f64, ratedP: f64, cls: string, detail: string): void {
  out_begin();
  out_set_i64(0, id);
  out_set_i64(1, ts);
  out_set_f64(2, ckg);
  out_set_f64(3, rated);
  out_set_f64(4, ckg - rated);
  out_set_f64(5, pkpa);
  out_set_f64(6, ratedP);
  putStr(7, cls);
  putStr(8, detail);
  out_commit();
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const nl = host_record_count(LOG);
  const na = host_record_count(REG);
  let out = 0;
  if (!kindsOk(LOG, "0012122") || !kindsOk(REG, "011221") || na > MAX_ASSETS) {
    const idOk = host_field_kind(REG, 0) == 0;
    for (let a = 0; a < na; a++) {
      emitRow(idOk ? host_record_field_i64(REG, a, 0) : -1, -1, NaN, NaN, NaN, NaN, "MALFORMED", "input schema absent, mistyped, or over capacity");
      out++;
    }
    return out;
  }
  memory.fill(OWNER, 0xFF, 131072);
  for (let a = 0; a < na; a++) {
    const k = host_record_field_i64(REG, a, 0);
    const h = find(k);
    if (load<i32>(OWNER + (<usize>h << 2)) == -1) {
      store<i64>(KEYS + (<usize>h << 3), k);
      store<i32>(OWNER + (<usize>h << 2), a);
      store<i32>(BEST + (<usize>h << 2), -1);
    }
  }
  for (let r = 0; r < nl; r++) {
    const h = find(host_record_field_i64(LOG, r, 0));
    if (load<i32>(OWNER + (<usize>h << 2)) == -1) continue;
    const b = load<i32>(BEST + (<usize>h << 2));
    if (b < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, b, 1)) store<i32>(BEST + (<usize>h << 2), r);
  }
  for (let a = 0; a < na; a++) {
    const id = host_record_field_i64(REG, a, 0);
    const rated = host_record_field_f64(REG, a, 1);
    const ratedP = host_record_field_f64(REG, a, 2);
    const tolPct = host_record_field_f64(REG, a, 5);
    const r = load<i32>(BEST + (<usize>find(id) << 2));
    const assetBad = !isFinite(rated) || rated < 0 || !isFinite(ratedP) || !isFinite(tolPct);
    out++;
    if (r < 0) {
      emitRow(id, -1, NaN, rated, NaN, ratedP, assetBad ? "MALFORMED" : "NO_READING", assetBad ? "asset register value invalid" : "no reading for asset");
      continue;
    }
    const ts = host_record_field_i64(LOG, r, 1);
    const m = host_record_field_f64(LOG, r, 2);
    const p = host_record_field_f64(LOG, r, 4);
    const ckg = m * unitFactor(LOG, r, 3, true);
    const pk = p * unitFactor(LOG, r, 5, false);
    const tol = Math.max(abs_tol_kg, tolPct / 100.0 * rated);
    const dp = pk - ratedP;
    const lim = rel_tol * Math.max(Math.abs(pk), Math.abs(ratedP));
    let cls = "OK";
    let detail = "within tolerance";
    if (assetBad || !isFinite(ckg) || !isFinite(pk) || m < 0) { cls = "MALFORMED"; detail = "unit, value, or register field invalid"; }
    else if (as_of_ts - ts > max_age_days * 86400) { cls = "STALE"; detail = "newest reading older than max_age_days"; }
    else if (rated - ckg > tol) { cls = "UNDERCHARGE"; detail = "charge below rated beyond tolerance"; }
    else if (ckg - rated > tol) { cls = "OVERCHARGE"; detail = "charge above rated beyond tolerance"; }
    else if (dp > lim) { cls = "PRESSURE_HIGH"; detail = "pressure above rated beyond rel_tol"; }
    else if (-dp > lim) { cls = "PRESSURE_LOW"; detail = "pressure below rated beyond rel_tol"; }
    emitRow(id, ts, ckg, rated, pk, ratedP, cls, detail);
  }
  for (let r = 0; r < nl; r++) {
    const id = host_record_field_i64(LOG, r, 0);
    if (load<i32>(OWNER + (<usize>find(id) << 2)) != -1) continue;
    const m = host_record_field_f64(LOG, r, 2);
    const ckg = m * unitFactor(LOG, r, 3, true);
    const pk = host_record_field_f64(LOG, r, 4) * unitFactor(LOG, r, 5, false);
    const bad = !isFinite(ckg) || !isFinite(pk) || m < 0;
    emitRow(id, host_record_field_i64(LOG, r, 1), ckg, NaN, pk, NaN, bad ? "MALFORMED" : "ORPHAN_READING", bad ? "orphan reading with invalid unit or value" : "reading has no register asset");
    out++;
  }
  return out;
}
