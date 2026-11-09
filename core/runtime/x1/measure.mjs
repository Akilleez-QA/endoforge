import { performance } from 'node:perf_hooks';
import { loadKernel } from './meter.mjs';
export const kernelFuel = 1_000_000_000;
export const signature = { version: 1, name: 'x1.kernel', inputs: [{ path: 'workload', type: 'string', unit: '1' }], output: { type: 'object', unit: '1' } };
export const limits = Object.freeze({ wallMs: 30000, memoryBytes: 64 * 1024 * 1024, fuel: kernelFuel });
export const allowedEffects = Object.freeze(['call:env.abort', 'import:env.abort']);
export const workloads = Object.freeze(['frozen-tests', 'non-finite-probes']);
const encode = value => (Array.isArray(value) ? value.map(encode) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
  : typeof value === 'bigint' ? value.toString() : typeof value !== 'number' ? value : Number.isNaN(value) ? 'NaN' : !Number.isFinite(value) ? String(value) : Object.is(value, -0) ? '-0' : value);
export const floats = new Set(['f32', 'f64']);
const abortSignature = signature => signature && signature.params.length === 4 && signature.params.every(type => type === 'i32') && !signature.results.length;
export const scalarKinds = Object.freeze(['number', 'integer', 'boolean', 'code']);
export const bufferKinds = Object.freeze(['record', 'list', 'text']);
export const maxBufferBytes = 1 << 20;
export const isBuffer = type => bufferKinds.includes(type?.kind);
export const usesBuffers = entry => Boolean(entry && (entry.args?.some(isBuffer) || isBuffer(entry.result)));
export const bufferArity = entry => (entry.args?.length ?? 0) + (isBuffer(entry.result) ? 1 : 0);
export function scalarLeaves(type, name, field) {
  if (!type || typeof type !== 'object') return [];
  if (scalarKinds.includes(type.kind)) return [{ field, name, type }];
  if (type.kind === 'record' && Array.isArray(type.fields)) return type.fields.flatMap(inner => scalarLeaves(inner, inner?.name, `${field}.${inner?.name}`));
  if (type.kind === 'list') return scalarLeaves(type.items, name, `${field}[]`);
  return [];
}
export class LayoutError extends Error {}
const alignUp = (n, a) => Math.ceil(n / a) * a;
export function layoutOf(type) {
  if (!type || typeof type !== 'object') throw new LayoutError('a value has no type');
  let layout;
  if (type.kind === 'integer' || type.kind === 'code' || type.kind === 'boolean') layout = { size: 4, align: 4 };
  else if (type.kind === 'number') layout = { size: 8, align: 8 };
  else if (type.kind === 'text') {
    if (!Number.isInteger(type.maxBytes) || type.maxBytes < 1) throw new LayoutError('text without maxBytes');
    layout = { size: alignUp(4 + type.maxBytes, 4), align: 4 };
  } else if (type.kind === 'list') {
    if (!Number.isInteger(type.max) || type.max < 1) throw new LayoutError('list without max');
    const item = layoutOf(type.items), align = Math.max(4, item.align), start = alignUp(4, item.align), stride = alignUp(item.size, item.align);
    layout = { size: alignUp(start + stride * type.max, align), align, start, stride, item };
  } else if (type.kind === 'record') {
    if (!Array.isArray(type.fields) || !type.fields.length) throw new LayoutError('record without fields');
    if (new Set(type.fields.map(field => field.name)).size !== type.fields.length) throw new LayoutError('record with duplicate field names');
    let cursor = 0, align = 4;
    const fields = type.fields.map(field => {
      const inner = layoutOf(field);
      cursor = alignUp(cursor, inner.align);
      const placed = { name: field.name, offset: cursor, layout: inner };
      cursor += inner.size;
      align = Math.max(align, inner.align);
      return placed;
    });
    layout = { size: alignUp(cursor, align), align, fields };
  } else throw new LayoutError(`kind ${type.kind} has no layout`);
  if (layout.size > maxBufferBytes) throw new LayoutError(`layout of ${layout.size} bytes exceeds ${maxBufferBytes}`);
  return Object.assign(layout, { type });
}
export function layoutTable(type) {
  const rows = [];
  const visit = (layout, path, offset, stride) => {
    const row = (suffix, at, wasm) => rows.push({ path: path + suffix, offset: at, ...(stride.length ? { stride } : {}), type: wasm });
    const { kind } = layout.type;
    if (kind === 'number') row('', offset, 'f64');
    else if (scalarKinds.includes(kind)) row('', offset, 'i32');
    else if (kind === 'text') { row(`${path ? '.' : ''}bytes`, offset, 'u32'); row(`${path ? '.' : ''}utf8`, offset + 4, `u8[${layout.type.maxBytes}]`); }
    else if (kind === 'list') {
      row(`${path ? '.' : ''}count`, offset, 'u32');
      visit(layout.item, `${path}[${'ijklmn'[stride.length] ?? 'x'}]`, offset + layout.start, [...stride, layout.stride]);
    } else for (const field of layout.fields) visit(field.layout, path ? `${path}.${field.name}` : field.name, offset + field.offset, stride);
  };
  visit(layoutOf(type), '', 0, []);
  return rows;
}
const utf8 = new TextDecoder('utf-8', { fatal: true });
function write(layout, value, view, at, path) {
  const { type } = layout;
  if (type.kind === 'integer' || type.kind === 'code') {
    if (!Number.isInteger(value) || value < -(2 ** 31) || value >= 2 ** 31) throw new LayoutError(`${path}: expected a 32-bit integer`);
    view.setInt32(at, value, true);
  } else if (type.kind === 'boolean') {
    if (typeof value !== 'boolean' && value !== 0 && value !== 1) throw new LayoutError(`${path}: expected a boolean`);
    view.setInt32(at, value ? 1 : 0, true);
  } else if (type.kind === 'number') {
    if (typeof value !== 'number') throw new LayoutError(`${path}: expected a number`);
    view.setFloat64(at, value, true);
  } else if (type.kind === 'text') {
    if (typeof value !== 'string') throw new LayoutError(`${path}: expected text`);
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > type.maxBytes) throw new LayoutError(`${path}: text is ${bytes.length} bytes, more than ${type.maxBytes} bytes`);
    view.setUint32(at, bytes.length, true);
    new Uint8Array(view.buffer, at + 4, bytes.length).set(bytes);
  } else if (type.kind === 'list') {
    if (!Array.isArray(value)) throw new LayoutError(`${path}: expected a list`);
    if (value.length > type.max) throw new LayoutError(`${path}: ${value.length} items, more than ${type.max}`);
    view.setUint32(at, value.length, true);
    value.forEach((item, index) => write(layout.item, item, view, at + layout.start + index * layout.stride, `${path}[${index}]`));
  } else {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LayoutError(`${path}: expected a record`);
    const names = new Set(layout.fields.map(field => field.name)), extra = Object.keys(value).filter(key => !names.has(key));
    if (extra.length) throw new LayoutError(`${path}: fields ${extra.join(', ')} are not in the layout`);
    for (const field of layout.fields) {
      if (!Object.hasOwn(value, field.name)) throw new LayoutError(`${path}: missing field ${field.name}`);
      write(field.layout, value[field.name], view, at + field.offset, `${path}.${field.name}`);
    }
  }
}
function read(layout, view, at, path) {
  const { type } = layout;
  if (type.kind === 'integer' || type.kind === 'code') return view.getInt32(at, true);
  if (type.kind === 'number') return view.getFloat64(at, true);
  if (type.kind === 'boolean') {
    const flag = view.getInt32(at, true);
    if (flag !== 0 && flag !== 1) throw new LayoutError(`${path}: boolean holds ${flag}`);
    return flag === 1;
  }
  if (type.kind === 'text') {
    const length = view.getUint32(at, true);
    if (length > type.maxBytes) throw new LayoutError(`${path}: text length ${length} is more than ${type.maxBytes} bytes`);
    try { return utf8.decode(new Uint8Array(view.buffer, at + 4, length)); } catch { throw new LayoutError(`${path}: text is not UTF-8`); }
  }
  if (type.kind === 'list') {
    const count = view.getUint32(at, true);
    if (count > type.max) throw new LayoutError(`${path}: count ${count} is more than ${type.max}`);
    return Array.from({ length: count }, (_, index) => read(layout.item, view, at + layout.start + index * layout.stride, `${path}[${index}]`));
  }
  return Object.fromEntries(layout.fields.map(field => [field.name, read(field.layout, view, at + field.offset, `${path}.${field.name}`)]));
}
const regions = new WeakMap();
function hostRegion(kernel, bytes) {
  const memory = kernel.memory?.();
  if (!memory) throw new LayoutError('the module exports no linear memory for host buffers');
  const held = regions.get(kernel);
  if (held && held.bytes >= bytes && held.base + held.bytes <= memory.buffer.byteLength) return held.base;
  const base = memory.buffer.byteLength, pages = Math.ceil(bytes / 65536);
  try { memory.grow(pages); } catch { throw new LayoutError('no room in linear memory for host buffers'); }
  regions.set(kernel, { base, bytes: pages * 65536 });
  return base;
}
export function invoke(kernel, entry, fn, args) {
  const exported = kernel.instance.exports[fn];
  if (!usesBuffers(entry)) return exported(...args);
  if (!Array.isArray(args) || args.length !== entry.args.length) throw new LayoutError(`${fn} takes ${entry.args.length} arguments`);
  let total = 8;
  const place = type => { const layout = layoutOf(type); total = alignUp(total, 8); const at = total; total += layout.size; return { layout, at }; };
  const inputs = entry.args.map(arg => (isBuffer(arg) ? place(arg) : null)), output = isBuffer(entry.result) ? place(entry.result) : null;
  const base = hostRegion(kernel, total), end = base + (output ? output.at : total);
  let view = new DataView(kernel.memory().buffer);
  new Uint8Array(view.buffer, base, total).fill(0);
  inputs.forEach((slot, index) => slot && write(slot.layout, args[index], view, base + slot.at, `${fn}.${entry.args[index].name}`));
  const snapshot = Buffer.from(new Uint8Array(view.buffer, base, end - base));
  const params = entry.args.map((_, index) => (inputs[index] ? base + inputs[index].at : args[index]));
  if (output) params.push(base + output.at);
  const value = exported(...params);
  view = new DataView(kernel.memory().buffer);
  if (!snapshot.equals(new Uint8Array(view.buffer, base, end - base))) throw new LayoutError(`${fn} wrote into its read-only input buffers`);
  return output ? read(output.layout, view, base + output.at, `${fn} result`) : value;
}
export function bufferEntries(glue) {
  const entries = new Map();
  if (!Array.isArray(glue?.exports)) return entries;
  for (const entry of glue.exports) if (typeof entry?.name === 'string' && Array.isArray(entry.args) && entry.result && typeof entry.result === 'object' && usesBuffers(entry)) entries.set(entry.name, entry);
  return entries;
}
export function parseBufferEntries(text) {
  try { return bufferEntries(JSON.parse(text)); } catch { return new Map(); }
}
const probeLimit = 64;
function numberPaths(type, value) {
  if (type?.kind === 'number') return typeof value === 'number' ? [[]] : [];
  if (type?.kind === 'record' && Array.isArray(type.fields) && value && typeof value === 'object') return type.fields.flatMap(field => numberPaths(field, value[field.name]).map(path => [field.name, ...path]));
  if (type?.kind === 'list' && Array.isArray(value)) return value.flatMap((item, index) => numberPaths(type.items, item).map(path => [index, ...path]));
  return [];
}
const replaced = (value, path, leaf) => {
  if (!path.length) return leaf;
  const copy = structuredClone(value);
  path.slice(0, -1).reduce((node, key) => node[key], copy)[path.at(-1)] = leaf;
  return copy;
};
export function probeCalls(tests, functions, entries = new Map()) {
  const calls = [];
  for (const fn of [...new Set(tests.map(test => test.fn))]) {
    const params = functions[fn]?.params;
    if (!params) continue;
    const base = (tests.find(test => test.fn === fn && !test.expectError) ?? tests.find(test => test.fn === fn)).args;
    const entry = entries.get(fn);
    if (usesBuffers(entry)) {
      if (!Array.isArray(base) || base.length !== entry.args.length) continue;
      const own = [];
      entry.args.forEach((arg, index) => {
        for (const path of numberPaths(arg, base[index])) for (const value of [NaN, Infinity, -Infinity]) own.push({ fn, args: base.map((item, i) => (i === index ? replaced(item, path, value) : item)) });
      });
      calls.push(...own.slice(0, probeLimit));
      continue;
    }
    params.forEach((type, index) => {
      if (floats.has(type)) for (const value of [NaN, Infinity, -Infinity]) calls.push({ fn, args: params.map((_, i) => (i === index ? value : base[i] ?? 0)) });
    });
  }
  return calls;
}
export function callKernel(kernel, fn, args, entry) {
  try { return { value: invoke(kernel, entry, fn, args) }; }
  catch (error) {
    if (error instanceof LayoutError) return { problem: error.message };
    if (kernel.exhausted()) return { limit: 'fuel exhausted' };
    return error instanceof RangeError ? { limit: 'stack exhausted' } : { trap: kernel.aborted() ? 'abort' : 'runtime' };
  }
}
export function freshKernel(loaded) {
  let aborts = false, last = false;
  const kernel = loaded.start(() => { aborts = true; last = true; throw new Error('abort'); });
  return Object.assign(kernel, { aborted: () => { const was = last; last = false; return was; }, aborts: () => aborts });
}
export function measuredPort(find) {
  const loaded = new Map(), rounds = new Map();
  const load = identity => {
    if (!loaded.has(identity)) loaded.set(identity, (() => {
      const candidate = find(identity);
      if (!candidate) return { problem: 'no.candidate' };
      if (typeof candidate.compiled?.wasm !== 'string' || candidate.compiled.error) return { problem: 'no.module' };
      let tests;
      try { tests = JSON.parse(candidate.files['tests.json']); } catch { return { problem: 'invalid.tests' }; }
      if (!Array.isArray(tests) || !tests.length) return { problem: 'invalid.tests' };
      let kernel;
      try { kernel = loadKernel(Buffer.from(candidate.compiled.wasm, 'base64'), kernelFuel); } catch { return { problem: 'invalid.module' }; }
      return { kernel, tests, entries: parseBufferEntries(candidate.files['glue.json']) };
    })());
    return loaded.get(identity);
  };
  const describe = identity => {
    if (find(identity)?.compiled?.unavailable) return { status: 'outcome_unknown' };
    const { problem, kernel, tests, entries } = load(identity);
    const observed = reason => ({ ...signature, name: `x1.refused.${reason}` });
    if (problem) return observed(problem);
    for (const test of tests) {
      const type = kernel.shape.functions[test.fn], entry = entries.get(test.fn);
      if (!type) return observed('missing.export');
      if (entry && type.params.length !== bufferArity(entry)) return observed('arity');
      if (!Array.isArray(test.args) || test.args.length !== (entry ? entry.args.length : type.params.length)) return observed('arity');
    }
    if (kernel.shape.start) try { freshKernel(kernel); } catch { return observed('instantiation'); }
    return signature;
  };
  const run = (identity, cases, limit) => {
    const { problem, kernel, tests, entries } = load(identity);
    if (problem) return { status: `not runnable: ${problem}`, outputs: [], usage: { wallMs: 0, memoryBytes: 0, fuel: 0 }, effects: [] };
    const round = rounds.get(identity) ?? 0;
    rounds.set(identity, round + 1);
    const planned = { 'frozen-tests': tests.map(test => ({ fn: test.fn, args: test.args })), 'non-finite-probes': probeCalls(tests, kernel.shape.functions, entries) };
    const flat = cases.flatMap(({ id }) => (planned[id] ?? []).map((call, index) => ({ ...call, id, index })));
    if (round % 2) flat.reverse();
    const results = Object.fromEntries(cases.map(({ id }) => [id, []]));
    const begin = performance.now();
    let status = 'completed', fresh;
    try { fresh = freshKernel(kernel); } catch { status = 'instantiation failed'; }
    if (fresh) for (const { fn, args, id, index } of flat) {
      const outcome = callKernel(fresh, fn, args, entries.get(fn));
      if (outcome.limit) { status = outcome.limit; break; }
      results[id][index] = { fn, args: args.map(encode), ...(outcome.problem ? { problem: outcome.problem } : outcome.trap ? { trap: outcome.trap } : { value: encode(outcome.value) }) };
    }
    const wallMs = performance.now() - begin;
    if (status === 'completed' && wallMs > limit.wallMs) status = 'outcome_unknown';
    return { status, outputs: cases.map(({ id }) => ({ caseId: id, value: { calls: results[id] } })),
      usage: { wallMs, memoryBytes: fresh?.memoryBytes() ?? 0, fuel: fresh ? Math.max(fresh.used(), 0) : 0 }, effects: fresh?.aborts() ? ['call:env.abort'] : [] };
  };
  const scanEffects = identity => {
    const { problem, kernel } = load(identity);
    if (problem) return [`unscannable:${problem}`];
    const { imports, calls } = kernel.shape;
    return [...new Set([...imports.map(entry => (entry.kind === 0 && entry.module === 'env' && entry.name === 'abort' && abortSignature(entry.signature) ? 'import:env.abort' : `import:${entry.module}.${entry.name}`)),
      ...calls.map(name => `call:${name}`)])].sort();
  };
  return { describe, run, scanEffects };
}
