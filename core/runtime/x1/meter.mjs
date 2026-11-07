const uleb = value => { const out = []; let n = BigInt(value); do { let byte = Number(n & 127n); n >>= 7n; if (n) byte |= 128; out.push(byte); } while (n); return out; };
const sleb = value => { const out = []; let n = BigInt(value); for (;;) { const byte = Number(n & 127n); n >>= 7n; if ((n === 0n && !(byte & 64)) || (n === -1n && byte & 64)) { out.push(byte); return out; } out.push(byte | 128); } };
const fuelExport = '__ef_fuel', memoryExport = '__ef_memory', bulkCost = 65536;
const types = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x70: 'funcref', 0x6f: 'externref' };
const order = [1, 2, 3, 4, 5, 13, 6, 7, 8, 9, 12, 10, 11];
class Reader {
  constructor(bytes, offset = 0, end = bytes.length) { this.bytes = bytes; this.offset = offset; this.end = end; }
  byte() { if (this.offset >= this.end) throw Error('truncated wasm'); return this.bytes[this.offset++]; }
  uint() { let n = 0, shift = 0, b; do { b = this.byte(); n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; }
  skipLeb() { while (this.byte() & 128); }
  name() { const length = this.uint(), start = this.offset; this.offset += length; return Buffer.from(this.bytes.subarray(start, this.offset)).toString(); }
}
function sections(bytes) {
  if (bytes.length < 8) throw Error('truncated wasm');
  const reader = new Reader(bytes, 8), list = [];
  while (reader.offset < bytes.length) {
    const id = reader.byte(), size = reader.uint(), start = reader.offset;
    reader.offset += size;
    if (reader.offset > bytes.length) throw Error('truncated wasm');
    list.push({ id, content: bytes.subarray(start, reader.offset) });
  }
  return list;
}
function walk(reader, opcode, stack, frame, onCall) {
  const skip = count => { for (let i = 0; i < count; i++) reader.skipLeb(); };
  if (opcode === 0x02 || opcode === 0x04) { reader.skipLeb(); stack.push(null); }
  else if (opcode === 0x05 || opcode <= 0x01 || opcode === 0x0f || opcode === 0x1a || opcode === 0x1b) return;
  else if (opcode === 0x0c || opcode === 0x0d || (opcode >= 0x20 && opcode <= 0x26) || opcode === 0x3f || opcode === 0x40 || opcode === 0x41 || opcode === 0x42 || opcode === 0xd0 || opcode === 0xd2) skip(1);
  else if (opcode === 0x10 || opcode === 0x12) onCall(reader.uint());
  else if (opcode === 0x11 || opcode === 0x13) { onCall(null); skip(2); }
  else if (opcode === 0x0e) { skip(reader.uint() + 1); }
  else if (opcode === 0x1c) skip(reader.uint());
  else if (opcode >= 0x28 && opcode <= 0x3e) skip(2);
  else if (opcode === 0x43) reader.offset += 4;
  else if (opcode === 0x44) reader.offset += 8;
  else if ((opcode >= 0x45 && opcode <= 0xc4) || opcode === 0xd1) return;
  else if (opcode === 0xfc) {
    const sub = reader.uint();
    if (sub <= 7) return;
    const counts = { 8: 2, 9: 1, 10: 2, 11: 1, 12: 2, 13: 1, 14: 2, 15: 1, 16: 1, 17: 1 };
    if (!counts[sub]) throw Error(`unmeterable opcode 0xfc ${sub}`);
    skip(counts[sub]);
    if (sub === 8 || sub === 10 || sub === 11) frame.cost += bulkCost;
  } else throw Error(`unmeterable opcode ${opcode}`);
}
function functionBody(bytes, start, end, onCall) {
  const reader = new Reader(bytes, start, end);
  for (let locals = reader.uint(); locals; locals--) { reader.skipLeb(); reader.byte(); }
  const entry = { at: reader.offset, cost: 1 }, points = [entry], stack = [entry];
  const current = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i]; return entry; };
  while (reader.offset < end) {
    const opcode = reader.byte();
    current().cost++;
    if (opcode === 0x03) { reader.skipLeb(); const frame = { at: reader.offset, cost: 1 }; points.push(frame); stack.push(frame); }
    else if (opcode === 0x0b) { stack.pop(); if (!stack.length) break; }
    else walk(reader, opcode, stack, current(), onCall);
  }
  if (reader.offset !== end || stack.length) throw Error('malformed function body');
  return points;
}
function charge(global, cost) {
  const index = uleb(global);
  return [0x23, ...index, 0x42, ...sleb(cost), 0x7d, 0x24, ...index, 0x23, ...index, 0x42, 0, 0x53, 0x04, 0x40, 0x00, 0x0b];
}
export function inspect(bytes) {
  const signatures = [], imports = [], functionTypes = [], functions = {}, calls = new Set();
  let memory = null, globals = 0, importedFunctions = 0, memoryName = null, start = false;
  const parts = sections(bytes);
  for (const { id, content } of parts) {
    const r = new Reader(content);
    if (id === 1) for (let n = r.uint(); n; n--) {
      if (r.byte() !== 0x60) throw Error('unknown type form');
      const list = () => Array.from({ length: r.uint() }, () => types[r.byte()]);
      signatures.push({ params: list(), results: list() });
    } else if (id === 2) for (let n = r.uint(); n; n--) {
      const module = r.name(), name = r.name(), kind = r.byte(), entry = { module, name, kind };
      if (kind === 0) { entry.signature = signatures[r.uint()]; functionTypes.push(entry.signature); importedFunctions++; }
      else if (kind === 1) { r.byte(); if (r.uint() & 1) r.uint(); r.uint(); }
      else if (kind === 2) { const flags = r.uint(); r.uint(); if (flags & 1) r.uint(); }
      else if (kind === 3) { r.byte(); r.byte(); globals++; }
      else throw Error('unknown import kind');
      imports.push(entry);
    } else if (id === 3) for (let n = r.uint(); n; n--) functionTypes.push(signatures[r.uint()]);
    else if (id === 5 && r.uint()) { const flags = r.uint(); memory = { initial: r.uint(), ...(flags & 1 ? { maximum: r.uint() } : {}) }; }
    else if (id === 6) globals += r.uint();
    else if (id === 7) for (let n = r.uint(); n; n--) {
      const name = r.name(), kind = r.byte(), index = r.uint();
      if (kind === 0) functions[name] = functionTypes[index];
      else if (kind === 2) memoryName ??= name;
    } else if (id === 8) start = true;
  }
  const code = parts.find(part => part.id === 10);
  const bodies = [];
  if (code) {
    const r = new Reader(code.content);
    for (let n = r.uint(); n; n--) {
      const size = r.uint(), at = r.offset;
      bodies.push({ at, size, points: functionBody(code.content, at, at + size, index => {
        if (index !== null && index < importedFunctions) { const target = imports.filter(i => i.kind === 0)[index]; calls.add(`${target.module}.${target.name}`); }
      }) });
      r.offset = at + size;
    }
  }
  return { imports, functions, memory, memoryName, start, globals, bodies, calls: [...calls].sort(), parts };
}
export function meter(bytes, fuel) {
  const shape = inspect(bytes), global = shape.globals, parts = shape.parts.map(part => ({ id: part.id, content: part.content }));
  const code = shape.parts.find(part => part.id === 10);
  if (code) {
    const out = [...uleb(shape.bodies.length)];
    for (const { at, size, points } of shape.bodies) {
      const body = [];
      let cursor = at;
      for (const point of points) { body.push(...code.content.subarray(cursor, point.at), ...charge(global, point.cost)); cursor = point.at; }
      body.push(...code.content.subarray(cursor, at + size));
      out.push(...uleb(body.length), ...body);
    }
    parts.find(part => part.id === 10).content = Uint8Array.from(out);
  }
  const entry = (name, kind, index) => [...uleb(Buffer.byteLength(name)), ...Buffer.from(name), kind, ...uleb(index)];
  const extend = (id, addition) => {
    const existing = parts.find(part => part.id === id);
    if (existing) {
      const r = new Reader(existing.content), count = r.uint();
      existing.content = Uint8Array.from([...uleb(count + 1), ...existing.content.subarray(r.offset), ...addition]);
      return;
    }
    const part = { id, content: Uint8Array.from([1, ...addition]) };
    const rank = value => order.indexOf(value), later = parts.findIndex(p => p.id !== 0 && rank(p.id) > rank(id));
    parts.splice(later < 0 ? parts.length : later, 0, part);
  };
  extend(6, [0x7e, 1, 0x42, ...sleb(fuel), 0x0b]);
  extend(7, entry(fuelExport, 3, global));
  if (shape.memory && !shape.memoryName) extend(7, entry(memoryExport, 2, 0));
  return Buffer.concat([bytes.subarray(0, 8), ...parts.flatMap(({ id, content }) => [Uint8Array.from([id, ...uleb(content.length)]), content])]);
}
let latest = null;
export function loadKernel(bytes, fuel) {
  const key = Buffer.from(bytes).toString('base64');
  if (latest?.key === key && latest.fuel === fuel) return latest.kernel;
  const kernel = compileKernel(bytes, fuel);
  latest = { key, fuel, kernel };
  return kernel;
}
function compileKernel(bytes, fuel) {
  const shape = inspect(bytes), module = new WebAssembly.Module(meter(bytes, fuel));
  const memoryName = shape.memoryName ?? (shape.memory ? memoryExport : null);
  const start = abort => {
    const hosts = {};
    for (const entry of shape.imports) if (entry.kind === 0) (hosts[entry.module] ??= {})[entry.name] = (...args) => {
      if (entry.module === 'env' && entry.name === 'abort') abort(...args);
      throw new Error(`forbidden import ${entry.module}.${entry.name}`);
    };
    const instance = new WebAssembly.Instance(module, hosts);
    const remaining = () => instance.exports[fuelExport].value;
    return { instance, used: () => Number(BigInt(fuel) - remaining()), exhausted: () => remaining() < 0n,
      memoryBytes: () => (memoryName ? instance.exports[memoryName].buffer.byteLength : 0) };
  };
  return { shape, start };
}
