import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { compile as compileKernel, loadCompiler, x1Flags } from '../../../experiments/assemblyscript-toolchain.mjs';
import { ASC_FILES, ASC_PATH, ASC_VERSION } from '../../../tools/asc/pin.mjs';
import { createEngine } from '../../../tools/browser/engine-host.mjs';
import { agentStage, frozenSpecification, specificationFiles, specificationProblems, stagePrompts, takeReply } from './agent.mjs';
import { compileFailure, runGates } from './gates.mjs';
import { createPort as x1Port, hash, implementationFiles as hostFiles } from './host.mjs';

export const cellFiles = Object.freeze(['loop-port.mjs', 'agent.mjs', 'oracle.mjs']);
export const implementationFiles = Object.freeze([...hostFiles, ...cellFiles]);
const oracleFiles = ['CONTRACT.md', 'tests.json', 'frozen.sha256'];
const maximumKernelPages = 1024;
const implementationBytes = implementationFiles.map(name => [name, readFileSync(new URL(name, import.meta.url))]);
const implementation = Object.fromEntries(implementationBytes.map(([name, bytes]) => [name, bytes.toString('hex')]));
export const implementationDigests = Object.freeze(Object.fromEntries(implementationBytes.map(([name, bytes]) => [name, hash(bytes)])));
const primer = {
  id: 'primer',
  files: { 'CONTRACT.md': 'Warm-up primer.', 'kernel.ts': 'export function primer(a:f64,b:i32):f64{let t=a;for(let i=0;i<b;i++){t+=Math.sqrt(<f64>i)}if(b<0){throw new Error("range")}return t}',
    'tests.json': JSON.stringify([{ name: 'primer', fn: 'primer', args: [1, 0], expect: 1 }]),
    'glue.json': JSON.stringify({ id: 'primer', assumption: 'Warm-up input that exercises the gates.', question: 'Does the cell have warm machinery ready?',
      exports: [{ name: 'primer', label: 'Warm-up', args: [{ name: 'a', kind: 'number', unit: '1' }, { name: 'b', kind: 'integer', unit: '1' }], result: { kind: 'number', unit: '1', precision: 2 } }], traps: [] }) },
};
primer.files['frozen.sha256'] = JSON.stringify({ contract: hash(primer.files['CONTRACT.md']), tests: hash(primer.files['tests.json']) });
let compiler;
let ascPath = ASC_PATH;
let engine = null;
const pinned = path => {
  const modules = join(dirname(path), '..', '..');
  const files = Object.fromEntries(Object.entries(ASC_FILES).map(([name, sha256]) => {
    if (createHash('sha256').update(readFileSync(join(modules, name))).digest('hex') !== sha256) throw Error(`compiler pin differs: ${name}`);
    return [name, sha256];
  }));
  return { name: 'assemblyscript', version: ASC_VERSION, files };
};
function declaredPages(bytes) {
  let p = 8;
  const uint = () => { let n = 0, shift = 0, b; do { b = bytes[p++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  while (p < bytes.length) {
    const section = bytes[p++], size = uint(), end = p + size;
    if (section === 5) {
      if (uint() !== 1) return null;
      const flags = uint(); uint();
      return flags & 1 ? uint() : null;
    }
    p = end;
  }
  return 0;
}
async function compileInCell(files, onRead) {
  const source = hash(files['kernel.ts']);
  const diagnostics = [], text = files['kernel.ts'];
  const onDiagnostic = ({ code, category, message, range }) => {
    if (category !== 3) return;
    const start = range?.source?.normalizedPath === 'kernel.ts' ? range.start : null;
    const line = start === null ? null : text.slice(0, start).split('\n').length;
    diagnostics.push({ code: `${code < 1000 ? 'AS' : 'TS'}${code}`, line, column: line && start - text.lastIndexOf('\n', start - 1), message });
  };
  try {
    const bytes = await compileKernel({ name: 'kernel', source: text }, ascPath, { flags: x1Flags, onRead, onDiagnostic });
    if (!bytes) return compileFailure(source, diagnostics);
    const pages = declaredPages(bytes);
    if (pages === null || pages > maximumKernelPages) return { source, error: 'compiled memory exceeds the kernel limit' };
    return { source, wasm: Buffer.from(bytes).toString('base64') };
  } catch { return compileFailure(source, []); }
}
const stageLimits = (limits, spent) => ({ ...limits, maxTokens: limits.maxTokens + spent });
const passed = result => ({ gates: Object.keys(result.gates).filter(name => result.gates[name].ok), tests: (result.tests || []).flatMap((test, index) => test.pass ? [index] : []) });
const summary = (result, before) => {
  if (result.promotable) return null;
  const mark = (entry, was) => was ? { ...entry, regression: true } : entry;
  const failing = Object.entries(result.gates).filter(([, gate]) => !gate.ok), compile = failing.find(([name]) => name === 'G2_compiles');
  return { stage: compile ? 'compile' : 'checks', gates: Object.fromEntries((compile ? [compile] : failing).map(([name, gate]) => [name, mark(gate, before.gates.has(name))])),
    tests: compile ? [] : (result.tests || []).flatMap((test, index) => test.pass ? [] : [mark(test, before.tests.has(index))]).slice(0, 20) };
};

export const inspect = input => (engine ? engine.inspect(input) : Promise.reject(Error('render engine is off in this cell')));

export async function warm({ primes = 1, path = ASC_PATH, render = null } = {}) {
  ascPath = path;
  if (render) await (engine ??= createEngine({ policy: render })).start();
  compiler = pinned(path);
  await loadCompiler(path);
  for (let i = 0; i < primes; i++) runGates({ ...primer, compiled: await compileInCell(primer.files) });
}

const filled = (text, elided, quote) => {
  const at = elided.map(name => {
    if (implementation[name] === undefined) throw Error('frozen identity changed');
    const key = `${quote}"${name}${quote}":${quote}"`, start = text.indexOf(`${key}${quote}"`);
    if (start < 0 || start !== text.lastIndexOf(`${key}${quote}"`)) throw Error('frozen identity changed');
    return [start + key.length, name];
  }).sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let from = 0;
  for (const [end, name] of at) { pieces.push(text.slice(from, end), implementation[name]); from = end; }
  pieces.push(text.slice(from));
  return pieces;
};
const digestOf = pieces => pieces.reduce((sha, piece) => sha.update(piece), createHash('sha256')).digest('hex');
function framed({ frame, elided }) {
  const data = JSON.parse(frame), thin = JSON.stringify(data.content), at = frame.indexOf(thin);
  if (typeof data.content !== 'string' || at < 0 || at !== frame.lastIndexOf(thin)) throw Error('frozen identity changed');
  const escaped = filled(thin, elided, '\\');
  return { data, encoded: [frame.slice(0, at), ...escaped, frame.slice(at + thin.length)], content: filled(data.content, elided, '') };
}
export const encodedOf = admission => framed(admission).encoded.join('');
export function verifyFromMemory(admission) {
  return async reference => {
    const { identity } = admission, { data, encoded, content } = framed(admission);
    if (reference.identity !== identity || `evr:${digestOf(encoded)}` !== identity) throw Error('frozen identity changed');
    if (digestOf(content) !== data.freeze.digest) throw Error('frozen content digest differs');
    const bundle = JSON.parse(data.content);
    for (const name of admission.elided) bundle.files[name] = implementation[name];
    return { identity, digest: data.freeze.digest, bundle };
  };
}

export function createPort(options, { stage = () => {}, host } = {}) {
  let candidate, identity, base, agentReceipt;
  let compileMs = 0, gateMs = 0, compiledSource, compiledResult;
  const rounds = [];
  const compileRound = async files => {
    stage('compile:start');
    const begin = performance.now();
    if (compiledSource !== files['kernel.ts']) {
      compiledResult = await compileInCell(files, () => stage('compile:read'));
      compiledSource = files['kernel.ts'];
    }
    compileMs += performance.now() - begin;
    return { id: options.candidate?.id ?? options.id, files, compiled: compiledResult };
  };
  const checkRound = current => {
    const begin = performance.now();
    const earlier = rounds.filter(round => round.passed && round.failures?.stage !== 'compile');
    const result = runGates(current), failures = summary(result, { gates: new Set(earlier.flatMap(round => round.passed.gates)), tests: new Set(earlier.flatMap(round => round.passed.tests)) });
    gateMs += performance.now() - begin;
    rounds.push({ round: rounds.length, source: current.compiled.source, failures, passed: passed(result) });
    return failures;
  };
  const repairRounds = async () => {
    const { module, maxRounds, options: repairOptions } = options.repair;
    const { repair } = await import(module);
    let files = options.candidate.files;
    for (let round = 0; ; round++) {
      const current = await compileRound(files);
      const failures = checkRound(current);
      if (!failures || round >= maxRounds) return current;
      const next = await repair({ files, failures, round, options: repairOptions });
      if (!next) return current;
      if (oracleFiles.some(name => next[name] !== undefined && next[name] !== files[name])) throw Error('frozen specification changed during repair');
      files = { ...files, 'kernel.ts': next['kernel.ts'] ?? files['kernel.ts'], 'glue.json': next['glue.json'] ?? files['glue.json'] };
    }
  };
  const agentCandidate = async () => {
    const { id, need, limits } = options, overlay = {}, messages = [];
    agentReceipt = { turns: 0, tokens: 0, tool_calls: 0, exit_reason: null };
    const ask = (messages, remaining) => { stage('model:wait'); return host({ kind: 'model', messages, remaining }); };
    if (options.admission) {
      const { bundle } = await verifyFromMemory(options.admission)({ identity: options.admission.identity });
      for (const name of oracleFiles) overlay[name] = Buffer.from(bundle.files[name], 'hex').toString();
    } else {
      agentReceipt.exit_reason = await agentStage({ ask, messages, overlay, editable: specificationFiles(limits), prompt: stagePrompts.specification({ need, id, oracle: limits.oracle }),
        check: async () => specificationProblems(overlay, limits), receipt: agentReceipt, limits });
      if (agentReceipt.exit_reason !== 'stop') throw Error(`specification stopped: ${agentReceipt.exit_reason}`);
      const oracle = limits.oracle ? frozenSpecification(overlay) : null;
      overlay['frozen.sha256'] = JSON.stringify({ contract: hash(overlay['CONTRACT.md']), tests: hash(overlay['tests.json']) });
      const frozen = Object.fromEntries(oracleFiles.map(name => [name, Buffer.from(overlay[name]).toString('hex')]));
      options.admission = await host({ kind: 'admit', files: frozen, implementation: implementationDigests, ...(oracle ? { oracle } : {}) });
      if (options.admission.reused) return null;
    }
    stage('admitted');
    const files = () => ({ 'CONTRACT.md': overlay['CONTRACT.md'], 'tests.json': overlay['tests.json'], 'frozen.sha256': overlay['frozen.sha256'], 'kernel.ts': overlay['kernel.ts'] ?? '', 'glue.json': overlay['glue.json'] ?? '' });
    agentReceipt.exit_reason = await agentStage({ ask, messages, overlay, editable: ['kernel.ts', 'glue.json'], prompt: stagePrompts.implementation({ id, overlay: messages.length ? null : overlay }),
      check: async () => (overlay['kernel.ts'] === undefined ? { problems: ['kernel.ts is missing'] } : checkRound(await compileRound(files()))), receipt: agentReceipt, limits: stageLimits(limits, agentReceipt.tokens) });
    if (overlay['kernel.ts'] === undefined) throw Error(`implementation stopped: ${agentReceipt.exit_reason}`);
    return compileRound(files());
  };
  const releasedCandidate = async () => {
    const { id, limits } = options, resumed = options.continuation;
    if (resumed && JSON.stringify(resumed.compiler) !== JSON.stringify(compiler)) throw Error('runtime changed during the wait');
    const state = resumed ?? { stage: null, turn: 0, messages: [], overlay: {}, receipt: { turns: 0, tokens: 0, tool_calls: 0, exit_reason: null }, compiler };
    const { messages, overlay } = state;
    agentReceipt = state.receipt;
    rounds.push(...(state.rounds ?? []));
    state.rounds = rounds;
    const admitted = () => verifyFromMemory(options.admission)({ identity: options.admission.identity }).then(({ bundle }) => {
      for (const name of implementationFiles) if (implementation[name] !== bundle.files[name]) throw Error('host implementation drift');
      for (const name of oracleFiles) {
        const text = Buffer.from(bundle.files[name], 'hex').toString();
        if (state.stage === 'implementation' && overlay[name] !== text) throw Error('frozen files differ from the continuation');
        overlay[name] = text;
      }
    });
    const files = () => ({ 'CONTRACT.md': overlay['CONTRACT.md'], 'tests.json': overlay['tests.json'], 'frozen.sha256': overlay['frozen.sha256'], 'kernel.ts': overlay['kernel.ts'] ?? '', 'glue.json': overlay['glue.json'] ?? '' });
    const stages = {
      specification: { editable: specificationFiles(limits), check: async () => specificationProblems(overlay, limits), prompt: () => stagePrompts.specification({ need: options.need, id, oracle: limits.oracle }) },
      implementation: { editable: ['kernel.ts', 'glue.json'], prompt: () => stagePrompts.implementation({ id, overlay: messages.length ? null : overlay }),
        check: async () => (overlay['kernel.ts'] === undefined ? { problems: ['kernel.ts is missing'] } : checkRound(await compileRound(files()))) },
    };
    const begin = name => { messages.push({ role: 'user', content: stages[name].prompt() }); Object.assign(state, { stage: name, turn: 0, stageTokens: state.receipt.tokens }); };
    if (options.admission) await admitted();
    if (!state.stage) begin(options.admission ? 'implementation' : 'specification');
    else {
      const { stage: name } = state;
      let exit = await takeReply({ messages, overlay, editable: stages[name].editable, check: stages[name].check, receipt: state.receipt, limits: stageLimits(limits, state.stageTokens ?? 0) }, options.reply);
      state.turn += 1;
      if (!exit && state.turn >= limits.maxTurns) exit = 'max_turns';
      if (exit) {
        state.receipt.exit_reason = exit;
        if (name === 'specification') {
          if (exit !== 'stop') throw Error(`specification stopped: ${exit}`);
          const oracle = limits.oracle ? frozenSpecification(overlay) : null;
          overlay['frozen.sha256'] = JSON.stringify({ contract: hash(overlay['CONTRACT.md']), tests: hash(overlay['tests.json']) });
          const frozen = Object.fromEntries(oracleFiles.map(file => [file, Buffer.from(overlay[file]).toString('hex')]));
          options.admission = await host({ kind: 'admit', files: frozen, implementation: implementationDigests, ...(oracle ? { oracle } : {}) });
          if (options.admission.reused) return { reused: true };
          stage('admitted');
          begin('implementation');
        } else {
          if (overlay['kernel.ts'] === undefined) throw Error(`implementation stopped: ${exit}`);
          return { candidate: await compileRound(files()) };
        }
      }
    }
    stage('model:wait');
    return { waiting: state };
  };
  const port = {
    describe: value => base.describe(value),
    run: (...args) => base.run(...args),
    scanEffects: value => base.scanEffects(value),
    residual(_, bundle) {
      stage('gates:start');
      for (const name of implementationFiles) if (implementation[name] !== bundle.files[name]) throw Error('host implementation drift');
      for (const name of oracleFiles) if (Buffer.from(bundle.files[name], 'hex').toString() !== candidate.files[name]) throw Error('oracle binding differs');
      const begin = performance.now();
      const result = runGates(candidate);
      gateMs += performance.now() - begin;
      return { passed: result.promotable, reason: JSON.stringify(result) };
    },
    measure: value => base.measure(value),
    async evaluate(evaluateCandidates, reference) {
      if (options.mode === 'inspect') {
        const result = await inspect(options.render);
        return { ...result, stage: result.status === 'completed' ? 'inspected' : 'outcome_unknown' };
      }
      compiler ||= pinned(ascPath);
      await loadCompiler(ascPath);
      if (options.mode === 'check') {
        const current = await compileRound(options.candidate.files);
        return { stage: 'checked', failures: checkRound(current) };
      }
      if (options.waits === 'release') {
        const next = await releasedCandidate();
        if (next.waiting) { port.waiting = next.waiting; return { stage: 'waiting' }; }
        candidate = next.candidate ?? null;
      } else candidate = options.mode === 'agent' ? await agentCandidate() : options.repair ? await repairRounds() : await compileRound(options.candidate.files);
      if (!candidate) { port.reused = true; return { stage: 'reused' }; }
      const content = JSON.stringify(candidate);
      identity = hash(content);
      base = x1Port({ candidates: { [identity]: candidate } });
      port.content = content;
      return evaluateCandidates(options.mode === 'agent' ? { identity: options.admission.identity } : reference, [identity], port, { requireFrozen: verifyFromMemory(options.admission) });
    },
    evidence() {
      if (port.waiting) return { waiting: port.waiting, compiler, timings: { compile: compileMs, gates: gateMs } };
      if (port.reused) return { reused: true, compiler, ...(agentReceipt ? { agent: agentReceipt } : {}), timings: { compile: compileMs, gates: gateMs } };
      stage('verdict');
      return { content: port.content, identity, compiler, rounds, ...(agentReceipt ? { agent: agentReceipt } : {}), timings: { compile: compileMs, gates: gateMs } };
    },
  };
  return port;
}
