import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export const signature = { version: 1, name: 'add',
  inputs: ['a', 'b'].map(path => ({ path, type: 'number', unit: '1', domain: [-10, 10] })),
  output: { type: 'number', unit: '1' } };

export function createPort({ directory }) {
  const tests = JSON.parse(readFileSync(new URL('./tests.json', import.meta.url)));
  const source = candidate => {
    const bytes = readFileSync(join(directory, candidate), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== candidate) throw Error('candidate bytes changed');
    if (!/^\(a,b\)=>a[+-]b\n$/.test(bytes)) throw Error('unsupported expression grammar');
    return bytes;
  };
  const execute = (candidate, inputs) => runInNewContext(`(${source(candidate)})(${inputs.a},${inputs.b})`, {}, { timeout: 100 });
  const check = candidate => ({ passed: tests.every(t => execute(candidate, t.inputs) === t.expected),
    reason: 'Executable outputs compared with six frozen exact Math observations' });
  return {
    describe(candidate) { source(candidate); return signature; },
    run(candidate, cases) {
      const start = performance.now(), heap = process.memoryUsage().heapUsed;
      const outputs = cases.map(t => ({ caseId: t.id, value: execute(candidate, t.inputs) }));
      return { status: 'completed', outputs,
        usage: { wallMs: performance.now() - start, memoryBytes: Math.max(0, process.memoryUsage().heapUsed - heap), fuel: cases.length }, effects: [] };
    },
    scanEffects(candidate) { source(candidate); return []; },
    invariant(name, candidate) { if (name !== 'exact_addition') throw Error('Unknown invariant'); return check(candidate); },
    residual: check,
    measure: candidate => ({ sourceBytes: Buffer.byteLength(source(candidate)) }),
  };
}
