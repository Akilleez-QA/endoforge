import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha } from '../P-70-oracle-injected/corpus.mjs';
import { measure } from '../P-70-oracle-injected/run.mjs';

const here = file => new URL(file, import.meta.url);
const root = new URL('../../', import.meta.url).pathname;
export const beforeCommit = 'd4d7efa';
export const sets = {
  'p71-heldout': { manifest: '7f042b11ebded5262f9f232c7763d8a4fdf743107efab54ffac73b4b1019edd8', split: 'heldout' },
  'p70-heldout-comparison': { manifest: '4fc1ca9a861e7a4ce9fe2f64d289d3cbce6b3745540b5470b7a729316c8cdb57', split: 'heldout' },
  'p70-dev': { manifest: '5c647ba8b96e5cd2198a6f0706bca31501b0a42e934613b4889441aff260eaf3', split: 'dev' },
};

export async function oracles(output) {
  const source = execFileSync('git', ['show', `${beforeCommit}:core/runtime/x1/oracle.mjs`], { cwd: root, encoding: 'utf8' })
    .replace("from './contract.mjs'", `from '${pathToFileURL(join(root, 'core/runtime/x1/contract.mjs'))}'`).replace("from './gates.mjs'", `from '${pathToFileURL(join(root, 'core/runtime/x1/gates.mjs'))}'`);
  const file = join(output, 'oracle-before.mjs');
  writeFileSync(file, source);
  return { before: await import(pathToFileURL(file)), after: await import(here('../../core/runtime/x1/oracle.mjs')), beforeSha: sha(source), afterSha: sha(readFileSync(here('../../core/runtime/x1/oracle.mjs'))) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [corpusPath, set, output] = process.argv.slice(2);
  const precommit = sha(readFileSync(here('./PRECOMMIT.md')));
  assert.equal(readFileSync(here('./receipt/precommit.sha256'), 'utf8').trim().split('\n').at(-1).split(/\s/)[0], precommit, 'PRECOMMIT.md differs from its recorded hash');
  assert.ok(Object.hasOwn(sets, set), `set must be one of ${Object.keys(sets).join(', ')}`);
  const corpusText = readFileSync(corpusPath, 'utf8'), corpus = JSON.parse(corpusText);
  const specs = corpus.specs.filter(s => s.split === sets[set].split);
  assert.equal(sha(specs.map(s => s.hash).join('\n')), sets[set].manifest, 'manifest differs');
  mkdirSync(output, { recursive: true });
  const versions = await oracles(output);
  const begin = Date.now(), result = measure(specs, versions);
  const environment = { precommit, set, specs: specs.length, corpusSha256: sha(corpusText), manifest: sets[set].manifest, node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), oracleBefore: { commit: beforeCommit, sha256: versions.beforeSha }, oracleAfter: { sha256: versions.afterSha }, ms: Date.now() - begin, at: new Date().toISOString() };
  writeFileSync(join(output, 'environment.json'), JSON.stringify(environment, null, 1));
  writeFileSync(join(output, 'rows.json'), JSON.stringify(result));
  console.log(JSON.stringify({ ...environment, pristineTests: result.pristine.length, injected: result.injected.length, excluded: result.excluded.length }, null, 1));
}
