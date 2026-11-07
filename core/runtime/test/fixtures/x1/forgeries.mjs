import { hash } from '../../../x1/host.mjs';

const residualOf = attempt => attempt.results.find(check => check.check === 'residual');
const editX1 = (attempt, edit) => {
  const residual = residualOf(attempt), x1 = JSON.parse(residual.reason);
  edit(x1);
  residual.reason = JSON.stringify(x1);
};
export const forgeries = {
  'evaluator digest in the report': evaluated => { evaluated.observed.report.evaluator_digest = '0'.repeat(64); },
  'evaluator digest in an attempt': evaluated => { evaluated.observed.report.attempts[1].evaluator_digest = '0'.repeat(64); },
  'evaluator identity in the report': evaluated => { evaluated.observed.report.frozen_evaluator = `evr:${'0'.repeat(64)}`; },
  'a failing gate left in place': evaluated => { editX1(evaluated.observed.report.attempts[0], x1 => { x1.gates.G4_tests.ok = false; }); },
  'a gate removed': evaluated => { editX1(evaluated.observed.report.attempts[0], x1 => { delete x1.gates.G7_glue; }); },
  'a missing round': evaluated => { evaluated.observed.report.attempts.pop(); },
  'tests dropped from the report': evaluated => { for (const attempt of evaluated.observed.report.attempts) editX1(attempt, x1 => { x1.tests.pop(); }); },
  'a value that misses its expectation marked as passing': evaluated => { for (const attempt of evaluated.observed.report.attempts) editX1(attempt, x1 => { x1.tests[0].got = 99; x1.tests[0].pass = true; }); },
  'a module digest that is not the candidate': evaluated => { for (const attempt of evaluated.observed.report.attempts) editX1(attempt, x1 => { x1.gates.G2_compiles.wasmSha256 = '0'.repeat(64); }); },
  'a kernel swapped by the cell': evaluated => {
    const swapped = JSON.parse(evaluated.content), source = 'export function add(a:i32,b:i32):i32{return a+b+0}';
    swapped.files['kernel.ts'] = source; swapped.compiled.source = hash(source);
    evaluated.content = JSON.stringify(swapped);
    const identity = hash(evaluated.content);
    for (const attempt of evaluated.observed.report.attempts) attempt.candidate = identity;
    evaluated.observed.report.frontier = [identity];
  },
  'a frontier that names someone else': evaluated => { evaluated.observed.report.frontier = ['0'.repeat(64)]; },
  'a report for another candidate': evaluated => {
    const other = JSON.parse(evaluated.content);
    other.files['glue.json'] = other.files['glue.json'].replace('Add two integers', 'Add two values');
    evaluated.content = JSON.stringify(other);
  },
};
