const OPS = new Map(Object.entries({
  0x46: [[0x47, 'sign']], 0x47: [[0x46, 'sign']], 0x45: [[0x01, 'sign']],
  0x48: [[0x4c, 'boundary'], [0x4a, 'sign']], 0x4c: [[0x48, 'boundary'], [0x4e, 'sign']], 0x4a: [[0x4e, 'boundary'], [0x48, 'sign']], 0x4e: [[0x4a, 'boundary'], [0x4c, 'sign']],
  0x49: [[0x4d, 'boundary'], [0x4b, 'sign']], 0x4d: [[0x49, 'boundary'], [0x4f, 'sign']], 0x4b: [[0x4f, 'boundary'], [0x49, 'sign']], 0x4f: [[0x4b, 'boundary'], [0x4d, 'sign']],
  0x61: [[0x62, 'sign']], 0x62: [[0x61, 'sign']],
  0x63: [[0x65, 'boundary'], [0x64, 'sign']], 0x65: [[0x63, 'boundary'], [0x66, 'sign']], 0x64: [[0x66, 'boundary'], [0x63, 'sign']], 0x66: [[0x64, 'boundary'], [0x65, 'sign']],
  0x6a: [[0x6b, 'sign']], 0x6b: [[0x6a, 'sign']], 0x71: [[0x72, 'join']], 0x72: [[0x71, 'join']],
  0x99: [[0x01, 'sign']], 0x9a: [[0x01, 'sign']],
  0x9b: [[0x9c, 'rounding'], [0x9d, 'rounding'], [0x9e, 'rounding']], 0x9c: [[0x9b, 'rounding'], [0x9d, 'rounding'], [0x9e, 'rounding']],
  0x9d: [[0x9b, 'rounding'], [0x9c, 'rounding'], [0x9e, 'rounding']], 0x9e: [[0x9b, 'rounding'], [0x9c, 'rounding'], [0x9d, 'rounding']],
  0xa0: [[0xa1, 'sign']], 0xa1: [[0xa0, 'sign']], 0xa2: [[0xa3, 'units']], 0xa3: [[0xa2, 'units']], 0xa4: [[0xa5, 'join']], 0xa5: [[0xa4, 'join']],
}).map(([k, v]) => [Number(k), v]));
const MAX_SITES = 600;
const unsupported = reason => Object.assign(Error(reason), { unsupported: true });
function scan(bytes) {
  let p = 8;
  const uint = () => { let n = 0, s = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; };
  const leb = () => { const start = p; while (bytes[p++] & 128); return p - start; };
  const sites = [];
  while (p < bytes.length) {
    const id = bytes[p++], size = uint(), end = p + size;
    if (id !== 10) { p = end; continue; }
    for (let count = uint(); count; count--) {
      const bodySize = uint(), bodyEnd = p + bodySize;
      for (let groups = uint(); groups; groups--) { uint(); p++; }
      while (p < bodyEnd) {
        const at = p, op = bytes[p++];
        for (const [to, kind] of OPS.get(op) ?? []) sites.push({ at, write: [to], kind, op: `${op.toString(16)}>${to.toString(16)}` });
        if (op === 0x02 || op === 0x03 || op === 0x04) leb();
        else if (op === 0x0c || op === 0x0d || op === 0x10 || (op >= 0x20 && op <= 0x24)) leb();
        else if (op === 0x0e) { for (let n = uint() + 1; n; n--) leb(); }
        else if (op === 0x11) { leb(); leb(); }
        else if (op === 0x1c) { for (let n = uint(); n; n--) p++; }
        else if (op >= 0x28 && op <= 0x3e) { leb(); leb(); }
        else if (op === 0x3f) p++;
        else if (op === 0x40) throw unsupported('memory.grow');
        else if (op === 0x41) {
          const start = p, width = leb();
          let value = 0, shift = 0, b, i = start;
          do { b = bytes[i++]; value |= (b & 127) << shift; shift += 7; } while (b & 128);
          if (shift < 32 && (b & 64)) value |= -1 << shift;
          for (const next of [value + 1, value - 1]) {
            const encoded = sleb(next);
            if (encoded.length === width) sites.push({ at: start, write: encoded, kind: 'constants', op: 'i32.const' });
          }
        } else if (op === 0x42) leb();
        else if (op === 0x43) p += 4;
        else if (op === 0x44) {
          const value = new DataView(bytes.buffer, bytes.byteOffset + p, 8).getFloat64(0, true);
          for (const next of new Set([value * 1.002, value * 0.998, -value, Number(value.toPrecision(3)), value === 0 ? 0.001 : value])) {
            if (Object.is(next, value) || !Number.isFinite(next)) continue;
            const out = new Uint8Array(8);
            new DataView(out.buffer).setFloat64(0, next, true);
            sites.push({ at: p, write: [...out], kind: 'constants', op: 'f64.const' });
          }
          p += 8;
        } else if (op === 0xfc) {
          const sub = uint();
          if (sub > 7) throw unsupported(`0xfc ${sub}`);
        } else if (op > 0xc4 || (op >= 0x06 && op <= 0x0a) || op === 0x12 || op === 0x13 || op === 0x18 || op === 0x19) throw unsupported(`opcode ${op}`);
      }
    }
    return sites;
  }
  return sites;
}
function sleb(value) {
  const out = [];
  for (;;) {
    const byte = value & 127;
    value >>= 7;
    if ((value === 0 && !(byte & 64)) || (value === -1 && (byte & 64))) { out.push(byte); return out; }
    out.push(byte | 128);
  }
}
export function mutantsOf(bytes) {
  const all = scan(bytes);
  const stride = Math.max(1, all.length / MAX_SITES);
  const sites = [];
  for (let i = 0; i < all.length; i += stride) sites.push(all[Math.floor(i)]);
  return { total: all.length, sites };
}
export function applied(bytes, site) {
  const copy = Uint8Array.from(bytes);
  copy.set(site.write, site.at);
  return copy;
}
