// Runs inside a contained cohort Worker. The cohort imports this, check-core.mjs and the pinned tsrs core.js
// from text, passes the compiler module it compiled once from the pinned bytes, and calls the returned
// function with each attempt's project before running what it emits. Nothing here reads a file.
export const DIAGNOSTICS_KEPT = 5;

export function createPreparer({ modules, wasm, config }) {
  const { runCheck } = modules.check, core = modules.core, module = wasm[config.compiler.sha256];
  if (!module) throw new Error('the pinned compiler module was not provided');
  return payload => {
    const report = runCheck({ core, module, compiler: config.compiler }, payload.project, { emit: true });
    const info = { compiler: report.compiler, exitCode: report.exitCode, wallMs: report.wallMs, memoryBytes: report.memoryBytes,
      diagnostics: report.diagnostics.slice(0, DIAGNOSTICS_KEPT), diagnosticCount: report.diagnostics.length,
      artifact: report.artifact ? report.artifact.sha256 : null };
    if (!report.artifact) return { ok: false, info };
    return { ok: true, info, modules: Object.fromEntries(Object.entries(report.artifact.files).filter(([path]) => path.endsWith('.js'))) };
  };
}
