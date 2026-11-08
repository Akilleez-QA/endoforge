import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha } from './corpus.mjs';
import { evaluator, injections, passes } from './mutate.mjs';

const here = file => new URL(file, import.meta.url);
const root = new URL('../../', import.meta.url).pathname;
export const beforeCommit = 'f97da96';

export async function oracles(output) {
  const source = execFileSync('git', ['show', `${beforeCommit}:core/runtime/x1/oracle.mjs`], { cwd: root, encoding: 'utf8' })
    .replace("from './contract.mjs'", `from '${pathToFileURL(join(root, 'core/runtime/x1/contract.mjs'))}'`).replace("from './gates.mjs'", `from '${pathToFileURL(join(root, 'core/runtime/x1/gates.mjs'))}'`);
  const file = join(output, 'oracle-before.mjs');
  writeFileSync(file, source);
  return { before: await import(pathToFileURL(file)), after: await import(here('../../core/runtime/x1/oracle.mjs')), beforeSha: sha(source), afterSha: sha(readFileSync(here('../../core/runtime/x1/oracle.mjs'))) };
}

const decide = (oracle, contract, tests) => {
  const analysis = oracle.analyzeSpecification({ 'CONTRACT.md': contract, 'tests.json': JSON.stringify(tests) }, { reference: false });
  return analysis ? analysis.decisions.map(d => ({ status: d.status, why: d.why, sources: d.sources })) : null;
};

export function measure(specs, { before, after }) {
  const pristine = [], injected = [], excluded = [];
  for (const spec of specs) {
    let tests;
    try { tests = JSON.parse(spec.tests); } catch { excluded.push({ hash: spec.hash, why: 'tests not JSON' }); continue; }
    const run = evaluator(spec.compiled);
    const failing = tests.filter(t => !(t && Array.isArray(t.args) && passes(t, run(t.fn, t.args))) && typeof t?.expect !== 'string');
    if (failing.length) { excluded.push({ hash: spec.hash, why: `kernel fails ${failing.length} of its frozen tests here` }); continue; }
    const b = decide(before, spec.contract, tests), a = decide(after, spec.contract, tests);
    tests.forEach((test, index) => pristine.push({ hash: spec.hash, need: spec.need, index, kind: test.expectError ? 'trap' : typeof test.expect, before: b?.[index]?.status ?? 'unanalyzed', after: a?.[index]?.status ?? 'unanalyzed', why: a?.[index]?.why ?? null }));
    for (const item of injections(spec, tests, run)) {
      const mutated = tests.map((t, i) => i === item.index ? item.test : t);
      const mb = decide(before, spec.contract, mutated), ma = decide(after, spec.contract, mutated);
      injected.push({ hash: spec.hash, need: spec.need, index: item.index, class: item.kind, detail: item.detail, original: item.original, mutated: item.test,
        before: mb?.[item.index]?.status ?? 'unanalyzed', after: ma?.[item.index]?.status ?? 'unanalyzed', why: ma?.[item.index]?.why ?? null, sources: ma?.[item.index]?.sources ?? null,
        otherFlagsAfter: ma ? ma.filter((d, i) => i !== item.index && (d.status === 'flagged' || d.status === 'corrected')).length : 0 });
    }
  }
  return { pristine, injected, excluded };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [corpusPath, split, output, limit] = process.argv.slice(2);
  const precommit = sha(readFileSync(here('./PRECOMMIT.md')));
  assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(/\s/)[0], precommit, 'PRECOMMIT.md differs from its recorded hash');
  assert.ok(['dev', 'heldout'].includes(split), 'split must be dev or heldout');
  const corpusText = readFileSync(corpusPath, 'utf8'), corpus = JSON.parse(corpusText);
  const specs = corpus.specs.filter(s => s.split === split).slice(0, limit ? Number(limit) : Infinity);
  assert.equal(sha(specs.map(s => s.hash).join('\n')), limit ? sha(specs.map(s => s.hash).join('\n')) : corpus.split[`${split === 'dev' ? 'dev' : 'heldout'}Manifest`]);
  mkdirSync(output, { recursive: true });
  const versions = await oracles(output);
  const begin = Date.now(), result = measure(specs, versions);
  const environment = { precommit, split, limit: limit ?? null, specs: specs.length, corpusSha256: sha(corpusText), manifest: sha(specs.map(s => s.hash).join('\n')), node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), oracleBefore: { commit: beforeCommit, sha256: versions.beforeSha }, oracleAfter: { sha256: versions.afterSha }, ms: Date.now() - begin, at: new Date().toISOString() };
  writeFileSync(join(output, 'environment.json'), JSON.stringify(environment, null, 1));
  writeFileSync(join(output, 'rows.json'), JSON.stringify(result));
  console.log(JSON.stringify({ ...environment, pristineTests: result.pristine.length, injected: result.injected.length, excluded: result.excluded.length }, null, 1));
}
