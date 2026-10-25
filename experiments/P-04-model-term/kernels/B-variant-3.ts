// Order: classification enum rank, then asset_id, then input position; per task 9 this overrides §6/§1.10 and may break T5
// OUT_HANDLE is an assumption: the SDK does not define a record-set handle for the output buffer
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
const OUT_HANDLE: u32 = 2;
const LB_KG: f64 = 0.45359237;
const PSI_KPA: f64 = 6.894757293168;
const SCR: usize = memory.data(256);
const TXT: usize = memory.data(96);
const PMASK: i32 = 0x7FFFFFF;

let gAbs: f64 = 0.05;
let gRel: f64 = 0.02;
let gMaxAge: i64 = 30;
let gAsOf: i64 = 0;
let gKg: f64 = NaN;
let gKpa: f64 = NaN;
let gTs: i64 = -1;
let gBad: bool = false;
let gHash: usize = 0;
let gMask: i32 = 0;
let gAid: usize = 0;

function isWs(c: i32): bool { return c == 32 || (c >= 9 && c <= 13); }

function strIs(p: usize, n: i32, lit: string): bool {
  if (n != lit.length) return false;
  for (let i = 0; i < n; i++) {
    let c = <i32>load<u8>(p + <usize>i);
    if (c >= 65 && c <= 90) c += 32;
    if (c != lit.charCodeAt(i)) return false;
  }
  return true;
}

function unitOf(r: i32, f: i32): i32 {
  let n = host_record_field_str(LOG, r, f, SCR, 32);
  if (n < 0) return -1;
  let s = 0;
  while (s < n && isWs(<i32>load<u8>(SCR + <usize>s))) s++;
  while (n > s && isWs(<i32>load<u8>(SCR + <usize>(n - 1)))) n--;
  let p = SCR + <usize>s;
  let m = n - s;
  if (f == 3) return strIs(p, m, "kg") ? 0 : (strIs(p, m, "lb") ? 1 : -1);
  if (strIs(p, m, "kpa")) return 0;
  return strIs(p, m, "bar") ? 1 : (strIs(p, m, "psi") ? 2 : -1);
}

function evalReading(r: i32): void {
  gTs = host_record_field_i64(LOG, r, 1);
  let m = host_record_field_f64(LOG, r, 2);
  let p = host_record_field_f64(LOG, r, 4);
  let mu = unitOf(r, 3);
  let pu = unitOf(r, 5);
  gKg = mu == 1 ? m * LB_KG : m;
  gKpa = pu == 1 ? p * 100.0 : (pu == 2 ? p * PSI_KPA : p);
  gBad = mu < 0 || pu < 0 || !isFinite<f64>(m) || !isFinite<f64>(p) || m < 0;
}

function classifyAsset(a: i32, r: i32): i32 {
  let rc = host_record_field_f64(REG, a, 1);
  let rp = host_record_field_f64(REG, a, 2);
  let tp = host_record_field_f64(REG, a, 5);
  gKg = NaN; gKpa = NaN; gTs = -1;
  if (r >= 0) evalReading(r);
  if (!isFinite<f64>(rc) || !isFinite<f64>(rp) || !isFinite<f64>(tp) || rc < 0 || (r >= 0 && gBad)) return 1;
  if (r < 0) return 2;
  if (gAsOf - gTs > gMaxAge * 86400) return 3;
  let tol = max<f64>(gAbs, tp / 100.0 * rc);
  let d = gKg - rc;
  if (-d > tol) return 4;
  if (d > tol) return 5;
  if (gKpa - rp > gRel * abs<f64>(rp)) return 6;
  if (rp - gKpa > gRel * abs<f64>(rp)) return 7;
  return 9;
}

function hashOf(k: i64): i32 {
  let x = <u64>k;
  x ^= x >>> 33; x *= 0xFF51AFD7ED558CCD; x ^= x >>> 33;
  return <i32>x & gMask;
}

function find(k: i64): i32 {
  let h = hashOf(k);
  while (true) {
    let v = load<i32>(gHash + (<usize>h << 2));
    if (v == 0) return -1;
    if (load<i64>(gAid + (<usize>(v - 1) << 3)) == k) return v - 1;
    h = (h + 1) & gMask;
  }
  return -1;
}

function less(x: i32, y: i32): bool {
  let cx = x >>> 27, cy = y >>> 27;
  if (cx != cy) return cx < cy;
  let px = x & PMASK, py = y & PMASK;
  let ax = load<i64>(gAid + (<usize>px << 3)), ay = load<i64>(gAid + (<usize>py << 3));
  return ax != ay ? ax < ay : px < py;
}

function sift(o: usize, i: i32, n: i32): void {
  let v = load<i32>(o + (<usize>i << 2));
  while (true) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && less(load<i32>(o + (<usize>c << 2)), load<i32>(o + (<usize>(c + 1) << 2)))) c++;
    let cv = load<i32>(o + (<usize>c << 2));
    if (!less(v, cv)) break;
    store<i32>(o + (<usize>i << 2), cv);
    i = c;
  }
  store<i32>(o + (<usize>i << 2), v);
}

function txt(lit: string): i32 {
  for (let i = 0; i < lit.length; i++) store<u8>(TXT + <usize>i, <u8>lit.charCodeAt(i));
  return lit.length;
}

function emitRow(aid: i64, rc: f64, rp: f64, cls: i32): void {
  out_begin();
  out_set_i64(0, aid); out_set_i64(1, gTs); out_set_f64(2, gKg); out_set_f64(3, rc);
  out_set_f64(4, gKg - rc); out_set_f64(5, gKpa); out_set_f64(6, rp);
  let n = 0, d = 0;
  switch (cls) {
    case 1: { n = txt("MALFORMED"); out_set_str(7, TXT, n); d = txt("bad unit, sign, finiteness, or schema"); break; }
    case 2: { n = txt("NO_READING"); out_set_str(7, TXT, n); d = txt("no reading for asset"); break; }
    case 3: { n = txt("STALE"); out_set_str(7, TXT, n); d = txt("newest reading older than max_age_days"); break; }
    case 4: { n = txt("UNDERCHARGE"); out_set_str(7, TXT, n); d = txt("charge below rated beyond tolerance"); break; }
    case 5: { n = txt("OVERCHARGE"); out_set_str(7, TXT, n); d = txt("charge above rated beyond tolerance"); break; }
    case 6: { n = txt("PRESSURE_HIGH"); out_set_str(7, TXT, n); d = txt("pressure above rated beyond rel_tol"); break; }
    case 7: { n = txt("PRESSURE_LOW"); out_set_str(7, TXT, n); d = txt("pressure below rated beyond rel_tol"); break; }
    case 8: { n = txt("ORPHAN_READING"); out_set_str(7, TXT, n); d = txt("reading has no registered asset"); break; }
    default: { n = txt("OK"); out_set_str(7, TXT, n); d = txt("within tolerance"); }
  }
  out_set_str(8, TXT, d);
  out_commit();
}

function schemaBad(): bool {
  return host_field_kind(LOG, 0) != 0 || host_field_kind(LOG, 1) != 0 || host_field_kind(LOG, 2) != 1
    || host_field_kind(LOG, 3) != 2 || host_field_kind(LOG, 4) != 1 || host_field_kind(LOG, 5) != 2
    || host_field_kind(LOG, 6) != 2 || host_field_kind(REG, 0) != 0 || host_field_kind(REG, 1) != 1
    || host_field_kind(REG, 2) != 1 || host_field_kind(REG, 3) != 2 || host_field_kind(REG, 4) != 2
    || host_field_kind(REG, 5) != 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  gAbs = abs_tol_kg; gRel = rel_tol; gMaxAge = max_age_days; gAsOf = as_of_ts;
  let nR = max<i32>(host_record_count(LOG), 0);
  let nA = max<i32>(host_record_count(REG), 0);
  if (schemaBad()) {
    gKg = NaN; gKpa = NaN; gTs = -1;
    emitRow(-1, NaN, NaN, 1);
    effect_emit(100, OUT_HANDLE);
    return 1;
  }
  let hs = 16;
  while (hs < nA * 2) hs <<= 1;
  let n = nA + nR;
  gMask = hs - 1;
  gHash = (__heap_base + 7) & ~<usize>7;
  let best = gHash + (<usize>hs << 2);
  gAid = (best + (<usize>nA << 2) + 7) & ~<usize>7;
  let src = gAid + (<usize>n << 3);
  let ord = src + (<usize>n << 2);
  let need = <i32>((ord + (<usize>n << 2) + 0xFFFF) >>> 16) - memory.size();
  if (need > 0 && memory.grow(need) < 0) return -1;
  memory.fill(gHash, 0, <usize>hs << 2);
  for (let a = 0; a < nA; a++) {
    let k = host_record_field_i64(REG, a, 0);
    store<i64>(gAid + (<usize>a << 3), k);
    store<i32>(best + (<usize>a << 2), -1);
    if (find(k) >= 0) continue;
    let h = hashOf(k);
    while (load<i32>(gHash + (<usize>h << 2)) != 0) h = (h + 1) & gMask;
    store<i32>(gHash + (<usize>h << 2), a + 1);
  }
  let m = nA;
  for (let r = 0; r < nR; r++) {
    let k = host_record_field_i64(LOG, r, 0);
    let j = find(k);
    if (j < 0) {
      evalReading(r);
      store<i64>(gAid + (<usize>m << 3), k);
      store<i32>(src + (<usize>m << 2), -(r + 1));
      store<i32>(ord + (<usize>m << 2), ((gBad ? 1 : 8) << 27) | m);
      m++;
      continue;
    }
    let cur = load<i32>(best + (<usize>j << 2));
    if (cur < 0 || host_record_field_i64(LOG, r, 1) > host_record_field_i64(LOG, cur, 1)) store<i32>(best + (<usize>j << 2), r);
  }
  for (let a = 0; a < nA; a++) {
    let r = load<i32>(best + (<usize>find(load<i64>(gAid + (<usize>a << 3))) << 2));
    store<i32>(src + (<usize>a << 2), a);
    store<i32>(ord + (<usize>a << 2), (classifyAsset(a, r) << 27) | a);
  }
  for (let i = (m >> 1) - 1; i >= 0; i--) sift(ord, i, m);
  for (let e = m - 1; e > 0; e--) {
    let t = load<i32>(ord);
    store<i32>(ord, load<i32>(ord + (<usize>e << 2)));
    store<i32>(ord + (<usize>e << 2), t);
    sift(ord, 0, e);
  }
  for (let i = 0; i < m; i++) {
    let p = load<i32>(ord + (<usize>i << 2)) & PMASK;
    let s = load<i32>(src + (<usize>p << 2));
    let aid = load<i64>(gAid + (<usize>p << 3));
    if (s >= 0) {
      let cls = classifyAsset(s, load<i32>(best + (<usize>find(aid) << 2)));
      emitRow(aid, host_record_field_f64(REG, s, 1), host_record_field_f64(REG, s, 2), cls);
    } else {
      evalReading(-s - 1);
      emitRow(aid, NaN, NaN, gBad ? 1 : 8);
    }
  }
  effect_emit(100, OUT_HANDLE);
  return m;
}
