import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { generate } from './generator.mjs';
import { compile } from './compiler.mjs';
import { ledger, receipt } from './ledger.mjs';
import { hash } from './host.mjs';
import { runGates } from './gates.mjs';
import { attemptAgent, attemptInIsolate } from './loop.mjs';
const failures = compiler => async candidate => {
  const result = runGates({ ...candidate, compiled: await compile(candidate.files, compiler) });
  if (result.promotable) return null;
  return { gates: Object.fromEntries(Object.entries(result.gates).filter(([, gate]) => !gate.ok)), tests: (result.tests || []).filter(test => !test.pass).slice(0, 20) };
};
export async function runNeed(options) {
  const env = options.env ?? process.env;
  if (env.ENDOFORGE_CODEX_TERSE !== 'fallback') return attempt(options);
  const begin = Date.now(), budget = Number(env.ENDOFORGE_RETRY_BUDGET_MS) || Infinity;
  const first = await attempt({ ...options, env: { ...env, ENDOFORGE_CODEX_TERSE: '1' } });
  if (first.promoted) return { ...first, retried: false };
  const elapsed = Date.now() - begin;
  if (elapsed >= budget) return { ...first, retried: false, retrySkipped: 'budget' };
  if (first.error) return { ...first, retried: false, retrySkipped: 'stage-error' };
  const second = await attempt({ ...options, directory: `${options.directory}-retry`, env: { ...env, ENDOFORGE_CODEX_TERSE: '0' }, deadline: begin + budget });
  return { ...second, retried: true, retryCancelled: !second.promoted && Date.now() >= begin + budget, first: { promoted: false, timings: first.timings } };
}
async function attempt(options) {
  const path = (options.env ?? process.env).ENDOFORGE_LOOP;
  return path === 'agent' ? attemptAgent(options) : path === 'isolate' ? attemptInIsolate(options) : attemptCurrent(options);
}
async function attemptCurrent({ need, directory, pool, env = process.env, compiler = env.ENDOFORGE_ASC_CMD, deadline = Infinity, observe }) {
  const timings = Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null]));
  let scalarFilter;
  try {
    const generated = await generate({ need, directory, env, check: failures(compiler), deadline });
    scalarFilter = generated.scalarFilter;
    Object.assign(timings, generated.timings);
    observe?.('generated');
    let start = performance.now();
    const candidate = { ...generated.candidate, compiled: await compile(generated.candidate.files, compiler) };
    timings.compile = performance.now() - start;
    start = performance.now();
    const content = JSON.stringify(candidate), identity = hash(content), reference = generated.reference;
    await ledger('register', { reference, content });
    const registerMs = performance.now() - start;
    const result = await pool.run({ reference, candidates: [identity], portOptions: { candidates: { [identity]: candidate } },
      receipts: [receipt(reference, generated.digest, identity)], timing: true });
    timings.gate = result.timings.gate; timings.ledger = registerMs + result.timings.ledger;
    start = performance.now();
    const decision = await ledger('promote', { reference, candidate: identity,
      receipt: { id: result.receipts[0].record.id, hash: result.receipts[0].hash }, decisionPath: join(directory, 'promotion.json') });
    timings.promote = performance.now() - start;
    observe?.('returned');
    return { promoted: decision.decision === 'promote', candidate: identity, receipt: decision.receipt,
      decision: decision.sha256, testDouble: generated.testDouble, modelMs: generated.modelMs, timings, ...(scalarFilter ? { scalarFilter } : {}) };
  } catch (error) {
    scalarFilter ??= error?.scalarFilter;
    return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1', timings, ...(scalarFilter ? { scalarFilter } : {}) };
  }
}
