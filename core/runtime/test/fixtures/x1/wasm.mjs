const uleb = value => { const out = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; out.push(byte); } while (value); return out; };
const text = value => { const bytes = [...Buffer.from(value)]; return [...uleb(bytes.length), ...bytes]; };
const vector = items => [...uleb(items.length), ...items.flat()];
const section = (id, bytes) => (bytes.length ? [id, ...uleb(bytes.length), ...bytes] : []);
const valtype = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
export function wasm({ functions = [], imports = [], globals = [], memory, exportMemory = true, start }) {
  const signatures = [...imports, ...functions].map(f => [0x60, ...vector((f.params ?? []).map(p => [valtype[p]])), ...vector((f.results ?? []).map(r => [valtype[r]]))]);
  const exports = functions.flatMap((f, i) => (f.name ? [[...text(f.name), 0, ...uleb(imports.length + i)]] : []));
  if (memory !== undefined && exportMemory) exports.push([...text('memory'), 2, 0]);
  return Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, vector(signatures)),
    ...section(2, imports.length ? vector(imports.map((f, i) => [...text(f.module), ...text(f.field), 0, ...uleb(i)])) : []),
    ...section(3, functions.length ? vector(functions.map((_, i) => uleb(imports.length + i))) : []),
    ...section(5, memory !== undefined ? vector([[1, ...uleb(memory), ...uleb(1024)]]) : []),
    ...section(6, globals.length ? vector(globals.map(init => [0x7f, 1, 0x41, ...uleb(init), 0x0b])) : []),
    ...section(7, exports.length ? vector(exports) : []),
    ...section(8, start === undefined ? [] : uleb(start)),
    ...section(10, functions.length ? vector(functions.map(f => { const body = [...(f.locals ?? [0]), ...f.body, 0x0b]; return [...uleb(body.length), ...body]; })) : []),
  ]);
}
export const add = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x20, 0, 0x20, 1, 0x6a] };
export const spin = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x03, 0x40, 0x0c, 0, 0x0b, 0x41, 0] };
export const recurse = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x20, 0, 0x20, 1, 0x10, 0] };
export const stateful = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x23, 0, 0x20, 0, 0x6a, 0x24, 0, 0x23, 0, 0x20, 1, 0x6a] };
export const grows = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x41, 3, 0x40, 0, 0x1a, 0x20, 0, 0x20, 1, 0x6a] };
export const callsHost = { name: 'add', params: ['i32', 'i32'], results: ['i32'], body: [0x10, 0, 0x20, 0, 0x20, 1, 0x6a] };
