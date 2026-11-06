import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openLibrary } from '../../core/library/library.mjs';
import { capabilityFromGlue, numerals, sha256 } from '../../core/library/key.mjs';
import { accepted, gridFor, loaded } from '../../core/library/discriminate.mjs';
import { declaredCases, mutantCase } from './near-miss.mjs';
const here = fileURLToPath(new URL('./', import.meta.url));
const corpus = process.env.P53_CORPUS, p51 = process.env.P53_P51, output = process.env.P53_OUTPUT, width = Number(process.env.P53_WIDTH) || 8;
if (!corpus || !p51 || !output) throw Error('P53_CORPUS, P53_P51 and P53_OUTPUT required');
if (!resolve(output).split('/').includes('.scratch') && resolve(output).startsWith(resolve(here, '../..'))) throw Error('output must stay out of git');
mkdirSync(output, { recursive: true });
const precommit = createHash('sha256').update(readFileSync(join(here, 'PRECOMMIT.md'))).digest('hex');
const recorded = readFileSync(join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0];
if (precommit !== recorded) throw Error('PRECOMMIT.md differs from its receipt');
const manifest = JSON.parse(readFileSync(join(p51, 'prep/corpus-manifest.json'), 'utf8')).cand;
const kernels = new Map();
for (const row of manifest) {
  const [run, id] = row.key.split('/'), directory = join(corpus, run, 'thread', id), candidate = join(directory, 'candidate');
  const read = name => readFileSync(join(candidate, name), 'utf8');
  const files = { 'kernel.ts': read('kernel.ts'), 'tests.json': read('tests.json'), 'CONTRACT.md': read('CONTRACT.md'), 'glue.json': read('glue.json'), 'frozen.sha256': read('frozen.sha256') };
  for (const [field, name] of [['kernel', 'kernel.ts'], ['tests', 'tests.json'], ['contract', 'CONTRACT.md'], ['glue', 'glue.json']]) if (sha256(files[name]) !== row[field]) throw Error(`manifest differs: ${row.key} ${name}`);
  kernels.set(row.key, { key: row.key, run, id, cohort: id.startsWith('add-') ? 'add' : 'P21', need: id.startsWith('add-') ? 'add' : id, directory, candidate, files, capability: capabilityFromGlue(JSON.parse(files['glue.json'])), contract: files['CONTRACT.md'], tests: JSON.parse(files['tests.json']) });
}
const frozenFiles = (contract, tests) => { const text = JSON.stringify(tests); return { 'CONTRACT.md': contract, 'tests.json': text, 'frozen.sha256': JSON.stringify({ contract: sha256(contract), tests: sha256(text) }) }; };
const MODES = ['contract', 'interface', 'prose'], GATES = ['full', 'mutants', 'none'];
const library = await openLibrary({ cells: width, deadlineMs: 30000, gate: 'none' });
const admitBegin = performance.now();
const outcomes = await library.admit([...kernels.values()].map(k => ({ ledger: join(k.directory, 'ledger.sqlite'), promotion: join(k.directory, 'promotion.json'), label: { key: k.key, run: k.run, need: k.need, cohort: k.cohort } })));
const admission = { admitted: outcomes.filter(o => o.admitted).length, refused: outcomes.filter(o => !o.admitted).map(o => o.reason), duplicates: outcomes.filter(o => o.duplicateOf).length, hostMatches: outcomes.filter(o => o.hostMatches).length, wallMs: performance.now() - admitBegin };
const byKey = new Map([...library.entries.values()].map(entry => [entry.label.key, entry]));
const cache = new Map();
const judge = (found, need) => {
  const id = sha256(`${found.entry.id}|${JSON.stringify(found.tests)}|${numerals(need.files['CONTRACT.md']).join()}`);
  if (!cache.has(id)) cache.set(id, library.qualify(found.entry, need, found.tests, 'full'));
  return cache.get(id);
};
const verdicts = run => {
  if (run.error) return { error: run.error, full: false, mutants: false, none: false };
  const r = run.result;
  if (!r.promotable) return { evaluatorFailed: true, full: false, mutants: false, none: false };
  return { none: true, mutants: library.survivors(r.discrimination, 'mutants') === 0, full: library.survivors(r.discrimination, 'full') === 0, discrimination: r.discrimination };
};
const limit = async (items, work) => { let next = 0; await Promise.all(Array.from({ length: width * 2 }, async () => { while (next < items.length) { const i = next++; await work(items[i], i); } })); };
const blank = () => ({ cases: 0, ...Object.fromEntries(MODES.flatMap(m => [[`${m}.matched`, 0], ...GATES.map(g => [`${m}.${g}`, 0])])), reasons: {} });
const record = async (table, label, need, options = {}) => {
  const row = table[label] ??= blank();
  row.cases++;
  const served = {};
  for (const mode of MODES) {
    const found = library.lookup(need, { mode, excludeRun: options.excludeRun ?? null });
    if (found.status !== 'hit') { if (mode === 'contract') row.reasons[found.reason] = (row.reasons[found.reason] ?? 0) + 1; continue; }
    row[`${mode}.matched`]++;
    const outcome = verdicts(await judge(found, need));
    if (mode === 'contract') { const why = outcome.error ?? (outcome.evaluatorFailed ? 'evaluator_failed' : outcome.full ? 'served' : 'evaluator_cannot_discriminate'); row.reasons[why] = (row.reasons[why] ?? 0) + 1; }
    for (const gate of GATES) if (outcome[gate]) row[`${mode}.${gate}`]++;
    served[mode] = { found, outcome };
  }
  return served;
};
const heldOut = {}, audit = { compared: 0, disagreements: [] }, perNeed = {};
await limit([...kernels.values()], async kernel => {
  const need = { id: kernel.id, capability: kernel.capability, files: { 'CONTRACT.md': kernel.contract, 'tests.json': kernel.files['tests.json'], 'frozen.sha256': kernel.files['frozen.sha256'] } };
  const served = await record(heldOut, kernel.cohort, need, { excludeRun: kernel.run });
  const need2 = perNeed[kernel.need] ??= { n: 0, contractFull: 0, interfaceNone: 0 };
  need2.n++;
  if (served.contract?.outcome.full) need2.contractFull++;
  if (served.interface?.outcome.none) need2.interfaceNone++;
  for (const [mode, gate] of [['contract', 'full'], ['interface', 'full'], ['interface', 'none'], ['contract', 'none']]) {
    const hit = served[mode];
    if (!hit?.outcome[gate]) continue;
    const own = loaded(Buffer.from(byKey.get(kernel.key).wasm, 'base64')), other = loaded(Buffer.from(hit.found.entry.wasm, 'base64'));
    let witness = null;
    for (const item of kernel.capability.exports) {
      for (const args of gridFor(item, kernel.tests, numerals(kernel.contract))) {
        const a = own(item.name, args), b = other(hit.found.binding[item.name], args);
        const same = a.trap || b.trap ? Boolean(a.trap) === Boolean(b.trap) : Object.is(a.value, b.value) || Math.abs(a.value - b.value) <= 1e-9 * Math.max(1, Math.abs(a.value), Math.abs(b.value));
        if (!same) { witness = { fn: item.name, trapDiffers: Boolean(a.trap) !== Boolean(b.trap) }; break; }
      }
      if (witness) break;
    }
    audit.compared++;
    if (witness) audit.disagreements.push({ need: kernel.key, served: hit.found.entry.label.key, mode, gate, ...witness });
  }
});
const adversarial = {};
const declared = [...kernels.values()].flatMap(declaredCases);
await limit(declared, async c => {
  const need = { id: c.key, capability: c.capability, files: frozenFiles(c.contract, c.tests) };
  await record(adversarial, `${c.arm}/${c.class}/${c.flavour}`, need);
});
const stream = createInterface({ input: createReadStream(join(p51, 'prep/mutants.jsonl')) });
const rows = [];
let mutantRows = 0, skippedNonFinite = 0;
for await (const line of stream) {
  const row = JSON.parse(line);
  if (row.surface !== 'kernel') continue;
  const kernel = kernels.get(row.key);
  const call = loaded(Buffer.from(byKey.get(row.key).wasm, 'base64'));
  const c = mutantCase(row, kernel, tests => tests.every(t => accepted(t, call(t.fn, t.args))));
  if (!c) { if (row.correlatedNonFinite) skippedNonFinite++; continue; }
  mutantRows++;
  rows.push(c);
}
const mutantTable = {};
await limit(rows, async c => {
  await record(mutantTable, `${c.arm}/${c.class}`, { id: c.key, capability: c.capability, files: frozenFiles(c.contract, c.tests) });
});
const mutantStats = { reached: 0, unsupported: 0, capped: 0, invalid: 0, mutants: 0 };
for (const pending of cache.values()) {
  const d = (await pending).result?.discrimination;
  if (!d) continue;
  mutantStats.reached++; mutantStats.mutants += d.mutants; mutantStats.invalid += d.invalid;
  if (d.unsupported) mutantStats.unsupported++;
  if (d.capped) mutantStats.capped++;
}
await library.close();
const percentile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
const stats = values => values.length ? { n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: Math.max(...values) } : { n: 0 };
const journalPath = join(output, 'warm.jsonl');
rmSync(journalPath, { force: true });
const spawnLog = process.env.P53_SPAWN_LOG;
const warm = await openLibrary({ journal: journalPath, cells: 1, deadlineMs: 30000 });
await warm.admit([...kernels.values()].map(k => ({ ledger: join(k.directory, 'ledger.sqlite'), promotion: join(k.directory, 'promotion.json'), label: { key: k.key, run: k.run, need: k.need, cohort: k.cohort } })));
const spawnsBefore = spawnLog && existsSync(spawnLog) ? readFileSync(spawnLog, 'utf8').trim().split('\n').length : 0;
const timing = { pass: [], refused: [], miss: [] };
for (const round of [0, 1]) for (const kernel of kernels.values()) {
  const need = { id: kernel.id, capability: kernel.capability, files: { 'CONTRACT.md': kernel.contract, 'tests.json': kernel.files['tests.json'], 'frozen.sha256': kernel.files['frozen.sha256'] } };
  let begin = performance.now();
  const outcome = await warm.serve(need);
  if (round) timing[outcome.verdict].push(performance.now() - begin);
  const other = { ...need, capability: { ...kernel.capability, exports: kernel.capability.exports.map(e => ({ ...e, result: { ...e.result, unit: 'no-such-unit' } })) } };
  begin = performance.now();
  await warm.serve(other);
  if (round) timing.miss.push(performance.now() - begin);
}
const warmSpawns = (spawnLog && existsSync(spawnLog) ? readFileSync(spawnLog, 'utf8').trim().split('\n').length : 0) - spawnsBefore;
await warm.close();
const journalBytes = statSync(journalPath).size;
const memory = JSON.parse(execFileSync(process.execPath, ['--expose-gc', join(here, 'memory.mjs'), journalPath], { encoding: 'utf8' }));
const generation = [];
const ids = [...kernels.values()].filter(k => k.run === 'cand-r1').slice(0, 5);
for (const k of ids) {
  const log = join(output, `spawns-${k.id}.log`);
  rmSync(log, { force: true });
  writeFileSync(log, '');
  generation.push(JSON.parse(execFileSync(process.execPath, ['--import', join(here, 'count-spawns.mjs'), join(here, 'generation-path.mjs'), k.candidate, byKey.get(k.key).wasm, k.id, log], { encoding: 'utf8', env: { ...process.env, P53_SPAWN_LOG: log } })));
}
const stages = { total: [], generate: [], spec: [], implementation: [], notModel: [] };
for (const k of kernels.values()) {
  const row = JSON.parse(readFileSync(join(k.directory, '..', `${k.id}.json`), 'utf8')), t = row.timings;
  stages.total.push(t.total); stages.generate.push(t.generate); stages.notModel.push(t.total - t.generate);
  const trace = join(k.directory, '..', '..', '..', `${k.run}-trace`);
  const files = existsSync(trace) ? readdirSync(trace).filter(n => n.startsWith(`${k.id}-`)).sort((a, b) => a.localeCompare(b)) : [];
  const span = name => { const times = [...readFileSync(join(trace, name), 'utf8').matchAll(/"t":(\d+)/g)].map(m => Number(m[1])); return times.at(-1) - times[0]; };
  if (files.length === 2) { stages.spec.push(span(files[0])); stages.implementation.push(span(files[1])); }
}
const summary = { precommit, node: process.version, admission, heldOut, perNeed, audit: { compared: audit.compared, disagreementCount: audit.disagreements.length, disagreements: audit.disagreements }, adversarial, mutantTable, mutantRows, skippedNonFinite, declaredCases: declared.length, mutantStats,
  warmPath: { pass: stats(timing.pass), refused: stats(timing.refused), miss: stats(timing.miss), spawns: warmSpawns, spawnCounted: Boolean(spawnLog) }, memory: { ...memory, journalBytesPerRecord: journalBytes / (kernels.size + 2 * kernels.size * 2) },
  generationPath: { replayed: generation, recorded: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, stats(v)])) } };
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('wrote', join(output, 'summary.json'));
