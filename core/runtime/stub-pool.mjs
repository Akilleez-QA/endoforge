#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
try {
  const { bwrapArgs: args } = JSON.parse(fs.readFileSync(process.env.ENDOFORGE_ISOLATE_SPEC, 'utf8'));
  const i = args.findIndex((v, i) => v === '--bind' && args[i + 2] === '/out');
  if (i < 0) throw new Error('missing /out bind');
  const host = args[i + 1], id = path.basename(path.dirname(host));
  const source = path.join(process.env.ENDOFORGE_STUB_REPLAY, 'atoms', id, 'out');
  if (!fs.existsSync(source)) throw new Error(`replay lacks outputs for ${id}`);
  await new Promise(r => setTimeout(r, Number(process.env.ENDOFORGE_STUB_LATENCY_MS || 0)));
  fs.cpSync(source, host, { recursive: true });
  const state = process.env.CODEX_POOL_STATE_DIR, home = path.join(state, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.appendFileSync(path.join(state, 'log'), `ts=${new Date().toISOString()} account=stub exit=0 class=ok\n`);
  const child = spawn(process.env.CODEX_POOL_BIN, process.argv.slice(2), { env: { ...process.env, CODEX_HOME: home }, stdio: 'inherit' });
  child.on('error', e => { console.error(`stub-pool: ${e.message}`); process.exitCode = 1; });
  child.on('exit', code => process.exit(code ?? 1));
} catch (e) { console.error(`stub-pool: ${e.message}`); process.exitCode = 1; }
