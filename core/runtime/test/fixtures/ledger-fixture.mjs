import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signature } from './identity-port.mjs';

export const hostPort = fileURLToPath(new URL('./identity-port.mjs', import.meta.url));
export const python = (code, input) => new Promise((resolve, reject) => {
  const child = execFile('python3', ['-B', '-c', code], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 30000,
  }, (error, stdout) => {
    if (error) return reject(error);
    try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(input));
});

export async function fixture(t, { invariants = ['identity'] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ef-isolates-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'evaluator');
  mkdirSync(root);
  writeFileSync(join(root, 'residual.txt'), 'identity preserves x');
  const configuration = {
    gateInput: { version: 1, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['synthetic'] },
      cases: [{ id: 'zero', inputs: { x: 0 } }], limits: { wallMs: 10, memoryBytes: 1024, fuel: 100 }, allowedEffects: [] },
    invariants, objectives: { cost: 'min' },
  };
  const candidates = ['pass', 'dominated', 'interface', 'effects', 'invariant', 'throw', 'heap', 'exit'];
  const reference = { ledger: join(directory, 'ledger.sqlite'), root };
  const frozen = await python(`
import json, sys
from core.ledger.ledger import Ledger
from core.ledger.frozen import FrozenEvaluators
r = json.load(sys.stdin)
ledger = Ledger(r['ledger'])
ledger.append(dict(version=0, kind='task', id='task', data=dict(intent='Identity', acceptance='x preserved')))
ledger.append(dict(version=0, kind='admitted_input', id='input', data=dict(task='task', content='0', origin='synthetic')))
frozen = FrozenEvaluators(ledger).freeze(r['root'], task='task', admitted_input='input',
    confirmed_by='synthetic contract', qualification='positive and negative controls',
    synthesis_context=dict(id='context', candidate_blind='confirmed', inputs=['input']),
    configuration=r['configuration'], residual='identity preserves x', invariant_version='1')
for candidate in r['candidates']:
    ledger.append(dict(version=0, kind='candidate', id=candidate,
                       data=dict(task='task', admitted_input='input', content=candidate, proposer='synthetic')))
print(json.dumps(frozen))
`, { ...reference, configuration, candidates });
  reference.identity = frozen.id;
  let sequence = 0;
  const job = (ids = ['pass'], portOptions) => ({ reference, candidates: ids, portOptions,
    receipts: ids.map(candidate => ({ version: 0, kind: 'receipt', id: `job-${++sequence}`, data: {
      task: 'task', candidate, frozen_evaluator: reference.identity,
      precommit: { observable: 'candidate evaluation', acceptance_boundary: 'all attempted checks pass',
        oracle: reference.identity, oracle_version: frozen.data.freeze.digest, artifact_identity: candidate,
        environment: { runtime: 'Node worker' }, failure_meaning: 'candidate rejected', stop_condition: 'batch report' },
      delivery_state: 'running', outcome_state: 'unobserved', observations: [],
    } })) });
  return { reference, job, directory };
}
