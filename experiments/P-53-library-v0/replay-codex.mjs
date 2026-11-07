import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const request = JSON.parse(readFileSync(0, 'utf8')), from = process.env.P53_REPLAY;
process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000053' })}\n`);
if (request.stage === 'specification') for (const name of ['CONTRACT.md', 'tests.json']) copyFileSync(join(from, name), name);
else { const glue = JSON.parse(readFileSync(join(from, 'glue.json'), 'utf8')); glue.id = request.id; writeFileSync('glue.json', JSON.stringify(glue)); copyFileSync(join(from, 'kernel.ts'), 'kernel.ts'); }
