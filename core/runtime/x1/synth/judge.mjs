import { kernelFuel, callKernel, freshKernel, parseBufferEntries, usesBuffers } from '../measure.mjs';
import { loadKernel } from '../meter.mjs';
import { glueProblems, propertyProblems, same } from './invariants.mjs';
export function judge(evaluator, candidate) {
  if (!evaluator.confirmation?.approved) return { decision: 'abstain', reason: 'residual not confirmed' };
  const { checks } = evaluator;
  if (!checks.vectors.length && !checks.glue.length) return { decision: 'abstain', reason: evaluator.error ?? 'nothing qualified' };
  const failures = [];
  let outcomes = [];
  if (checks.vectors.length) {
    let loaded;
    try { loaded = loadKernel(Buffer.from(candidate.compiled.wasm, 'base64'), kernelFuel); } catch { return { decision: 'refuse', failures: ['module did not load'] }; }
    const entries = parseBufferEntries(candidate.files?.['glue.json']);
    const run = order => {
      const kernel = freshKernel(loaded), out = new Array(checks.vectors.length);
      for (const i of order) {
        const v = checks.vectors[i], type = loaded.shape.functions[v.fn], entry = entries.get(v.fn);
        if (type && usesBuffers(entry)) {
          if (!Array.isArray(v.args) || v.args.length !== entry.args.length) { out[i] = { missing: true }; continue; }
          const r = callKernel(kernel, v.fn, v.args, entry);
          out[i] = r.problem ? { problem: r.problem } : r.limit ? { limit: r.limit } : r.trap ? { trap: true } : { value: r.value };
          continue;
        }
        if (!type || type.params.length !== v.args.length) { out[i] = { missing: true }; continue; }
        if (type.params.some((t, j) => t !== 'f64' && t !== 'f32' && !Number.isInteger(v.args[j]))) { out[i] = { skipped: true }; continue; }
        const r = callKernel(kernel, v.fn, type.params.map((t, j) => (t === 'i64' ? BigInt(v.args[j]) : v.args[j])));
        out[i] = r.limit ? { limit: r.limit } : r.trap ? { trap: true } : { value: Number(r.value) };
      }
      return out;
    };
    const order = checks.vectors.map((_, i) => i);
    outcomes = run(order);
    const again = run([...order].reverse());
    if (JSON.stringify(outcomes) !== JSON.stringify(again)) failures.push('determinism: two instances disagree');
    checks.vectors.forEach((v, i) => {
      const o = outcomes[i];
      if (o.missing) failures.push(`value.reference: ${v.fn} is not exported with ${v.args.length} parameters`);
      else if (o.limit) failures.push(`value.reference: ${v.fn}(${v.args}) ${o.limit}`);
      else if (o.problem) failures.push(`value.reference: ${v.fn}: ${o.problem}`);
      else if (!o.skipped && !same(o.trap ? { throws: true } : o, v)) failures.push(`value.reference: ${v.fn}(${JSON.stringify(v.args)}) gives ${o.trap ? 'a trap' : JSON.stringify(o.value)}, expected ${v.throws ? 'a trap' : v.value}`);
    });
    failures.push(...propertyProblems(checks, outcomes));
  }
  let glue = null;
  try { glue = JSON.parse(candidate.files['glue.json']); } catch {}
  const g = glueProblems(checks, glue);
  failures.push(...g.problems);
  return { decision: failures.length ? 'refuse' : 'pass', failures: [...new Set(failures)].slice(0, 20), counted: failures.length, vectors: checks.vectors.length,
    skipped: outcomes.filter(o => o?.skipped).length, unknownUnits: g.unknown.length };
}
