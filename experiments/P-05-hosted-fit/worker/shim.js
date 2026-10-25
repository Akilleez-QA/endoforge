// P-05 harness shim: a Worker that type-checks an in-memory project with tsc-rs WASM.
// core.js is upstream ts-rust npm/wasm/core.js (the runtime-independent glue the lab adapter uses,
// isolate-factory-lab/adapters/checkers/tscrs-wasm/index.mjs). indexedFileSystem is copied from
// isolate-factory-lab/adapters/checkers/tscrs-wasm/host.mjs (the adapter's indexed HostFileSystem).
import * as core from "./core.js";
import tsModule from "./ts_rust.size.wasm"; // WebAssembly.Module (workerd wasm module binding)
import kernelModule from "./kernel.wasm";   // second module binding: one tiny kernel

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

// --- copied from lab host.mjs (indexedFileSystem) ---
function indexedFileSystem(files) {
  const map = new Map(Object.entries(files));
  const dirs = new Map();
  const addPath = (path, kind) => {
    let child = path;
    let k = kind;
    while (child !== "/") {
      const slash = child.lastIndexOf("/");
      const parent = slash <= 0 ? "/" : child.slice(0, slash);
      const name = child.slice(slash + 1);
      let entries = dirs.get(parent);
      const existed = entries !== undefined;
      if (!entries) dirs.set(parent, (entries = new Map()));
      if (entries.has(name)) return;
      entries.set(name, k);
      if (existed) return;
      child = parent;
      k = "directory";
    }
  };
  if (!dirs.has("/")) dirs.set("/", new Map());
  for (const p of map.keys()) addPath(p, "file");
  const written = new Map();
  return {
    written,
    readFile: (path) => map.get(path),
    stat(path) {
      const text = map.get(path);
      if (text !== undefined) return { isDirectory: false, isFile: true, size: encoder.encode(text).length, mtimeMs: 0 };
      return dirs.has(path) ? { isDirectory: true, size: 0, mtimeMs: 0 } : undefined;
    },
    readDirectory(path) {
      const entries = dirs.get(path);
      return entries ? [...entries].map(([name, kind]) => ({ name, kind })) : undefined;
    },
    realpath: (path) => (map.has(path) || dirs.has(path) ? path : undefined),
    writeFile(path, data, append) {
      if (dirs.has(path)) return `open ${path}: is a directory`;
      const text = decoder.decode(data);
      const next = append ? (map.get(path) ?? "") + text : text;
      map.set(path, next);
      written.set(path, next);
      addPath(path, "file");
    },
    remove(path) {
      map.delete(path);
      written.delete(path);
    },
  };
}
// --- end copy ---

let requests = 0;
const held = []; // for /alloc: keep allocations alive so they count

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ping") return Response.json({ ok: true, requests });
    if (url.pathname === "/alloc") {
      // Limit-enforcement probe. {kind: "wasm"|"js", mib}
      const { kind, mib } = await request.json();
      const t0 = performance.now();
      try {
        if (kind === "wasm") {
          const mem = new WebAssembly.Memory({ initial: 1, maximum: 65536 });
          mem.grow(mib * 16); // 64 KiB pages
          new Uint8Array(mem.buffer).fill(1); // touch so it is resident
          held.push(mem);
          return Response.json({ ok: true, kind, mib, bytes: mem.buffer.byteLength, ms: performance.now() - t0 });
        }
        // On-heap JS arrays (typed arrays are off-heap and escape --max-old-space-size):
        // packed double arrays store 8 bytes per element in V8's heap (large object space).
        let count = 0;
        const target = mib * 1024 * 1024;
        while (count * 8 < target) {
          const chunk = new Array(1 << 20);
          for (let i = 0; i < chunk.length; i++) chunk[i] = i + 0.5;
          held.push(chunk);
          count += chunk.length;
        }
        return Response.json({ ok: true, kind, mib, bytes: count * 8, ms: performance.now() - t0 });
      } catch (e) {
        return Response.json({ ok: false, kind, mib, error: String(e && e.message) });
      }
    }
    if (url.pathname !== "/check") return new Response("not found", { status: 404 });
    const body = await request.json();
    const t0 = performance.now();
    // One kernel instance per request (the "module instance" of X6), used once.
    const kernel = new WebAssembly.Instance(kernelModule, {});
    const kernelOut = kernel.exports.add(40, 2);
    const t1 = performance.now();
    const fs = indexedFileSystem(body.files);
    let stdout = "", stderr = "";
    const dec = new TextDecoder();
    let r;
    try {
      r = core.runTsc(tsModule, {
        args: body.args, cwd: body.cwd, fs, env: {}, diagnosticsJson: true,
        stdout: (c) => (stdout += dec.decode(c)), stderr: (c) => (stderr += dec.decode(c)),
      });
    } catch (e) {
      return Response.json({ ok: false, error: String(e && e.message), stderr: stderr.slice(0, 4000), stdout: stdout.slice(0, 4000) }, { status: 500 });
    }
    const t2 = performance.now();
    requests++;
    return Response.json({
      ok: true, exitCode: r.exitCode, kernelOut,
      diagnostics: (r.diagnostics ?? []).map((d) => ({ file: d.fileName ?? null, code: d.code, category: d.category, line: d.startPosition ? d.startPosition.line + 1 : 0 })),
      timing: { kernelMs: t1 - t0, checkMs: t2 - t1, totalMs: t2 - t0 },
      stderr: stderr.slice(0, 2000),
    });
  },
};
