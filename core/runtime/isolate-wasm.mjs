import { createHash } from 'node:crypto';
import { admitToolingWasm, guardToolingExports, toolingWasmPolicy } from './isolate-wasm-tooling.mjs';

const pageBytes = 65536;
const leb = value => {
  const bytes = [];
  do { const part = value % 128; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)); } while (value);
  return bytes;
};
const concat = parts => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const vector = entries => concat([leb(entries.length), ...entries]);
const section = (id, bytes) => concat([[id, ...leb(bytes.length)], bytes]);
const valueTypes = new Set([0x7f, 0x7e, 0x7d, 0x7c, 0x70, 0x6f]);
const GROW = 1, BLOCK = 2, INDEX = 3, TABLE = 4, TWO = 5, SELECT = 6, MEMARG = 7, I64 = 8, F32 = 9, F64 = 10, MISC = 11, REFUSED = 255;
const immediates = new Uint8Array(256).fill(REFUSED);
for (const op of [0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b, 0xd1]) immediates[op] = 0;
for (let op = 0x45; op <= 0xc4; op++) immediates[op] = 0;
immediates[0x40] = GROW;
for (const op of [0x02, 0x03, 0x04, 0x41, 0xd0]) immediates[op] = BLOCK;
for (const op of [0x0c, 0x0d, 0x10, 0x12, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x3f, 0xd2]) immediates[op] = INDEX;
immediates[0x0e] = TABLE;
immediates[0x11] = immediates[0x13] = TWO;
immediates[0x1c] = SELECT;
for (let op = 0x28; op <= 0x3e; op++) immediates[op] = MEMARG;
immediates[0x42] = I64; immediates[0x43] = F32; immediates[0x44] = F64; immediates[0xfc] = MISC;

class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  byte() {
    if (this.offset >= this.bytes.length) throw new WebAssembly.CompileError('truncated wasm');
    return this.bytes[this.offset++];
  }
  uint() {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** (7 * i);
      if (!(byte & 128) && value <= 0xffffffff) return value;
    }
    throw new WebAssembly.CompileError('invalid wasm integer');
  }
  skipLeb(max = 5) {
    for (let i = 0; i < max; i++) if (!(this.byte() & 128)) return;
    throw new WebAssembly.CompileError('invalid wasm integer');
  }
  take(length) {
    const start = this.offset;
    this.offset += length;
    if (this.offset > this.bytes.length) throw new WebAssembly.CompileError('truncated wasm');
    return this.bytes.subarray(start, this.offset);
  }
  name() { return this.take(this.uint()); }
}

export function trustedWasmPolicy(entries, maxMb) {
  if (!Array.isArray(entries)) throw new TypeError('trustedWasmModules must be an array');
  const names = new Set(), hashes = new Set();
  return Object.freeze(entries.map(({ name, sha256, maximumPages }) => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(name) ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > maxMb * 16 ||
        names.has(name) || hashes.has(sha256)) throw new TypeError('invalid trustedWasmModules entry');
    names.add(name); hashes.add(sha256);
    return Object.freeze({ name, sha256, maximumPages });
  }));
}

export function installWasmLimit(maxMb, breach, trustedWasmModules = [], sharedWasmModules = [], toolingWasmModules = []) {
  const trustedModules = new Map(trustedWasmPolicy(trustedWasmModules, maxMb).map(entry => [entry.sha256, entry]));
  const toolingModules = new Map(toolingWasmPolicy(toolingWasmModules, maxMb).map(entry => [entry.sha256, entry]));
  if ([...toolingModules.keys()].some(sha256 => trustedModules.has(sha256))) throw new TypeError('a digest cannot be both trusted and tooling');
  const sharedModules = new Map(sharedWasmModules.map(entry => [entry.sha256, entry]));
  const native = Object.fromEntries(Object.getOwnPropertyNames(WebAssembly).map(key => [key, WebAssembly[key]]));
  const cap = maxMb * 1024 * 1024 / pageBytes;
  const modules = new WeakMap(sharedWasmModules.map(entry => [entry.module, entry.data]));
  const shared = source => {
    if (!sharedModules.size) return undefined;
    const view = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
    return sharedModules.get(createHash('sha256').update(view).digest('hex'))?.module;
  };
  const memoryLimits = new WeakMap();
  const flags = new Set();
  const activeFlags = new Set();
  const fail = () => breach('ERR_WORKCELL_WASM_MEMORY_LIMIT');
  const unsupported = () => { throw new native.CompileError('unsupported wasm feature in bounded workcell'); };
  const check = () => {
    for (const ref of flags) {
      const flag = ref.deref();
      if (!flag) flags.delete(ref);
      else if (flag.value) fail();
    }
  };
  const memoryType = (reader, trusted, limits) => {
    const kind = reader.uint();
    if (kind > 3) unsupported();
    const initial = reader.uint();
    if (!(kind & 1) && !trusted) fail();
    const maximum = kind & 1 ? reader.uint() : trusted.maximumPages;
    if (initial > maximum || initial > cap || maximum > cap) fail();
    limits.push(kind & 1 ? cap : maximum);
    return [...leb(kind | 1), ...leb(initial), ...leb(maximum)];
  };
  const valueType = reader => {
    if (!valueTypes.has(reader.byte())) unsupported();
  };
  const rewrite = source => {
    const bytes = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
      : new Uint8Array(source).slice();
    const tooling = toolingModules.size ? toolingModules.get(createHash('sha256').update(bytes).digest('hex')) : undefined;
    if (tooling) return admitToolingWasm(bytes, tooling);
    if (!native.validate(bytes)) throw new native.CompileError('invalid wasm module');
    const trusted = trustedModules.size ? trustedModules.get(createHash('sha256').update(bytes).digest('hex')) : undefined;
    const reader = new Reader(bytes);
    const header = reader.take(8);
    const sections = new Map();
    const custom = [];
    while (reader.offset < bytes.length) {
      const id = reader.byte(), content = reader.take(reader.uint());
      if (id === 0) custom.push(section(id, content));
      else if (id > 12) unsupported();
      else sections.set(id, content);
    }
    let typeCount = 0, importedFunctions = 0, importedGlobals = 0, memories = 0;
    const limits = [], importedMemories = [], exportedMemories = [];
    if (sections.has(1)) {
      const types = new Reader(sections.get(1));
      typeCount = types.uint();
      for (let i = 0; i < typeCount; i++) {
        if (types.byte() !== 0x60) unsupported();
        for (let j = types.uint(); j; j--) valueType(types);
        for (let j = types.uint(); j; j--) valueType(types);
      }
    }
    if (sections.has(2)) {
      const imports = new Reader(sections.get(2));
      const entries = [];
      for (let i = imports.uint(); i; i--) {
        const start = imports.offset;
        const importModule = Buffer.from(imports.name()).toString(), importName = Buffer.from(imports.name()).toString();
        const kind = imports.byte(), prefix = imports.bytes.slice(start, imports.offset);
        if (kind === 2) {
          importedMemories.push({ module: importModule, name: importName, memory: memories });
          entries.push([...prefix, ...memoryType(imports, trusted, limits)]);
          memories++;
          continue;
        }
        if (kind === 0) { imports.uint(); importedFunctions++; }
        else if (kind === 1) {
          valueType(imports);
          const limits = imports.uint();
          if (limits > 1) unsupported();
          imports.uint();
          if (limits) imports.uint();
        } else if (kind === 3) { valueType(imports); imports.byte(); importedGlobals++; }
        else unsupported();
        entries.push(imports.bytes.subarray(start, imports.offset));
      }
      sections.set(2, vector(entries));
    }
    if (sections.has(5)) {
      const memory = new Reader(sections.get(5));
      const entries = [];
      for (let i = memory.uint(); i; i--) { entries.push(memoryType(memory, trusted, limits)); memories++; }
      sections.set(5, vector(entries));
    }
    if (!memories) return { bytes, flag: null, start: null };
    const count = id => sections.has(id) ? new Reader(sections.get(id)).uint() : 0;
    const append = (id, entries) => {
      const content = new Reader(sections.get(id) || Uint8Array.of(0));
      const length = content.uint();
      sections.set(id, concat([leb(length + entries.length), content.take(content.bytes.length - content.offset), ...entries]));
    };
    const helperBase = importedFunctions + count(3);
    const flagIndex = importedGlobals + count(6);
    const exportNames = new Set();
    if (sections.has(7)) {
      const exports = new Reader(sections.get(7));
      for (let i = exports.uint(); i; i--) {
        const name = Buffer.from(exports.name());
        const kind = exports.byte(), index = exports.uint();
        exportNames.add(name.toString('hex'));
        if (kind === 2) exportedMemories.push({ name: name.toString(), memory: index });
      }
    }
    const privateName = base => {
      let name = base;
      while (exportNames.has(Buffer.from(name).toString('hex'))) name += '_';
      exportNames.add(Buffer.from(name).toString('hex'));
      return name;
    };
    const flag = privateName('__ef_memory_limit');
    const exportEntry = (name, kind, index) => [...leb(Buffer.byteLength(name)), ...Buffer.from(name), kind, ...leb(index)];
    append(1, [[0x60, 1, 0x7f, 1, 0x7f]]);
    append(3, Array.from({ length: memories }, () => leb(typeCount)));
    append(6, [[0x7f, 1, 0x41, 0, 0x0b]]);
    append(7, [exportEntry(flag, 3, flagIndex)]);
    let start = null;
    if (sections.has(8)) {
      start = privateName('__ef_start');
      append(7, [exportEntry(start, 0, new Reader(sections.get(8)).uint())]);
      sections.delete(8);
    }
    const code = new Reader(sections.get(10) || Uint8Array.of(0));
    const bodies = [], functions = code.uint();
    for (let i = functions; i; i--) {
      const body = new Reader(code.take(code.uint()));
      for (let j = body.uint(); j; j--) { body.uint(); valueType(body); }
      const pieces = [];
      let copied = 0, length = body.bytes.length;
      while (body.offset < body.bytes.length) {
        const offset = body.offset, op = body.byte();
        switch (immediates[op]) {
          case 0: break;
          case GROW: {
            const call = [0x10, ...leb(helperBase + body.uint())];
            pieces.push(body.bytes.subarray(copied, offset), call);
            length += call.length - (body.offset - offset);
            copied = body.offset;
            break;
          }
          case BLOCK: body.skipLeb(); break;
          case INDEX: body.uint(); break;
          case TABLE: for (let j = body.uint() + 1; j; j--) body.uint(); break;
          case TWO: body.uint(); body.uint(); break;
          case SELECT: for (let j = body.uint(); j; j--) valueType(body); break;
          case MEMARG: { const align = body.uint(); if (align & 0x40) body.uint(); body.uint(); break; }
          case I64: body.skipLeb(10); break;
          case F32: body.take(4); break;
          case F64: body.take(8); break;
          case MISC: {
            const sub = body.uint();
            if (sub === 8 || sub === 10 || sub === 12 || sub === 14) { body.uint(); body.uint(); }
            else if (sub === 9 || sub === 11 || (sub >= 13 && sub <= 17)) body.uint();
            else if (sub > 7) unsupported();
            break;
          }
          default: unsupported();
        }
      }
      pieces.push(body.bytes.subarray(copied));
      bodies.push(leb(length), ...pieces);
    }
    for (let memory = 0; memory < memories; memory++) {
      const constant = leb(limits[memory]);
      if (constant.at(-1) & 0x40) { constant[constant.length - 1] |= 0x80; constant.push(0); }
      const body = [0, 0x20, 0, 0x41, ...constant, 0x3f, ...leb(memory), 0x6b, 0x4b,
        0x04, 0x40, 0x41, 1, 0x24, ...leb(flagIndex), 0x00, 0x0b,
        0x20, 0, 0x40, ...leb(memory), 0x0b];
      bodies.push(leb(body.length), body);
    }
    sections.set(10, concat([leb(functions + memories), ...bodies]));
    const order = [1, 2, 3, 4, 5, 6, 7, 9, 12, 10, 11];
    return { bytes: concat([header, ...custom, ...order.flatMap(id => sections.has(id) ? [section(id, sections.get(id))] : [])]), flag, start, limits, importedMemories, exportedMemories };
  };
  const wrapConstructor = (key, construct) => {
    const wrapped = new Proxy(native[key], { construct });
    Object.defineProperty(native[key].prototype, 'constructor', { value: wrapped });
    Object.defineProperty(WebAssembly, key, { value: wrapped });
  };
  const grow = native.Memory.prototype.grow;
  Object.defineProperty(native.Memory.prototype, 'grow', { value(delta) {
    const pages = Number(delta);
    if (this.buffer.byteLength / pageBytes + pages > (memoryLimits.get(this) ?? cap)) fail();
    return grow.call(this, pages);
  } });
  wrapConstructor('Memory', (target, [descriptor], derived) => {
    const initial = Number(descriptor.initial), maximum = descriptor.maximum === undefined ? cap : Number(descriptor.maximum);
    if (initial > cap || maximum > cap) fail();
    if (descriptor.address && descriptor.address !== 'i32') unsupported();
    return Reflect.construct(target, [{ initial, maximum, shared: descriptor.shared }], derived);
  });
  wrapConstructor('Module', (target, [source, options], derived) => {
    const reused = shared(source);
    if (reused) return reused;
    const data = rewrite(source);
    const module = Reflect.construct(target, [data.bytes, options], derived);
    modules.set(module, data);
    return module;
  });
  const instance = (module, imports, derived = WebAssembly.Instance) => {
    const data = modules.get(module);
    if (!data) throw new TypeError('workcell requires a locally checked WebAssembly.Module');
    if (data.tooling) {
      const result = Reflect.construct(native.Instance, [module, imports], derived);
      for (const { name, memory } of data.exportedMemories) memoryLimits.set(result.exports[name], data.limits[memory]);
      guardToolingExports(result, data.flag, fail);
      return result;
    }
    const result = Reflect.construct(native.Instance, [module, imports], derived);
    if (data.flag) {
      const limit = (object, memory) => { if (data.limits[memory] < cap) memoryLimits.set(object, data.limits[memory]); };
      for (const { module: from, name, memory } of data.importedMemories) limit(imports[from][name], memory);
      for (const { name, memory } of data.exportedMemories) limit(result.exports[name], memory);
      const flag = result.exports[data.flag];
      activeFlags.add(flag);
      flags.add(new WeakRef(flag));
    }
    try { if (data.start) result.exports[data.start](); }
    finally { for (const flag of activeFlags) if (flag.value) fail(); }
    return result;
  };
  wrapConstructor('Instance', (target, [module, imports], derived) => instance(module, imports, derived));
  WebAssembly.compile = async (source, options) => {
    const reused = shared(source);
    if (reused) return reused;
    const data = rewrite(source);
    const module = await native.compile(data.bytes, options);
    modules.set(module, data);
    return module;
  };
  WebAssembly.instantiate = async (source, imports, options) => {
    if (source instanceof native.Module) return instance(source, imports);
    const module = await WebAssembly.compile(source, options);
    return { module, instance: instance(module, imports) };
  };
  WebAssembly.compileStreaming = async (source, options) => WebAssembly.compile(await (await source).arrayBuffer(), options);
  WebAssembly.instantiateStreaming = async (source, imports, options) => WebAssembly.instantiate(await (await source).arrayBuffer(), imports, options);
  check.begin = () => {
    check();
    activeFlags.clear();
  };
  check.describe = module => {
    const { bytes, ...data } = modules.get(module);
    return data;
  };
  return check;
}
