import { writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';

export const signature = { version: 1, name: 'identity',
  inputs: [{ path: 'x', type: 'number', unit: '1', domain: [0, 10] }],
  output: { type: 'number', unit: '1' } };

export async function createPort({ barrier, participants, release, abort } = {}) {
  if (barrier) {
    await writeFile(join(barrier, `${process.pid}-${threadId}`), 'ready');
    while ((await readdir(barrier)).length < participants) {
      if (abort && existsSync(abort)) throw new Error('fixture wait aborted');
      await setTimeout(10);
    }
  }
  while (release && !existsSync(release)) {
    if (abort && existsSync(abort)) throw new Error('fixture wait aborted');
    await setTimeout(10);
  }
  return {
    describe(candidate) {
      if (candidate === 'heap') {
        const retained = [];
        for (;;) retained.push(Array.from({ length: 4096 }, () => ({ value: Math.random() })));
      }
      if (candidate === 'exit') process.exit(17);
      if (candidate === 'throw') throw new Error('synthetic callback failure');
      return candidate === 'interface' ? { ...signature, name: 'other' } : signature;
    },
    run: (candidate, cases) => ({ status: 'completed',
      outputs: cases.map(c => ({ caseId: c.id, value: c.inputs.x })),
      usage: { wallMs: 1, memoryBytes: 16, fuel: 1 }, effects: [] }),
    scanEffects: candidate => candidate === 'effects' ? ['network'] : [],
    invariant: (name, candidate) => ({ passed: candidate !== 'invariant', reason: 'synthetic identity check' }),
    residual: () => ({ passed: true, reason: 'synthetic request holds' }),
    measure: candidate => ({ cost: candidate === 'dominated' ? 2 : 1 }),
  };
}
