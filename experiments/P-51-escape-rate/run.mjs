import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { runNeed } from '../../core/runtime/x1/pipeline.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { runGates } from '../../core/runtime/x1/gates.mjs';
import { loadCorpus } from './prepare.mjs';
const here = fileURLToPath(new URL('./', import.meta.url)), root = resolve(here, '../..');
const sha = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
export function caseFor(row, kernel, arm) {
  if (arm === 'control') return { contract: kernel.contract, tests: kernel.testsText, kernel: kernel.source, glue: kernel.glue };
  const base = { contract: kernel.contract, tests: kernel.testsText, kernel: kernel.source, glue: kernel.glue };
  if (row.surface === 'glue') return { ...base, glue: row.glue };
  if (row.surface === 'binding') return { ...base, ...(row.driftTests ? { driftTests: row.driftTests } : {}), ...(row.driftContract ? { driftContract: row.driftContract } : {}) };
  return { ...base, kernel: row.source, tests: arm === 'correlated' ? row.correlatedTests : kernel.testsText };
}
export async function submit({ replay, pool, asc, scratch, name, wasm }) {
  const directory = join(scratch, `p51-${sha(name)}`), casePath = `${directory}.case.json`, home = `${directory}.home`;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(casePath, JSON.stringify(replay));
  const env = { ...process.env, ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, join(here, 'replay-codex.mjs')]), CODEX_HOME: home, ENDOFORGE_ASC_CMD: asc, ENDOFORGE_CODEX_TERSE: 'scalar', ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_SELF_CHECK: '0', P51_CASE: casePath };
  try {
    const result = await runNeed({ need: `Replayed candidate ${sha(name)}; no model.`, directory, pool, env });
    const outcome = { promoted: result.promoted === true, error: result.error ?? null };
    if (!outcome.promoted) outcome.caught = attribute(directory, wasm, result);
    return outcome;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(casePath, { force: true });
  }
}
function attribute(directory, wasm, result) {
  if (result.error && !existsSync(join(directory, 'candidate', 'kernel.ts'))) return 'before_candidate';
  if (!wasm) return result.error ? 'pipeline_stage' : 'unattributed';
  try {
    const read = name => readFileSync(join(directory, 'candidate', name), 'utf8');
    const files = Object.fromEntries(['CONTRACT.md', 'tests.json', 'frozen.sha256', 'kernel.ts', 'glue.json'].map(name => [name, read(name)]));
    const id = directory.split(sep).pop();
    const gates = runGates({ id, files, compiled: { source: hash(files['kernel.ts']), wasm } });
    const failed = Object.entries(gates.gates).filter(([, g]) => !g.ok).map(([n]) => n);
    return failed.length ? failed.join('+') : result.error ? 'pipeline_stage' : 'gates_passed_decision_refused';
  } catch { return 'pipeline_stage'; }
}
export async function loadRows(path, surfaces) {
  const rows = [];
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (surfaces.includes(row.surface)) rows.push(row);
  }
  return rows;
}
export async function drive({ rows, kernels, arm, caseArm = arm, output, pool, asc, width, scratch, baselines, log = () => {} }) {
  const path = join(output, `${arm}.jsonl`), done = new Set();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).mutant);
  const pending = rows.filter(r => !done.has(r.mutant));
  let cursor = 0, finished = 0;
  const start = Date.now();
  await Promise.all(Array.from({ length: width }, async () => {
    while (cursor < pending.length) {
      const row = pending[cursor++], kernel = kernels[row.key];
      const name = `${arm}|${row.mutant}`;
      let outcome;
      try { outcome = await submit({ replay: caseFor(row, kernel, caseArm), pool, asc, scratch, name, wasm: row.wasm ?? baselines[row.key] }); }
      catch (error) { outcome = { promoted: false, error: `harness: ${error.message}`, caught: 'harness_error' }; }
      appendFileSync(path, `${JSON.stringify({ mutant: row.mutant, arm, key: row.key, id: row.id, need: row.need, cohort: row.cohort, surface: row.surface, class: row.class, op: row.op, witness: row.witness ?? null, ...outcome })}\n`);
      if (++finished % 250 === 0) log(`${arm} ${finished}/${pending.length} ${(finished * 1000 / (Date.now() - start)).toFixed(1)}/s`);
    }
  }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corpusRoot = process.env.P51_CORPUS, output = resolve(process.env.P51_OUTPUT || ''), prep = process.env.P51_PREP, asc = process.env.ENDOFORGE_ASC_CMD, arms = (process.env.P51_ARMS || 'control,sampled,glue,binding,correlated').split(',');
  if (!corpusRoot || !process.env.P51_OUTPUT || !prep || !asc) throw Error('P51_CORPUS, P51_PREP, P51_OUTPUT and ENDOFORGE_ASC_CMD required');
  if (!relative(root, output).split(sep).includes('..')) throw Error('P51_OUTPUT must be outside checkout');
  const precommit = hash(readFileSync(join(here, 'PRECOMMIT.md')));
  assert.equal(readFileSync(join(here, 'receipt/precommit.sha256'), 'utf8').split(/\s/)[0], precommit);
  mkdirSync(output, { recursive: true });
  const width = Number(process.env.P51_WIDTH) || 14, scratch = process.env.P51_SCRATCH || tmpdir();
  const corpus = loadCorpus(corpusRoot, 'cand'), kernels = Object.fromEntries(corpus.map(k => [k.key, k]));
  const baselines = JSON.parse(readFileSync(join(prep, 'baselines.json'), 'utf8'));
  writeFileSync(join(output, 'environment.json'), JSON.stringify({ precommit, node: process.version, gates: hash(readFileSync(join(root, 'core/runtime/x1/gates.mjs'))), host: hash(readFileSync(join(root, 'core/runtime/x1/host.mjs'))), width, arms, started: new Date().toISOString() }, null, 2));
  const pool = new IsolatePool({ hostPort: join(root, 'core/runtime/x1/host.mjs'), size: width, isolation: 'thread', prewarm: true });
  await pool.ready();
  try {
    for (const arm of arms) {
      if (arm === 'correlated-retry') {
        const retry = new Set(readFileSync(join(output, 'correlated.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(r => ['gates_passed_decision_refused', 'before_candidate'].includes(r.caught)).map(r => r.mutant));
        await drive({ rows: (await loadRows(join(prep, 'mutants.jsonl'), ['kernel'])).filter(r => retry.has(r.mutant)), kernels, arm, caseArm: 'correlated', output, pool, asc, width, scratch, baselines, log: console.error });
        console.error(`${arm} complete`);
        continue;
      }
      const rows = arm === 'control' ? corpus.map(k => ({ mutant: `${k.key}#control`, key: k.key, id: k.id, need: k.need, cohort: k.cohort, surface: 'control', class: 'control', op: 'pristine' }))
        : await loadRows(join(prep, 'mutants.jsonl'), arm === 'glue' ? ['glue'] : arm === 'binding' ? ['binding'] : ['kernel']);
      await drive({ rows, kernels, arm, output, pool, asc, width, scratch, baselines, log: console.error });
      console.error(`${arm} complete`);
    }
  } finally { await pool.close(); }
}
