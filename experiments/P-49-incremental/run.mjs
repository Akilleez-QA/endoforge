import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { installWasmLimit } from '../../core/runtime/isolate-wasm.mjs';
import { TSRS_MODULE, WORKCELL } from '../../tools/tscheck/pin.mjs';

if (isMainThread) {
  const [work, out, repsText = '5', ...names] = process.argv.slice(2);
  const worker = new Worker(fileURLToPath(import.meta.url), { resourceLimits: WORKCELL.resourceLimits, execArgv: [], workerData: { work, reps: Number(repsText), names: names.length ? names : ['medium/ill', 'medium/well', 'stress/ill', 'stress/well'] } });
  const summary = await new Promise((resolve, reject) => {
    worker.on('message', message => message.done ? resolve(message.done) : console.log(message.line));
    worker.once('error', reject);
  });
  await worker.terminate();
  writeFileSync(out, `${JSON.stringify({ node: process.version, module: TSRS_MODULE.name, ...summary }, null, 1)}\n`);
} else {
  installWasmLimit(WORKCELL.wasmMemoryMaxMb, () => process.exit(18), WORKCELL.trustedWasmModules);
  const vendor = new URL('../../tools/tscheck/node_modules/@tsrs/wasm/', import.meta.url);
  const core = await import(new URL('core.js', vendor));
  const module = new WebAssembly.Module(readFileSync(new URL('tsrs.wasm', vendor)));
  const { work, reps, names } = workerData;
  const INFO = '/proj/.tsbuildinfo';
  const read = (dir, root, files = {}) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) read(path, root, files);
      else files[`/proj/${relative(root, path)}`] = readFileSync(path, 'utf8');
    }
    return files;
  };
  const check = (files, buildInfo) => {
    const input = buildInfo === undefined ? files : buildInfo === null ? { ...files } : { ...files, [INFO]: buildInfo };
    const host = core.memoryFileSystem(input);
    const args = ['-p', '/proj/tsconfig.json', '--pretty', 'false', '--noEmit', ...(buildInfo === undefined ? [] : ['--incremental', '--tsBuildInfoFile', INFO])];
    let stderr = '';
    const text = new TextDecoder();
    const started = performance.now();
    const r = core.runTsc(module, core.makeRequest(args, { cwd: '/proj', json: true }), host, { env: {}, stdout: () => {}, stderr: chunk => { stderr += text.decode(chunk); } });
    const wallMs = performance.now() - started;
    if (r.exitCode === core.EXIT_CRASHED) throw new Error(`trapped: ${stderr.slice(0, 300)}`);
    const diagnostics = core.parseReply(r.reply).map(d => `${d.fileName}:${d.startPosition ? d.startPosition.line + 1 : 0}:${d.startPosition ? d.startPosition.character + 1 : 0}:${d.code}:${d.text}`).sort();
    return { wallMs, exitCode: r.exitCode, diagnostics, written: host.written.get(INFO) };
  };
  const importCounts = files => {
    const counts = new Map();
    for (const [path, source] of Object.entries(files)) if (path.startsWith('/proj/src/')) for (const m of source.matchAll(/from "\.\/(m\d+)\.js"/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  };
  const steps = {};
  const rows = [];
  for (const name of names) {
    const base = read(join(work, name, 'proj'), join(work, name, 'proj'));
    const shared = `/proj/src/${importCounts(base)[0]?.[0] ?? 'm000'}.ts`;
    const imported = new Set(importCounts(base).map(([m]) => `/proj/src/${m}.ts`));
    const leaf = Object.keys(base).sort().reverse().find(path => /\/src\/m\d+\.ts$/.test(path) && !imported.has(path));
    const field = /export interface \w+ \{ id: number;/.exec(base[shared]);
    if (!field) throw new Error(`no interface in ${shared}`);
    const edits = [
      ['comment', files => ({ ...files, [leaf]: `${base[leaf]}\n// probe comment\n` })],
      ['body', files => ({ ...files, [leaf]: base[leaf].replace(/let acc = (\d+);/, 'let acc = $1 + 1;') })],
      ['add-error', files => ({ ...files, [leaf]: `${base[leaf]}\nexport const bad: number = "x";\n` })],
      ['restore', files => ({ ...files, [leaf]: base[leaf] })],
      ['export-type', files => ({ ...files, [shared]: base[shared].replace(field[0], field[0].replace('id: number', 'id: string')) })],
      ['restore', files => ({ ...files, [shared]: base[shared] })],
      ['syntax-error', files => ({ ...files, [leaf]: `${base[leaf]}\nexport const = ;\n` })],
      ['restore', files => ({ ...files, [leaf]: base[leaf] })],
      ['options', files => { const c = JSON.parse(base['/proj/tsconfig.json']); c.compilerOptions.strict = false; return { ...files, '/proj/tsconfig.json': JSON.stringify(c) }; }],
      ['restore', files => ({ ...files, '/proj/tsconfig.json': base['/proj/tsconfig.json'] })],
    ];
    for (let rep = 0; rep < reps; rep++) {
      let files = base;
      const seedFull = check(files);
      const seed = check(files, null);
      let buildInfo = seed.written;
      const seedRow = { name, rep, step: 'seed', fullMs: Math.round(seedFull.wallMs), incrementalMs: Math.round(seed.wallMs), parity: JSON.stringify(seedFull.diagnostics) === JSON.stringify(seed.diagnostics), exitParity: seedFull.exitCode === seed.exitCode, diagnostics: seedFull.diagnostics.length, buildInfoBytes: seed.written?.length ?? 0 };
      rows.push(seedRow);
      parentPort.postMessage({ line: JSON.stringify(seedRow) });
      for (const [index, [step, edit]] of edits.entries()) {
        files = edit(files);
        const full = check(files);
        const incremental = check(files, buildInfo ?? null);
        if (incremental.written) buildInfo = incremental.written;
        const parity = JSON.stringify(full.diagnostics) === JSON.stringify(incremental.diagnostics);
        const row = { name, rep, step, index, fullMs: Math.round(full.wallMs), incrementalMs: Math.round(incremental.wallMs), parity, exitParity: full.exitCode === incremental.exitCode, diagnostics: full.diagnostics.length, incrementalDiagnostics: incremental.diagnostics.length, buildInfoBytes: buildInfo?.length ?? 0,
          ...(parity ? {} : { onlyFull: full.diagnostics.filter(d => !incremental.diagnostics.includes(d)).slice(0, 5), onlyIncremental: incremental.diagnostics.filter(d => !full.diagnostics.includes(d)).slice(0, 5) }) };
        rows.push(row);
        parentPort.postMessage({ line: JSON.stringify(row) });
      }
    }
    steps[name] = { leaf: leaf.replace('/proj/', ''), shared: shared.replace('/proj/', '') };
  }
  parentPort.postMessage({ done: { steps, rows } });
}
