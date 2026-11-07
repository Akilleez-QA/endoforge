import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runGates } from './gates.mjs';
import { allowedEffects, limits, measuredPort, signature, workloads } from './measure.mjs';
export const implementationFiles = Object.freeze(['host.mjs', 'gates.mjs', 'glue.schema.json', 'measure.mjs', 'meter.mjs', 'contract.mjs']);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export { signature };
export const configuration = {
  gateInput: { version: 1, contract: { version: 1, signature, refusals: [], tolerance: 0, sources: ['X1'] },
    cases: workloads.map(id => ({ id, inputs: { workload: id } })), limits: { ...limits }, allowedEffects: [...allowedEffects] },
  invariants: [], objectives: { bytes: 'min' },
};
export function createPort({ candidates }) {
  const get = identity => {
    const candidate = candidates[identity];
    if (hash(JSON.stringify(candidate)) !== identity) throw Error('candidate binding differs');
    return candidate;
  };
  return {
    ...measuredPort(identity => {
      const candidate = candidates[identity];
      return candidate && hash(JSON.stringify(candidate)) === identity ? candidate : null;
    }),
    residual(identity, bundle) {
      const candidate = get(identity);
      for (const name of implementationFiles) {
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
