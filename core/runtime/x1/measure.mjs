import { performance } from 'node:perf_hooks';
import { loadKernel } from './meter.mjs';
export const kernelFuel = 1_000_000_000;
export const signature = { version: 1, name: 'x1.kernel', inputs: [{ path: 'workload', type: 'string', unit: '1' }], output: { type: 'object', unit: '1' } };
export const limits = Object.freeze({ wallMs: 30000, memoryBytes: 64 * 1024 * 1024, fuel: kernelFuel });
export const allowedEffects = Object.freeze(['call:env.abort', 'import:env.abort']);
export const workloads = Object.freeze(['frozen-tests', 'non-finite-probes']);
const encode = value => (typeof value === 'bigint' ? value.toString() : typeof value !== 'number' ? value : Number.isNaN(value) ? 'NaN' : !Number.isFinite(value) ? String(value) : Object.is(value, -0) ? '-0' : value);
export const floats = new Set(['f32', 'f64']);
const abortSignature = signature => signature && signature.params.length === 4 && signature.params.every(type => type === 'i32') && !signature.results.length;
export function probeCalls(tests, functions) {
  const calls = [];
  for (const fn of [...new Set(tests.map(test => test.fn))]) {
    const params = functions[fn]?.params;
    if (!params) continue;
    const base = (tests.find(test => test.fn === fn && !test.expectError) ?? tests.find(test => test.fn === fn)).args;
    params.forEach((type, index) => {
      if (floats.has(type)) for (const value of [NaN, Infinity, -Infinity]) calls.push({ fn, args: params.map((_, i) => (i === index ? value : base[i] ?? 0)) });
    });
  }
  return calls;
}
export function callKernel(kernel, fn, args) {
  try { return { value: kernel.instance.exports[fn](...args) }; }
  catch (error) {
    if (kernel.exhausted()) return { limit: 'fuel exhausted' };
    return error instanceof RangeError ? { limit: 'stack exhausted' } : { trap: kernel.aborted() ? 'abort' : 'runtime' };
  }
}
export function freshKernel(loaded) {
  let aborts = false, last = false;
  const kernel = loaded.start(() => { aborts = true; last = true; throw new Error('abort'); });
  return Object.assign(kernel, { aborted: () => { const was = last; last = false; return was; }, aborts: () => aborts });
}
export function measuredPort(find) {
  const loaded = new Map(), rounds = new Map();
  const load = identity => {
    if (!loaded.has(identity)) loaded.set(identity, (() => {
      const candidate = find(identity);
      if (!candidate) return { problem: 'no.candidate' };
      if (typeof candidate.compiled?.wasm !== 'string' || candidate.compiled.error) return { problem: 'no.module' };
      let tests;
      try { tests = JSON.parse(candidate.files['tests.json']); } catch { return { problem: 'invalid.tests' }; }
      if (!Array.isArray(tests) || !tests.length) return { problem: 'invalid.tests' };
      let kernel;
      try { kernel = loadKernel(Buffer.from(candidate.compiled.wasm, 'base64'), kernelFuel); } catch { return { problem: 'invalid.module' }; }
      return { kernel, tests };
    })());
    return loaded.get(identity);
  };
  const describe = identity => {
    if (find(identity)?.compiled?.unavailable) return { status: 'outcome_unknown' };
    const { problem, kernel, tests } = load(identity);
    const observed = reason => ({ ...signature, name: `x1.refused.${reason}` });
    if (problem) return observed(problem);
    for (const test of tests) {
      const type = kernel.shape.functions[test.fn];
      if (!type) return observed('missing.export');
      if (!Array.isArray(test.args) || test.args.length !== type.params.length) return observed('arity');
    }
    try { freshKernel(kernel); } catch { return observed('instantiation'); }
    return signature;
  };
  const run = (identity, cases, limit) => {
    const { problem, kernel, tests } = load(identity);
    if (problem) return { status: `not runnable: ${problem}`, outputs: [], usage: { wallMs: 0, memoryBytes: 0, fuel: 0 }, effects: [] };
    const round = rounds.get(identity) ?? 0;
    rounds.set(identity, round + 1);
    const planned = { 'frozen-tests': tests.map(test => ({ fn: test.fn, args: test.args })), 'non-finite-probes': probeCalls(tests, kernel.shape.functions) };
    const flat = cases.flatMap(({ id }) => (planned[id] ?? []).map((call, index) => ({ ...call, id, index })));
    if (round % 2) flat.reverse();
    const results = Object.fromEntries(cases.map(({ id }) => [id, []]));
    const begin = performance.now();
    let status = 'completed', fresh;
    try { fresh = freshKernel(kernel); } catch { status = 'instantiation failed'; }
    if (fresh) for (const { fn, args, id, index } of flat) {
      const outcome = callKernel(fresh, fn, args);
      if (outcome.limit) { status = outcome.limit; break; }
      results[id][index] = { fn, args: args.map(encode), ...(outcome.trap ? { trap: outcome.trap } : { value: encode(outcome.value) }) };
    }
    const wallMs = performance.now() - begin;
    if (status === 'completed' && wallMs > limit.wallMs) status = 'outcome_unknown';
    return { status, outputs: cases.map(({ id }) => ({ caseId: id, value: { calls: results[id] } })),
      usage: { wallMs, memoryBytes: fresh?.memoryBytes() ?? 0, fuel: fresh ? Math.max(fresh.used(), 0) : 0 }, effects: fresh?.aborts() ? ['call:env.abort'] : [] };
  };
  const scanEffects = identity => {
    const { problem, kernel } = load(identity);
    if (problem) return [`unscannable:${problem}`];
    const { imports, calls } = kernel.shape;
    return [...new Set([...imports.map(entry => (entry.kind === 0 && entry.module === 'env' && entry.name === 'abort' && abortSignature(entry.signature) ? 'import:env.abort' : `import:${entry.module}.${entry.name}`)),
      ...calls.map(name => `call:${name}`)])].sort();
  };
  return { describe, run, scanEffects };
}
