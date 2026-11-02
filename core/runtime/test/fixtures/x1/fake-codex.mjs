import { writeFileSync, readFileSync } from 'node:fs';
import { candidate } from './candidate.mjs';
const request = JSON.parse(readFileSync(0, 'utf8')), c = candidate();
if (!process.env.CODEX_HOME || !process.argv.includes('exec')) process.exit(2);
if (process.env.FAKE_CODEX_RECORD) writeFileSync(`${process.env.FAKE_CODEX_RECORD}.${request.stage}.json`, JSON.stringify({ ...request, argv: process.argv.slice(2) }));
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000001' }) + '\n');
if (process.env.FAKE_CODEX_MODE === 'exit') process.exit(3);
if (request.stage === 'specification') {
  for (const name of ['CONTRACT.md', 'tests.json']) writeFileSync(name, c.files[name]);
  if (process.env.FAKE_CODEX_MODE === 'early') writeFileSync('kernel.ts', c.files['kernel.ts']);
} else {
  const glue = JSON.parse(c.files['glue.json']); glue.id = request.id;
  writeFileSync('kernel.ts', c.files['kernel.ts']);
  writeFileSync('glue.json', process.env.FAKE_CODEX_MODE === 'glue' ? '{}' : JSON.stringify(glue));
  if (process.env.FAKE_CODEX_MODE === 'drift') writeFileSync('tests.json', '[]');
}
