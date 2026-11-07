import { writeFileSync, readFileSync } from 'node:fs';
import { candidate } from './candidate.mjs';
const request = JSON.parse(readFileSync(0, 'utf8')), c = candidate();
if (!process.env.CODEX_HOME || !process.argv.includes('exec')) process.exit(2);
if (process.env.FAKE_CODEX_RECORD) writeFileSync(`${process.env.FAKE_CODEX_RECORD}.${request.stage}.json`, JSON.stringify({ ...request, argv: process.argv.slice(2) }));
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000001' }) + '\n');
if (process.env.FAKE_CODEX_MODE === 'exit') process.exit(3);
const terse = JSON.stringify(request).includes('reply with only the word done');
if (process.env.FAKE_CODEX_DELAY_MS && !terse) await new Promise(r => setTimeout(r, Number(process.env.FAKE_CODEX_DELAY_MS)));
if (request.stage === 'specification') {
  for (const name of ['CONTRACT.md', 'tests.json']) writeFileSync(name, c.files[name]);
  if (process.env.FAKE_CODEX_CONTRACT) writeFileSync('CONTRACT.md', process.env.FAKE_CODEX_CONTRACT);
  if (process.env.FAKE_CODEX_TESTS) writeFileSync('tests.json', process.env.FAKE_CODEX_TESTS);
  if (process.env.FAKE_CODEX_MODE === 'reference') {
    writeFileSync('reference.js', 'function add(a, b) { if (a > 10) throw Error("range"); return a + b; }');
    writeFileSync('tests.json', JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 99 }, { name: 'high', fn: 'add', args: [11, 0], expectError: true }]));
  }
  if (process.env.FAKE_CODEX_MODE === 'early') writeFileSync('kernel.ts', c.files['kernel.ts']);
} else {
  const glue = JSON.parse(process.env.FAKE_CODEX_GLUE ?? c.files['glue.json']); glue.id = request.id;
  writeFileSync('kernel.ts', process.env.FAKE_CODEX_KERNEL ?? c.files['kernel.ts']);
  writeFileSync('glue.json', process.env.FAKE_CODEX_MODE === 'glue' || (process.env.FAKE_CODEX_MODE === 'terse-glue' && terse) || (process.env.FAKE_CODEX_MODE === 'repair' && request.stage === 'implementation') ? '{}' : JSON.stringify(glue));
  if (process.env.FAKE_CODEX_MODE === 'drift') writeFileSync('tests.json', '[]');
}
