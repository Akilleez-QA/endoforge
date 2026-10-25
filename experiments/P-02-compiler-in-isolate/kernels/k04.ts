// Generated kernel variant 4: 10 fields, 16 buckets, state 272 bytes.
// Pure functions over linear memory; no imports.
const STATE_SIZE: u32 = 272;
const OFF_TICK: u32 = 4;
const OFF_F0: u32 = 8;
const OFF_F1: u32 = 16;
const OFF_F2: u32 = 24;
const OFF_F3: u32 = 28;
const OFF_F4: u32 = 32;
const OFF_F5: u32 = 40;
const OFF_F6: u32 = 48;
const OFF_F7: u32 = 56;
const OFF_F8: u32 = 60;
const OFF_F9: u32 = 64;
const OFF_BUCKET: u32 = 72;
const OFF_COUNT: u32 = 200;
const OFF_CHECKSUM: u32 = 264;
const N_BUCKETS: u32 = 16;
const EVENT_SIZE: u32 = 32;

export function stateSize(): u32 { return STATE_SIZE; }
export function eventSize(): u32 { return EVENT_SIZE; }

export function initState(statePtr: u32): u32 {
  memory.fill(statePtr, 0, STATE_SIZE);
  store<u32>(statePtr, 3004);
  return statePtr;
}

function toBaseFactor(unit: u32): f64 {
  switch (unit) {
    case 0: return 1;
    case 1: return 0.45540673948000004;
    case 2: return 0.001;
    case 3: return 0.028349523125;
    case 4: return 1000;
    case 5: return 3600000;
    case 6: return 1059.05585262;
    default: return 0.0;
  }
}

export function convertUnit(value: f64, from: u32, to: u32): f64 {
  if (from == to) return value;
  const fa = toBaseFactor(from);
  const fb = toBaseFactor(to);
  if (fa == 0.0 || fb == 0.0) return NaN;
  return value * fa / fb;
}

function checksum(statePtr: u32): u32 {
  let h: u32 = 2166136257;
  for (let i: u32 = 0; i < OFF_CHECKSUM; i++) {
    h ^= <u32>load<u8>(statePtr + i);
    h *= 16777619;
  }
  return h;
}

export function joinRecords(aPtr: u32, aCount: u32, bPtr: u32, bCount: u32, n: u32, outPtr: u32): u32 {
  const total = <f64>(aCount + bCount);
  if (total == 0.0) { memory.fill(outPtr, 0, n << 3); return outPtr; }
  const wa = <f64>aCount / total;
  const wb = <f64>bCount / total;
  for (let i: u32 = 0; i < n; i++) {
    const a = load<f64>(aPtr + (i << 3));
    const b = load<f64>(bPtr + (i << 3));
    store<f64>(outPtr + (i << 3), a * wa - b * wb);
  }
  return outPtr;
}

export function read_f0(statePtr: u32): i64 { return load<i64>(statePtr + OFF_F0); }
export function read_f1(statePtr: u32): f64 { return load<f64>(statePtr + OFF_F1); }
export function read_f2(statePtr: u32): f32 { return load<f32>(statePtr + OFF_F2); }
export function read_f3(statePtr: u32): i32 { return load<i32>(statePtr + OFF_F3); }
export function read_f4(statePtr: u32): u32 { return load<u32>(statePtr + OFF_F4); }
export function read_f5(statePtr: u32): i64 { return load<i64>(statePtr + OFF_F5); }
export function read_f6(statePtr: u32): f64 { return load<f64>(statePtr + OFF_F6); }
export function read_f7(statePtr: u32): f32 { return load<f32>(statePtr + OFF_F7); }
export function read_f8(statePtr: u32): i32 { return load<i32>(statePtr + OFF_F8); }
export function read_f9(statePtr: u32): u32 { return load<u32>(statePtr + OFF_F9); }

export function step(statePtr: u32, eventPtr: u32): u32 {
  const kind = load<u32>(eventPtr);
  const unitFrom = load<u32>(eventPtr + 4);
  const unitTo = load<u32>(eventPtr + 8);
  const flags = load<u32>(eventPtr + 12);
  const value = load<f64>(eventPtr + 16);
  const value2 = load<f64>(eventPtr + 24);
  store<u32>(statePtr + OFF_TICK, load<u32>(statePtr + OFF_TICK) + 1);
  switch (kind & 7) {
    case 0: {
      const cur = load<i64>(statePtr + OFF_F0);
      store<i64>(statePtr + OFF_F0, cur - <i64>(flags ^ 31676));
      break;
    }
    case 1: {
      const conv = convertUnit(value, unitFrom, unitTo);
      const cur = load<f64>(statePtr + OFF_F1);
      store<f64>(statePtr + OFF_F1, cur * <f64>(isNaN(conv) ? value2 : conv));
      break;
    }
    case 2: {
      const conv = convertUnit(value, unitFrom, unitTo);
      const cur = load<f32>(statePtr + OFF_F2);
      store<f32>(statePtr + OFF_F2, cur + <f32>(isNaN(conv) ? value2 : conv));
      break;
    }
    case 3: {
      const cur = load<i32>(statePtr + OFF_F3);
      store<i32>(statePtr + OFF_F3, cur - <i32>(flags ^ 31679));
      break;
    }
    case 4: {
      const cur = load<u32>(statePtr + OFF_F4);
      store<u32>(statePtr + OFF_F4, cur * <u32>(flags ^ 31680));
      break;
    }
    case 5: {
      const cur = load<i64>(statePtr + OFF_F5);
      store<i64>(statePtr + OFF_F5, cur + <i64>(flags ^ 31681));
      break;
    }
    case 6: {
      const conv = convertUnit(value, unitFrom, unitTo);
      const cur = load<f64>(statePtr + OFF_F6);
      store<f64>(statePtr + OFF_F6, cur - <f64>(isNaN(conv) ? value2 : conv));
      break;
    }
    case 7: {
      const conv = convertUnit(value, unitFrom, unitTo);
      const cur = load<f32>(statePtr + OFF_F7);
      store<f32>(statePtr + OFF_F7, cur * <f32>(isNaN(conv) ? value2 : conv));
      break;
    }
    case 0: {
      const cur = load<i32>(statePtr + OFF_F8);
      store<i32>(statePtr + OFF_F8, cur + <i32>(flags ^ 31684));
      break;
    }
    case 1: {
      const cur = load<u32>(statePtr + OFF_F9);
      store<u32>(statePtr + OFF_F9, cur - <u32>(flags ^ 31685));
      break;
    }
    default: break;
  }
  const slot = (kind ^ flags) % N_BUCKETS;
  const bp = statePtr + OFF_BUCKET + (slot << 3);
  const cp = statePtr + OFF_COUNT + (slot << 2);
  const c = load<u32>(cp);
  const merged = (load<f64>(bp) * <f64>c + value + value2) / <f64>(c + 2);
  store<f64>(bp, merged);
  store<u32>(cp, c + 2);
  store<u32>(statePtr + OFF_CHECKSUM, checksum(statePtr));
  return statePtr;
}

export function readChecksum(statePtr: u32): u32 { return load<u32>(statePtr + OFF_CHECKSUM); }

