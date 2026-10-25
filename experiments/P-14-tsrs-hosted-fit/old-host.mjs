// Shared by index.mjs and worker.mjs: one tsc-rs WASM run over an in-memory HostFileSystem.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * An indexed in-memory HostFileSystem (upstream core.d.ts interface). Unlike upstream's
 * memoryFileSystem, stat/readDirectory are O(1)/O(entries) via a directory index built once per run.
 * Writes (emitted files) land in `written`.
 */
export function indexedFileSystem(files) {
  const map = new Map(Object.entries(files));
  const dirs = new Map(); // dir -> Map(name -> kind)
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

/**
 * One check. `core` is upstream core.js; `module` a compiled WebAssembly.Module.
 * Returns plain data (structured-cloneable): exitCode, diagnostics (upstream JSON), written files.
 */
export function runOnce(core, module, { files, cwd, args, fsKind }) {
  const fs = fsKind === "upstream-memory" ? core.memoryFileSystem(new Map(Object.entries(files))) : indexedFileSystem(files);
  let stdout = "";
  let stderr = "";
  const dec = new TextDecoder();
  try {
    const r = core.runTsc(module, {
      args,
      cwd,
      fs,
      env: {},
      diagnosticsJson: true,
      stdout: (c) => (stdout += dec.decode(c)),
      stderr: (c) => (stderr += dec.decode(c)),
    });
    let written;
    if (fs.written) written = Object.fromEntries(fs.written);
    else written = Object.fromEntries([...fs.files].filter(([k]) => !(k in files) || files[k] !== fs.files.get(k)));
    return { ok: true, exitCode: r.exitCode, diagnostics: r.diagnostics ?? [], written, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      name: error?.name,
      stderr: String(error?.stderr ?? stderr).slice(0, 4000),
      stdout: stdout.slice(0, 4000),
    };
  }
}
