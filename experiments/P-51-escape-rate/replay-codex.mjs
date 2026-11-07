import { readFileSync, writeFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8')), replay = JSON.parse(readFileSync(process.env.P51_CASE, 'utf8'));
if (!process.env.CODEX_HOME || !process.argv.includes('exec')) process.exit(2);
process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000051' })}\n`);
if (request.stage === 'specification') {
  writeFileSync('CONTRACT.md', replay.contract);
  writeFileSync('tests.json', replay.tests);
} else {
  const glue = JSON.parse(replay.glue);
  glue.id = request.id;
  writeFileSync('kernel.ts', replay.kernel);
  writeFileSync('glue.json', JSON.stringify(glue));
  if (replay.driftTests) writeFileSync('tests.json', replay.driftTests);
  if (replay.driftContract) writeFileSync('CONTRACT.md', replay.driftContract);
}
