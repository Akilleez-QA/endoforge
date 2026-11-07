import { writeFileSync } from 'node:fs';
import { createPort as identityPort } from '../../core/runtime/test/fixtures/identity-port.mjs';

const MiB = 1048576;
const retained = [];
const touch = bytes => { bytes.fill(1); return bytes; };
const chunk = {
  arraybuffer: size => { const buffer = new ArrayBuffer(size); touch(new Uint8Array(buffer)); return buffer; },
  typedarray: size => touch(new Float64Array(size / 8)),
  buffer: size => Buffer.alloc(size, 1),
  'shared-arraybuffer': size => { const buffer = new SharedArrayBuffer(size); touch(new Uint8Array(buffer)); return buffer; },
  blob: size => new Blob([Buffer.alloc(size, 1)]),
  'wasm-memories': () => { const memory = new WebAssembly.Memory({ initial: 512, maximum: 512 }); touch(new Uint8Array(memory.buffer)); return memory; },
};
const chunkMb = kind => kind === 'wasm-memories' ? 32 : 64;

export async function createPort(options = {}) {
  const port = await identityPort(options);
  const { alloc } = options;
  if (!alloc) return port;
  let exercised = false;
  return { ...port, describe(candidate) {
    if (!exercised) {
      exercised = true;
      if (alloc.kind === 'js-heap') for (;;) retained.push(Array.from({ length: 4096 }, () => ({ value: Math.random() })));
      const size = chunkMb(alloc.kind);
      for (let reached = size; reached <= alloc.capMb; reached += size) {
        retained.push(chunk[alloc.kind](size * MiB));
        const { arrayBuffers, external, heapUsed } = process.memoryUsage();
        writeFileSync(alloc.progress, JSON.stringify({ reachedMb: reached, arrayBuffersMb: Math.round(arrayBuffers / MiB), externalMb: Math.round(external / MiB), heapUsedMb: Math.round(heapUsed / MiB) }));
      }
    }
    return port.describe(candidate);
  } };
}
