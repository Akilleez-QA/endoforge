import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
const [tree, corpus, prep, output] = process.argv.slice(2), load = path => import(resolve(tree, path));
const { runGates } = await load('core/runtime/x1/gates.mjs');
const { createPort, hash, configuration } = await load('core/runtime/x1/host.mjs');
const { runUniversalGates } = await load('core/engine/gates.mjs');
const { loadCorpus } = await load('experiments/P-51-escape-rate/prepare.mjs');
const kernels = Object.fromEntries(loadCorpus(corpus, 'cand').map(kernel => [kernel.key, kernel]));
const lines = [], freeze = (contract, tests) => JSON.stringify({ contract: hash(contract), tests: hash(tests) });
for await (const line of createInterface({ input: createReadStream(join(prep, 'mutants.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (row.surface !== 'kernel') continue;
  const kernel = kernels[row.key], glue = JSON.parse(kernel.glue);
  glue.id = 'candidate';
  const files = { 'CONTRACT.md': kernel.contract, 'tests.json': kernel.testsText, 'frozen.sha256': freeze(kernel.contract, kernel.testsText), 'kernel.ts': row.source, 'glue.json': JSON.stringify(glue) };
  const candidate = { id: 'candidate', files, compiled: { source: hash(row.source), wasm: row.wasm } }, identity = hash(JSON.stringify(candidate));
  const port = createPort({ candidates: { [identity]: candidate } });
  let promoted = true, at = null;
  for (let round = 0; round < 2 && promoted; round++) {
    const universal = await runUniversalGates({ ...structuredClone(configuration.gateInput), candidate: identity }, port);
    if (!universal.passed) { promoted = false; at = universal.firstFailure; break; }
    const result = runGates(candidate);
    if (!result.promotable) { promoted = false; at = Object.entries(result.gates).filter(([, gate]) => !gate.ok).map(([name]) => name).join('+'); }
  }
  lines.push(JSON.stringify({ mutant: row.mutant, key: row.key, cohort: row.cohort, class: row.class, op: row.op, witness: row.witness, promoted, at }));
}
writeFileSync(output, `${lines.join('\n')}\n`);
const count = cohort => { const list = lines.map(line => JSON.parse(line)).filter(row => row.cohort === cohort); return [list.filter(row => row.promoted).length, list.length]; };
console.log(JSON.stringify({ P21: count('P21'), add: count('add') }));
