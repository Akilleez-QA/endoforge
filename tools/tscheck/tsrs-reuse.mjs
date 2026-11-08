const PAGE = 65536;
const MIB = 1048576;
const EXPORTED = 'export function prepare(';

export const REUSE_DEFAULTS = Object.freeze({ growthMb: 16, maxRuns: 1000 });

export function exposePrepare(coreText) {
  const parts = coreText.split('\nfunction prepare(');
  if (parts.length !== 2 || coreText.includes(EXPORTED)) throw new Error('tsrs core does not have exactly one private prepare to expose');
  return `${parts[0]}\n${EXPORTED}${parts[1]}`;
}

const lastNonZero = bytes => {
  const words = new BigUint64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 3);
  for (let index = words.length - 1; index >= 0; index--) if (words[index] !== 0n) return index * 8 + 7;
  return -1;
};

const firstNonZero = bytes => {
  const words = new BigUint64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 3);
  for (let index = 0; index < words.length; index++) if (words[index] !== 0n) return index * 8;
  return bytes.byteLength;
};

export function memoryImage(memory) {
  const bytes = new Uint8Array(memory.buffer);
  const start = Math.floor(firstNonZero(bytes) / PAGE) * PAGE;
  const end = Math.min(bytes.byteLength, Math.ceil((lastNonZero(bytes) + 1) / PAGE) * PAGE);
  return Object.freeze({ start, end, length: bytes.byteLength, bytes: bytes.slice(start, Math.max(start, end)) });
}

export function restoreImage(memory, image) {
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(image.bytes, image.start);
  bytes.fill(0, image.end, image.length);
}

export function createReusingRunTsc(core, { growthMb = REUSE_DEFAULTS.growthMb, maxRuns = REUSE_DEFAULTS.maxRuns, image: shared } = {}) {
  if (typeof core.prepare !== 'function') throw new Error('instance reuse needs the tsrs core with prepare exposed');
  const current = { request: null, host: null, io: null };
  const request = { get cwd() { return current.request.cwd; }, get args() { return current.request.args; }, get flags() { return current.request.flags; } };
  const host = Object.fromEntries(['readFile', 'stat', 'readDir', 'realpath', 'writeFile', 'remove', 'chtimes'].map(name => [name, (...args) => current.host[name](...args)]));
  const io = { env: {}, stdout: chunk => current.io.stdout?.(chunk), stderr: chunk => current.io.stderr?.(chunk),
    beforeRun: memory => current.io.beforeRun?.(memory), afterRun: memory => current.io.afterRun?.(memory) };
  const stats = { instances: 0, reused: 0, discarded: 0 };
  let slot = null, image = shared ?? null;
  const fresh = module => {
    const state = { exited: false };
    const run = core.prepare(module, request, host, io);
    const wasi = run.imports.wasi_snapshot_preview1, exit = wasi.proc_exit;
    if (exit) wasi.proc_exit = code => { state.exited = true; return exit(code); };
    const instance = new WebAssembly.Instance(module, run.imports);
    if (!image) image = memoryImage(instance.exports.memory);
    stats.instances += 1;
    return { module, run, instance, state, runs: 0, limit: image.length + growthMb * MIB };
  };
  const runTsc = (module, nextRequest, nextHost, nextIo = {}) => {
    if (Object.keys(nextIo.env ?? {}).length) throw new Error('instance reuse runs with an empty environment');
    if (slot && (slot.module !== module || slot.runs >= maxRuns || slot.instance.exports.memory.buffer.byteLength > slot.limit)) { slot = null; stats.discarded += 1; }
    current.request = nextRequest; current.host = nextHost; current.io = nextIo;
    try {
      if (slot) { restoreImage(slot.instance.exports.memory, image); stats.reused += 1; } else slot = fresh(module);
    } catch (error) {
      slot = null;
      current.request = null; current.host = null; current.io = null;
      throw error;
    }
    const used = slot;
    used.runs += 1;
    used.state.exited = false;
    try {
      const result = used.run.start(used.instance);
      if (used.state.exited || result.exitCode === core.EXIT_CRASHED) { slot = null; stats.discarded += 1; }
      return result;
    } catch (error) {
      slot = null;
      stats.discarded += 1;
      throw error;
    } finally {
      current.request = null; current.host = null; current.io = null;
    }
  };
  return { runTsc, stats };
}
