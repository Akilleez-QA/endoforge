import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { configuration, hash } from './host.mjs';
import { ledger } from './ledger.mjs';
const schema = JSON.parse(await readFile(new URL('./glue.schema.json', import.meta.url)));
export const glueRules = [
  'Every export of kernel.ts has exactly one glue.exports entry, and glue describes no other names.',
  'Each args list has one entry per parameter of the export, in order.',
  'A result of kind number must include an integer precision from 0 to 6 (decimal places shown).',
  'A result of kind code must include a codes table labelling every code the tests return.',
  'A result of kind boolean must include labels with true and false strings.',
  'An argument of kind code must include a codes table.',
  'Every function with an expectError test must have a traps entry with fn, when and message.',
];
export const glueTemplate = {
  id: '<id>', assumption: 'State the physical and unit assumptions of the kernel.', question: 'State the question a technician asks.',
  exports: [{ name: 'exampleKernel', label: 'Example result', headline: true,
    args: [{ name: 'massLb', kind: 'number', unit: 'lb', range: '0..1000' }],
    result: { kind: 'number', unit: 'USD', precision: 2 } }],
  traps: [{ fn: 'exampleKernel', when: 'massLb is outside 0..1000', message: 'Mass is outside the supported range.' }],
};
const read = async (directory, name) => {
  const file = join(directory, name), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('invalid generated file');
  return readFile(file, 'utf8');
};
function invoke(directory, prompt, env, timeout) {
  const argv = env.ENDOFORGE_CODEX_CMD?.startsWith('[') ? JSON.parse(env.ENDOFORGE_CODEX_CMD) : [env.ENDOFORGE_CODEX_CMD];
  if (!argv?.length || !argv.every(x => typeof x === 'string' && x) || !env.CODEX_HOME) throw Error('ENDOFORGE_CODEX_CMD and CODEX_HOME required');
  return new Promise((resolve, reject) => {
    const child = execFile(argv[0], [...argv.slice(1), 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-'], {
      cwd: directory, env, timeout, maxBuffer: 2 * 1024 * 1024,
    }, error => error ? reject(Error('codex generation failed or timed out')) : resolve());
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(prompt));
  });
}
export async function generate({ need, directory, env = process.env, timeout = 600000 }) {
  if (typeof need !== 'string' || !need.trim()) throw Error('nonempty need required');
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw Error('positive generation timeout required');
  await mkdir(directory);
  const workspace = join(directory, 'candidate'), root = join(directory, 'oracle');
  await mkdir(workspace); await mkdir(root);
  const reference = { ledger: join(directory, 'ledger.sqlite'), root };
  const id = basename(directory);
  const start = performance.now();
  await invoke(workspace, { stage: 'specification', need, id, instructions:
    'Write only CONTRACT.md and tests.json. Do not write kernel.ts or glue.json yet. Define a pure bounded AssemblyScript kernel, explicit assumptions, exports and numeric tests. tests.json is a nonempty array of {name,fn,args,expect,tol?} or {name,fn,args,expectError:true}. Include boundary and trap cases. For every number result, state in CONTRACT.md the decimal places to show. These files will be frozen before implementation.', glueRules }, env, timeout);
  const names = (await readdir(workspace)).sort();
  if (JSON.stringify(names) !== JSON.stringify(['CONTRACT.md', 'tests.json'])) throw Error('code or unexpected files before freeze');
  const files = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(workspace, n)])));
  const tests = JSON.parse(files['tests.json']);
  if (!files['CONTRACT.md'].trim() || !Array.isArray(tests) || !tests.length) throw Error('contract and nonempty tests required');
  const generatedSpecMs = performance.now() - start, freezeStart = performance.now();
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  await writeFile(join(workspace, 'frozen.sha256'), files['frozen.sha256']);
  for (const name of Object.keys(files)) await writeFile(join(root, name), files[name]);
  for (const name of ['host.mjs', 'gates.mjs', 'glue.schema.json']) await writeFile(join(root, name), await readFile(new URL(name, import.meta.url)));
  const frozen = await ledger('freeze', { reference, need, configuration });
  reference.identity = frozen.identity;
  const freezeMs = performance.now() - freezeStart, codeStart = performance.now();
  await invoke(workspace, { stage: 'implementation', need, id, glueSchema: schema, glueRules, glueTemplate, instructions:
    'Read the frozen CONTRACT.md and tests.json. Write kernel.ts and glue.json only. Do not change CONTRACT.md, tests.json or frozen.sha256. Use AssemblyScript 0.28.20, runtime stub, no imports except env.abort, explicit bounded memory. Implement all frozen tests and the closed glue schema; glue.id must equal id. glue.json must satisfy every rule in glueRules; glueTemplate shows the shape. No compiler or other output files.' }, env, timeout);
  for (const [name, text] of Object.entries(files)) if (await read(workspace, name) !== text) throw Error('frozen specification changed during generation');
  if (JSON.stringify((await readdir(workspace)).sort()) !== JSON.stringify([...Object.keys(files), 'kernel.ts', 'glue.json'].sort())) throw Error('unexpected implementation files');
  for (const name of ['kernel.ts', 'glue.json']) files[name] = await read(workspace, name);
  JSON.parse(files['glue.json']);
  return { candidate: { id, files }, reference, digest: frozen.digest,
    testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1',
    timings: { generate: generatedSpecMs + performance.now() - codeStart, freeze: freezeMs } };
}
