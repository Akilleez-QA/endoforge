import { signature } from './identity-port.mjs';

export function createPort(options, { hostCall }) {
  const seen = [];
  return {
    describe: () => signature,
    async run(candidate, cases) {
      if (candidate === 'hang') for (;;);
      if (options?.flood) for (let i = 0; i < options.flood; i++) await hostCall({ i });
      seen.push(await hostCall({ candidate }).catch(error => ({ error: error.message })));
      if (seen.at(-1).error) throw new Error(seen.at(-1).error);
      return { status: 'completed', outputs: cases.map(c => ({ caseId: c.id, value: c.inputs.x })),
        usage: { wallMs: 1, memoryBytes: 16, fuel: 1 }, effects: [] };
    },
    scanEffects: () => [],
    invariant: () => ({ passed: true, reason: 'synthetic' }),
    residual: () => ({ passed: true, reason: 'synthetic' }),
    measure: () => ({ cost: 1 }),
    evidence: () => ({ seen, pid: process.pid }),
  };
}
