import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPort as identityPort } from './identity-port.mjs';

export async function warm({ counter, exitFirst = Infinity, exitCounts, gate }) {
  const before = existsSync(counter) ? readFileSync(counter, 'utf8').length : 0;
  appendFileSync(counter, 'x');
  if (!(exitCounts ? exitCounts.includes(before) : before < exitFirst)) return;
  while (gate && !existsSync(gate)) await sleep(5);
  if (gate) rmSync(gate);
  process.exit(19);
}

export const createPort = identityPort;
