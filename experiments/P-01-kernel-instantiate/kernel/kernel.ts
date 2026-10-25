// P-01 kernel: a pure WASM kernel in Edition 3's shape.
// Exports pure functions over linear memory: step(statePtr, eventPtr) -> ptr.
// No imports beyond `abort` (which the stub runtime still declares).
// All state lives in a caller-owned region of linear memory; the kernel never
// allocates from a heap and never touches the outside world.

// ---- Fixed-size state struct (byte layout) ------------------------------
// offset  size  field
//   0      4    version (u32)
//   4      4    tick (u32)
//   8      8    totalMassKg (f64)
//  16      8    totalEnergyJ (f64)
//  24      4    eventCount (u32)
//  28      4    errorCount (u32)
//  32     16*8  bucket[16] (f64)   running sums keyed by event.kind & 15
// 160     16*4  count[16]  (u32)   counts per bucket
// 224      8    lastValue (f64)
// 232      4    checksum (u32)
// 236      4    pad
// total 240 bytes
const STATE_SIZE: u32 = 240;
const OFF_VERSION: u32 = 0;
const OFF_TICK: u32 = 4;
const OFF_MASS: u32 = 8;
const OFF_ENERGY: u32 = 16;
const OFF_EVENTS: u32 = 24;
const OFF_ERRORS: u32 = 28;
const OFF_BUCKET: u32 = 32;
const OFF_COUNT: u32 = 160;
const OFF_LAST: u32 = 224;
const OFF_CHECKSUM: u32 = 232;

// ---- Event record (byte layout) -----------------------------------------
// offset  size  field
//   0      4    kind (u32)        0=reset 1=add-mass 2=add-energy 3=convert 4=join
//   4      4    unitFrom (u32)
//   8      4    unitTo (u32)
//  12      4    flags (u32)
//  16      8    value (f64)
//  24      8    value2 (f64)
// total 32 bytes
const EVENT_SIZE: u32 = 32;
const EV_KIND: u32 = 0;
const EV_UNIT_FROM: u32 = 4;
const EV_UNIT_TO: u32 = 8;
const EV_FLAGS: u32 = 12;
const EV_VALUE: u32 = 16;
const EV_VALUE2: u32 = 24;

// Unit ids: 0 kg, 1 lb, 2 g, 3 oz (mass); 10 J, 11 kJ, 12 kWh, 13 BTU (energy);
// 20 K, 21 C, 22 F (temperature).
export const UNIT_KG: u32 = 0;
export const UNIT_LB: u32 = 1;
export const UNIT_G: u32 = 2;
export const UNIT_OZ: u32 = 3;
export const UNIT_J: u32 = 10;
export const UNIT_KJ: u32 = 11;
export const UNIT_KWH: u32 = 12;
export const UNIT_BTU: u32 = 13;
export const UNIT_K: u32 = 20;
export const UNIT_C: u32 = 21;
export const UNIT_F: u32 = 22;

export function stateSize(): u32 { return STATE_SIZE; }
export function eventSize(): u32 { return EVENT_SIZE; }

/** Zero a state struct and stamp the version. */
export function initState(statePtr: u32): u32 {
  memory.fill(statePtr, 0, STATE_SIZE);
  store<u32>(statePtr + OFF_VERSION, 3);
  return statePtr;
}

// Factor to convert `unit` into its family base (kg or J). Returns 0 for unknown.
function toBaseFactor(unit: u32): f64 {
  switch (unit) {
    case 0: return 1.0;
    case 1: return 0.45359237;
    case 2: return 0.001;
    case 3: return 0.028349523125;
    case 10: return 1.0;
    case 11: return 1000.0;
    case 12: return 3.6e6;
    case 13: return 1055.05585262;
    default: return 0.0;
  }
}

function sameFamily(a: u32, b: u32): bool {
  return a / 10 == b / 10;
}

/** Convert a value between two units of the same linear family or temperature. Returns NaN if impossible. */
export function convertUnit(value: f64, from: u32, to: u32): f64 {
  if (from == to) return value;
  if (from >= 20 && to >= 20) {
    let kelvin: f64;
    if (from == 20) kelvin = value;
    else if (from == 21) kelvin = value + 273.15;
    else if (from == 22) kelvin = (value - 32.0) * 5.0 / 9.0 + 273.15;
    else return NaN;
    if (to == 20) return kelvin;
    if (to == 21) return kelvin - 273.15;
    if (to == 22) return (kelvin - 273.15) * 9.0 / 5.0 + 32.0;
    return NaN;
  }
  if (!sameFamily(from, to)) return NaN;
  const fa = toBaseFactor(from);
  const fb = toBaseFactor(to);
  if (fa == 0.0 || fb == 0.0) return NaN;
  return value * fa / fb;
}

// FNV-1a over the first 232 bytes of the state so a host can detect drift.
function checksum(statePtr: u32): u32 {
  let h: u32 = 2166136261;
  for (let i: u32 = 0; i < OFF_CHECKSUM; i++) {
    h ^= <u32>load<u8>(statePtr + i);
    h *= 16777619;
  }
  return h;
}

/**
 * Join two fixed-size records (each `n` f64 fields) by index: out[i] = a[i]*wa + b[i]*wb,
 * where wa/wb come from counts (a weighted mean). Writes n f64 at outPtr; returns outPtr.
 */
export function joinRecords(aPtr: u32, aCount: u32, bPtr: u32, bCount: u32, n: u32, outPtr: u32): u32 {
  const total = <f64>(aCount + bCount);
  if (total == 0.0) {
    memory.fill(outPtr, 0, n << 3);
    return outPtr;
  }
  const wa = <f64>aCount / total;
  const wb = <f64>bCount / total;
  for (let i: u32 = 0; i < n; i++) {
    const a = load<f64>(aPtr + (i << 3));
    const b = load<f64>(bPtr + (i << 3));
    store<f64>(outPtr + (i << 3), a * wa + b * wb);
  }
  return outPtr;
}

/**
 * The reducer. Applies one event to the state struct in place and returns statePtr.
 * Pure: reads only [statePtr, statePtr+240) and [eventPtr, eventPtr+32).
 */
export function step(statePtr: u32, eventPtr: u32): u32 {
  const kind = load<u32>(eventPtr + EV_KIND);
  const value = load<f64>(eventPtr + EV_VALUE);
  const tick = load<u32>(statePtr + OFF_TICK) + 1;
  store<u32>(statePtr + OFF_TICK, tick);
  store<u32>(statePtr + OFF_EVENTS, load<u32>(statePtr + OFF_EVENTS) + 1);

  if (kind == 0) {
    initState(statePtr);
    store<u32>(statePtr + OFF_TICK, tick);
  } else if (kind == 1) {
    const kg = convertUnit(value, load<u32>(eventPtr + EV_UNIT_FROM), UNIT_KG);
    if (isNaN(kg)) {
      store<u32>(statePtr + OFF_ERRORS, load<u32>(statePtr + OFF_ERRORS) + 1);
    } else {
      store<f64>(statePtr + OFF_MASS, load<f64>(statePtr + OFF_MASS) + kg);
      store<f64>(statePtr + OFF_LAST, kg);
    }
  } else if (kind == 2) {
    const j = convertUnit(value, load<u32>(eventPtr + EV_UNIT_FROM), UNIT_J);
    if (isNaN(j)) {
      store<u32>(statePtr + OFF_ERRORS, load<u32>(statePtr + OFF_ERRORS) + 1);
    } else {
      store<f64>(statePtr + OFF_ENERGY, load<f64>(statePtr + OFF_ENERGY) + j);
      store<f64>(statePtr + OFF_LAST, j);
    }
  } else if (kind == 3) {
    const out = convertUnit(value, load<u32>(eventPtr + EV_UNIT_FROM), load<u32>(eventPtr + EV_UNIT_TO));
    if (isNaN(out)) store<u32>(statePtr + OFF_ERRORS, load<u32>(statePtr + OFF_ERRORS) + 1);
    else store<f64>(statePtr + OFF_LAST, out);
  } else if (kind == 4) {
    // Fold value/value2 into the bucket as a running weighted mean with the existing count.
    const slot = load<u32>(eventPtr + EV_FLAGS) & 15;
    const bp = statePtr + OFF_BUCKET + (slot << 3);
    const cp = statePtr + OFF_COUNT + (slot << 2);
    const c = load<u32>(cp);
    const prev = load<f64>(bp);
    const v2 = load<f64>(eventPtr + EV_VALUE2);
    const merged = (prev * <f64>c + value + v2) / <f64>(c + 2);
    store<f64>(bp, merged);
    store<u32>(cp, c + 2);
    store<f64>(statePtr + OFF_LAST, merged);
  } else {
    store<u32>(statePtr + OFF_ERRORS, load<u32>(statePtr + OFF_ERRORS) + 1);
  }

  // Every event also accumulates into bucket (kind & 15) so all paths touch the array.
  const slot2 = kind & 15;
  store<f64>(statePtr + OFF_BUCKET + (slot2 << 3), load<f64>(statePtr + OFF_BUCKET + (slot2 << 3)) + value);
  store<u32>(statePtr + OFF_COUNT + (slot2 << 2), load<u32>(statePtr + OFF_COUNT + (slot2 << 2)) + 1);

  store<u32>(statePtr + OFF_CHECKSUM, checksum(statePtr));
  return statePtr;
}

/** Read back a field for hosts that prefer a call to a raw memory read. */
export function readMass(statePtr: u32): f64 { return load<f64>(statePtr + OFF_MASS); }
export function readEnergy(statePtr: u32): f64 { return load<f64>(statePtr + OFF_ENERGY); }
export function readChecksum(statePtr: u32): u32 { return load<u32>(statePtr + OFF_CHECKSUM); }
