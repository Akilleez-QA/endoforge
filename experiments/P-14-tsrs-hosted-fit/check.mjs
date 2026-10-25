import { runOnce } from './old-host.mjs';

export function check(engine, core, module, kernel, project) {
  const t = performance.now();
  const k = new WebAssembly.Instance(kernel);
  if (k.exports.add(2, 3) !== 5) throw new Error('kernel failed');
  let linearBytes = 0;
  const args = ['-p', `${project.root}/tsconfig.json`, '--pretty', 'false'];
  let exitCode, diagnostics, written, stderr = '', stdout = '';
  if (engine === 'old') {
    const Original = WebAssembly.Instance;
    WebAssembly.Instance = class extends Original {
      constructor(...a) {
        super(...a);
        for (const x of Object.values(this.exports)) if (x instanceof WebAssembly.Memory) {
          // Retain the memory only through this synchronous invocation.
          captured.push(x);
        }
      }
    };
    const captured = [];
    let r;
    try { r = runOnce(core, module, {files: project.files, cwd: project.root, args, fsKind: 'indexed'}); }
    finally { WebAssembly.Instance = Original; }
    linearBytes = captured.reduce((n, m) => n + m.buffer.byteLength, 0);
    if (!r.ok) throw new Error(JSON.stringify(r));
    ({exitCode, diagnostics, written, stderr, stdout} = r);
  } else {
    const fs = core.memoryFileSystem(project.files);
    const dec = new TextDecoder();
    const r = core.runTsc(module, core.makeRequest(args, {cwd: project.root, json: true}), fs, {
      stdout: b => stdout += dec.decode(b), stderr: b => stderr += dec.decode(b),
    });
    exitCode = r.exitCode;
    linearBytes = r.memoryBytes;
    diagnostics = core.parseReply(r.reply);
    written = Object.fromEntries(fs.written);
  }
  const wallMs = performance.now() - t;
  if (exitCode === 5) throw new Error(`compiler trap: ${stderr}`);
  return {wallMs, linearBytes, exitCode, stderr, stdout, written,
    diagnostics: diagnostics.map(d => ({file: d.fileName ?? null,
      line: d.startPosition ? d.startPosition.line + 1 : 0,
      col: d.startPosition ? d.startPosition.character + 1 : 0,
      pos: d.pos, code: d.code, category: d.category, text: d.text,
    })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}
