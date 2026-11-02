import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { generate } from './generator.mjs';
import { compile } from './compiler.mjs';
import { ledger, receipt } from './ledger.mjs';
import { hash } from './host.mjs';
export async function runNeed({ need, directory, pool, env = process.env, compiler = env.ENDOFORGE_ASC_CMD }) {
  const timings = Object.fromEntries(['generate', 'freeze', 'compile', 'gate', 'ledger', 'promote'].map(k => [k, null]));
  try {
    const generated = await generate({ need, directory, env });
    Object.assign(timings, generated.timings);
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
    return { promoted: decision.decision === 'promote', candidate: identity, receipt: decision.receipt,
      decision: decision.sha256, testDouble: generated.testDouble, timings };
  } catch { return { promoted: false, error: 'pipeline stage failed; inspect local artifacts', testDouble: env.ENDOFORGE_CODEX_TEST_DOUBLE === '1', timings }; }
}
