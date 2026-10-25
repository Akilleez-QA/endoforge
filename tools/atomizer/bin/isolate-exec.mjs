#!/usr/bin/env node
// Host trampoline: only inspect CODEX_HOME itself, never its contents.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
const trace = (s) => { try { if (process.env.ENDOFORGE_ISOLATE_TRACE) fs.appendFileSync(process.env.ENDOFORGE_ISOLATE_TRACE, s + '\n'); } catch {} };
const now = () => performance.timeOrigin + performance.now();
try {
  const { bwrapArgs, cmdHead } = JSON.parse(fs.readFileSync(process.env.ENDOFORGE_ISOLATE_SPEC, 'utf8'));
  const home = process.env.CODEX_HOME;
  if (!home || !fs.statSync(home).isDirectory()) throw new Error('CODEX_HOME must be an existing directory');
  trace(`start ${now()}`);
  const child = spawn('bwrap', [...bwrapArgs, '--bind', home, home, '--setenv', 'CODEX_HOME', home, '--', cmdHead, ...process.argv.slice(2)], { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => { console.error(`isolate-exec: ${error.message}`); process.exitCode = 127; });
  child.on('exit', (code, signal) => { const exit = code ?? 128 + os.constants.signals[signal]; trace(`end ${now()} ${exit}`); process.exit(exit); });
} catch (error) { console.error(`isolate-exec: ${error.message}`); process.exitCode = 1; }
