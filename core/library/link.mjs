import { inspect } from '../runtime/x1/meter.mjs';
export class LinkError extends Error { constructor(reason, detail) { super(detail ?? reason); this.reason = reason; } }
const refuse = (reason, detail) => { throw new LinkError(reason, detail); };
const MAGIC = [0, 97, 115, 109, 1, 0, 0, 0];
const PAGE = 65536, MEMORY_PAGES = 1024, HOST_PAGES = 64, NO_WINDOW = 2 ** 33;
const LOAD_WIDTH = [4, 8, 4, 8, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4], STORE_WIDTH = [4, 8, 4, 8, 1, 2, 1, 2, 4];
const STORE_VALUE = ['i32', 'i64', 'f32', 'f64', 'i32', 'i32', 'i64', 'i64', 'i64'];
const VALUE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
const uleb = value => { const out = []; let n = value; do { const part = n % 128; n = Math.floor(n / 128); out.push(part | (n ? 128 : 0)); } while (n); return out; };
const sleb = value => { const out = []; let n = BigInt(value); for (;;) { const byte = Number(n & 127n); n >>= 7n; if ((n === 0n && !(byte & 64)) || (n === -1n && byte & 64)) { out.push(byte); return out; } out.push(byte | 128); } };
const f64 = value => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return [...out]; };
const f32 = value => { const out = new Uint8Array(4); new DataView(out.buffer).setFloat32(0, value, true); return [...out]; };
const named = text => { const bytes = Buffer.from(text); return [...uleb(bytes.length), ...bytes]; };
const section = (id, content) => [id, ...uleb(content.length), ...content];
const vector = rows => [...uleb(rows.length), ...rows.flat()];
const wide = value => [0x42, ...sleb(value)];
const narrowConst = value => [...wide(value), 0xa7];
const alignUp = (n, a) => Math.ceil(n / a) * a;
const int32 = code => { let n = 0, s = 0, i = 1, b; do { b = code[i++]; n += (b & 127) * 2 ** s; s += 7; } while (b & 128); if (b & 64) n -= 2 ** s; return n >>> 0; };
class Cursor {
  constructor(bytes, at = 0, end = bytes.length) { this.bytes = bytes; this.at = at; this.end = end; }
  byte() { if (this.at >= this.end) refuse('malformed_module', 'truncated'); return this.bytes[this.at++]; }
  uint() { let n = 0, s = 0, b; do { b = this.byte(); n += (b & 127) * 2 ** s; s += 7; } while (b & 128); return n; }
  leb() { const start = this.at; while (this.byte() & 128); return [...this.bytes.subarray(start, this.at)]; }
  take(count) { const out = [...this.bytes.subarray(this.at, this.at + count)]; this.at += count; return out; }
}
function constant(r, allowed = new Set([0x41, 0x42, 0x43, 0x44])) {
  const start = r.at, op = r.byte();
  if (!allowed.has(op)) refuse('initializer_unsupported', `initializer opcode ${op}`);
  if (op === 0x41 || op === 0x42) r.leb(); else r.at += op === 0x43 ? 4 : 8;
  if (r.byte() !== 0x0b) refuse('initializer_unsupported', 'multi-instruction initializer');
  return [...r.bytes.subarray(start, r.at)];
}
function parse(bytes) {
  if (bytes.length < 8) refuse('malformed_module', 'truncated');
  const module = { bytes, types: [], abort: null, functions: [], tables: [], memories: [], limits: [], globals: [], exports: new Map(), start: null, elements: [], data: [], dataCount: null, bodies: [] };
  const top = new Cursor(bytes, 8);
  while (top.at < bytes.length) {
    const id = top.byte(), size = top.uint(), r = new Cursor(bytes, top.at, top.at + size);
    top.at += size;
    if (id === 0) continue;
    if (id === 12) { module.dataCount = r.uint(); continue; }
    if (id === 8) { module.start = r.uint(); continue; }
    const count = r.uint();
    for (let n = 0; n < count; n++) {
      if (id === 1) {
        const start = r.at;
        if (r.byte() !== 0x60) refuse('malformed_module', 'unknown type form');
        for (let side = 0; side < 2; side++) { const length = r.uint(); r.at += length; }
        module.types.push([...bytes.subarray(start, r.at)]);
      } else if (id === 2) {
        const text = () => Buffer.from(r.take(r.uint())).toString();
        const from = text(), name = text(), kind = r.byte();
        if (kind !== 0 || from !== 'env' || name !== 'abort' || module.abort !== null) refuse('import_unsupported', `${from}.${name}`);
        module.abort = r.uint();
      } else if (id === 3) module.functions.push(r.uint());
      else if (id === 4) { const start = r.at; r.byte(); if (r.uint() & 1) r.uint(); r.uint(); module.tables.push([...bytes.subarray(start, r.at)]); }
      else if (id === 5) { const start = r.at, flags = r.uint(), initial = r.uint(), maximum = flags & 1 ? r.uint() : null; module.memories.push([...bytes.subarray(start, r.at)]); module.limits.push({ initial, maximum }); }
      else if (id === 6) { const head = r.take(2); module.globals.push([...head, ...constant(r)]); }
      else if (id === 7) { const name = Buffer.from(r.take(r.uint())).toString(), kind = r.byte(), index = r.uint(); module.exports.set(name, { kind, index }); }
      else if (id === 9) {
        if (r.uint() !== 0) refuse('element_unsupported', 'only active table-0 function segments compose');
        const offset = constant(r, new Set([0x41])), functions = Array.from({ length: r.uint() }, () => r.uint());
        module.elements.push({ offset, functions });
      } else if (id === 10) { const length = r.uint(); module.bodies.push({ at: r.at, end: r.at + length }); r.at += length; }
      else if (id === 11) {
        const flag = r.uint();
        if (flag === 2) refuse('data_unsupported', 'explicit memory index');
        const offset = flag === 0 ? constant(r, new Set([0x41])) : [], length = r.uint();
        const payload = r.take(length);
        module.data.push({ raw: [...uleb(flag), ...offset, ...uleb(length), ...payload], at: flag === 0 ? int32(offset) : null, length, payload });
      } else refuse('malformed_module', `section ${id}`);
    }
  }
  return module;
}
function rewrite(module, body, map, params) {
  const r = new Cursor(module.bytes, body.at, body.end), out = [];
  const usage = { memory: false, table: false, grow: false };
  const copy = () => out.push(...r.leb());
  const groups = r.uint(), guard = map.guard;
  let declared = 0;
  out.push(...uleb(groups + (guard ? 4 : 0)));
  for (let n = 0; n < groups; n++) { const raw = r.leb(); declared += new Cursor(raw).uint(); out.push(...raw, r.byte()); }
  if (guard) out.push(2, VALUE.i32, 1, VALUE.i64, 1, VALUE.f32, 1, VALUE.f64);
  const first = params + declared, temp = { i32: first, b: first + 1, i64: first + 2, f32: first + 3, f64: first + 4 };
  const set = local => [0x21, ...uleb(local)], get = local => [0x20, ...uleb(local)], check = [0x10, ...uleb(guard?.check ?? 0)];
  const memarg = op => {
    const raw = r.leb(), rawOffset = r.leb(), flags = new Cursor(raw).uint(), offset = new Cursor(rawOffset).uint();
    if (flags & 0x40) refuse('memory_conflict', 'a part addresses more than one memory');
    return { tail: [op, ...raw, ...rawOffset], offset };
  };
  while (r.at < r.end) {
    const op = r.byte();
    out.push(op);
    if (op === 0x02 || op === 0x03 || op === 0x04) {
      const peek = r.bytes[r.at];
      if ((peek & 0xc0) === 0x40) out.push(r.byte());
      else out.push(...sleb(map.type(r.uint())));
    } else if (op === 0x0c || op === 0x0d || (op >= 0x20 && op <= 0x22)) copy();
    else if (op === 0x23 || op === 0x24) out.push(...uleb(map.global(r.uint())));
    else if (op === 0x10) out.push(...uleb(map.func(r.uint())));
    else if (op === 0x11) { usage.table = true; out.push(...uleb(map.type(r.uint())), ...uleb(map.table(r.uint()))); }
    else if (op === 0x0e) { const n = r.uint(); out.push(...uleb(n)); for (let i = 0; i <= n; i++) copy(); }
    else if (op === 0x1c) { const n = r.uint(); out.push(...uleb(n)); out.push(...r.take(n)); }
    else if (op === 0x25 || op === 0x26) { usage.table = true; out.push(...uleb(map.table(r.uint()))); }
    else if (op >= 0x28 && op <= 0x3e) {
      usage.memory = true;
      if (!guard) { copy(); copy(); continue; }
      const access = memarg(op);
      out.pop();
      if (op <= 0x35) out.push(...wide(access.offset + LOAD_WIDTH[op - 0x28]), ...check, ...access.tail);
      else { const local = temp[STORE_VALUE[op - 0x36]]; out.push(...set(local), ...wide(access.offset + STORE_WIDTH[op - 0x36]), ...check, ...get(local), ...access.tail); }
    } else if (op === 0x3f || op === 0x40) {
      usage.memory = true;
      if (op === 0x40) usage.grow = true;
      const index = r.byte();
      if (!guard) { out.push(index); continue; }
      out.pop();
      if (op === 0x3f) out.push(0x23, ...uleb(guard.limit), ...wide(16), 0x88, 0xa7);
      else out.push(0x10, ...uleb(guard.grow));
    }
    else if (op === 0x41 || op === 0x42) copy();
    else if (op === 0x43) out.push(...r.take(4));
    else if (op === 0x44) out.push(...r.take(8));
    else if (op === 0xd0) out.push(r.byte());
    else if (op === 0xd2) out.push(...uleb(map.func(r.uint())));
    else if (op === 0xfc) {
      const sub = r.uint();
      out.push(...uleb(sub));
      if (sub <= 7) continue;
      if (sub >= 8 && sub <= 11) usage.memory = true; else if (sub >= 12 && sub <= 17) usage.table = true; else refuse('opcode_unsupported', `0xfc ${sub}`);
      if (sub === 9) { out.push(...uleb(map.data(r.uint()))); continue; }
      if (sub === 12) { out.push(...uleb(map.element(r.uint())), ...uleb(map.table(r.uint()))); continue; }
      if (sub === 13) { out.push(...uleb(map.element(r.uint()))); continue; }
      if (sub === 14) { out.push(...uleb(map.table(r.uint())), ...uleb(map.table(r.uint()))); continue; }
      if (sub >= 15) { out.push(...uleb(map.table(r.uint()))); continue; }
      if (!guard) {
        if (sub === 8) { out.push(...uleb(map.data(r.uint()))); copy(); }
        else for (let i = 0; i < { 10: 2, 11: 1 }[sub]; i++) copy();
        continue;
      }
      out.length -= 1 + uleb(sub).length;
      const size = [...get(temp.i32), 0xad], span = [...size, ...check];
      if (sub === 8) { const segment = map.data(r.uint()); r.leb(); out.push(...set(temp.i32), ...set(temp.b), ...span, ...get(temp.b), ...get(temp.i32), 0xfc, ...uleb(8), ...uleb(segment), 0); }
      else if (sub === 10) { r.leb(); r.leb(); out.push(...set(temp.i32), ...set(temp.b), ...span, ...get(temp.b), ...span, ...get(temp.i32), 0xfc, ...uleb(10), 0, 0); }
      else { r.leb(); out.push(...set(temp.i32), ...set(temp.b), ...span, ...get(temp.b), ...get(temp.i32), 0xfc, ...uleb(11), 0); }
    } else if (op > 0xc4 && op !== 0xd1 || (op >= 0x06 && op <= 0x0a) || op === 0x12 || op === 0x13 || op === 0x18 || op === 0x19) refuse('opcode_unsupported', `opcode ${op}`);
  }
  return { code: out, usage };
}
const CONVERT = {
  'i32>i64': [0xac], 'i32>f32': [0xb2], 'i32>f64': [0xb7], 'i64>f32': [0xb4], 'i64>f64': [0xb9], 'f32>f64': [0xbb],
};
const NARROW = {
  'i64>i32': { trunc: [0xa7], nearest: [0xa7] }, 'f64>f32': { trunc: [0xb6], nearest: [0xb6] },
  'f64>i32': { trunc: [0xaa], nearest: [0x9e, 0xaa] }, 'f64>i64': { trunc: [0xb0], nearest: [0x9e, 0xb0] },
  'f32>i32': { trunc: [0xa8], nearest: [0x90, 0xa8] }, 'f32>i64': { trunc: [0xae], nearest: [0x90, 0xae] },
};
function converted(from, to, narrow) {
  if (from === to) return [];
  const pair = `${from}>${to}`;
  if (CONVERT[pair]) return CONVERT[pair];
  if (!NARROW[pair]) refuse('adapter_narrowing', pair);
  if (!NARROW[pair][narrow]) refuse('adapter_narrowing', `${pair} needs narrow: trunc or nearest`);
  return NARROW[pair][narrow];
}
const typedConstant = (type, value) => {
  if (!Number.isFinite(value)) refuse('adapter_constant', String(value));
  if ((type === 'i32' || type === 'i64') && !Number.isInteger(value)) refuse('adapter_constant', `${value} is not a ${type}`);
  return type === 'i32' ? [0x41, ...sleb(value)] : type === 'i64' ? [0x42, ...sleb(value)] : type === 'f32' ? [0x43, ...f32(value)] : [0x44, ...f64(value)];
};
function adapted(type, wanted, adapter) {
  const { scale, offset, narrow } = adapter, linear = scale !== undefined || offset !== undefined;
  if (!linear) return converted(type, wanted, narrow);
  const code = [...converted(type, 'f64')];
  if (scale !== undefined) { if (!Number.isFinite(scale)) refuse('adapter_constant', String(scale)); code.push(0x44, ...f64(scale), 0xa2); }
  if (offset !== undefined) { if (!Number.isFinite(offset)) refuse('adapter_constant', String(offset)); code.push(0x44, ...f64(offset), 0xa0); }
  return [...code, ...converted('f64', wanted, narrow)];
}
export function signatureOf(bytes, fn) {
  const shape = inspect(bytes).functions[fn];
  if (!shape) refuse('unknown_export', fn);
  if (shape.results.length !== 1) refuse('adapter_arity', `${fn} returns ${shape.results.length} values`);
  return shape;
}
function wrapper(spec, parts, resolved, placeOf) {
  const params = spec.params.length, inputs = params - (spec.bufferResult === undefined ? 0 : 1), locals = [], code = [];
  const local = index => [0x20, ...uleb(index)];
  let previous = null, previousType = null, previousBuffer = null;
  spec.stages.forEach((stage, index) => {
    const shape = inspect(parts[stage.part]).functions[stage.fn], buffers = stage.buffers ?? { args: [], out: null };
    if (!shape) refuse('unknown_export', stage.fn);
    if (shape.results.length > 1 || (!shape.results.length && buffers.out === null)) refuse('adapter_arity', `${stage.fn} returns ${shape.results.length} values`);
    const arity = shape.params.length - (buffers.out === null ? 0 : 1);
    if (stage.args.length !== arity) refuse('adapter_arity', `${stage.fn} takes ${arity} arguments, the plan gives ${stage.args.length}`);
    const place = stage.buffers ? placeOf(stage.part) : null;
    stage.args.forEach((arg, position) => {
      const size = buffers.args[position] ?? null;
      if (size === null) return;
      const physical = place.window + stage.slots.args[position];
      if (arg.previous === true) {
        if (index === 0 || !previousBuffer || previousBuffer.size !== size) refuse('adapter_arity', `${stage.fn} takes a ${size}-byte buffer the previous stage does not produce`);
        code.push(...narrowConst(physical), ...narrowConst(previousBuffer.at));
      } else {
        if (!Number.isInteger(arg.input) || arg.input < 0 || arg.input >= inputs) refuse('adapter_arity', `input ${arg.input}`);
        code.push(...narrowConst(physical), ...local(arg.input));
      }
      code.push(...narrowConst(size), 0xfc, 10, 0, 0);
    });
    if (buffers.out !== null) code.push(...narrowConst(place.window + stage.slots.out), ...narrowConst(0), ...narrowConst(buffers.out), 0xfc, 11, 0);
    stage.args.forEach((arg, position) => {
      const wanted = shape.params[position];
      if ((buffers.args[position] ?? null) !== null) code.push(...narrowConst(place.virtual + stage.slots.args[position]));
      else if (arg.const !== undefined) code.push(...typedConstant(wanted, arg.const));
      else if (arg.previous === true) {
        if (index === 0 || previous === null) refuse('adapter_arity', 'the first stage has no previous output');
        code.push(...local(previous), ...adapted(previousType, wanted, arg));
      } else {
        if (!Number.isInteger(arg.input) || arg.input < 0 || arg.input >= inputs) refuse('adapter_arity', `input ${arg.input}`);
        code.push(...local(arg.input), ...adapted(spec.params[arg.input], wanted, arg));
      }
    });
    if (buffers.out !== null) code.push(...narrowConst(place.virtual + stage.slots.out));
    code.push(0x10, ...uleb(resolved(stage.part, stage.fn)));
    if (buffers.out !== null) {
      if (shape.results.length) code.push(0x1a);
      previous = null; previousType = null;
      previousBuffer = { at: place.window + stage.slots.out, size: buffers.out };
      return;
    }
    previous = params + locals.length;
    previousType = shape.results[0];
    previousBuffer = null;
    locals.push(previousType);
    code.push(0x21, ...uleb(previous));
  });
  if (spec.bufferResult !== undefined) {
    if (!previousBuffer || previousBuffer.size !== spec.bufferResult) refuse('adapter_arity', 'the last stage does not produce the declared buffer');
    code.push(...local(params - 1), ...narrowConst(previousBuffer.at), ...narrowConst(spec.bufferResult), 0xfc, 10, 0, 0, 0x0b);
  } else {
    if (previous === null) refuse('adapter_arity', 'the last stage produces no scalar result');
    code.push(...local(previous), ...adapted(previousType, spec.result, spec.output ?? {}), 0x0b);
  }
  return { locals: [...uleb(locals.length), ...locals.flatMap(type => [1, VALUE[type]])], code };
}
function exportAsWrapper(item, parts) {
  const shape = inspect(parts[item.part]).functions[item.fn];
  if (!shape) refuse('unknown_export', item.fn);
  const hasOut = item.buffers.out !== null, arity = shape.params.length - (hasOut ? 1 : 0);
  return { name: item.name, params: shape.params, ...(hasOut ? { bufferResult: item.buffers.out } : { result: shape.results[0] }),
    stages: [{ part: item.part, fn: item.fn, buffers: item.buffers, args: Array.from({ length: arity }, (_, input) => ({ input })) }] };
}
function reserveSlots(wrappers) {
  const exchange = new Map();
  for (const spec of wrappers) {
    const cursor = new Map();
    const take = (part, size) => { const at = alignUp(cursor.get(part) ?? 0, 8); cursor.set(part, at + size); return at; };
    for (const stage of spec.stages) {
      if (!stage.buffers) continue;
      stage.slots = { args: stage.args.map((_, position) => (stage.buffers.args[position] ?? null) === null ? null : take(stage.part, stage.buffers.args[position])), out: stage.buffers.out === null ? null : take(stage.part, stage.buffers.out) };
    }
    for (const [part, bytes] of cursor) exchange.set(part, Math.max(exchange.get(part) ?? 0, bytes));
  }
  return exchange;
}
function planRegions(modules, compiled, members, exchange) {
  const windows = members.map(i => Math.ceil((exchange.get(i) ?? 0) / PAGE));
  const share = Math.floor((MEMORY_PAGES - HOST_PAGES - windows.reduce((sum, pages) => sum + pages, 0)) / members.length);
  let cursor = 0;
  return new Map(members.map((part, k) => {
    const limits = modules[part].limits;
    if (limits.length > 1) refuse('memory_conflict', 'a part declares more than one memory');
    const initial = limits[0]?.initial ?? 0, grows = compiled[part].some(body => body.usage.grow);
    if (initial > share) refuse('memory_conflict', `a part needs ${initial} pages, its share is ${share}`);
    const reserved = grows ? Math.max(initial, Math.min(limits[0].maximum ?? share, share)) : initial;
    const base = cursor * PAGE, reservedBytes = reserved * PAGE;
    cursor += reserved + windows[k];
    return [part, { base, initial: initial * PAGE, reservedBytes, virtual: reservedBytes, window: base + reservedBytes, exchange: exchange.get(part) ?? 0, end: cursor * PAGE }];
  }));
}
const regionGlobals = ({ base, initial, reservedBytes, exchange }) => {
  const row = (mutable, value) => [VALUE.i64, mutable, ...wide(value), 0x0b];
  return [row(0, base), row(1, initial), row(0, exchange ? reservedBytes : NO_WINDOW), row(0, exchange ? reservedBytes + exchange : 0)];
};
function regionHelpers(at, reservedBytes) {
  const G = offset => [0x23, ...uleb(at + offset)];
  const address = [0x20, 0, 0xad], ending = [...address, 0x20, 1, 0x7c];
  const check = [0, ...ending, ...G(1), 0x56, 0x04, 0x40, ...address, ...G(2), 0x54, 0x04, 0x40, 0x00, 0x0b, ...ending, ...G(3), 0x56, 0x04, 0x40, 0x00, 0x0b, 0x0b, ...address, ...G(0), 0x7c, 0xa7, 0x0b];
  const grown = [0x20, 0, 0xad, ...wide(16), 0x86, ...G(1), 0x7c];
  const grow = [0, ...grown, ...wide(reservedBytes), 0x56, 0x04, 0x7f, ...wide(-1), 0xa7, 0x05, ...G(1), ...wide(16), 0x88, 0xa7, ...grown, 0x24, ...uleb(at + 1), 0x0b, 0x0b];
  return { check, grow };
}
export function link(buffers, { exports = [], wrappers = [] } = {}) {
  const parts = buffers.map(buffer => Uint8Array.from(buffer));
  const modules = parts.map(parse);
  const types = [], abortRaw = modules.filter(m => m.abort !== null).map(m => Buffer.from(m.types[m.abort]).toString('hex'));
  if (new Set(abortRaw).size > 1) refuse('import_unsupported', 'parts disagree on env.abort');
  const abortIndex = modules.findIndex(m => m.abort !== null), hasAbort = abortIndex >= 0;
  const importedFunctions = hasAbort ? 1 : 0;
  let typeBase = 0, functionBase = importedFunctions, globalBase = 0;
  const offsets = modules.map(module => {
    const at = { type: typeBase, function: functionBase, global: globalBase };
    types.push(...module.types);
    typeBase += module.types.length; functionBase += module.functions.length; globalBase += module.globals.length;
    return at;
  });
  const assigned = { table: modules.map(() => 0), element: modules.map(() => 0), data: modules.map(() => 0), guard: modules.map(() => null) };
  const mapFor = i => {
    const local = modules[i].abort !== null ? 1 : 0;
    return { type: t => offsets[i].type + t, global: g => offsets[i].global + g, func: f => (local && f === 0 ? 0 : offsets[i].function + f - local),
      table: t => assigned.table[i] + t, element: e => assigned.element[i] + e, data: d => assigned.data[i] + d, guard: assigned.guard[i] };
  };
  const paramsOf = (module, n) => new Cursor(Uint8Array.from(module.types[module.functions[n]]), 1).uint();
  const compile = () => modules.map((module, i) => module.bodies.map((body, n) => rewrite(module, body, mapFor(i), paramsOf(module, n))));
  let compiled = compile();
  const memoryUsers = modules.map((module, i) => i).filter(i => compiled[i].some(body => body.usage.memory));
  const tableUsers = modules.map((module, i) => i).filter(i => modules[i].elements.length || compiled[i].some(body => body.usage.table));
  const separate = memoryUsers.length > 1 || wrappers.some(spec => spec.stages.some(stage => stage.buffers));
  const plainExports = separate ? exports.filter(item => !item.buffers) : exports;
  const allWrappers = separate ? [...wrappers, ...exports.filter(item => item.buffers).map(item => exportAsWrapper(item, parts))] : wrappers;
  const exchange = separate ? reserveSlots(allWrappers) : new Map();
  const members = separate ? [...new Set([...memoryUsers, ...exchange.keys()])].sort((a, b) => a - b) : [];
  const regions = separate ? planRegions(modules, compiled, members, exchange) : new Map();
  const partFunctions = modules.reduce((sum, module) => sum + module.functions.length, 0);
  members.forEach((part, k) => { assigned.guard[part] = { check: importedFunctions + partFunctions + 2 * k, grow: importedFunctions + partFunctions + 2 * k + 1, limit: globalBase + 4 * k + 1 }; });
  let tablesSoFar = 0, elementsSoFar = 0, dataSoFar = 0;
  for (const part of tableUsers) { assigned.table[part] = tablesSoFar; assigned.element[part] = elementsSoFar; tablesSoFar += modules[part].tables.length; elementsSoFar += modules[part].elements.length; }
  for (const part of members) { assigned.data[part] = dataSoFar; dataSoFar += modules[part].data.length; }
  if (separate || tableUsers.length > 1) compiled = compile();
  const resolved = (part, fn) => {
    const target = modules[part].exports.get(fn);
    if (!target || target.kind !== 0) refuse('unknown_export', fn);
    return mapFor(part).func(target.index);
  };
  const functionTypes = modules.flatMap((module, i) => module.functions.map(t => offsets[i].type + t));
  const bodies = compiled.flatMap(list => list.map(body => body.code));
  const exported = [];
  const taken = new Set();
  const publish = (name, index) => { if (taken.has(name)) refuse('plan_mismatch', `duplicate export ${name}`); taken.add(name); exported.push([...named(name), 0, ...uleb(index)]); };
  for (const { name, part, fn } of plainExports) publish(name, resolved(part, fn));
  if (separate) {
    const checkType = types.length, growType = checkType + 1;
    types.push([0x60, 2, VALUE.i32, VALUE.i64, 1, VALUE.i32], [0x60, 1, VALUE.i32, 1, VALUE.i32]);
    members.forEach((part, k) => {
      const { check, grow } = regionHelpers(globalBase + 4 * k, regions.get(part).reservedBytes);
      functionTypes.push(checkType, growType);
      bodies.push(check, grow);
    });
  }
  for (const spec of allWrappers) {
    const { locals, code } = wrapper(spec, parts, resolved, part => regions.get(part));
    const raw = [0x60, ...uleb(spec.params.length), ...spec.params.map(type => VALUE[type]), ...(spec.bufferResult !== undefined ? [0] : [1, VALUE[spec.result]])];
    types.push(raw);
    functionTypes.push(types.length - 1);
    bodies.push([...locals, ...code]);
    publish(spec.name, importedFunctions + functionTypes.length - 1);
  }
  const starts = modules.map((module, i) => module.start === null ? null : mapFor(i).func(module.start)).filter(index => index !== null);
  let start = null;
  if (starts.length) {
    types.push([0x60, 0, 0]);
    functionTypes.push(types.length - 1);
    bodies.push([0, ...starts.flatMap(index => [0x10, ...uleb(index)]), 0x0b]);
    start = importedFunctions + functionTypes.length - 1;
  }
  const memoryPart = memoryUsers[0];
  const out = [...MAGIC, ...section(1, vector(types))];
  if (hasAbort) out.push(...section(2, vector([[...named('env'), ...named('abort'), 0, ...uleb(offsets[abortIndex].type + modules[abortIndex].abort)]])));
  out.push(...section(3, vector(functionTypes.map(uleb))));
  const tables = tableUsers.flatMap(part => modules[part].tables);
  if (tables.length) out.push(...section(4, vector(tables)));
  const totalPages = Math.ceil([...regions.values()].reduce((end, region) => Math.max(end, region.end), 0) / PAGE);
  if (separate) out.push(...section(5, vector([[1, ...uleb(totalPages), ...uleb(totalPages + HOST_PAGES)]])));
  else if (memoryPart !== undefined && modules[memoryPart].memories.length) out.push(...section(5, vector(modules[memoryPart].memories)));
  const globals = [...modules.flatMap(module => module.globals), ...members.flatMap(part => regionGlobals(regions.get(part)))];
  if (globals.length) out.push(...section(6, vector(globals)));
  out.push(...section(7, vector(exported)));
  if (start !== null) out.push(...section(8, uleb(start)));
  const elements = tableUsers.flatMap(part => { const map = mapFor(part); return modules[part].elements.map(({ offset, functions }) => { const list = [...uleb(functions.length), ...functions.flatMap(f => uleb(map.func(f)))], table = map.table(0); return table === 0 ? [0, ...offset, ...list] : [2, ...uleb(table), ...offset, 0, ...list]; }); });
  if (elements.length) out.push(...section(9, vector(elements)));
  const memberData = part => modules[part].data.map(segment => {
    if (segment.at === null) return segment.raw;
    const region = regions.get(part);
    if (segment.at + segment.length > region.initial) refuse('data_unsupported', 'a data segment reaches past its memory');
    return [0, 0x41, ...sleb(segment.at + region.base), 0x0b, ...uleb(segment.length), ...segment.payload];
  });
  const data = separate ? members.flatMap(memberData) : memoryPart !== undefined ? modules[memoryPart].data.map(segment => segment.raw) : [];
  if (separate) { if (members.some(part => modules[part].dataCount !== null)) out.push(...section(12, uleb(data.length))); }
  else if (memoryPart !== undefined && modules[memoryPart].dataCount !== null) out.push(...section(12, uleb(modules[memoryPart].dataCount)));
  out.push(...section(10, vector(bodies.map(body => [...uleb(body.length), ...body]))));
  if (data.length) out.push(...section(11, vector(data)));
  const bytes = Uint8Array.from(out);
  try { new WebAssembly.Module(bytes); } catch (error) { refuse('link_invalid', error.message); }
  return bytes;
}
