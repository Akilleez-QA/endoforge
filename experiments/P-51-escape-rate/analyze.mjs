import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CLASSES } from './mutate.mjs';
import { classifyEscape, disagreesWithPeers, load, peerConsensus, relationViolations, same, PEER_TOLERANCE } from './probe.mjs';
import { clopperPearson, clusterBootstrap, requiredN } from './stats.mjs';
import { loadCorpus } from './prepare.mjs';
const NON_FINITE = [NaN, Infinity, -Infinity];
function nonFiniteLeak(loaded) {
  for (const fn of loaded.names) for (let i = 0; i < loaded.arity[fn]; i++) for (const value of NON_FINITE) for (const fill of [0, 1]) {
    const args = Array(loaded.arity[fn]).fill(fill);
    args[i] = value;
    const result = loaded.call(fn, args);
    if (!result.trap && typeof result.value === 'number' && !Number.isFinite(result.value)) return true;
  }
  return false;
}
function glueNameMismatch(source, glue) {
  const declared = new Map([...source.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)].map(m => [m[1], m[2].split(',').map(p => p.split(':')[0].trim()).filter(Boolean)]));
  return glue.exports.some(entry => declared.has(entry.name) && JSON.stringify(declared.get(entry.name)) !== JSON.stringify(entry.args.map(a => a.name)));
}
const readJsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const rate = (rows, escaped = r => r.promoted) => ({ ...clopperPearson(rows.filter(escaped).length, rows.length), clusterBootstrap: clusterBootstrap(rows, r => r.need, escaped) });
function breakdown(rows) {
  return { overall: rate(rows), perClass: Object.fromEntries(CLASSES.map(name => [name, rate(rows.filter(r => r.class === name))])), perNeed: Object.fromEntries([...new Set(rows.map(r => r.need))].sort().map(need => { const part = rows.filter(r => r.need === need); return [need, { k: part.filter(r => r.promoted).length, n: part.length }]; })), perOp: Object.fromEntries([...new Set(rows.map(r => r.op))].sort().map(op => { const part = rows.filter(r => r.op === op); return [op, { class: part[0].class, k: part.filter(r => r.promoted).length, n: part.length }]; })) };
}
const tally = (rows, field) => rows.reduce((out, row) => { const key = row[field] ?? 'none'; out[key] = (out[key] ?? 0) + 1; return out; }, {});
async function loadSources(path) {
  const sources = new Map();
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (row.surface === 'kernel') sources.set(row.mutant, { wasm: row.wasm, op: row.op });
  }
  return sources;
}
export async function analyze({ corpusRoot, prep, output }) {
  const corpus = loadCorpus(corpusRoot, 'cand'), base = loadCorpus(corpusRoot, 'base');
  const baselines = JSON.parse(readFileSync(join(prep, 'baselines.json'), 'utf8'));
  const loadedCache = new Map(), loadedOf = kernel => {
    if (!loadedCache.has(kernel.key)) loadedCache.set(kernel.key, load(baselines[kernel.key]));
    return loadedCache.get(kernel.key);
  };
  const kernels = Object.fromEntries(corpus.map(k => [k.key, k]));
  const allPeers = [...corpus, ...base].filter(k => baselines[k.key]);
  const peersOf = kernel => allPeers.filter(p => p.need === kernel.need && p.key !== kernel.key);
  const consensusCache = new Map(), consensusOf = kernel => {
    if (!consensusCache.has(kernel.key)) consensusCache.set(kernel.key, peerConsensus(kernel, peersOf(kernel), loadedOf(kernel), loadedOf));
    return consensusCache.get(kernel.key);
  };
  const control = readJsonl(join(output, 'control.jsonl'));
  const eligible = new Set(control.filter(r => r.promoted).map(r => r.key));
  const usable = rows => rows.filter(r => eligible.has(r.key) && r.caught !== 'harness_error');
  const retried = new Map(readJsonl(join(output, 'correlated-retry.jsonl')).map(r => [r.mutant, r]));
  const firstPassCorrelated = readJsonl(join(output, 'correlated.jsonl'));
  const transient = firstPassCorrelated.filter(r => r.caught === 'gates_passed_decision_refused');
  const sampled = readJsonl(join(output, 'sampled.jsonl')), correlated = firstPassCorrelated.map(r => retried.get(r.mutant) ?? r), glue = readJsonl(join(output, 'glue.jsonl')), binding = readJsonl(join(output, 'binding.jsonl'));
  const sources = await loadSources(join(prep, 'mutants.jsonl'));
  const pristine = { P21: { kernels: 0, peerFlagged: 0, peerValueFlagged: 0, relationFlagged: 0, withConsensus: 0 }, add: { kernels: 0, peerFlagged: 0, peerValueFlagged: 0, relationFlagged: 0, withConsensus: 0 } };
  for (const kernel of corpus.filter(k => eligible.has(k.key))) {
    const stats = pristine[kernel.cohort], consensus = consensusOf(kernel), loaded = loadedOf(kernel), verdict = disagreesWithPeers(consensus, loaded);
    stats.kernels++;
    if (consensus.length) stats.withConsensus++;
    if (verdict.any) stats.peerFlagged++;
    if (verdict.value) stats.peerValueFlagged++;
    if (relationViolations(JSON.parse(kernel.glue), loaded).length) stats.relationFlagged++;
  }
  const natural = { P21: { pairs: 0, disagreeing: 0, valueDisagreeing: 0 }, add: { pairs: 0, disagreeing: 0, valueDisagreeing: 0 } };
  const usableCorpus = corpus.filter(k => eligible.has(k.key));
  for (let a = 0; a < usableCorpus.length; a++) for (let b = a + 1; b < usableCorpus.length; b++) {
    const x = usableCorpus[a], y = usableCorpus[b];
    if (x.need !== y.need) continue;
    const lx = loadedOf(x), ly = loadedOf(y), shared = lx.names.filter(n => ly.names.includes(n) && lx.arity[n] === ly.arity[n]);
    if (!shared.length) continue;
    let any = false, value = false, compared = false;
    for (const test of [...x.tests, ...y.tests]) {
      if (!shared.includes(test.fn) || !Array.isArray(test.args) || test.args.length !== lx.arity[test.fn]) continue;
      compared = true;
      const p = lx.call(test.fn, test.args), q = ly.call(test.fn, test.args);
      if (same(p, q, PEER_TOLERANCE)) continue;
      any = true;
      if (!p.trap && !q.trap) value = true;
    }
    if (!compared) continue;
    natural[x.cohort].pairs++;
    if (any) natural[x.cohort].disagreeing++;
    if (value) natural[x.cohort].valueDisagreeing++;
  }
  const oracle = row => {
    const kernel = kernels[row.key], loaded = load(sources.get(row.mutant).wasm);
    const verdict = disagreesWithPeers(consensusOf(kernel), loaded), relations = relationViolations(JSON.parse(kernel.glue), loaded);
    const pristineVerdict = disagreesWithPeers(consensusOf(kernel), loadedOf(kernel)), pristineRelations = relationViolations(JSON.parse(kernel.glue), loadedOf(kernel));
    return { peerCatch: verdict.any, peerValueCatch: verdict.value, peerApplicable: consensusOf(kernel).length > 0, relationCatch: relations.length > 0, relations,
      peerNet: verdict.any && !pristineVerdict.any, peerValueNet: verdict.value && !pristineVerdict.value, relationNet: relations.some(r => !pristineRelations.includes(r)) };
  };
  const summariseOracles = rows => {
    const result = { n: rows.length, peerApplicable: 0, peerCatch: 0, peerValueCatch: 0, relationCatch: 0, relationRelations: {}, either: 0, neither: 0, peerNet: 0, peerValueNet: 0, relationNet: 0, eitherNet: 0, finiteWitness: 0, finiteEitherNet: 0, finitePeerNet: 0, finiteRelationNet: 0, finitePeerApplicable: 0 };
    for (const row of rows) {
      const o = oracle(row);
      if (o.peerApplicable) result.peerApplicable++;
      if (o.peerCatch) result.peerCatch++;
      if (o.peerValueCatch) result.peerValueCatch++;
      if (o.relationCatch) result.relationCatch++;
      for (const r of o.relations) result.relationRelations[r] = (result.relationRelations[r] ?? 0) + 1;
      if (o.peerCatch || o.relationCatch) result.either++; else result.neither++;
      if (o.peerNet) result.peerNet++;
      if (o.peerValueNet) result.peerValueNet++;
      if (o.relationNet) result.relationNet++;
      if (o.peerNet || o.relationNet) result.eitherNet++;
      if (row.witness?.finite) {
        result.finiteWitness++;
        if (o.peerApplicable) result.finitePeerApplicable++;
        if (o.peerNet) result.finitePeerNet++;
        if (o.relationNet) result.finiteRelationNet++;
        if (o.peerNet || o.relationNet) result.finiteEitherNet++;
      }
    }
    return result;
  };
  const sampledRows = usable(sampled), correlatedRows = usable(correlated), glueRows = usable(glue), bindingRows = usable(binding);
  const cohort = (rows, name) => rows.filter(r => r.cohort === name);
  const escapes = sampledRows.filter(r => r.promoted).map(row => {
    const kernel = kernels[row.key], { reason, detail } = classifyEscape(row, kernel.tests, loadedOf(kernel), load(sources.get(row.mutant).wasm));
    return { ...row, reason, detail };
  });
  const glueEscapes = glueRows.filter(r => r.promoted).map(row => ({ ...row, ...classifyEscape(row) }));
  const sampledEscaped = new Set(escapes.map(r => r.mutant));
  const correlatedByMutant = new Map(correlatedRows.map(r => [r.mutant, r]));
  const bothArms = sampledRows.filter(r => correlatedByMutant.has(r.mutant));
  const reliesOnIndependence = bothArms.filter(r => !r.promoted && correlatedByMutant.get(r.mutant).promoted);
  const correlatedCaught = correlatedRows.filter(r => !r.promoted);
  const escapeOnly = correlatedRows.filter(r => r.promoted);
  const eligibleKernels = corpus.filter(k => eligible.has(k.key));
  const proposed = {
    nonFiniteLeak: {
      pristineFlagged: { P21: eligibleKernels.filter(k => k.cohort === 'P21' && nonFiniteLeak(loadedOf(k))).length, add: eligibleKernels.filter(k => k.cohort === 'add' && nonFiniteLeak(loadedOf(k))).length },
      nonFiniteOnlyEscapesCaughtNet: escapes.filter(r => !r.witness?.finite && nonFiniteLeak(load(sources.get(r.mutant).wasm)) && !nonFiniteLeak(loadedOf(kernels[r.key]))).length,
      nonFiniteOnlyEscapes: escapes.filter(r => !r.witness?.finite).length,
    },
    glueArgNames: {
      pristineFlagged: { P21: eligibleKernels.filter(k => k.cohort === 'P21' && glueNameMismatch(k.source, JSON.parse(k.glue))).length, add: eligibleKernels.filter(k => k.cohort === 'add' && glueNameMismatch(k.source, JSON.parse(k.glue))).length },
    },
    selfMutation: {
      p21KernelsWithFiniteSurvivor: new Set(escapes.filter(r => r.cohort === 'P21' && r.witness?.finite).map(r => r.key)).size,
      p21KernelsWithAnySurvivor: new Set(escapes.filter(r => r.cohort === 'P21').map(r => r.key)).size,
      p21Kernels: eligibleKernels.filter(k => k.cohort === 'P21').length,
    },
  };
  const glueSource = new Map();
  for (const line of readFileSync(join(prep, 'mutants.jsonl'), 'utf8').split('\n')) {
    if (!line.includes('"surface":"glue"')) continue;
    const row = JSON.parse(line);
    if (row.op === 'glue_args_reordered') glueSource.set(row.mutant, row.glue);
  }
  const reorderedEscapes = glueEscapes.filter(r => r.op === 'glue_args_reordered');
  proposed.glueArgNames.reorderedEscapes = reorderedEscapes.length;
  proposed.glueArgNames.reorderedCaughtNet = reorderedEscapes.filter(r => glueNameMismatch(kernels[r.key].source, JSON.parse(glueSource.get(r.mutant))) && !glueNameMismatch(kernels[r.key].source, JSON.parse(kernels[r.key].glue))).length;
  const summary = {
    proposedChecks: proposed,
    control: { kernels: control.length, promoted: control.filter(r => r.promoted).length, notPromoted: control.filter(r => !r.promoted).map(r => ({ key: r.key, caught: r.caught })) },
    tiers: { oneIn1000: { zeroEscapes: requiredN(1e-3, 0), twoEscapes: requiredN(1e-3, 2) }, oneIn10000: { zeroEscapes: requiredN(1e-4, 0), twoEscapes: requiredN(1e-4, 2) } },
    sampled: { P21: breakdown(cohort(sampledRows, 'P21')), add: breakdown(cohort(sampledRows, 'add')), all: breakdown(sampledRows), caughtBy: tally(sampledRows.filter(r => !r.promoted), 'caught') },
    witnessScope: { finiteWitness: rate(cohort(sampledRows, 'P21').filter(r => r.witness?.finite)), nonFiniteOnly: rate(cohort(sampledRows, 'P21').filter(r => !r.witness?.finite)) },
    escapeReasons: { P21: tally(cohort(escapes, 'P21'), 'reason'), add: tally(cohort(escapes, 'add'), 'reason'), details: tally(escapes, 'detail'), perClass: Object.fromEntries(CLASSES.map(name => [name, tally(escapes.filter(r => r.class === name && r.cohort === 'P21'), 'reason')])) },
    glue: { P21: breakdown(cohort(glueRows, 'P21')), add: breakdown(cohort(glueRows, 'add')), caughtBy: tally(glueRows.filter(r => !r.promoted), 'caught'), reasons: tally(glueEscapes, 'reason') },
    binding: { byOp: Object.fromEntries([...new Set(bindingRows.map(r => r.op))].map(op => [op, { n: bindingRows.filter(r => r.op === op).length, promoted: bindingRows.filter(r => r.op === op && r.promoted).length, caughtBy: tally(bindingRows.filter(r => r.op === op && !r.promoted), 'caught') }])) },
    correlatedRetry: { retried: retried.size, transientRefusals: transient.length, transientPromotedOnRetry: transient.filter(r => retried.get(r.mutant)?.promoted).length, firstPassPromoted: firstPassCorrelated.filter(r => r.promoted).length },
    correlated: { P21: breakdown(cohort(correlatedRows, 'P21')), add: breakdown(cohort(correlatedRows, 'add')), caughtBy: tally(correlatedCaught, 'caught'), caughtOnlyBecauseIndependent: { P21: reliesOnIndependence.filter(r => r.cohort === 'P21').length, add: reliesOnIndependence.filter(r => r.cohort === 'add').length } },
    oracles: {
      pristineFalseAlarm: pristine,
      sampledEscapesP21: summariseOracles(cohort(escapes, 'P21')),
      sampledEscapesAdd: summariseOracles(cohort(escapes, 'add')),
      correlatedEscapesP21: summariseOracles(cohort(escapeOnly, 'P21')),
      correlatedEscapesAdd: summariseOracles(cohort(escapeOnly, 'add')),
    },
    naturalDisagreement: natural,
    escapeList: escapes.map(({ mutant, need, cohort: c, class: fault, op, reason, detail }) => ({ mutant, need, cohort: c, class: fault, op, reason, detail })),
    glueEscapeOps: tally(glueEscapes, 'op'),
    sampledEscapedCount: sampledEscaped.size,
  };
  return summary;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await analyze({ corpusRoot: process.env.P51_CORPUS, prep: resolve(process.env.P51_PREP), output: resolve(process.env.P51_OUTPUT) });
  writeFileSync(join(resolve(process.env.P51_OUTPUT), 'summary.json'), JSON.stringify(summary, null, 2));
  const { escapeList, ...brief } = summary;
  console.log(JSON.stringify(brief, (key, value) => key === 'perNeed' || key === 'perOp' ? undefined : typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(5)) : value, 1));
}
