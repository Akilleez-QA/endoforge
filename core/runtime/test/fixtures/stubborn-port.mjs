import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createPort as identityPort } from './identity-port.mjs';

export async function createPort({ trapTerm, holdStderr, pidFile, exitAfter } = {}) {
  const port = await identityPort();
  if (trapTerm) process.on('SIGTERM', () => {});
  if (holdStderr) {
    const child = spawn('sleep', ['60'], { stdio: ['ignore', 'ignore', 'inherit'] });
    writeFileSync(pidFile, String(child.pid));
    child.unref();
  }
  return { ...port, async describe(candidate) {
    if (exitAfter) process.exit(17);
    await new Promise(resolve => setTimeout(resolve, 60000));
    return port.describe(candidate);
  } };
}
