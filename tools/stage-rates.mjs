import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [path, ...flags] = process.argv.slice(2);
if (!path) { console.error('usage: node tools/stage-rates.mjs <snapshot.json> [--watch] [--json]'); process.exit(2); }
const show = () => {
  let view;
  try { view = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { console.error(`no snapshot at ${path}: ${error.code ?? error.message}`); return false; }
  console.log(flags.includes('--json') ? JSON.stringify({ at: view.at, verdict: view.verdict, stages: view.stages }, null, 1) : view.text);
  return true;
};
if (!flags.includes('--watch')) process.exit(show() ? 0 : 1);
for (;;) { process.stdout.write('\x1b[2J\x1b[H'); show(); await sleep(1000); }
