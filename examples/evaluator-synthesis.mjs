import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../core/runtime/isolate-pool.mjs';
import { runNeed } from '../core/runtime/x1/pipeline.mjs';
import { scriptedProvider } from '../core/runtime/x1/transports.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'ef-synthesis-'));
const reply = (path, value) => ({ text: JSON.stringify({ calls: [{ name: 'edit_file', path, content: JSON.stringify(value) }, { name: 'done' }] }), usage: 1 });
const evaluatorAuthor = scriptedProvider(({ session }) => session.startsWith('need')
  ? reply('sheet.json', { residual: ['Adds two integers from -10 to 10.'], quantities: [], relations: [], invariants: [] })
  : reply('binding.json', { exports: [{ name: 'add', params: ['a', 'b'].map(name => ({ name, unit: '1', min: -10, max: 10, integer: true })), result: { kind: 'number', unit: '1' } }],
    reference: 'function add(a, b) { return a + b; }' }));
const kernels = {
  correct: 'export function add(a:i32,b:i32):i32{return a+b}',
  'wrong-above-5': 'export function add(a:i32,b:i32):i32{return a>5?a+b+1:a+b}',
};
const pool = new IsolatePool({ hostPort: here('../core/runtime/x1/host.mjs'), size: 1, isolation: 'thread' });
try {
  for (const [name, kernel] of Object.entries(kernels)) {
    const directory = join(work, name);
    const result = await runNeed({ need: 'integer add(a,b)', directory, pool, synthProvider: evaluatorAuthor, env: { ...process.env,
      ENDOFORGE_SYNTH: '1', ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_TERSE: '1', CODEX_HOME: join(work, 'codex-home'), FAKE_CODEX_KERNEL: kernel,
      ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, here('../core/runtime/test/fixtures/x1/fake-codex.mjs')]),
      ENDOFORGE_ASC_CMD: here('../tools/asc/node_modules/.bin/asc') } });
    const evaluator = JSON.parse(readFileSync(join(directory, 'oracle', 'synth', 'evaluator.json'), 'utf8'));
    const verdict = JSON.parse(readFileSync(join(directory, 'synthesis.json'), 'utf8'));
    console.log(JSON.stringify({ kernel: name, promoted: result.promoted, frozenVectors: evaluator.checks.vectors.length, synthesis: verdict.decision,
      firstFailure: verdict.failures?.[0] ?? null }));
  }
} finally {
  await pool.close();
}
