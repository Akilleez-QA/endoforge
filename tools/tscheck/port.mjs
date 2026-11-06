import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { typecheck, warm as warmChecker } from './checker.mjs';

export const TS_INVARIANT = 'typescript';

export async function warm({ vendor, probe } = {}) {
  await warmChecker({ probe, ...(vendor ? { vendor: new URL(vendor) } : {}) });
}

export async function createPort({ basePort, baseOptions, projects, vendor, reportFile }) {
  const { createPort: createBase } = await import(pathToFileURL(basePort).href);
  const base = await createBase(baseOptions);
  return { ...base, async invariant(name, candidate, ...rest) {
    if (name !== TS_INVARIANT) return base.invariant(name, candidate, ...rest);
    const project = projects[candidate];
    if (!project) throw new Error('no project for candidate');
    const report = await typecheck(project, vendor ? { vendor: new URL(vendor) } : {});
    if (reportFile) appendFileSync(reportFile, `${JSON.stringify({ candidate, workcell: threadId, rssBytes: process.memoryUsage().rss, ...report })}\n`);
    const first = report.diagnostics.slice(0, 5).map(d => `${d.file}(${d.line},${d.column}): TS${d.code} ${d.text}`);
    return { passed: report.diagnostics.length === 0, reason: first.length ? first.join('\n') : `no diagnostics from ${report.compiler.name}` };
  } };
}
