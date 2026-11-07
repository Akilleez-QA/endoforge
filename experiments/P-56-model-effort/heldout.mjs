// Run held-out tests on a promoted candidate with the unchanged X1 gate code.
// The candidate's own tests.json is replaced by the held-out tests and frozen.sha256 is
// recomputed for them, so G1 binds the held-out file. Only G3 (exports) and G4 (values and
// traps) are read; G7 glue rules are about the candidate's own tests and are ignored here.
import { hash } from '../../core/runtime/x1/host.mjs';
import { runGates } from '../../core/runtime/x1/gates.mjs';

export function heldOut(content, tests) {
  const candidate = JSON.parse(content);
  const testsText = JSON.stringify(tests);
  const files = { ...candidate.files, 'tests.json': testsText, 'frozen.sha256': JSON.stringify({ contract: hash(candidate.files['CONTRACT.md']), tests: hash(testsText) }) };
  const result = runGates({ ...candidate, files });
  const g3 = result.gates.G3_exports, g4 = result.gates.G4_tests;
  if (!result.gates.G1_frozen?.ok || !result.gates.G2_compiles?.ok) return { clean: false, reason: 'held-out harness could not bind or load the candidate', gates: result.gates };
  if (!g3?.ok) return { clean: false, reason: g3?.why ?? 'exports', passed: 0, total: tests.length, failed: tests.map(test => test.name) };
  return { clean: Boolean(g4?.ok), passed: g4.passed, total: g4.total, failed: result.tests.filter(test => !test.pass).map(({ name, fn, args, expect, got }) => ({ name, fn, args, expect, got })) };
}
