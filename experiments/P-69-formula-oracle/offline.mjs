import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzeSpecification, freezeTests } from '../../core/runtime/x1/oracle.mjs';
import { entryKey, finalRun, labelEntry } from './label.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';

const accepts = (test, value) => test.expectError ? value?.trap === true
  : value && !value.trap && typeof value.value === 'number' && typeof test.expect === 'number' && Math.abs(value.value - test.expect) <= (Number.isFinite(test.tol) ? test.tol : 0);

function truthOf(entry, test, observed) {
  const fn = hNeeds.find(h => h.id === entry.need)?.reference?.[test.fn];
  if (fn && test.args.every(Number.isFinite)) { try { return { value: fn(...test.args) }; } catch { return { trap: true }; } }
  if (!observed) return null;
  return observed.trap ? { trap: true } : { value: observed.got };
}

export function offline(corpus) {
  const rows = [], timings = [];
  for (const entry of corpus) {
    if (entry.missing) continue;
    const labels = labelEntry(entry);
    if (!labels) continue;
    const begin = performance.now();
    const analysis = analyzeSpecification({ 'CONTRACT.md': entry.contract, 'tests.json': entry.tests }, { reference: false });
    const frozen = analysis ? freezeTests(analysis.tests, analysis.decisions).tests : null;
    timings.push({ key: entryKey(entry), ms: performance.now() - begin });
    const run = finalRun(entry);
    labels.forEach((label, index) => {
      const decision = analysis?.decisions[index], test = analysis?.tests[index];
      const row = { key: entryKey(entry), need: entry.need, index, label, status: decision?.status ?? 'unanalyzed', sources: decision?.sources ?? null };
      if (label === 'wrong') {
        const observed = run?.find(t => t.name === test.name && JSON.stringify(t.args) === JSON.stringify(test.args));
        const truth = truthOf(entry, test, observed);
        row.mechanism = ['flagged', 'corrected'].includes(row.status) ? row.sources.filter(s => s !== 'literal').join('+') : truth && frozen && accepts(frozen[index], truth) ? 'tolerance' : null;
        row.caught = Boolean(row.mechanism);
        row.literal = test.expectError ? 'trap' : test.expect;
        row.truth = truth?.trap ? 'trap' : truth?.value;
      }
      rows.push(row);
    });
  }
  return { rows, timings };
}

export function summarize({ rows, timings }) {
  const wrong = rows.filter(r => r.label === 'wrong'), correct = rows.filter(r => r.label === 'correct');
  const falseFlags = correct.filter(r => ['flagged', 'corrected'].includes(r.status));
  const ms = timings.map(t => t.ms).sort((a, b) => a - b), at = q => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  const by = list => Object.fromEntries([...Map.groupBy(list, r => r.mechanism ?? 'missed')].map(([k, v]) => [k, v.length]));
  return {
    wrong: wrong.length, caught: wrong.filter(r => r.caught).length, byMechanism: by(wrong), specs: new Set(wrong.map(r => r.key)).size, specsCaught: new Set(wrong.filter(r => r.caught).map(r => r.key)).size,
    correct: correct.length, falseFlags: falseFlags.length, unknown: rows.filter(r => r.label === 'unknown').length,
    status: Object.fromEntries([...Map.groupBy(correct, r => r.status)].map(([k, v]) => [k, v.length])),
    freezeMs: { needs: ms.length, p50: at(0.5), p95: at(0.95), max: ms.at(-1) },
    missed: wrong.filter(r => !r.caught), falseFlagRows: falseFlags,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [corpusPath, output] = process.argv.slice(2);
  const result = offline(JSON.parse(readFileSync(corpusPath, 'utf8')));
  const summary = summarize(result);
  if (output) writeFileSync(output, JSON.stringify({ summary, rows: result.rows, timings: result.timings }, null, 1));
  console.log(JSON.stringify({ ...summary, falseFlagRows: summary.falseFlagRows.length }, null, 1));
}
