import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { runGates } from '../../core/runtime/x1/gates.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { freezeSpecification } from '../../core/runtime/x1/oracle.mjs';
import { corpus } from '../P-56-evaluator-synthesis/corpus.mjs';

function compiledOf(directory) {
  const db = new DatabaseSync(join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    for (const { body } of db.prepare('select body from records order by seq desc').all()) {
      const content = JSON.parse(body).data?.content;
      if (typeof content !== 'string') continue;
      try { const parsed = JSON.parse(content); if (parsed?.compiled?.wasm) return parsed.compiled; } catch { }
    }
    return null;
  } finally { db.close(); }
}

const gate = (kernel, tests, compiled) => runGates({ id: kernel.id, files: { 'CONTRACT.md': kernel.contract, 'tests.json': tests, 'frozen.sha256': JSON.stringify({ contract: hash(kernel.contract), tests: hash(tests) }),
  'kernel.ts': kernel.kernel, 'glue.json': kernel.glue }, compiled });

export function pristine(root, limit = Infinity) {
  return corpus(root).slice(0, limit).map(kernel => {
    const [run] = kernel.key.split('/'), directory = join(root, run, 'thread', kernel.id);
    kernel.kernel = readFileSync(join(directory, 'candidate', 'kernel.ts'), 'utf8');
    const compiled = compiledOf(directory);
    if (!compiled) return { key: kernel.key, verdict: 'no compiled kernel' };
    const before = gate(kernel, kernel.tests, compiled).promotable;
    const begin = performance.now(), frozen = freezeSpecification({ 'CONTRACT.md': kernel.contract, 'tests.json': kernel.tests });
    const ms = performance.now() - begin;
    if (!frozen) return { key: kernel.key, before, after: before, ms, oracle: null };
    const after = frozen.report.flagged ? false : gate(kernel, frozen.text, compiled).promotable;
    return { key: kernel.key, before, after, ms, report: { ...frozen.report, ms: undefined }, changes: frozen.changes.length };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, output, limit] = process.argv.slice(2);
  const rows = pristine(root, limit ? Number(limit) : Infinity);
  if (output) writeFileSync(output, JSON.stringify(rows, null, 1));
  const regressions = rows.filter(row => row.before === true && row.after !== true);
  console.log(JSON.stringify({ kernels: rows.length, promotedBefore: rows.filter(r => r.before === true).length, promotedAfter: rows.filter(r => r.after === true).length, regressions: regressions.map(r => ({ key: r.key, report: r.report })),
    corrected: rows.reduce((n, r) => n + (r.report?.corrected ?? 0), 0), flagged: rows.reduce((n, r) => n + (r.report?.flagged ?? 0), 0), missing: rows.filter(r => r.verdict).length }, null, 1));
}
