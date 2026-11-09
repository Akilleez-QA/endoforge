import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { testProblems } from './gates.mjs';
import { configuration, hash, implementationFiles } from './host.mjs';
import { ledger } from './ledger.mjs';
import { fillExpected } from './reference.mjs';
import { filterScalarTests } from './scalar.mjs';
const schema = JSON.parse(await readFile(new URL('./glue.schema.json', import.meta.url)));
export const glueRules = [
  'Every export of kernel.ts has exactly one glue.exports entry, and glue describes no other names.',
  'Each args list has one entry per parameter of the export, in order, named exactly as the kernel.ts parameter.',
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
export const capabilityKinds = Object.freeze(['integer', 'number', 'boolean', 'code', 'record', 'list', 'text']);
export const capabilityRule = 'End CONTRACT.md with one fenced block that opens with the line ```capability and closes with ```, holding only JSON {"exports":[{"name":...,"args":[{"name":...,"kind":...,"unit":...,"range":...}],"result":{"kind":...,"unit":...,"precision":...}}],"traps":[...]}: one exports entry per kernel export with its parameters in order; each kind one of integer, number, boolean, code, record, list or text; each unit a unit string, 1 when dimensionless; each range as low..high wherever the contract bounds that value; precision on every number result; codes on every code value; traps listing the name of every export that has an expectError test. The library finds an already promoted kernel by this block, and glue.json must later declare the same exports, kinds, units, ranges, precision and traps.';
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function capabilityBlock(contract) {
  const match = String(contract ?? '').match(/```capability\s*\n([\s\S]*?)```/);
  if (!match) return { block: null, error: 'CONTRACT.md has no ```capability block' };
  try { return { block: JSON.parse(match[1]) }; } catch { return { block: null, error: 'the ```capability block is not JSON' }; }
}
function valueProblems(where, value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${where} must be an object`];
  const problems = [];
  if (field && (typeof value.name !== 'string' || !value.name)) problems.push(`${where} needs a name`);
  if (!capabilityKinds.includes(value.kind)) problems.push(`${where} kind must be one of ${capabilityKinds.join(', ')}`);
  if (value.unit !== undefined && (typeof value.unit !== 'string' || !value.unit)) problems.push(`${where} unit must be a nonempty string`);
  if (['integer', 'number', 'code'].includes(value.kind) && value.unit === undefined) problems.push(`${where} needs a unit`);
  if (value.range !== undefined && typeof value.range !== 'string') problems.push(`${where} range must be a string such as 0..10`);
  if (value.kind === 'code' && (!value.codes || typeof value.codes !== 'object' || Object.keys(value.codes).length < 2)) problems.push(`${where} of kind code needs a codes table`);
  return problems;
}
export function capabilityProblems(contract, tests, { required = true } = {}) {
  if (!required && !String(contract ?? '').includes('```capability')) return [];
  const { block, error } = capabilityBlock(contract);
  if (error) return [error];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return ['the ```capability block must be a JSON object'];
  if (!Array.isArray(block.exports) || !block.exports.length) return ['the ```capability block needs a nonempty exports array'];
  const problems = [], exports = new Map();
  for (const [at, item] of block.exports.entries()) {
    const where = `capability export ${item?.name ?? at}`;
    if (typeof item?.name !== 'string' || !identifier.test(item.name)) { problems.push(`${where} needs an identifier name`); continue; }
    if (exports.has(item.name)) problems.push(`${where} is declared twice`);
    exports.set(item.name, item);
    if (!Array.isArray(item.args)) problems.push(`${where} needs an args array`);
    else item.args.forEach((arg, index) => problems.push(...valueProblems(`${where} argument ${arg?.name ?? index}`, arg, true)));
    problems.push(...valueProblems(`${where} result`, item.result, false));
    if (item.result?.kind === 'number' && !(Number.isInteger(item.result.precision) && item.result.precision >= 0 && item.result.precision <= 6)) problems.push(`${where} number result needs an integer precision from 0 to 6`);
  }
  const traps = block.traps ?? [];
  if (!Array.isArray(traps) || traps.some(name => typeof name !== 'string')) problems.push('capability traps must be an array of export names');
  else for (const name of traps) if (!exports.has(name)) problems.push(`capability trap ${name} names no export`);
  for (const test of Array.isArray(tests) ? tests : []) {
    const item = exports.get(test?.fn);
    if (!item) { problems.push(`test ${test?.name ?? test?.fn} calls ${test?.fn}, which the capability block does not export`); continue; }
    if (Array.isArray(item.args) && Array.isArray(test.args) && test.args.length !== item.args.length) problems.push(`test ${test.name ?? test.fn} passes ${test.args.length} arguments; capability export ${item.name} declares ${item.args.length}`);
    if (test.expectError === true && Array.isArray(traps) && !traps.includes(test.fn)) problems.push(`capability traps must list ${test.fn}, which has an expectError test`);
  }
  return [...new Set(problems)];
}
const read = async (directory, name) => {
  const file = join(directory, name), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('invalid generated file');
  return readFile(file, 'utf8');
};
export function effortFor(need, setting = 'auto') {
  if (setting === 'default') return null;
  if (setting !== 'auto') return setting;
  const words = need.match(/## The request, in the requester's words\s+([\s\S]*?)(\n## |$)/);
  return (words ? words[1] : need).trim().length <= 400 ? 'low' : null;
}
export const reviewRule = 'Send no message before writing. Before your edit, silently check every case in tests.json against the contract and your code, and fix any mismatch. Then write all your files in one single edit and reply with only the word done.';
export const exactRule = 'Before that edit, silently derive every numeric expect in tests.json step by step from the formula in CONTRACT.md, carrying at least 12 significant digits, and write the value you derived; never write a rounded or estimated value with a tolerance tighter than its error.';
export const scalarRule = 'Every exported function takes and returns only finite numbers (integer or float scalars); no arrays, strings, null, booleans or objects at the boundary. expectError tests use only finite numeric inputs. Integer parameters are only tested with integer values.';
export const referenceRule = 'Also write reference.js: plain JavaScript that defines one function per kernel export, with the same name and parameters, computing exactly the formula in CONTRACT.md in double precision with only Math and Number, and throwing an Error for every expectError case. In tests.json omit expect from every value test; the supervisor runs reference.js in a sandbox and writes each expect from its result. Never write an expected value yourself.';
export const terseRule = 'Send no message before writing. Write all your files in one single edit. After that edit, reply with only the word done.';
export const stableOrder = ['instructions', 'glueRules', 'glueSchema', 'glueTemplate', 'stage'];
export function promptFor(prompt, env) {
  if (env.ENDOFORGE_CODEX_PREFIX !== 'stable') return prompt;
  const first = stableOrder.filter(k => k in prompt);
  return Object.fromEntries([...first, ...Object.keys(prompt).filter(k => !first.includes(k))].map(k => [k, prompt[k]]));
}
const relativePath = (entry, first) => typeof entry === 'string' && !isAbsolute(entry) && (/^\.\.?\//.test(entry) || (first && entry.includes('/')));
export const commandFor = (env, cwd = process.cwd()) => {
  const argv = env.ENDOFORGE_CODEX_CMD?.startsWith('[') ? JSON.parse(env.ENDOFORGE_CODEX_CMD) : [env.ENDOFORGE_CODEX_CMD];
  return Array.isArray(argv) ? argv.map((entry, index) => (relativePath(entry, index === 0) ? resolve(cwd, entry) : entry)) : argv;
};
function invoke(directory, prompt, env, timeout, { resume = null, effort = null, cwd = process.cwd() } = {}) {
  const mode = env.ENDOFORGE_CODEX_TERSE ?? 'exact';
  if (mode === 'review') prompt = { ...prompt, instructions: `${prompt.instructions} ${reviewRule}` };
  if (mode === 'exact' || mode === 'scalar') prompt = { ...prompt, instructions: `${prompt.instructions} ${terseRule}${prompt.stage === 'specification' ? ` ${exactRule}${mode === 'scalar' ? ` ${scalarRule}` : ''}` : ''}` };
  if (mode === 'reference') prompt = { ...prompt, instructions: `${prompt.instructions} ${terseRule}${prompt.stage === 'specification' ? ` ${referenceRule}` : ''}` };
  if (mode === '1') prompt = { ...prompt, instructions: `${prompt.instructions} ${terseRule}` };
  const argv = commandFor(env, cwd);
  if (!argv?.length || !argv.every(x => typeof x === 'string' && x) || !env.CODEX_HOME) throw Error('ENDOFORGE_CODEX_CMD and CODEX_HOME required');
  const tuning = effort ? ['-c', `model_reasoning_effort="${effort}"`] : [];
  const args = resume
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', ...tuning, resume, '-']
    : ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', ...tuning, '-'];
  return new Promise((resolve, reject) => {
    const child = execFile(argv[0], [...argv.slice(1), ...args], {
      cwd: directory, env, timeout, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(Error('codex generation failed or timed out'));
      const started = String(stdout).split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } })
        .find(event => event?.type === 'thread.started' && typeof event.thread_id === 'string' && /^[A-Za-z0-9-]+$/.test(event.thread_id));
      resolve(started?.thread_id ?? null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(promptFor(prompt, env)));
  });
}
export const correctionNotice = 'The supervisor corrected suspect cases in tests.json after freeze, from agreeing independent references; frozen.tests.json in this message is the corrected frozen tests.json and replaces any earlier version you remember. Implement against it.';
async function correctedTests(root, files) {
  const tests = await read(root, 'tests.json'), sealed = await read(root, 'frozen.sha256');
  if (tests === files['tests.json'] && sealed === files['frozen.sha256']) return null;
  const digest = JSON.parse(sealed);
  if (digest?.contract !== hash(files['CONTRACT.md']) || digest?.tests !== hash(tests)) throw Error('corrected tests do not match the frozen digest');
  const parsed = JSON.parse(tests);
  if (!Array.isArray(parsed) || !parsed.length || testProblems(parsed).length) throw Error('corrected frozen tests must each assert something a kernel can fail');
  return { 'tests.json': tests, 'frozen.sha256': sealed };
}
export async function generate({ need, directory, env = process.env, timeout = 600000, check = null, deadline = Infinity, library = null, freeze = null, implementation = [] }) {
  const left = () => { const ms = Math.min(timeout, Math.floor(deadline - Date.now())); if (ms <= 0) throw Error('request deadline reached'); return ms; };
  if (typeof need !== 'string' || !need.trim()) throw Error('nonempty need required');
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw Error('positive generation timeout required');
  await mkdir(directory);
  const workspace = join(directory, 'candidate'), root = join(directory, 'oracle');
  await mkdir(workspace); await mkdir(root);
  const reference = { ledger: join(directory, 'ledger.sqlite'), root };
  const id = basename(directory);
  const effort = effortFor(need, env.ENDOFORGE_CODEX_EFFORT || 'auto'), session = env.ENDOFORGE_CODEX_SESSION || 'resume', warm = session === 'resume', packed = session === 'packed';
  const evaluated = (env.ENDOFORGE_CODEX_TERSE ?? 'exact') === 'reference', specNames = evaluated ? ['CONTRACT.md', 'reference.js', 'tests.json'] : ['CONTRACT.md', 'tests.json'];
  let modelMs = 0;
  const client = async (...args) => { const begin = performance.now(); try { return await invoke(...args); } finally { modelMs += performance.now() - begin; } };
  const start = performance.now();
  const thread = await client(workspace, { stage: 'specification', need, id, instructions:
    'The workspace starts empty; do not explore it or run commands. Write only CONTRACT.md and tests.json, CONTRACT.md under 40 lines. Do not write kernel.ts or glue.json yet. Define a pure bounded AssemblyScript kernel, explicit assumptions, exports and numeric tests. tests.json is a nonempty array of {name,fn,args,expect,tol?} or {name,fn,args,expectError:true}. Include boundary and trap cases. For every number result, state in CONTRACT.md the decimal places to show. ' + capabilityRule + ' These files will be frozen before implementation.', glueRules }, env, left(), { effort });
  const names = (await readdir(workspace)).sort();
  if (JSON.stringify(names) !== JSON.stringify(specNames)) throw Error('code or unexpected files before freeze');
  const files = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(workspace, n)])));
  let tests = JSON.parse(files['tests.json']);
  const scalar = env.ENDOFORGE_CODEX_TERSE === 'scalar';
  let scalarFilter;
  if (scalar && Array.isArray(tests)) {
    const filtered = filterScalarTests(files['CONTRACT.md'], tests);
    tests = filtered.tests; scalarFilter = filtered.report;
    await writeFile(join(directory, 'scalar-filter.json'), JSON.stringify(scalarFilter, null, 2));
    if (!tests.length || scalarFilter.missingValueTests.length) throw Object.assign(Error('scalar specification requires value tests for every function'), { scalarFilter });
    if (scalarFilter.droppedCount) {
      files['tests.json'] = JSON.stringify(tests, null, 2);
      await writeFile(join(workspace, 'tests.json'), files['tests.json']);
    }
  }
  if (evaluated && Array.isArray(tests)) {
    tests = await fillExpected(files['reference.js'], tests);
    files['tests.json'] = JSON.stringify(tests, null, 2);
    await writeFile(join(workspace, 'tests.json'), files['tests.json']);
  }
  if (!files['CONTRACT.md'].trim() || !Array.isArray(tests) || !tests.length) throw Error('contract and nonempty tests required');
  if (testProblems(tests).length) throw Error('frozen tests must each assert something a kernel can fail');
  const capability = capabilityProblems(files['CONTRACT.md'], tests, { required: false });
  if (capability.length) throw Object.assign(Error(`capability block refused at the freeze: ${capability.join('; ')}`), { capability });
  const generatedSpecMs = performance.now() - start, freezeStart = performance.now();
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  await writeFile(join(workspace, 'frozen.sha256'), files['frozen.sha256']);
  for (const name of Object.keys(files)) await writeFile(join(root, name), files[name]);
  for (const name of [...implementationFiles, ...implementation]) await writeFile(join(root, name), await readFile(new URL(name, import.meta.url)));
  const frozen = await (freeze ? freeze({ reference, need, configuration }) : ledger('freeze', { reference, need, configuration }));
  reference.identity = frozen.identity;
  const corrected = await correctedTests(root, files);
  if (corrected) for (const name of ['tests.json', 'frozen.sha256']) { files[name] = corrected[name]; await writeFile(join(workspace, name), corrected[name]); }
  const freezeMs = performance.now() - freezeStart;
  const reused = library ? await library.serve({ id, files }) : null;
  if (reused?.verdict === 'pass') return { reused, reference, digest: frozen.digest, testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1', modelMs, timings: { generate: generatedSpecMs, freeze: freezeMs } };
  const codeStart = performance.now();
  await client(workspace, { stage: 'implementation', need, id, ...(packed || corrected ? { frozen: { 'CONTRACT.md': files['CONTRACT.md'], 'tests.json': files['tests.json'] } } : {}), glueSchema: schema, glueRules, glueTemplate, instructions:
    (corrected ? `${correctionNotice} ` : '') + 'You already wrote the frozen CONTRACT.md and tests.json; read them only if not in context. Do not run compilers, tests or other commands; the supervisor compiles and gates. Write kernel.ts and glue.json only. Do not change CONTRACT.md, tests.json or frozen.sha256. Use AssemblyScript 0.28.20, runtime stub, no imports except env.abort, explicit bounded memory. The compiler runs with --noAssert, which deletes assert() calls, so never use assert; make every expectError case trap with an explicit if (condition) abort() or throw. Implement all frozen tests and the closed glue schema; glue.id must equal id. glue.json must satisfy every rule in glueRules and declare the exports, kinds, units, ranges, precision and traps of the capability block in CONTRACT.md; glueTemplate shows the shape. No compiler or other output files.' }, env, left(), { effort, resume: warm ? thread : null });
  for (const [name, text] of Object.entries(files)) if (await read(workspace, name) !== text) throw Error('frozen specification changed during generation');
  if (JSON.stringify((await readdir(workspace)).sort()) !== JSON.stringify([...Object.keys(files), 'kernel.ts', 'glue.json'].sort())) throw Error('unexpected implementation files');
  for (const name of ['kernel.ts', 'glue.json']) files[name] = await read(workspace, name);
  let repaired = false;
  const failures = env.ENDOFORGE_SELF_CHECK === '1' && check && thread ? await check({ id, files: { ...files } }) : null;
  if (failures) {
    await client(workspace, { stage: 'repair', id, failures, instructions:
      'The supervisor compiled your kernel.ts and ran the frozen gates on it; failures are listed. Fix kernel.ts and glue.json only so every frozen test and gate passes. Do not change CONTRACT.md, tests.json or frozen.sha256 and do not run commands.' }, env, left(), { effort, resume: thread });
    for (const [name, text] of Object.entries(files)) if (!['kernel.ts', 'glue.json'].includes(name) && await read(workspace, name) !== text) throw Error('frozen specification changed during repair');
    if (JSON.stringify((await readdir(workspace)).sort()) !== JSON.stringify(Object.keys(files).sort())) throw Error('unexpected repair files');
    for (const name of ['kernel.ts', 'glue.json']) files[name] = await read(workspace, name);
    repaired = true;
  }
  JSON.parse(files['glue.json']);
  return { candidate: { id, files }, reference, digest: frozen.digest,
    ...(scalarFilter ? { scalarFilter } : {}),
    testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1',
    session: { effort: effort ?? 'default', resumed: Boolean(warm && thread), packed }, repaired,
    modelMs, timings: { generate: generatedSpecMs + performance.now() - codeStart, freeze: freezeMs } };
}
