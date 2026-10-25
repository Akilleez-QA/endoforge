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

const ibuf = memory.data(32);
const obuf = memory.data(96);
// Output record-set handle for the summary effect is assumed to be 2.
const OUT_SET: u32 = 2;
let rk: usize = 0;
let ak: usize = 0;
let od: usize = 0;
let gCh: f64 = NaN;
let gPr: f64 = NaN;
let gRc: f64 = NaN;
let gRp: f64 = NaN;
let gTs: i64 = -1;

function ld(p: usize, i: i32): i32 { return load<i32>(p + (<usize>i << 2)); }
function st(p: usize, i: i32, v: i32): void { store<i32>(p + (<usize>i << 2), v); }
function ld64(p: usize, i: i32): i64 { return load<i64>(p + (<usize>i << 3)); }
function st64(p: usize, i: i32, v: i64): void { store<i64>(p + (<usize>i << 3), v); }

function less(a: i32, b: i32): bool {
  const ra = ld(rk, a);
  const rb = ld(rk, b);
  if (ra != rb) return ra < rb;
  const xa = ld64(ak, a);
  const xb = ld64(ak, b);
  if (xa != xb) return xa < xb;
  return a < b;
}

function sift(root: i32, n: i32): void {
  let r = root;
  while (true) {
    let c = 2 * r + 1;
    if (c >= n) break;
    if (c + 1 < n && less(ld(od, c), ld(od, c + 1))) c++;
    if (!less(ld(od, r), ld(od, c))) break;
    const t = ld(od, r);
    st(od, r, ld(od, c));
    st(od, c, t);
    r = c;
  }
}

// In-place heapsort keeps memory flat; ties break on row index for determinism.
function hsort(n: i32): void {
  for (let i = n / 2 - 1; i >= 0; i--) sift(i, n);
  for (let e = n - 1; e > 0; e--) {
    const t = ld(od, 0);
    st(od, 0, ld(od, e));
    st(od, e, t);
    sift(0, e);
  }
}

function lowerBound(sd: usize, n: i32, id: i64): i32 {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ld64(sd, mid) < id) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function unitKey(set: u32, idx: i32, field: i32): i32 {
  const n = host_record_field_str(set, idx, field, ibuf, 32);
  if (n < 0) return -1;
  let s = 0;
  let e = n;
  while (s < e && isWs(load<u8>(ibuf + s))) s++;
  while (e > s && isWs(load<u8>(ibuf + e - 1))) e--;
  if (e - s > 3) return -1;
  let k = (e - s) << 24;
  for (let i = s; i < e; i++) {
    let c = <i32>load<u8>(ibuf + i);
    if (c >= 65 && c <= 90) c += 32;
    k |= c << (8 * (i - s));
  }
  return k;
}

function isWs(c: u8): bool { return c == 32 || (c >= 9 && c <= 13); }

function massFactor(k: i32): f64 { return k == 0x0200676B ? 1.0 : (k == 0x0200626C ? 0.45359237 : -1.0); }

function presFactor(k: i32): f64 {
  if (k == 0x0361706B) return 1.0;
  if (k == 0x03726162) return 100.0;
  return k == 0x03697370 ? 6.894757293168 : -1.0;
}

function judge(a: i32, r: i32, absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  gCh = NaN; gPr = NaN; gRc = NaN; gRp = NaN; gTs = -1;
  let bad = false;
  let pct = 0.0;
  if (a >= 0) {
    gRc = host_record_field_f64(1, a, 1);
    gRp = host_record_field_f64(1, a, 2);
    pct = host_record_field_f64(1, a, 5);
    bad = host_field_kind(1, 1) != 1 || host_field_kind(1, 2) != 1 || host_field_kind(1, 5) != 1 || !isFinite<f64>(gRc) || !isFinite<f64>(gRp) || !isFinite<f64>(pct);
  }
  if (r >= 0) {
    gTs = host_record_field_i64(0, r, 1);
    bad = bad || host_field_kind(0, 2) != 1 || host_field_kind(0, 3) != 2 || host_field_kind(0, 4) != 1 || host_field_kind(0, 5) != 2;
    if (!bad) {
      const m = host_record_field_f64(0, r, 2);
      const p = host_record_field_f64(0, r, 4);
      const mf = massFactor(unitKey(0, r, 3));
      const pf = presFactor(unitKey(0, r, 5));
      bad = mf < 0 || pf < 0 || m < 0 || !isFinite<f64>(m) || !isFinite<f64>(p);
      if (!bad) { gCh = m * mf; gPr = p * pf; }
    }
  }
  if (bad) return 1;
  if (r < 0) return 2;
  if (a < 0) return 8;
  if (asOf - gTs > maxAge * 86400) return 3;
  const tol = Math.max(absTol, pct / 100.0 * gRc);
  const d = gCh - gRc;
  if (d < -tol) return 4;
  if (d > tol) return 5;
  const within = Math.abs(gPr - gRp) <= relTol * Math.max(Math.abs(gPr), Math.abs(gRp));
  if (!within && gPr > gRp) return 6;
  if (!within && gPr < gRp) return 7;
  return 9;
}

function cls(k: i32): string {
  switch (k) {
    case 1: return "MALFORMED";
    case 2: return "NO_READING";
    case 3: return "STALE";
    case 4: return "UNDERCHARGE";
    case 5: return "OVERCHARGE";
    case 6: return "PRESSURE_HIGH";
    case 7: return "PRESSURE_LOW";
    case 8: return "ORPHAN_READING";
    default: return "OK";
  }
}

function why(k: i32): string {
  switch (k) {
    case 1: return "unknown unit, negative or non-finite value, or absent field";
    case 2: return "no reading for this asset";
    case 3: return "newest reading older than max age";
    case 4: return "charge below rated beyond tolerance";
    case 5: return "charge above rated beyond tolerance";
    case 6: return "pressure above rated beyond relative tolerance";
    case 7: return "pressure below rated beyond relative tolerance";
    case 8: return "reading has no matching asset";
    default: return "within tolerance";
  }
}

function putStr(field: i32, s: string): void {
  const n = <i32>String.UTF8.encodeUnsafe(changetype<usize>(s), s.length, obuf);
  out_set_str(field, obuf, n);
}

export function run(absTol: f64, relTol: f64, maxAge: i64, asOf: i64): i32 {
  const n1 = max(host_record_count(1), 0);
  const n0 = max(host_record_count(0), 0);
  const cap = <usize>(n1 + n0);
  rk = heap.alloc(cap * 4);
  ak = heap.alloc(cap * 8);
  od = heap.alloc(cap * 4);
  const ra = heap.alloc(cap * 4);
  const rr = heap.alloc(cap * 4);
  const sd = heap.alloc(<usize>n1 * 8);
  const sx = heap.alloc(<usize>n1 * 4);
  const bs = heap.alloc(<usize>n1 * 4);
  for (let i = 0; i < n1; i++) {
    st(rk, i, 0);
    st64(ak, i, host_record_field_i64(1, i, 0));
    st(od, i, i);
  }
  hsort(n1);
  for (let k = 0; k < n1; k++) {
    const a = ld(od, k);
    st64(sd, k, ld64(ak, a));
    st(sx, k, a);
    st(bs, k, -1);
  }
  let m = n1;
  for (let r = 0; r < n0; r++) {
    const id = host_record_field_i64(0, r, 0);
    const ts = host_record_field_i64(0, r, 1);
    let k = lowerBound(sd, n1, id);
    if (k < n1 && ld64(sd, k) == id) {
      for (; k < n1 && ld64(sd, k) == id; k++) {
        const b = ld(bs, k);
        if (b < 0 || ts > host_record_field_i64(0, b, 1)) st(bs, k, r);
      }
    } else {
      st64(ak, m, id);
      st(ra, m, -1);
      st(rr, m, r);
      m++;
    }
  }
  for (let i = 0; i < n1; i++) {
    st64(ak, i, ld64(sd, i));
    st(ra, i, ld(sx, i));
    st(rr, i, ld(bs, i));
  }
  for (let i = 0; i < m; i++) {
    st(rk, i, judge(ld(ra, i), ld(rr, i), absTol, relTol, maxAge, asOf));
    st(od, i, i);
  }
  hsort(m);
  for (let j = 0; j < m; j++) {
    const i = ld(od, j);
    const c = judge(ld(ra, i), ld(rr, i), absTol, relTol, maxAge, asOf);
    out_begin();
    out_set_i64(0, ld64(ak, i));
    out_set_i64(1, ld(rr, i) < 0 ? -1 : gTs);
    out_set_f64(2, gCh);
    out_set_f64(3, gRc);
    out_set_f64(4, gCh - gRc);
    out_set_f64(5, gPr);
    out_set_f64(6, gRp);
    putStr(7, cls(c));
    putStr(8, why(c));
    out_commit();
  }
  effect_emit(100, OUT_SET);
  return m;
}
