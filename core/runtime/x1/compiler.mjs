import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileFailure } from './gates.mjs';
import { hash } from './host.mjs';
export const ascDiagnostics = text => [...String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '').matchAll(/^ERROR (\w+): (.*)$(?:(?!^ERROR )[\s\S])*?\((\d+),(\d+)\)$/gm)]
  .map(([, code, message, line, column]) => ({ code, line: Number(line), column: Number(column), message }));
export async function compile(files, command = process.env.ENDOFORGE_ASC_CMD, { timeoutMs = 60000 } = {}) {
  if (!command) throw Error('ENDOFORGE_ASC_CMD required');
  const directory = await mkdtemp(join(tmpdir(), 'ef-compile-'));
  const source = hash(files['kernel.ts']);
  try {
    await writeFile(join(directory, 'kernel.ts'), files['kernel.ts']);
    await new Promise((resolve, reject) => execFile(command, [join(directory, 'kernel.ts'), '--runtime', 'stub', '-O3',
      '--noAssert', '--noColors', '--maximumMemory', '1024', '-o', join(directory, 'kernel.wasm')],
    { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve()));
    return { source, wasm: (await readFile(join(directory, 'kernel.wasm'))).toString('base64') };
  } catch (error) {
    if (error.killed || ['EAGAIN', 'ENOMEM', 'EMFILE'].includes(error.code)) return { source, error: 'compiler failed or timed out', unavailable: true };
    return compileFailure(source, ascDiagnostics(error.stderr));
  }
  finally { await rm(directory, { recursive: true, force: true }); }
}
