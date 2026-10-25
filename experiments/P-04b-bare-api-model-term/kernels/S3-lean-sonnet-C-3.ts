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

const CAP: i32 = 16384;
const MASK: i32 = 32767;
const SB: usize = memory.data(32);
const CB: usize = memory.data(24);
const DB: usize = memory.data(80);
const SLOT = new StaticArray<i32>(32768);
const AIDS = new StaticArray<i64>(CAP);
const BEST = new StaticArray<i32>(CAP);
const BTS = new StaticArray<i64>(CAP);
let gCharge: f64 = NaN;
let gPress: f64 = NaN;

function lower(c: i32): i32 {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

function isWs(c: i32): bool {
  return c == 32 || (c >= 9 && c <= 13);
}

function unitPack(set: u32, idx: i32, f: i32): i32 {
  const n = host_record_field_str(set, idx, f, SB, 32);
  if (n < 0) return -1;
  let s: i32 = 0;
  let e: i32 = n;
  while (s < e && isWs(<i32>load<u8>(SB + <usize>s))) s++;
  while (e > s && isWs(<i32>load<u8>(SB + <usize>(e - 1)))) e--;
  const l = e - s;
  if (l < 2 || l > 3) return -1;
  const a = lower(<i32>load<u8>(SB + <usize>s));
  const b = lower(<i32>load<u8>(SB + <usize>(s + 1)));
  const c = l == 3 ? lower(<i32>load<u8>(SB + <usize>(s + 2))) : 0;
  return (a << 16) | (b << 8) | c;
}

function massFactor(p: i32): f64 {
  if (p == ((107 << 16) | (103 << 8))) return 1.0;
  if (p == ((108 << 16) | (98 << 8))) return 0.45359237;
  return -1.0;
}

function pressFactor(p: i32): f64 {
  if (p == ((107 << 16) | (112 << 8) | 97)) return 1.0;
  if (p == ((98 << 16) | (97 << 8) | 114)) return 100.0;
  if (p == ((112 << 16) | (115 << 8) | 105)) return 6.894757293168;
  return -1.0;
}

function readRow(r: i32): bool {
  gCharge = NaN;
  gPress = NaN;
  const mf = massFactor(unitPack(0, r, 3));
  const pf = pressFactor(unitPack(0, r, 5));
  const m = host_record_field_f64(0, r, 2);
  const p = host_record_field_f64(0, r, 4);
  if (mf < 0 || pf < 0 || !isFinite(m) || !isFinite(p) || m < 0) return false;
  gCharge = m * mf;
  gPress = p * pf;
  return true;
}

function slotOf(id: i64): i32 {
  let h = <i32>((<u64>id * 0x9E3779B97F4A7C15) >> 49);
  while (SLOT[h] >= 0 && AIDS[SLOT[h]] != id) h = (h + 1) & MASK;
  return h;
}

function put(buf: usize, cap: i32, s: string): i32 {
  const n = s.length < cap ? s.length : cap;
  for (let i = 0; i < n; i++) store<u8>(buf + <usize>i, <u8>s.charCodeAt(i));
  return n;
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
  out_set_str(7, CB, put(CB, 24, cls));
  out_set_str(8, DB, put(DB, 80, det));
  out_commit();
}

function kindIs(set: u32, f: i32, k: i32): bool {
  return host_field_kind(set, f) == k;
}

export function run(abs_tol_kg: f64, rel_tol: f64, max_age_days: i64, as_of_ts: i64): i32 {
  const ok0 = kindIs(0, 0, 0) && kindIs(0, 1, 0) && kindIs(0, 2, 1) && kindIs(0, 3, 2) && kindIs(0, 4, 1) && kindIs(0, 5, 2);
  const ok1 = kindIs(1, 0, 0) && kindIs(1, 1, 1) && kindIs(1, 2, 1) && kindIs(1, 5, 1);
  const nr = host_record_count(0);
  let na = host_record_count(1);
  if (na > CAP) na = CAP;
  let count: i32 = 0;
  SLOT.fill(-1);
  BEST.fill(-1);
  if (ok1) {
    for (let i = 0; i < na; i++) {
      AIDS[i] = host_record_field_i64(1, i, 0);
      const h = slotOf(AIDS[i]);
      if (SLOT[h] < 0) SLOT[h] = i;
    }
  }
  if (ok0 && ok1) {
    for (let r = 0; r < nr; r++) {
      const a = SLOT[slotOf(host_record_field_i64(0, r, 0))];
      const ts = host_record_field_i64(0, r, 1);
      if (a >= 0 && (BEST[a] < 0 || ts > BTS[a])) {
        BEST[a] = r;
        BTS[a] = ts;
      }
    }
  }
  for (let i = 0; i < na; i++) {
    const id = ok1 ? AIDS[i] : <i64>0;
    const rc = ok1 ? host_record_field_f64(1, i, 1) : NaN;
    const rp = ok1 ? host_record_field_f64(1, i, 2) : NaN;
    const tp = ok1 ? host_record_field_f64(1, i, 5) : NaN;
    const b = ok1 ? BEST[SLOT[slotOf(id)]] : -1;
    const ts = b >= 0 ? host_record_field_i64(0, b, 1) : <i64>-1;
    let cls = "OK";
    let det = "within tolerance";
    gCharge = NaN;
    gPress = NaN;
    if (!ok1 || !isFinite(rc) || !isFinite(rp) || !isFinite(tp) || rc < 0 || rp < 0 || tp < 0) {
      cls = "MALFORMED";
      det = "bad asset register row";
    } else if (b < 0) {
      cls = "NO_READING";
      det = "no reading for asset";
    } else if (!readRow(b)) {
      cls = "MALFORMED";
      det = "bad unit or value in reading";
    } else if (as_of_ts - ts > max_age_days * 86400) {
      cls = "STALE";
      det = "newest reading older than max age";
    } else {
      const d = gCharge - rc;
      const tol = Math.max(abs_tol_kg, tp / 100.0 * rc);
      const pd = gPress - rp;
      const pOut = Math.abs(pd) > rel_tol * Math.max(Math.abs(gPress), Math.abs(rp));
      if (d < 0 && Math.abs(d) > tol) {
        cls = "UNDERCHARGE";
        det = "charge below rated beyond tolerance";
      } else if (d > 0 && Math.abs(d) > tol) {
        cls = "OVERCHARGE";
        det = "charge above rated beyond tolerance";
      } else if (pd > 0 && pOut) {
        cls = "PRESSURE_HIGH";
        det = "pressure above rated beyond tolerance";
      } else if (pd < 0 && pOut) {
        cls = "PRESSURE_LOW";
        det = "pressure below rated beyond tolerance";
      }
    }
    emit(id, ts, gCharge, rc, gPress, rp, cls, det);
    count++;
  }
  if (ok0 && ok1) {
    for (let r = 0; r < nr; r++) {
      const id = host_record_field_i64(0, r, 0);
      if (SLOT[slotOf(id)] >= 0) continue;
      const good = readRow(r);
      emit(id, host_record_field_i64(0, r, 1), gCharge, NaN, gPress, NaN, good ? "ORPHAN_READING" : "MALFORMED", good ? "reading has no asset register entry" : "bad unit or value in reading");
      count++;
    }
  }
  return count;
}
