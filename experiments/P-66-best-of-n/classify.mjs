import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGates } from '../../core/runtime/x1/gates.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';
import { heldOut } from '../P-56-model-effort/heldout.mjs';

const tolerance = (test, value) => Math.max(Number.isFinite(test.tol) ? test.tol : 0, 1e-6 * Math.max(1, Math.abs(value)));
const sameValue = (a, b, test) => a.trap || b.trap ? a.trap === b.trap : typeof a.value === 'number' && typeof b.value === 'number' ? Math.abs(a.value - b.value) <= tolerance(test, b.value) : a.value === b.value;
const expected = test => test.expectError ? { trap: true } : { trap: false, value: test.expect };
const contentPath = (dir, row) => join(dir, `${row.need}--${row.arm}--${row.sample}.content.json`);

function finalTests(content) {
  try {
    const result = runGates(JSON.parse(content));
    if (!result.tests?.length) return null;
    return result.tests.map(test => ({ ...test, observed: test.trap ? { trap: true } : { trap: false, value: test.got } }));
  } catch { return null; }
}

function onSibling(content, test) {
  const probe = test.expectError ? { name: test.name, fn: test.fn, args: test.args, expectError: true } : { name: test.name, fn: test.fn, args: test.args, expect: test.expect, ...(Number.isFinite(test.tol) ? { tol: test.tol } : {}) };
  const result = heldOut(content, [probe]);
  if (result.reason) return null;
  if (result.clean) return expected(test);
  const got = result.failed[0]?.got;
  return got === undefined || (typeof got === 'string' && typeof test.expect !== 'string') ? { trap: true } : { trap: false, value: got };
}

function referenceValue(reference, test) {
  const fn = reference[test.fn];
  if (!fn || !Array.isArray(test.args)) return null;
  try { return { trap: false, value: fn(...test.args) }; } catch { return { trap: true }; }
}

export function classify(rows, dir) {
  const byNeed = Map.groupBy(rows, row => row.need);
  const out = [];
  for (const [need, runs] of byNeed) {
    const h = hNeeds.find(entry => entry.id === need);
    const promoted = runs.filter(row => row.promoted && existsSync(contentPath(dir, row)));
    for (const row of runs.filter(r => !r.promoted)) {
      const base = { need, arm: row.arm, sample: row.sample };
      const path = contentPath(dir, row);
      if (!existsSync(path)) { out.push({ ...base, class: 'no-candidate', evidence: row.error ?? row.agent?.exit_reason ?? null }); continue; }
      const content = readFileSync(path, 'utf8');
      const tests = finalTests(content);
      if (!tests) { out.push({ ...base, class: 'other', evidence: 'final candidate did not run its frozen tests' }); continue; }
      const failing = tests.filter(test => !test.pass);
      let evidence = null;
      if (h) {
        const frozen = JSON.parse(JSON.parse(content).files['tests.json']);
        for (const test of failing) {
          const spec = frozen.find(entry => entry.name === test.name) ?? test;
          const ref = referenceValue(h.reference, spec);
          if (ref && !sameValue(ref, expected(spec), spec)) { evidence = { test: spec.name, fn: spec.fn, args: spec.args, frozen: expected(spec), reference: ref, kernel: test.observed }; break; }
        }
      } else {
        for (const test of failing) {
          const frozen = JSON.parse(JSON.parse(content).files['tests.json']).find(entry => entry.name === test.name);
          if (!frozen) continue;
          const seen = promoted.filter(other => other !== row).map(other => onSibling(readFileSync(contentPath(dir, other), 'utf8'), frozen)).filter(Boolean);
          const agreeing = seen.filter(value => sameValue(value, test.observed, frozen) && !sameValue(value, expected(frozen), frozen));
          if (agreeing.length >= 2 && agreeing.length * 2 > seen.length) { evidence = { test: frozen.name, fn: frozen.fn, args: frozen.args, frozen: expected(frozen), kernel: test.observed, siblings: seen.length, agreeing: agreeing.length }; break; }
        }
      }
      out.push({ ...base, class: evidence ? 'frozen-wrong' : failing.length ? 'other' : 'gates-other', evidence: evidence ?? { failingTests: failing.length, exit: row.agent?.exit_reason ?? row.error } });
    }
  }
  return out;
}
