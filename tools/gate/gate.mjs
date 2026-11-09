#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runGates } from '../../core/runtime/x1/gates.mjs';
import { capabilityProblems } from '../../core/runtime/x1/generator.mjs';
import { ASC_PATH } from '../asc/pin.mjs';

async function compileWith(args) {
  if (process.env.ENDOFORGE_ASC) {
    execFileSync(process.env.ENDOFORGE_ASC, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    return;
  }
  if (!fs.existsSync(ASC_PATH)) throw new Error(`pinned compiler missing at ${ASC_PATH}; run make loop-setup or set ENDOFORGE_ASC`);
  const asc = await import(pathToFileURL(ASC_PATH));
  const stdout = asc.createMemoryStream(), stderr = asc.createMemoryStream();
  const { error } = await asc.main(args, { stdout, stderr });
  if (error) throw Object.assign(new Error(String(error.message || error)), { stderr: stderr.toString() || String(error.message || error) });
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const [cmd, dirArg] = process.argv.slice(2);
if (!cmd || !dirArg) { console.error('usage: gate.mjs freeze|run <dir>'); process.exit(2); }
const dir = path.resolve(dirArg);
const f = (n) => path.join(dir, n);

if (cmd === 'freeze') {
  for (const n of ['CONTRACT.md', 'tests.json']) if (!fs.existsSync(f(n))) { console.error(`missing ${n}`); process.exit(2); }
  if (fs.existsSync(f('kernel.ts'))) { console.error('refusing to freeze: kernel.ts already exists (tests must be frozen before any code)'); process.exit(2); }
  const tests = JSON.parse(fs.readFileSync(f('tests.json'), 'utf8'));
  const capability = capabilityProblems(fs.readFileSync(f('CONTRACT.md'), 'utf8'), tests);
  if (capability.length) { console.error(`refusing to freeze: ${capability.join('; ')}`); process.exit(2); }
  const rec = { at: new Date().toISOString(), contract: sha(f('CONTRACT.md')), tests: sha(f('tests.json')) };
  fs.writeFileSync(f('frozen.sha256'), JSON.stringify(rec, null, 2) + '\n');
  console.log(`frozen contract ${rec.contract.slice(0, 16)}… tests ${rec.tests.slice(0, 16)}…`);
  process.exit(0);
}

if (cmd !== 'run') { console.error('unknown command'); process.exit(2); }
const finish = (result) => { fs.writeFileSync(f('result.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ promotable: result.promotable, gates: result.gates }, null, 1)); process.exit(result.promotable ? 0 : 1); };
const files = {};
for (const n of ['CONTRACT.md', 'tests.json', 'frozen.sha256', 'kernel.ts', 'glue.json']) if (fs.existsSync(f(n))) files[n] = fs.readFileSync(f(n), 'utf8');
let compiled = null;
if (Object.hasOwn(files, 'kernel.ts')) {
  const source = crypto.createHash('sha256').update(files['kernel.ts']).digest('hex');
  try {
    fs.rmSync(f('kernel.wasm'), { force: true });
    await compileWith([f('kernel.ts'), '--runtime', 'stub', '-O3', '--noAssert', '--maximumMemory', '1024', '-o', f('kernel.wasm'), '--textFile', f('kernel.wat')]);
    compiled = { source, wasm: fs.readFileSync(f('kernel.wasm')).toString('base64') };
  } catch (e) { compiled = { source, error: String(e.stderr || e.message).slice(0, 2000) }; }
} else compiled = { error: 'no kernel.ts' };
let result;
try { result = runGates({ id: dir, files, compiled }); }
catch (e) { result = { at: new Date().toISOString(), gates: { G1_frozen: { ok: false, why: String(e.message || e) } }, tests: [], promotable: false }; }
finish(result);
