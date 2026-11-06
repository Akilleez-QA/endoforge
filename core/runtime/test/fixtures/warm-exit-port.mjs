import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createPort as identityPort } from './identity-port.mjs';

export async function warm({ counter, exitFirst = Infinity }) {
  const before = existsSync(counter) ? readFileSync(counter, 'utf8').length : 0;
  appendFileSync(counter, 'x');
  if (before < exitFirst) process.exit(19);
}

export const createPort = identityPort;
