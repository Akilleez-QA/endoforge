import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runGates } from './gates.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const signature = { version: 1, name: 'x1', inputs: [{ path: 'token', type: 'number', unit: '1', domain: [0, 1] }], output: { type: 'number', unit: '1' } };
export const configuration = {
  gateInput: { version: 1, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['X1'] },
    cases: [{ id: 'envelope', inputs: { token: 1 } }], limits: { wallMs: 10, memoryBytes: 1024, fuel: 10 }, allowedEffects: [] },
  invariants: [], objectives: { bytes: 'min' },
};
export function createPort({ candidates }) {
  const get = identity => {
    const candidate = candidates[identity];
    if (hash(JSON.stringify(candidate)) !== identity) throw Error('candidate binding differs');
    return candidate;
  };
  return {
    describe: () => signature,
    run: (_, cases) => ({ status: 'completed', outputs: cases.map(c => ({ caseId: c.id, value: 1 })),
      usage: { wallMs: 0, memoryBytes: 0, fuel: 0 }, effects: [] }),
    scanEffects: () => [],
    residual(identity, bundle) {
      const candidate = get(identity);
      for (const name of ['host.mjs', 'gates.mjs', 'glue.schema.json']) {
        if (readFileSync(new URL(name, import.meta.url)).toString('hex') !== bundle.files[name]) throw Error('host implementation drift');
      }
      for (const name of ['CONTRACT.md', 'tests.json', 'frozen.sha256']) {
        if (Buffer.from(bundle.files[name], 'hex').toString() !== candidate.files[name]) throw Error('oracle binding differs');
      }
      const result = runGates(candidate);
      return { passed: result.promotable, reason: JSON.stringify(result) };
    },
    measure: identity => ({ bytes: Buffer.from(get(identity).compiled.wasm, 'base64').length }),
  };
}
