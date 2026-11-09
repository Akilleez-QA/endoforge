import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const COMPAT_POLICY = 'COMPAT-TS-CHECK-RUN2-TESTS/v1';
export const COMPAT_ACTIONS = Object.freeze(['freeze', 'register', 'receipt', 'promote']);
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));

export function compatLedger(action, request) {
  if (!COMPAT_ACTIONS.includes(action)) return Promise.reject(new TypeError(`unknown compatibility ledger action ${action}`));
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-B', '-m', 'tools.compat_policy', action], { cwd: REPOSITORY, timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`compatibility ledger ${action} refused: ${String(stderr).trim().slice(0, 400)}`));
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export async function promoteChecked({ ledger, frozen, candidate, check, decisionPath }) {
  if (typeof ledger !== 'string' || !ledger) throw new TypeError('promotion needs a ledger path');
  if (typeof frozen !== 'string' || !frozen) throw new TypeError('promotion needs the frozen compatibility evaluator identity');
  const identity = await compatLedger('register', { ledger, files: { 'kernel.ts': candidate.files['kernel.ts'], 'tests.json': candidate.files['tests.json'] } });
  const report = await check(candidate);
  const receipt = await compatLedger('receipt', { ledger, candidate: identity, frozen_evaluator: frozen, report });
  const decision = await compatLedger('promote', { ledger, candidate: identity, receipt, ...(decisionPath ? { decisionPath } : {}) });
  return { candidate: identity, receipt, report, decision, promoted: decision.decision === 'promote' };
}
