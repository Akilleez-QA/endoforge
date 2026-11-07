import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createPort as identityPort } from './identity-port.mjs';

export async function createPort({ trapTerm, holdStderr, pidFile, exitAfter, quick, blockMs, blockedFile, startedFile, verdictOnTerm, verdictFile, exitAfterVerdict } = {}) {
  const port = await identityPort();
  let releaseVerdict = () => {};
  const verdict = new Promise(resolve => { releaseVerdict = resolve; });
  if (verdictOnTerm) process.on('SIGTERM', () => {
    if (verdictFile) writeFileSync(verdictFile, 'returned');
    releaseVerdict();
  });
  else if (trapTerm) process.on('SIGTERM', () => {});
  if (holdStderr) {
    const child = spawn('sleep', ['60'], { stdio: ['ignore', 'ignore', 'inherit'] });
    writeFileSync(pidFile, String(child.pid));
    child.unref();
  }
  if (startedFile) writeFileSync(startedFile, String(process.pid));
  return { ...port, async describe(candidate) {
    if (exitAfter) process.exit(17);
    if (blockMs) execFileSync('/bin/sh', ['-c', ': > "$1"; sleep "$2"', 'sh', blockedFile, String(blockMs / 1000)]);
    if (quick) return port.describe(candidate);
    if (verdictOnTerm) {
      await verdict;
      if (exitAfterVerdict) setTimeout(() => process.exit(0), 0);
      return port.describe(candidate);
    }
    await new Promise(resolve => setTimeout(resolve, 60000));
    return port.describe(candidate);
  } };
}
