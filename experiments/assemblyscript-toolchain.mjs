import { pathToFileURL } from 'node:url';

export const trustedWasmModules = Object.freeze([Object.freeze({
  name: 'assemblyscript-0.28.20-f64-pow',
  sha256: '24982099e4fafe2b0779b0d4cb7a78b8264ebd3890e3c8d75b6d54a3e333e189',
  maximumPages: 16,
})]);

let compiler;
export async function loadCompiler(ascPath) {
  return compiler ||= import(pathToFileURL(ascPath));
}

export async function compile(c, ascPath) {
  const asc = await loadCompiler(ascPath), files = {}, overlay = { [`${c.name}.ts`]: c.source };
  const result = await asc.main([`${c.name}.ts`, '-O3', '--runtime', 'stub', '--noColors', '--initialMemory', '1',
    '--maximumMemory', '16', '--noAssert', '--outFile', 'out.wasm'], {
    stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(),
    readFile: name => overlay[name] ?? null, writeFile: (name, data) => { files[name] = data; }, listFiles: () => [],
  });
  return result.error ? null : files['out.wasm'];
}
