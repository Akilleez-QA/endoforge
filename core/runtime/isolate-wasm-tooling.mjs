const { validate, CompileError } = WebAssembly;
const refuse = message => { throw new CompileError(message); };
const leb = value => {
  const bytes = [];
  do { const part = value % 128; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)); } while (value);
  return bytes;
};

export function toolingWasmPolicy(entries, maxMb) {
  if (!Array.isArray(entries)) throw new TypeError('toolingWasmModules must be an array');
  const names = new Set(), hashes = new Set();
  return Object.freeze(entries.map(({ name, sha256, maximumPages } = {}) => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(name) ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > maxMb * 16 ||
        names.has(name) || hashes.has(sha256)) throw new TypeError('invalid toolingWasmModules entry');
    names.add(name); hashes.add(sha256);
    return Object.freeze({ name, sha256, maximumPages });
  }));
}

export function admitToolingWasm(bytes, entry) {
  if (!validate(bytes)) refuse('invalid wasm module');
  let offset = 8, memories = 0;
  const byte = () => offset < bytes.length ? bytes[offset++] : refuse('truncated wasm');
  const uint = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const next = byte();
      value += (next & 127) * 2 ** (7 * i);
      if (!(next & 128)) return value;
    }
    return refuse('invalid wasm integer');
  };
  const skip = () => { const length = uint(); offset += length; };
  const unsupported = () => refuse('unsupported wasm feature in tooling module');
  const output = [bytes.subarray(0, 8)];
  while (offset < bytes.length) {
    const start = offset, id = byte(), size = uint(), end = offset + size;
    if (id === 2) {
      for (let count = uint(); count; count--) {
        skip(); skip();
        const kind = byte();
        if (kind === 0) uint();
        else if (kind === 1) { if (![0x70, 0x6f].includes(byte())) unsupported(); const flag = uint(); if (flag > 1) unsupported(); uint(); if (flag) uint(); }
        else if (kind === 3) { if (![0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x70, 0x6f].includes(byte())) unsupported(); byte(); }
        else if (kind === 4) { byte(); uint(); }
        else unsupported();
      }
      if (offset !== end) refuse('malformed import section');
    }
    if (id !== 5) {
      offset = end;
      output.push(bytes.subarray(start, end));
      continue;
    }
    const entries = [];
    for (let count = uint(); count; count--) {
      if (++memories > 1) unsupported();
      const flag = uint();
      if (flag > 1) unsupported();
      const initial = uint(), maximum = Math.min(flag ? uint() : Infinity, entry.maximumPages);
      if (initial > maximum) refuse('tooling module memory exceeds its pinned maximum');
      entries.push(1, ...leb(initial), ...leb(maximum));
    }
    if (offset !== end) refuse('malformed memory section');
    const content = [...leb(memories), ...entries];
    output.push(Uint8Array.from([5, ...leb(content.length), ...content]));
  }
  const admitted = new Uint8Array(output.reduce((total, part) => total + part.length, 0));
  output.reduce((at, part) => { admitted.set(part, at); return at + part.length; }, 0);
  return { bytes: admitted, flag: null, start: null, tooling: entry.name };
}
