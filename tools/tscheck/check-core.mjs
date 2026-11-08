// The check itself, with no file system or package access, so the same code runs on the supervisor
// (checker.mjs) and inside a contained cohort Worker (cohort-check.mjs), where it is imported from text.
import { createHash } from 'node:crypto';

const now = performance.now.bind(performance);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const DECLARATION = /\.d\.(?:mts|cts|ts|[^/]*\.ts)$/;
const COMPILER_NAME = /(?:\.d(?:\.[^/]*)?)?\.(?:tsx?|mts|cts|jsx?|mjs|cjs|json|tsbuildinfo)$/;
const UNSAFE = /[\p{C}\p{Zl}\p{Zp}\\]/u;
const INFO_NAME = '.tsbuildinfo';
const fold = value => value.normalize('NFKC').toLowerCase();
const text = value => typeof value === 'string' ? value : Buffer.from(value).toString('latin1').replaceAll('\0', '');
const refused = (path, reason) => new Error(`project path refused: ${JSON.stringify(path)} ${reason}`);

export const HOST_OPTIONS = Object.freeze(['--noCheck', 'false', '--noResolve', 'false', '--incremental', 'true']);

function requireCanonical(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/') throw refused(path, 'is not an absolute path below /');
  if (UNSAFE.test(path)) throw refused(path, 'has a newline, backslash, control or format character');
  if (path !== path.normalize('NFC')) throw refused(path, 'is not in Unicode NFC form');
  for (const segment of path.slice(1).split('/')) {
    if (!segment || /[\p{Zs}.]$/u.test(segment)) throw refused(path, 'has an empty, dot or padded segment');
  }
}

function refuseInputs(root, files) {
  requireCanonical(root);
  const folded = new Set();
  const keys = new Set(Object.keys(files));
  for (const path of keys) {
    if (fold(path).split(/[/\\]/).some(segment => segment.endsWith(INFO_NAME))) throw new Error(`build info is not accepted as input: ${JSON.stringify(path)}`);
    requireCanonical(path);
    if (!path.startsWith(`${root}/`)) throw refused(path, `is not under the root ${root}`);
    if (typeof files[path] !== 'string' && !(files[path] instanceof Uint8Array)) throw refused(path, 'has contents that are neither text nor bytes');
    const name = path.slice(path.lastIndexOf('/') + 1);
    const family = COMPILER_NAME.exec(fold(name))?.[0];
    if (family && !name.endsWith(family)) throw refused(path, `is not the exact extension ${family}`);
    if (folded.has(fold(path))) throw refused(path, 'differs from another key only by case or Unicode form');
    folded.add(fold(path));
    for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
      if (keys.has(path.slice(0, end))) throw refused(path, 'is below a key that is also a file');
    }
  }
}

function programOf(root, info) {
  const { fileNames = [] } = JSON.parse(info ?? '{}');
  return new Set(fileNames.filter(name => name.startsWith('./')).map(name => `${root}/${name.slice(2)}`));
}

function checkedSources(root, files, program) {
  const sources = Object.keys(files).filter(path => SOURCE.test(path) && !DECLARATION.test(path));
  const outside = sources.filter(path => !program.has(path) && !path.startsWith(`${root}/node_modules/`));
  if (outside.length) throw new Error(`not a full check: project sources outside the program: ${outside.slice(0, 5).join(', ')}`);
  const checked = sources.filter(path => program.has(path));
  if (!checked.length) throw new Error('not a full check: no TypeScript source in the program');
  const unchecked = checked.filter(path => /@ts-nocheck/i.test(text(files[path])));
  if (unchecked.length) throw new Error(`not a full check: @ts-nocheck in ${unchecked.slice(0, 5).join(', ')}`);
  return checked.length;
}

const sameText = (left, right) => Buffer.from(left).equals(Buffer.from(right));
const baselineFor = (baseline, project) => {
  if (!baseline) return undefined;
  if (baseline.root !== project.root || baseline.tsconfig !== JSON.stringify(project.tsconfig ?? null)) return undefined;
  const keys = Object.keys(project.files);
  if (keys.length !== Object.keys(baseline.files).length || !keys.every(key => Object.hasOwn(baseline.files, key))) return undefined;
  return keys.every(key => sameText(baseline.files[key], project.files[key])) ? undefined : baseline.buildInfo;
};

export function createBaseline(compiler, project) {
  const report = runCheck(compiler, project, { buildInfo: null });
  if (report.diagnostics.length || typeof report.buildInfo !== 'string') throw new Error('a baseline project must check clean');
  return Object.freeze({ root: project.root, tsconfig: JSON.stringify(project.tsconfig ?? null), files: Object.freeze({ ...project.files }), buildInfo: report.buildInfo });
}

export function runCheck({ core, module, compiler }, project, { emit = false, buildInfo, baseline } = {}) {
  if (emit && buildInfo !== undefined) throw new Error('emit needs a full check');
  if (baseline !== undefined && buildInfo !== undefined) throw new Error('a baseline and build info are exclusive');
  const incremental = buildInfo !== undefined;
  refuseInputs(project.root, project.files);
  const infoPath = `${project.root}/${INFO_NAME}`;
  const seed = incremental ? buildInfo : baselineFor(baseline, project);
  const files = { ...project.files, ...(project.tsconfig ? { [`${project.root}/tsconfig.json`]: JSON.stringify(project.tsconfig) } : {}),
    ...(typeof seed === 'string' ? { [infoPath]: seed } : {}) };
  const host = core.memoryFileSystem(files);
  let stderr = '';
  const started = now();
  const result = core.runTsc(module,
    core.makeRequest(['-p', `${project.root}/tsconfig.json`, '--pretty', 'false', ...HOST_OPTIONS, '--tsBuildInfoFile', infoPath, ...(emit ? [] : ['--noEmit'])], { cwd: project.root, json: true }),
    host, { env: {}, stderr: chunk => { stderr += Buffer.from(chunk).toString(); } });
  const wallMs = Math.round(now() - started);
  if (result.exitCode === core.EXIT_CRASHED) throw new Error(`tsrs trapped: ${stderr.slice(0, 300)}`);
  const diagnostics = core.parseReply(result.reply).map(d => ({
    file: d.fileName ?? null,
    line: d.startPosition ? d.startPosition.line + 1 : 0,
    column: d.startPosition ? d.startPosition.character + 1 : 0,
    code: d.code,
    text: d.text,
  }));
  if (result.exitCode !== 0 && !diagnostics.length) throw new Error(`tsrs failed without diagnostics: ${stderr.slice(0, 300)}`);
  const clean = !diagnostics.length;
  const sources = clean ? checkedSources(project.root, files, programOf(project.root, host.written.get(infoPath) ?? files[infoPath])) : null;
  const written = Object.fromEntries([...host.written].filter(([path]) => path !== infoPath));
  if (emit && clean && !Object.keys(written).length) throw new Error('emit produced no files');
  if (emit && clean) for (const path of Object.keys(written)) {
    requireCanonical(path);
    if (!path.startsWith(`${project.root}/`)) throw refused(path, `was emitted outside the root ${project.root}`);
  }
  return {
    compiler: { name: compiler.name, sha256: compiler.sha256 },
    exitCode: result.exitCode,
    diagnostics,
    wallMs,
    memoryBytes: result.memoryBytes,
    checkedSources: sources,
    ...(incremental ? { buildInfo: host.written.get(infoPath) ?? buildInfo } : {}),
    artifact: emit && clean
      ? { files: written, sha256: Object.fromEntries(Object.entries(written).map(([path, value]) => [path, sha256(value)])) }
      : null,
  };
}
