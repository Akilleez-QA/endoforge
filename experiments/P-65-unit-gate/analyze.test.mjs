import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'p65-')), tree = join(out, 'tree'), s2a = join(out, 's2a');
after(() => rmSync(out, { recursive: true, force: true }));

const stub = `import { mkdirSync, writeFileSync } from 'node:fs';
const dir = process.env.P51_OUTPUT;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/env.json', JSON.stringify({ arms: process.env.P51_ARMS, width: process.env.ENDOFORGE_SYNTH_WIDTH }));
for (const arm of process.env.P51_ARMS.split(',')) writeFileSync(dir + '/' + arm + '.jsonl', JSON.stringify(arm === 'control'
  ? { key: 'k1', promoted: true } : { mutant: 'cand-r3/m1', cohort: 'P21', need: 'n1', class: 'c', op: 'o', surface: 'kernel', promoted: false, caught: 'G9_units' }) + '\\n');
`;
mkdirSync(join(tree, 'experiments/P-51-escape-rate'), { recursive: true });
writeFileSync(join(tree, 'experiments/P-51-escape-rate/run.mjs'), stub);
copyFileSync(join(here, '../P-51-escape-rate/stats.mjs'), join(tree, 'experiments/P-51-escape-rate/stats.mjs'));
mkdirSync(s2a);
const escaped = JSON.stringify({ mutant: 'cand-r3/m1', cohort: 'P21', need: 'n1', class: 'c', op: 'o', promoted: true }) + '\n';
writeFileSync(join(s2a, 'sampled.jsonl'), escaped);
writeFileSync(join(s2a, 'glue.jsonl'), escaped);
writeFileSync(join(out, 'gates-offline.jsonl'), JSON.stringify({ mutant: 'cand-r3/m1', failed: ['G9_units'], units: 'rule:x' }) + '\n');
writeFileSync(join(out, 'offline-S2.jsonl'), JSON.stringify({ mutant: 'cand-r3/m1', decision: 'refuse' }) + '\n');

const env = { ...process.env, P65_OUT: out, P65_CORPUS: 'c', P65_PREP: 'p', P65_RECORDED: 'r', P65_S2A: s2a };
const run = step => spawnSync('bash', [join(here, 'run.sh'), step], { env, encoding: 'utf8' });

test('run.sh writes the U1a and U2a rows that analyze.mjs reads', () => {
  for (const step of ['U1a', 'U2a']) assert.equal(run(step).status, 0, step);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'U1a/env.json'), 'utf8')), { arms: 'control', width: '1' });
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'U2a/env.json'), 'utf8')), { arms: 'control,sampled,glue', width: '2' });
  const analyzed = run('analyze');
  assert.equal(analyzed.status, 0, analyzed.stderr);
  const result = JSON.parse(analyzed.stdout);
  assert.equal(result.pristine.U1, '1 / 1');
  assert.equal(result.pristine.U2, '1 / 1');
  assert.match(result.sampledP21.U2.escaped, /^0 \/ 1 /);
  assert.match(result.glueP21.U2.escaped, /^0 \/ 1 /);
  assert.equal(result.crossCheck.disagreements, 0);
});

test('run.sh refuses a step it does not know, including the pre-amendment row names', () => {
  for (const step of ['U1', 'U2', '']) {
    const refused = run(step);
    assert.equal(refused.status, 2, step);
    assert.match(refused.stderr, /usage: run\.sh/);
  }
});
