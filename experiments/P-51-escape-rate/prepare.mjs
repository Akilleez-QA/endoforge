import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../core/runtime/x1/compiler.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { CLASSES, CAP_PER_CLASS, enumerateGlue, enumerateKernel, selectKernelMutants } from './mutate.mjs';
import { difference, gridsFor, load, regenerateTests } from './probe.mjs';
const here = fileURLToPath(new URL('./', import.meta.url)), root = resolve(here, '../..');
export const needOf = id => id.startsWith('add-') ? 'add' : id;
export const cohortOf = id => id.startsWith('add-') ? 'add' : 'P21';
export function loadCorpus(corpusRoot, arm) {
  const rows = [];
  for (const run of readdirSync(corpusRoot).filter(n => new RegExp(`^${arm}-r\\d+$`).test(n)).sort()) {
    const thread = join(corpusRoot, run, 'thread');
    for (const name of readdirSync(thread).filter(n => n.endsWith('.json')).sort()) {
      const row = JSON.parse(readFileSync(join(thread, name), 'utf8'));
      if (!row.promoted) continue;
      const directory = join(thread, row.id, 'candidate');
      const read = file => readFileSync(join(directory, file), 'utf8');
      rows.push({ key: `${run}/${row.id}`, id: row.id, run, arm, need: needOf(row.id), cohort: cohortOf(row.id), source: read('kernel.ts'), testsText: read('tests.json'), tests: JSON.parse(read('tests.json')), contract: read('CONTRACT.md'), glue: read('glue.json') });
    }
  }
  return rows;
}
export function manifest(corpus) {
  return corpus.map(k => ({ key: k.key, kernel: hash(k.source), tests: hash(k.testsText), contract: hash(k.contract), glue: hash(k.glue) }));
}
const limit = (width, items, work) => {
  let cursor = 0;
  return Promise.all(Array.from({ length: width }, async () => { while (cursor < items.length) { const index = cursor++; await work(items[index], index); } }));
};
export async function prepare({ corpus, peers = [], asc, output, width = 12, log = () => {} }) {
  mkdirSync(output, { recursive: true });
  const stream = createWriteStream(join(output, 'mutants.jsonl'));
  const counts = { kernels: corpus.length, enumerated: 0, deduplicatedSelected: 0, stillborn: 0, identicalWasm: 0, duplicateWasm: 0, equivalent: 0, nonEquivalent: 0, witnessFiniteOnly: 0, witnessNonFiniteOnly: 0, baselineCompileFailed: 0, perClass: Object.fromEntries(CLASSES.map(c => [c, { available: 0, selected: 0, stillborn: 0, identicalWasm: 0, duplicateWasm: 0, equivalent: 0, nonEquivalent: 0, nonFiniteOnly: 0 }])), glueProposed: 0, glueUnchanged: 0, binding: 0 };
  const baselines = {};
  const compileAll = [...corpus, ...peers];
  await limit(width, compileAll, async kernel => {
    const compiled = await compile({ 'kernel.ts': kernel.source }, asc);
    if (compiled.error) { counts.baselineCompileFailed++; return; }
    baselines[kernel.key] = compiled.wasm;
  });
  writeFileSync(join(output, 'baselines.json'), JSON.stringify(baselines));
  const rows = [];
  for (const kernel of corpus) {
    if (!baselines[kernel.key]) continue;
    const glue = JSON.parse(kernel.glue);
    const decimalZero = new Set(glue.exports.filter(e => e.result.precision === 0 || e.result.kind === 'integer' || e.result.kind === 'code').map(e => e.name));
    const resultUnits = Object.fromEntries(glue.exports.map(e => [e.name, e.result.unit ?? '']));
    const all = enumerateKernel(kernel.source, { decimalZero, resultUnits });
    counts.enumerated += all.length;
    const { selected, available } = selectKernelMutants(kernel.key, all, CAP_PER_CLASS);
    for (const name of CLASSES) counts.perClass[name].available += available[name];
    counts.deduplicatedSelected += selected.length;
    selected.forEach((mutant, index) => rows.push({ kernel, mutant, index }));
  }
  let done = 0;
  const seenWasm = new Map();
  await limit(width, rows, async ({ kernel, mutant, index }) => {
    const stats = counts.perClass[mutant.class];
    stats.selected++;
    const compiled = await compile({ 'kernel.ts': mutant.source }, asc);
    if (++done % 500 === 0) log(`compiled ${done}/${rows.length}`);
    if (compiled.error) { counts.stillborn++; stats.stillborn++; return; }
    const digest = createHash('sha256').update(compiled.wasm).digest('hex');
    if (compiled.wasm === baselines[kernel.key]) { counts.identicalWasm++; stats.identicalWasm++; return; }
    const seen = seenWasm.get(kernel.key) ?? new Set();
    seenWasm.set(kernel.key, seen);
    if (seen.has(`${mutant.class}|${digest}`)) { counts.duplicateWasm++; stats.duplicateWasm++; return; }
    seen.add(`${mutant.class}|${digest}`);
    const baseline = load(baselines[kernel.key]), candidate = load(compiled.wasm);
    const witness = difference(baseline, candidate, gridsFor(kernel.source, mutant.source, kernel.tests, baseline));
    if (!witness.finite && !witness.nonFinite) { counts.equivalent++; stats.equivalent++; return; }
    counts.nonEquivalent++; stats.nonEquivalent++;
    if (!witness.finite) { counts.witnessNonFiniteOnly++; stats.nonFiniteOnly++; } else counts.witnessFiniteOnly++;
    const regenerated = regenerateTests(kernel.tests, load(compiled.wasm));
    stream.write(`${JSON.stringify({ mutant: `${kernel.key}#${mutant.class}#${index}`, key: kernel.key, id: kernel.id, need: kernel.need, cohort: kernel.cohort, surface: 'kernel', class: mutant.class, op: mutant.op, source: mutant.source, wasm: compiled.wasm, witness: { finite: Boolean(witness.finite), nonFinite: Boolean(witness.nonFinite) }, correlatedTests: JSON.stringify(regenerated.tests), correlatedNonFinite: regenerated.nonFinite })}\n`);
  });
  for (const kernel of corpus) {
    if (!baselines[kernel.key]) continue;
    const proposed = enumerateGlue(kernel.glue);
    counts.glueProposed += proposed.length;
    proposed.forEach((mutant, index) => stream.write(`${JSON.stringify({ mutant: `${kernel.key}#glue#${index}`, key: kernel.key, id: kernel.id, need: kernel.need, cohort: kernel.cohort, surface: 'glue', class: mutant.class, op: mutant.op, glue: mutant.glue })}\n`));
    const tests = JSON.parse(kernel.testsText), first = tests.findIndex(t => typeof t.expect === 'number');
    if (first >= 0) {
      tests[first] = { ...tests[first], expect: tests[first].expect + 1 };
      stream.write(`${JSON.stringify({ mutant: `${kernel.key}#binding#tests`, key: kernel.key, id: kernel.id, need: kernel.need, cohort: kernel.cohort, surface: 'binding', class: 'stale_binding', op: 'tests_changed_after_freeze', driftTests: JSON.stringify(tests) })}\n`);
      counts.binding++;
    }
    stream.write(`${JSON.stringify({ mutant: `${kernel.key}#binding#contract`, key: kernel.key, id: kernel.id, need: kernel.need, cohort: kernel.cohort, surface: 'binding', class: 'stale_binding', op: 'contract_changed_after_freeze', driftContract: `${kernel.contract}\nRevision after freeze.\n` })}\n`);
    counts.binding++;
  }
  await new Promise(done => stream.end(done));
  writeFileSync(join(output, 'prepared.json'), JSON.stringify({ counts, capPerClass: CAP_PER_CLASS }, null, 2));
  return counts;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpusRoot = process.env.P51_CORPUS, output = resolve(process.env.P51_OUTPUT || ''), asc = process.env.ENDOFORGE_ASC_CMD;
  if (!corpusRoot || !process.env.P51_OUTPUT || !asc) throw Error('P51_CORPUS, P51_OUTPUT and ENDOFORGE_ASC_CMD required');
  if (!relative(root, output).split(sep).includes('..')) throw Error('P51_OUTPUT must be outside checkout');
  const corpus = loadCorpus(corpusRoot, 'cand'), peers = loadCorpus(corpusRoot, 'base');
  mkdirSync(output, { recursive: true });
  const corpusManifest = { cand: manifest(corpus), base: manifest(peers) };
  writeFileSync(join(output, 'corpus-manifest.json'), JSON.stringify(corpusManifest, null, 2));
  const counts = await prepare({ corpus, peers, asc, output, width: Number(process.env.P51_WIDTH) || 12, log: console.error });
  console.log(JSON.stringify({ corpusManifestSha256: hash(JSON.stringify(corpusManifest, null, 2)), counts }, null, 2));
  if (!existsSync(join(output, 'mutants.jsonl'))) process.exit(1);
}
