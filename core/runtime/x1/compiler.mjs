import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './host.mjs';
export async function compile(files, command = process.env.ENDOFORGE_ASC_CMD) {
  if (!command) throw Error('ENDOFORGE_ASC_CMD required');
  const directory = await mkdtemp(join(tmpdir(), 'ef-compile-'));
  const source = hash(files['kernel.ts']);
  try {
    await writeFile(join(directory, 'kernel.ts'), files['kernel.ts']);
    await new Promise((resolve, reject) => execFile(command, [join(directory, 'kernel.ts'), '--runtime', 'stub', '-O3',
      '--noAssert', '--maximumMemory', '1024', '-o', join(directory, 'kernel.wasm')],
    { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }, error => error ? reject(error) : resolve()));
    return { source, wasm: (await readFile(join(directory, 'kernel.wasm'))).toString('base64') };
  } catch { return { source, error: 'compiler failed or timed out' }; }
  finally { await rm(directory, { recursive: true, force: true }); }
}
