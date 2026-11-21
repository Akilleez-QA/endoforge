import { forgeAddress, forgeEvidenceHash } from '../../forge-core.mjs';
import { signature } from './identity-port.mjs';

export function createPort(options, { hostCall, host, spawn }) {
  const seen = [];
  const call = request => options?.via === 'spawn' && request.op === 'spawn' ? spawn(request.children, request.budget, request.merge) : (options?.via === 'host' ? host : hostCall)(request);
  let forged = false;
  const forgeCalls = options?.forgeCalls ?? (options?.inputs ? [] : null);
  return {
    describe: () => signature,
    async run(candidate, cases) {
      if (candidate === 'hang') for (;;);
      if (forgeCalls && !forged) {
        forged = true;
        for (const request of forgeCalls) seen.push(await call(request.ownPid ? { ...request, pid: process.pid } : request).catch(error => ({ error: error.message })));
        if (options.selfSpawn) seen.push(await call({ op: 'spawn', children: [{ goal: options.goal, inputs: options.inputs, codeVersion: 'fixture-v1', budget: options.selfSpawn }], budget: options.selfSpawn, merge: 'set-union' }).catch(error => ({ error: error.message })));
        if (options.hang) for (;;);
        if (options.exit) process.exit(19);
      }
      if (options?.flood) for (let i = 0; i < options.flood; i++) await hostCall({ i });
      if (!forgeCalls) seen.push(await hostCall({ candidate }).catch(error => ({ error: error.message })));
      if (!forgeCalls && seen.at(-1).error) throw new Error(seen.at(-1).error);
      return { status: 'completed', outputs: cases.map(c => ({ caseId: c.id, value: c.inputs.x })),
        usage: { wallMs: 1, memoryBytes: 16, fuel: 1 }, effects: [] };
    },
    scanEffects: () => [],
    invariant: () => ({ passed: true, reason: 'synthetic' }),
    residual: () => ({ passed: true, reason: 'synthetic' }),
    measure: () => ({ cost: 1 }),
    evidence: () => {
      if (!forgeCalls) return { seen, pid: process.pid };
      const value = options.value ?? seen;
      const verification = { check: 'synthetic frozen fixture', replay: [true, true] };
      const verdict = options.outcome?.verdict ?? 'pass';
      const address = forgeAddress({ goal: options.goal ?? 'envelope', inputs: options.inputs ?? {}, codeVersion: 'fixture-v1' });
      const outcome = options.outcome === null ? null : {
        verdict, evidenceHash: forgeEvidenceHash({ address, value, verdict, evidence: verification }),
        verifyCost: 1, generateCost: 10, ...options.outcome,
      };
      if (options.outcome?.omit) {
        delete outcome[options.outcome.omit];
        delete outcome.omit;
      }
      return { seen, value, verification, outcome, pid: process.pid };
    },
  };
}
