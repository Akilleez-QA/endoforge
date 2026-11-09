import { inspect } from '../runtime/x1/meter.mjs';
export class LinkError extends Error { constructor(reason, detail) { super(detail ?? reason); this.reason = reason; } }
const refuse = (reason, detail) => { throw new LinkError(reason, detail); };
const MAGIC = [0, 97, 115, 109, 1, 0, 0, 0];
const VALUE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
const uleb = value => { const out = []; let n = value; do { const part = n % 128; n = Math.floor(n / 128); out.push(part | (n ? 128 : 0)); } while (n); return out; };
const sleb = value => { const out = []; let n = BigInt(value); for (;;) { const byte = Number(n & 127n); n >>= 7n; if ((n === 0n && !(byte & 64)) || (n === -1n && byte & 64)) { out.push(byte); return out; } out.push(byte | 128); } };
const f64 = value => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return [...out]; };
const f32 = value => { const out = new Uint8Array(4); new DataView(out.buffer).setFloat32(0, value, true); return [...out]; };
const named = text => { const bytes = Buffer.from(text); return [...uleb(bytes.length), ...bytes]; };
const section = (id, content) => [id, ...uleb(content.length), ...content];
const vector = rows => [...uleb(rows.length), ...rows.flat()];
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
  const module = { bytes, types: [], abort: null, functions: [], tables: [], memories: [], globals: [], exports: new Map(), start: null, elements: [], data: [], dataCount: null, bodies: [] };
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
      else if (id === 5) { const start = r.at; if (r.uint() & 1) r.uint(); r.uint(); module.memories.push([...bytes.subarray(start, r.at)]); }
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
        module.data.push([...uleb(flag), ...offset, ...uleb(length), ...r.take(length)]);
      } else refuse('malformed_module', `section ${id}`);
    }
  }
  return module;
}
function rewrite(module, body, map) {
  const r = new Cursor(module.bytes, body.at, body.end), out = [];
  const usage = { memory: false, table: false };
  const copy = () => out.push(...r.leb());
  const locals = r.uint();
  out.push(...uleb(locals));
  for (let n = 0; n < locals; n++) { copy(); out.push(r.byte()); }
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
    else if (op === 0x11) { usage.table = true; out.push(...uleb(map.type(r.uint()))); copy(); }
    else if (op === 0x0e) { const n = r.uint(); out.push(...uleb(n)); for (let i = 0; i <= n; i++) copy(); }
    else if (op === 0x1c) { const n = r.uint(); out.push(...uleb(n)); out.push(...r.take(n)); }
    else if (op === 0x25 || op === 0x26) { usage.table = true; copy(); }
    else if (op >= 0x28 && op <= 0x3e) { usage.memory = true; copy(); copy(); }
    else if (op === 0x3f || op === 0x40) { usage.memory = true; out.push(r.byte()); }
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
      const counts = { 8: 2, 9: 1, 10: 2, 11: 1, 12: 2, 13: 1, 14: 2, 15: 1, 16: 1, 17: 1 };
      for (let i = 0; i < counts[sub]; i++) copy();
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
function wrapper(spec, parts, resolved) {
  const params = spec.params.length, locals = [];
  const code = [];
  let previous = null, previousType = null;
  spec.stages.forEach((stage, index) => {
    const shape = signatureOf(parts[stage.part], stage.fn);
    if (stage.args.length !== shape.params.length) refuse('adapter_arity', `${stage.fn} takes ${shape.params.length} arguments, the plan gives ${stage.args.length}`);
    stage.args.forEach((arg, position) => {
      const wanted = shape.params[position];
      if (arg.const !== undefined) code.push(...typedConstant(wanted, arg.const));
      else if (arg.previous === true) {
        if (index === 0) refuse('adapter_arity', 'the first stage has no previous output');
        code.push(0x20, ...uleb(previous), ...adapted(previousType, wanted, arg));
      } else {
        if (!Number.isInteger(arg.input) || arg.input < 0 || arg.input >= params) refuse('adapter_arity', `input ${arg.input}`);
        code.push(0x20, ...uleb(arg.input), ...adapted(spec.params[arg.input], wanted, arg));
      }
    });
    code.push(0x10, ...uleb(resolved(stage.part, stage.fn)));
    previous = params + index;
    previousType = shape.results[0];
    locals.push(previousType);
    code.push(0x21, ...uleb(previous));
  });
  code.push(0x20, ...uleb(previous), ...adapted(previousType, spec.result, spec.output ?? {}), 0x0b);
  return { locals: [...uleb(locals.length), ...locals.flatMap(type => [1, VALUE[type]])], code };
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
  const mapFor = i => {
    const local = modules[i].abort !== null ? 1 : 0;
    return { type: t => offsets[i].type + t, global: g => offsets[i].global + g, func: f => (local && f === 0 ? 0 : offsets[i].function + f - local) };
  };
  const compiled = modules.map((module, i) => module.bodies.map(body => rewrite(module, body, mapFor(i))));
  const memoryUsers = modules.map((module, i) => i).filter(i => compiled[i].some(body => body.usage.memory));
  const tableUsers = modules.map((module, i) => i).filter(i => modules[i].elements.length || compiled[i].some(body => body.usage.table));
  if (memoryUsers.length > 1) refuse('memory_conflict', `${memoryUsers.length} parts read or write linear memory`);
  if (tableUsers.length > 1) refuse('table_conflict', `${tableUsers.length} parts use a table`);
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
  for (const { name, part, fn } of exports) publish(name, resolved(part, fn));
  for (const spec of wrappers) {
    const { locals, code } = wrapper(spec, parts, resolved);
    const raw = [0x60, ...uleb(spec.params.length), ...spec.params.map(type => VALUE[type]), 1, VALUE[spec.result]];
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
  const memoryPart = memoryUsers[0], tablePart = tableUsers[0];
  const out = [...MAGIC, ...section(1, vector(types))];
  if (hasAbort) out.push(...section(2, vector([[...named('env'), ...named('abort'), 0, ...uleb(offsets[abortIndex].type + modules[abortIndex].abort)]])));
  out.push(...section(3, vector(functionTypes.map(uleb))));
  if (tablePart !== undefined && modules[tablePart].tables.length) out.push(...section(4, vector(modules[tablePart].tables)));
  if (memoryPart !== undefined && modules[memoryPart].memories.length) out.push(...section(5, vector(modules[memoryPart].memories)));
  const globals = modules.flatMap(module => module.globals);
  if (globals.length) out.push(...section(6, vector(globals)));
  out.push(...section(7, vector(exported)));
  if (start !== null) out.push(...section(8, uleb(start)));
  if (tablePart !== undefined && modules[tablePart].elements.length) {
    const map = mapFor(tablePart);
    out.push(...section(9, vector(modules[tablePart].elements.map(({ offset, functions }) => [0, ...offset, ...uleb(functions.length), ...functions.flatMap(f => uleb(map.func(f)))]))));
  }
  const data = memoryPart !== undefined ? modules[memoryPart].data : [];
  if (memoryPart !== undefined && modules[memoryPart].dataCount !== null) out.push(...section(12, uleb(modules[memoryPart].dataCount)));
  out.push(...section(10, vector(bodies.map(body => [...uleb(body.length), ...body]))));
  if (data.length) out.push(...section(11, vector(data)));
  const bytes = Uint8Array.from(out);
  try { new WebAssembly.Module(bytes); } catch (error) { refuse('link_invalid', error.message); }
  return bytes;
}
