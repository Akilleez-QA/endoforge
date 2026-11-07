import { createHash } from 'node:crypto';
import { createContainedPool, createContainedRunner, LANE } from '../../core/runtime/contained/runner.mjs';
import { typecheck } from './checker.mjs';

export const ROUTE = 'typescript';
const ROOT = '/proj';
const SCALARS = 'declare type i8=number;declare type i16=number;declare type i32=number;declare type i64=number;declare type isize=number;declare type u8=number;declare type u16=number;declare type u32=number;declare type u64=number;declare type usize=number;declare type f32=number;declare type f64=number;declare type bool=boolean;\n';
const ADAPTER = 'const kernel = require("./kernel");exports.main = I => I.tests.map(t => { try { return { out: kernel[t.fn](...t.args) }; } catch (error) { return { err: String(error && error.message) }; } });';
const sha256 = text => createHash('sha256').update(text).digest('hex');

export const projectFor = source => ({ root: ROOT, files: { [`${ROOT}/kernel.ts`]: source, [`${ROOT}/scalars.d.ts`]: SCALARS },
  tsconfig: { compilerOptions: { strict: true, target: 'es2022', lib: ['es2022'], module: 'commonjs', moduleResolution: 'bundler', types: [], noEmitOnError: true }, files: ['./kernel.ts', './scalars.d.ts'] } });

const passes = (test, result) => {
  if (test.expectError) return result.err !== undefined;
  if (result.err !== undefined) return false;
  if (typeof test.expect === 'boolean') return Boolean(result.out) === test.expect || result.out === (test.expect ? 1 : 0);
  if (typeof test.expect === 'number') return Number.isFinite(test.tol) ? Math.abs(Number(result.out) - test.expect) <= test.tol : Number(result.out) === test.expect;
  return String(result.out) === String(test.expect);
};

export const LAYOUTS = Object.freeze({
  'shared-reuse': options => createContainedRunner({ ...options, reuse: true }),
  'shared-fresh': options => createContainedRunner({ ...options, reuse: false }),
  'process-per-cell': options => createContainedPool({ ...options, reuse: false }),
});

export function createContainedRoute({ width = 1, deadlineMs = 1000, layout = 'shared-reuse', ...limits } = {}) {
  if (!Object.hasOwn(LAYOUTS, layout)) throw new TypeError(`unknown layout ${layout}`);
  const pool = LAYOUTS[layout]({ width, deadlineMs, ...limits });
  const receipt = fields => ({ lane: LANE, route: ROUTE, ...fields });
  return {
    pool,
    ready: () => pool.ready(),
    close: () => pool.close(),
    async check(candidate, { contract } = {}) {
      const started = performance.now();
      const report = await typecheck(projectFor(candidate.files['kernel.ts']), { emit: true });
      const checkMs = performance.now() - started;
      if (!report.artifact) return receipt({ status: 'refused', reason: 'typescript', diagnostics: report.diagnostics.slice(0, 5), compiler: report.compiler, checkMs });
      const modules = Object.fromEntries(Object.entries(report.artifact.files).filter(([path]) => path.endsWith('.js')));
      modules[`${ROOT}/__adapter.js`] = ADAPTER;
      const tests = JSON.parse(candidate.files['tests.json']);
      const runStarted = performance.now();
      const result = await pool.runTwice({ modules, entry: `${ROOT}/__adapter.js`, input: { tests }, deadlineMs, contract });
      const fields = { compiler: report.compiler, artifact: report.artifact.sha256, adapter: sha256(ADAPTER), checkMs, runMs: performance.now() - runStarted, comparedRuns: result.comparedRuns ?? 0, cohort: result.cohort, contract: result.contract };
      if (result.status !== 'completed') return receipt({ status: result.status, reason: result.reason, detail: result.detail, ...fields });
      const outcomes = JSON.parse(result.output);
      const failed = tests.flatMap((test, index) => passes(test, outcomes[index]) ? [] : [{ name: test.name, got: outcomes[index] }]);
      return receipt({ status: failed.length ? 'refused' : 'completed', reason: failed.length ? 'tests' : null, passed: tests.length - failed.length, total: tests.length, failed: failed.slice(0, 5), outputSha256: result.outputSha256, ...fields });
    },
  };
}
