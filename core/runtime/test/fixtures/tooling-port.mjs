import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPort as identityPort } from './identity-port.mjs';

export async function createPort(options) {
  const port = await identityPort(options);
  const { bytes, wasm, glue, call, args = [] } = options;
  const source = wasm ? await readFile(wasm) : Uint8Array.from(bytes);
  const exports = glue
    ? (await import(pathToFileURL(glue).href)).initSync({ module: source })
    : (await WebAssembly.instantiate(source, {})).instance.exports;
  exports[call](...args);
  return port;
}
