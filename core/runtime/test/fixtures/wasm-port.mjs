import assert from 'node:assert/strict';
import { createPort as identityPort } from './identity-port.mjs';

export async function createPort(options) {
  const port = await identityPort(options);
  let exercised = false;
  return { ...port, async describe(candidate) {
    if (!exercised) {
      exercised = true;
      const { action, bytes, pages = 17, imports } = options;
      const source = Uint8Array.from(bytes || []);
      const response = () => new Response(source, { headers: { 'Content-Type': 'application/wasm' } });
      if (action === 'initial') new WebAssembly.Memory({ initial: pages });
      else if (action === 'maximum') new WebAssembly.Memory({ initial: 1, maximum: pages });
      else if (action === 'grow') new WebAssembly.Memory({ initial: 1 }).grow(pages);
      else if (action === 'grow-coercion') {
        const memory = new WebAssembly.Memory({ initial: 1 });
        memory.grow({ valueOf() { return pages; } });
      } else if (action === 'shared-grow') new WebAssembly.Memory({ initial: 1, maximum: 16, shared: true }).grow(pages);
      else {
        let module, instance;
        const bindings = imports ? { env: { memory: new WebAssembly.Memory({ initial: 1, ...(options.importMaximum ? { maximum: options.importMaximum } : {}) }) } } : {};
        if (action === 'foreign-module') instance = new WebAssembly.Instance(options.module);
        else if (action === 'foreign-instantiate') instance = await WebAssembly.instantiate(options.module);
        else if (action === 'compile') module = await WebAssembly.compile(source);
        else if (action === 'module') module = new WebAssembly.Module(source);
        else if (action === 'module-constructor') module = new WebAssembly.Module.prototype.constructor(source);
        else if (action === 'compile-streaming') module = await WebAssembly.compileStreaming(response());
        else if (action === 'instantiate-streaming') ({ instance } = await WebAssembly.instantiateStreaming(response(), bindings));
        else if (action === 'instantiate') ({ instance } = await WebAssembly.instantiate(source, bindings));
        else if (action === 'instance') instance = new WebAssembly.Instance(new WebAssembly.Module(source), bindings);
        else if (action === 'instantiate-module') instance = await WebAssembly.instantiate(await WebAssembly.compile(source), bindings);
        else throw new Error('unknown wasm fixture action');
        if (module) instance = new WebAssembly.Instance(module, bindings);
        if (instance.exports.grow && !options.exportGrow) {
          if (options.swallow) {
            try { instance.exports.grow(pages); } catch { }
          } else assert.equal(instance.exports.grow(pages), options.expectedOldPages ?? 1);
        }
        if (options.checkMemory) assert.equal(instance.exports.memory.buffer.byteLength, options.checkMemory * 65536);
        if (options.exportGrow) instance.exports.memory.grow(pages);
        if (options.importGrow) try { bindings.env.memory.grow(pages); } catch { }
      }
    }
    return port.describe(candidate);
  } };
}
