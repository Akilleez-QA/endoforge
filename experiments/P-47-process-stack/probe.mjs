const name = process.argv[2];
const nest = (open, close, depth) => open.repeat(depth) + close.repeat(depth);
const deep = depth => { let value = []; for (let i = 0; i < depth; i++) value = [value]; return value; };
const wasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1, 4, 0, 0x10, 0, 0x0b]);
const probes = {
  js: () => { let depth = 0; const down = () => { depth++; down(); }; try { down(); } catch (error) { return { thrown: error.name, depth }; } return {}; },
  'json-parse': () => JSON.parse(nest('[', ']', 20000000)),
  'json-stringify': () => JSON.stringify(deep(5000000)),
  parser: () => new Function(`return ${nest('(', ')', 5000000).replace('()', '(1)')}`),
  wasm: () => new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports.f(),
  clone: () => structuredClone(deep(5000000)),
};
try { console.log(JSON.stringify({ returned: true, ...probes[name]() })); }
catch (error) { console.log(JSON.stringify({ thrown: error.name })); }
