// Samples the load average every 10 s with the number of rows each arm file holds, so every row can be given the load at the time it was written.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
const [output, log] = process.argv.slice(2), arms = ['control', 'sampled', 'glue', 'binding', 'correlated'];
const count = arm => { const path = join(output, `${arm}.jsonl`); return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0; };
const sample = () => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), load: loadavg().map(v => +v.toFixed(2)), rows: Object.fromEntries(arms.map(arm => [arm, count(arm)])) })}\n`);
sample();
setInterval(sample, 10000);
