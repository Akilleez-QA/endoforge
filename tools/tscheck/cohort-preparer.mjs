// Runs inside a contained cohort Worker. The cohort imports this, check-core.mjs and the pinned tsrs core.js
// from text, passes the compiler module it compiled once from the pinned bytes, and calls the returned
// function with each attempt's project before running what it emits. Nothing here reads a file.
export const DIAGNOSTICS_KEPT = 5;

export function createPreparer({ modules, wasm, config }) {
  const { runCheck, createBaseline } = modules.check, module = wasm[config.compiler.sha256];
  if (!module) throw new Error('the pinned compiler module was not provided');
  const reuse = config.reuse ? modules.reuse.createReusingRunTsc(modules.core, config.reuse) : null;
  const core = reuse ? { ...modules.core, runTsc: reuse.runTsc } : modules.core;
  const compiler = { core, module, compiler: config.compiler };
  const baseline = config.baseline ? createBaseline(compiler, config.baseline) : undefined;
  const prepare = payload => {
    const report = runCheck(compiler, payload.project, { emit: true, ...(baseline ? { baseline } : {}) });
    const info = { compiler: report.compiler, exitCode: report.exitCode, wallMs: report.wallMs, memoryBytes: report.memoryBytes,
      diagnostics: report.diagnostics.slice(0, DIAGNOSTICS_KEPT), diagnosticCount: report.diagnostics.length,
      artifact: report.artifact ? report.artifact.sha256 : null };
    if (!report.artifact) return { ok: false, info };
    return { ok: true, info, modules: Object.fromEntries(Object.entries(report.artifact.files).filter(([path]) => path.endsWith('.js'))) };
  };
  prepare.held = () => reuse ? reuse.held() : 0;
  prepare.shed = () => reuse ? reuse.shed() : 0;
  return prepare;
}
