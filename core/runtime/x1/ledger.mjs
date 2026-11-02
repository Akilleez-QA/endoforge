import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function ledger(action, request) {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-B', '-m', 'tools.x1_ledger', action], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(Error(`ledger ${action} refused`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
export function receipt(reference, digest, candidate) {
  return { version: 0, kind: 'receipt', id: 'receipt', data: {
    task: 'task', candidate, frozen_evaluator: reference.identity,
    precommit: { observable: 'X1', acceptance_boundary: 'G1-G7', oracle: reference.identity, oracle_version: digest,
      artifact_identity: candidate, environment: { runtime: 'workcell' }, failure_meaning: 'refuse', stop_condition: 'report' },
    delivery_state: 'running', outcome_state: 'unobserved', observations: [],
  } };
}
