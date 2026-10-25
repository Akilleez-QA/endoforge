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

const STR: usize = memory.data(256);
const TXT: usize = memory.data(256);
const C_MAL: i32 = 1, C_NOR: i32 = 2, C_STALE: i32 = 3, C_UNDER: i32 = 4, C_OVER: i32 = 5;
const C_PHI: i32 = 6, C_PLO: i32 = 7, C_ORPH: i32 = 8, C_OK: i32 = 9;

let IDS: usize = 0, BEST: usize = 0, TS: usize = 0, SLOTS: usize = 0, RECS: usize = 0;
let mask: u32 = 0;
let schemaOk: bool = true;
let gTs: i64 = -1, gCharge: f64 = NaN, gPress: f64 = NaN, gRc: f64 = NaN, gRp: f64 = NaN;

@inline function p4(b: usize, i: i32): usize { return b + (<usize>i << 2); }
@inline function p8(b: usize, i: i32): usize { return b + (<usize>i << 3); }
@inline function p16(i: i32): usize { return RECS + (<usize>i << 4); }
function isSp(c: u32): bool { return c == 0x20 || (c >= 0x09 && c <= 0x0D); }
function lc(c: u32): u32 { return c >= 0x41 && c <= 0x5A ? c | 0x20 : c; }
function hashOf(k: i64): u32 { return <u32>((<u64>k * 0x9E3779B97F4A7C15) >>> 40) & mask; }

function unitFactor(r: i32, field: i32, mass: bool): f64 {
  const n = host_record_field_str(0, r, field, STR, 256);
  if (n < 0) return NaN;
  let s = 0, e = n;
  while (s < e && isSp(<u32>load<u8>(STR + <usize>s))) s++;
  while (e > s && isSp(<u32>load<u8>(STR + <usize>(e - 1)))) e--;
  const len = e - s;
  if (len < 2 || len > 3) return NaN;
  const a = lc(<u32>load<u8>(STR + <usize>s)), b = lc(<u32>load<u8>(STR + <usize>(s + 1)));
  const c: u32 = len == 3 ? lc(<u32>load<u8>(STR + <usize>(s + 2))) : 0;
  if (mass) {
    if (len == 2 && a == 0x6B && b == 0x67) return 1.0;
    if (len == 2 && a == 0x6C && b == 0x62) return 0.45359237;
    return NaN;
  }
  if (len == 3 && a == 0x6B && b == 0x70 && c == 0x61) return 1.0;
  if (len == 3 && a == 0x62 && b == 0x61 && c == 0x72) return 100.0;
  if (len == 3 && a == 0x70 && b == 0x73 && c == 0x69) return 6.894757293168;
  return NaN;
}

function readReading(r: i32): bool {
  gTs = host_record_field_i64(0, r, 1);
  gCharge = host_record_field_f64(0, r, 2) * unitFactor(r, 3, true);
  gPress = host_record_field_f64(0, r, 4) * unitFactor(r, 5, false);
  return schemaOk && isFinite<f64>(gCharge) && isFinite<f64>(gPress) && gCharge >= 0;
}

function classify(a: i32, r: i32, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  gTs = -1; gCharge = NaN; gPress = NaN;
  gRc = host_record_field_f64(1, a, 1); gRp = host_record_field_f64(1, a, 2);
  const tp = host_record_field_f64(1, a, 5);
  const rOk = r < 0 || readReading(r);
  if (!schemaOk || !rOk || !isFinite<f64>(gRc) || !isFinite<f64>(gRp) || !isFinite<f64>(tp) || gRc < 0) return C_MAL;
  if (r < 0) return C_NOR;
  if (asOf - gTs > maxAge * 86400) return C_STALE;
  const tol = Math.max(absTol, tp / 100.0 * gRc);
  if (gRc - gCharge > tol) return C_UNDER;
  if (gCharge - gRc > tol) return C_OVER;
  if (gPress - gRp > relTol * Math.abs(gRp)) return C_PHI;
  if (gRp - gPress > relTol * Math.abs(gRp)) return C_PLO;
  return C_OK;
}

function lookup(k: i64): i32 {
  let h = hashOf(k);
  let v = load<i32>(p4(SLOTS, <i32>h));
  while (v != 0) {
    if (load<i64>(p8(IDS, v - 1)) == k) return v - 1;
    h = (h + 1) & mask;
    v = load<i32>(p4(SLOTS, <i32>h));
  }
  return -1;
}

function recLess(i: i32, j: i32): bool {
  const pi = p16(i), pj = p16(j);
  const ci = load<i32>(pi, 12), cj = load<i32>(pj, 12);
  if (ci != cj) return ci < cj;
  const ai = load<i64>(pi), aj = load<i64>(pj);
  if (ai != aj) return ai < aj;
  return load<i32>(pi, 8) < load<i32>(pj, 8);
}

function recSwap(i: i32, j: i32): void {
  const pi = p16(i), pj = p16(j);
  const a0 = load<i64>(pi), a1 = load<i64>(pi, 8);
  store<i64>(pi, load<i64>(pj)); store<i64>(pi, load<i64>(pj, 8), 8);
  store<i64>(pj, a0); store<i64>(pj, a1, 8);
}

function siftDown(root: i32, end: i32): void {
  while (root * 2 + 1 < end) {
    let child = root * 2 + 1;
    if (child + 1 < end && recLess(child, child + 1)) child++;
    if (!recLess(root, child)) return;
    recSwap(root, child);
    root = child;
  }
}

function putStr(field: i32, s: string): void {
  const n = String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, TXT);
  out_set_str(field, TXT, <i32>n);
}

function className(c: i32): string {
  switch (c) {
    case C_MAL: return "MALFORMED";
    case C_NOR: return "NO_READING";
    case C_STALE: return "STALE";
    case C_UNDER: return "UNDERCHARGE";
    case C_OVER: return "OVERCHARGE";
    case C_PHI: return "PRESSURE_HIGH";
    case C_PLO: return "PRESSURE_LOW";
    case C_ORPH: return "ORPHAN_READING";
    default: return "OK";
  }
}

function detailOf(c: i32): string {
  switch (c) {
    case C_MAL: return "unit, sign, finiteness, schema or capacity check failed";
    case C_NOR: return "no reading for asset";
    case C_STALE: return "newest reading older than max_age_days";
    case C_UNDER: return "charge below rated beyond tolerance";
    case C_OVER: return "charge above rated beyond tolerance";
    case C_PHI: return "pressure above rated beyond rel_tol";
    case C_PLO: return "pressure below rated beyond rel_tol";
    case C_ORPH: return "reading asset_id not in register";
    default: return "within tolerance";
  }
}

function emit(aid: i64, c: i32): void {
  out_begin();
  out_set_i64(0, aid);
  out_set_i64(1, gTs);
  out_set_f64(2, gCharge);
  out_set_f64(3, gRc);
  out_set_f64(4, gCharge - gRc);
  out_set_f64(5, gPress);
  out_set_f64(6, gRp);
  putStr(7, className(c));
  putStr(8, detailOf(c));
  out_commit();
}

function failCapacity(): i32 {
  gTs = -1; gCharge = NaN; gPress = NaN; gRc = NaN; gRp = NaN;
  emit(-1, C_MAL);
  effect_emit(100, 1);
  return 1;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  let nA = host_record_count(1), nR = host_record_count(0);
  if (nA < 0) nA = 0;
  if (nR < 0) nR = 0;
  if (nA > (1 << 20) || nR > (1 << 20)) return failCapacity();
  schemaOk = host_field_kind(0, 0) == 0 && host_field_kind(0, 1) == 0 && host_field_kind(0, 2) == 1
    && host_field_kind(0, 3) == 2 && host_field_kind(0, 4) == 1 && host_field_kind(0, 5) == 2
    && host_field_kind(1, 0) == 0 && host_field_kind(1, 1) == 1 && host_field_kind(1, 2) == 1
    && host_field_kind(1, 5) == 1;
  let cap: u32 = 16;
  while (cap < <u32>nA * 2) cap <<= 1;
  mask = cap - 1;
  // Raw scratch region above the static data; grown once, reused across runs, never allocated per record.
  IDS = (__heap_base + 15) & ~(<usize>15);
  BEST = IDS + (<usize>nA << 3);
  TS = BEST + (<usize>nA << 2);
  SLOTS = (TS + (<usize>nA << 3) + 15) & ~(<usize>15);
  RECS = (SLOTS + (<usize>cap << 2) + 15) & ~(<usize>15);
  const pages = <i32>((RECS + (<usize>(nA + nR) << 4) + 0xFFFF) >>> 16);
  if (pages > 64) return failCapacity();
  const cur = memory.size();
  if (pages > cur && memory.grow(pages - cur) < 0) return failCapacity();
  memory.fill(SLOTS, 0, <usize>cap << 2);
  for (let a = 0; a < nA; a++) {
    const k = host_record_field_i64(1, a, 0);
    store<i64>(p8(IDS, a), k);
    store<i32>(p4(BEST, a), -1);
    if (lookup(k) >= 0) continue;
    let h = hashOf(k);
    while (load<i32>(p4(SLOTS, <i32>h)) != 0) h = (h + 1) & mask;
    store<i32>(p4(SLOTS, <i32>h), a + 1);
  }
  let orph = 0;
  for (let r = 0; r < nR; r++) {
    const k = host_record_field_i64(0, r, 0);
    const a = lookup(k);
    if (a >= 0) {
      const ts = host_record_field_i64(0, r, 1);
      if (load<i32>(p4(BEST, a)) < 0 || ts > load<i64>(p8(TS, a))) {
        store<i32>(p4(BEST, a), r);
        store<i64>(p8(TS, a), ts);
      }
      continue;
    }
    const p = p16(nA + orph);
    store<i64>(p, k);
    store<i32>(p, nA + r, 8);
    store<i32>(p, readReading(r) ? C_ORPH : C_MAL, 12);
    orph++;
  }
  for (let a = 0; a < nA; a++) {
    const k = load<i64>(p8(IDS, a));
    const best = load<i32>(p4(BEST, lookup(k)));
    store<i32>(p4(BEST, a), best);
    const p = p16(a);
    store<i64>(p, k);
    store<i32>(p, a, 8);
    store<i32>(p, classify(a, best, abs_tol_kg, rel_tol, max_age_days, as_of_ts), 12);
  }
  const total = nA + orph;
  for (let i = total / 2 - 1; i >= 0; i--) siftDown(i, total);
  for (let end = total - 1; end > 0; end--) {
    recSwap(0, end);
    siftDown(0, end);
  }
  for (let i = 0; i < total; i++) {
    const p = p16(i);
    const ref = load<i32>(p, 8), c = load<i32>(p, 12);
    if (ref < nA) {
      classify(ref, load<i32>(p4(BEST, ref)), abs_tol_kg, rel_tol, max_age_days, as_of_ts);
    } else {
      readReading(ref - nA);
      gRc = NaN; gRp = NaN;
    }
    emit(load<i64>(p), c);
  }
  // Summary effect payload carries the committed record count for the export.csv sink.
  effect_emit(100, <u32>total);
  return total;
}
