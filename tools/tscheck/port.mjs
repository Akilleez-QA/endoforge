import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { typecheck, warm as warmChecker } from './checker.mjs';

export const TS_INVARIANT = 'typescript';

export async function warm({ vendor } = {}) {
  await warmChecker(vendor ? { vendor: new URL(vendor) } : {});
}

export async function createPort({ basePort, baseOptions, projects, vendor, reportFile, emit = false }) {
  const { createPort: createBase } = await import(pathToFileURL(basePort).href);
  const base = await createBase(baseOptions);
  const emitted = [];
  return { ...base, evidence() {
    return emit ? { typescript: emitted } : base.evidence?.();
  }, async invariant(name, candidate, ...rest) {
    if (name !== TS_INVARIANT) return base.invariant(name, candidate, ...rest);
    const project = projects[candidate];
    if (!project) throw new Error('no project for candidate');
    const report = await typecheck(project, { emit, ...(vendor ? { vendor: new URL(vendor) } : {}) });
    if (report.artifact) emitted.push({ candidate, round: rest[1], compiler: report.compiler, sha256: report.artifact.sha256 });
    if (reportFile) appendFileSync(reportFile, `${JSON.stringify({ candidate, workcell: threadId, rssBytes: process.memoryUsage().rss, ...report })}\n`);
    const first = report.diagnostics.slice(0, 5).map(d => `${d.file}(${d.line},${d.column}): TS${d.code} ${d.text}`);
    return { passed: report.diagnostics.length === 0, reason: first.length ? first.join('\n') : `no diagnostics from ${report.compiler.name}` };
  } };
}
