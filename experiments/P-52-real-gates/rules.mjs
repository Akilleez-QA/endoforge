import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glueProblems, nonFiniteExpectation, probeProblem } from '../../core/runtime/x1/contract.mjs';
import { callKernel, freshKernel, kernelFuel, probeCalls } from '../../core/runtime/x1/measure.mjs';
import { loadKernel } from '../../core/runtime/x1/meter.mjs';
import { loadCorpus } from '../P-51-escape-rate/prepare.mjs';
const [corpusRoot, baselinesPath, output] = process.argv.slice(2);
const baselines = JSON.parse(readFileSync(baselinesPath, 'utf8'));
const kinds = [['names', /differ from kernel parameters/], ['precision', /contract states/], ['unit', /disagrees with the name/], ['codes', /fit the contract better/]];
const kindOf = text => kinds.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
const split = key => (key.startsWith('base') ? 'base' : key.startsWith('cand-r1/') ? 'development' : 'held-out');
const blank = () => ({ kernels: 0, flagged: 0, names: 0, precision: 0, unit: 0, codes: 0, nonFiniteFlagged: 0, expectations: {}, details: [] });
const tally = { development: blank(), 'held-out': blank(), base: blank() };
const mislabel = {};
const count = (name, problems) => {
  mislabel[name] ??= { total: 0, byNames: 0, byAnyRule: 0 };
  mislabel[name].total++;
  if (problems.some(p => kindOf(p) === 'names')) mislabel[name].byNames++;
  if (problems.length) mislabel[name].byAnyRule++;
};
const dropSuffix = name => name.replace(/([a-z0-9])[A-Z][A-Za-z0-9]*$/, '$1');
for (const arm of ['cand', 'base']) for (const kernel of loadCorpus(corpusRoot, arm)) {
  const row = tally[split(kernel.key)], glue = JSON.parse(kernel.glue), base = { source: kernel.source, contract: kernel.contract };
  row.kernels++;
  const problems = glueProblems(glue, base);
  if (problems.length) { row.flagged++; row.details.push(`${kernel.key}: ${problems.join(' | ')}`); }
  for (const [kind] of kinds) if (problems.some(p => kindOf(p) === kind)) row[kind]++;
  if (baselines[kernel.key]) {
    const loaded = loadKernel(Buffer.from(baselines[kernel.key], 'base64'), kernelFuel), names = Object.keys(loaded.shape.functions);
    const expected = nonFiniteExpectation(kernel.contract, names), fresh = freshKernel(loaded), seen = new Set(), tests = JSON.parse(kernel.testsText);
    for (const name of new Set(tests.map(t => t.fn))) if (loaded.shape.functions[name]?.params.some(p => p[0] === 'f')) row.expectations[expected[name]] = (row.expectations[expected[name]] ?? 0) + 1;
    for (const { fn, args } of probeCalls(tests, loaded.shape.functions)) {
      const problem = probeProblem(expected[fn], callKernel(fresh, fn, args));
      if (problem) seen.add(`${fn} [${expected[fn]}] ${problem}`);
    }
    if (seen.size) { row.nonFiniteFlagged++; row.details.push(`${kernel.key}: ${[...seen].join(' | ')}`); }
  }
  if (arm !== 'cand') continue;
  glue.exports.forEach((entry, e) => {
    entry.args.forEach((arg, a) => {
      const change = edit => { const copy = structuredClone(glue); edit(copy.exports[e].args); return copy; };
      const stripped = dropSuffix(arg.name);
      if (stripped !== arg.name) count('unit suffix dropped from a name', glueProblems(change(args => { args[a].name = stripped; }), base));
      const next = entry.args[a + 1];
      if (!next) return;
      count('whole argument entries in the wrong order', glueProblems(change(args => { [args[a], args[a + 1]] = [args[a + 1], args[a]]; }), base));
      count('names swapped, units and order kept', glueProblems(change(args => { [args[a].name, args[a + 1].name] = [args[a + 1].name, args[a].name]; }), base));
      if (arg.unit !== next.unit) count('units swapped, names kept', glueProblems(change(args => { [args[a].unit, args[a + 1].unit] = [args[a + 1].unit, args[a].unit]; }), base));
      const swapped = kernel.source.replace(new RegExp(`\\b(${arg.name})\\b(\\s*:[^,)]*,\\s*)\\b(${next.name})\\b`), `$3$2$1`);
      if (swapped !== kernel.source) count('same wrong order in kernel signature and glue', glueProblems(change(args => { [args[a].name, args[a + 1].name] = [args[a + 1].name, args[a].name]; }), { ...base, source: swapped }));
    });
  });
}
const report = { tally, mislabel };
writeFileSync(output, JSON.stringify(report, null, 2));
for (const [name, row] of Object.entries(tally)) { const { details, ...rest } = row; console.log(name, JSON.stringify(rest)); for (const line of details) console.log('  ', line.slice(0, 240)); }
console.log(JSON.stringify(mislabel, null, 1));
