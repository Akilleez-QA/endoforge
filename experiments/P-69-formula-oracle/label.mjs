import { runGates } from '../../core/runtime/x1/gates.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';

export const knownWrong = [
  ['P-56', 'pilot', 'H08--sonnet-medium--0'], ['P-56', 'pilot', 'CC-036--sonnet-medium--0'], ['P-56', 'main', 'CC-036--sonnet-low--0'], ['P-56', 'main', 'CC-025--opus-low--0'],
  ['P-56', 'main', 'CC-002--sonnet-low--0'], ['P-66', 'main', 'H02--sonnet-low--0'], ['P-66', 'main', 'H02--sonnet-low--2'], ['P-66', 'main', 'H02--sonnet-low--5'],
  ['P-66', 'main', 'H08--sonnet-low--3'], ['P-66', 'main', 'H08--sonnet-low--5'],
].map(parts => parts.join('/'));
export const entryKey = entry => `${entry.study}/${entry.stage}/${entry.id}`;
const floor = (test, value) => Math.max(Number.isFinite(test.tol) ? test.tol : 0, 1e-9 * Math.max(1, Math.abs(value)));

export function finalRun(entry) {
  if (!entry.kernel || !entry.compiled?.wasm) return null;
  try {
    const result = runGates({ id: entry.id, files: { 'CONTRACT.md': entry.contract, 'tests.json': entry.tests, 'frozen.sha256': JSON.stringify({ contract: hash(entry.contract), tests: hash(entry.tests) }), 'kernel.ts': entry.kernel, 'glue.json': entry.glue ?? '{}' }, compiled: entry.compiled });
    return result.tests?.length ? result.tests : null;
  } catch { return null; }
}

function truth(need, test) {
  const fn = hNeeds.find(h => h.id === need)?.reference?.[test.fn];
  if (!fn || !Array.isArray(test.args) || !test.args.every(Number.isFinite)) return null;
  try { return { value: fn(...test.args) }; } catch { return { trap: true }; }
}

export function labelEntry(entry) {
  let tests;
  try { tests = JSON.parse(entry.tests); } catch { return null; }
  if (!Array.isArray(tests)) return null;
  const run = finalRun(entry), known = knownWrong.includes(entryKey(entry)), isH = /^H\d+$/.test(entry.need);
  return tests.map((test, index) => {
    const outcome = run?.find(t => t.name === test.name && JSON.stringify(t.args) === JSON.stringify(test.args));
    if (isH) {
      const expected = truth(entry.need, test);
      if (!expected) return 'unknown';
      if (test.expectError || expected.trap) return Boolean(test.expectError) === Boolean(expected.trap) ? 'correct' : 'wrong';
      if (typeof test.expect !== 'number' || typeof expected.value !== 'number') return 'unknown';
      return Math.abs(test.expect - expected.value) <= floor(test, expected.value) ? 'correct' : 'wrong';
    }
    if (!outcome) return 'unknown';
    if (outcome.pass) return 'correct';
    return known ? 'wrong' : 'unknown';
  });
}
