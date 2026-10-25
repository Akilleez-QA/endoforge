#!/usr/bin/env node
// P-03 escape-rate-method runner. Idempotent; no network; writes receipt/*.
// Validates the METHOD on a toy task. It does not measure Endoforge's escape rate.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = p => path.join(here, 'receipt', p);
const sha = s => createHash('sha256').update(s).digest('hex');
const shaFile = p => sha(fs.readFileSync(p));
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

// ---------- 0. verify the freeze before importing anything mutable ----------
function verifyHashFile(file) {
  for (const line of fs.readFileSync(R(file), 'utf8').trim().split('\n')) {
    const [want, rel] = line.trim().split(/\s+/);
    const got = shaFile(path.join(here, rel));
    if (got !== want) throw new Error(`${rel} changed since freeze (${file}): ${got} != ${want}`);
  }
}
verifyHashFile('precommit.sha256');
verifyHashFile('evaluator.sha256');
verifyHashFile('reference-and-stats.sha256');

const E = await import('./src/evaluator.mjs');
const M = await import('./src/mutants.mjs');
const { makeInputs } = await import('./src/inputs.mjs');
const { clopperPearson, oneSidedUpper, median, quantile } = await import('./src/stats.mjs');
const { kernel: reference } = await import('./src/kernel.mjs');

// ---------- environment ----------
function env(label) {
  const cpu = fs.readFileSync('/proc/cpuinfo', 'utf8');
  const model = (cpu.match(/model name\s*:\s*(.+)/) || [])[1];
  const mem = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').split('\n').filter(l => /^(MemTotal|MemAvailable|SwapTotal|SwapFree):/.test(l)).map(l => l.split(/:\s+/).map(s => s.trim())));
  let git = null;
  try { git = execSync('git rev-parse HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const files = {};
  for (const f of ['PRECOMMIT.md', 'run.mjs', 'src/kernel.mjs', 'src/evaluator.mjs', 'src/inputs.mjs', 'src/mutants.mjs', 'src/stats.mjs']) files[f] = shaFile(path.join(here, f));
  return {
    label, timestamp: new Date().toISOString(), hostname: os.hostname(), kernel: os.release(), platform: os.platform(), arch: os.arch(),
    cpu_model: model, cpu_count: os.cpus().length, loadavg: os.loadavg(), memory: mem,
    node: process.version, v8: process.versions.v8, git_commit: git, git_dirty_note: 'experiments/ is untracked at the time of this probe',
    module_sha256: files,
  };
}

const runStart = performance.now();
const envBefore = env('before');
writeJson(R('env-before.json'), envBefore);

// ---------- 1. generate mutants ----------
const src = fs.readFileSync(path.join(here, 'src/kernel.mjs'), 'utf8');
let all = [...M.mechanicalMutants(src), ...M.domainSemanticMutants(src), ...M.modelPlausibleMutants(src)];
all.forEach((m, i) => { m.id = `${m.stratum}-${String(i + 1).padStart(3, '0')}`; });

// ---------- 2. equivalence filter by differential execution ----------
const DIFF_SEED = 0x5eed0002, DIFF_N = 2000;
const diffInputs = makeInputs(DIFF_SEED, DIFF_N);
const refOutputs = diffInputs.map(({ state, event }) => {
  const s = JSON.parse(JSON.stringify(state)), e = JSON.parse(JSON.stringify(event));
  const out = reference(s, e);
  return JSON.stringify({ out, s, e });   // output plus post-call input snapshot (catches aliasing)
});

function differential(fn) {
  // Returns null if equivalent over all inputs, else { index, kind }.
  for (let i = 0; i < diffInputs.length; i++) {
    const s = JSON.parse(JSON.stringify(diffInputs[i].state)), e = JSON.parse(JSON.stringify(diffInputs[i].event));
    const r = E.runGuarded(fn, s, e);
    if (!r.ok) return { index: i, kind: 'threw' };
    if (r.ms > E.WALL_CAP_MS) return { index: i, kind: 'slow' };
    let js;
    try { js = JSON.stringify({ out: r.out, s, e }); } catch { return { index: i, kind: 'unserialisable' }; }
    if (js !== refOutputs[i]) return { index: i, kind: 'differs' };
  }
  return null;
}

function compileAndFilter(m) {
  const mutated = M.applyEdits(src, m.edits);
  m.source_sha256 = sha(mutated);
  const c = M.compileKernel(mutated);
  if (!c.ok) { m.status = 'uncompilable'; m.compile_error = c.error; return; }
  const t0 = performance.now();
  const d = differential(c.fn);
  m.differential_ms = performance.now() - t0;
  if (d === null) { m.status = 'equivalent'; return; }
  m.status = 'non-equivalent';
  m.first_difference = d;
  m._fn = c.fn;
}
for (const m of all) compileAndFilter(m);

// ---------- 3. harness over every non-equivalent mutant ----------
function harness(m) {
  const r = E.evaluate(m._fn);
  m.harness = r;
}
for (const m of all) if (m.status === 'non-equivalent') harness(m);

// ---------- 4. searched stratum: compose top-scoring non-equivalent S1–S3 mutants ----------
const ranked = all.filter(m => m.status === 'non-equivalent').sort((a, b) => b.harness.score - a.harness.score);
const s4 = M.searchedMutants(ranked, 50);
s4.forEach((m, i) => { m.id = `S4-${String(i + 1).padStart(3, '0')}`; });
for (const m of s4) { compileAndFilter(m); if (m.status === 'non-equivalent') harness(m); }
all = [...all, ...s4];

// S4b — POST-HOC, NOT IN PRECOMMIT.md. Added after the first complete run showed that the
// precommitted S4 (compose the top-scoring non-equivalent mutants) degenerates when the top
// scorers are themselves escapees: every composition of two escapees escaped (56/56). S4b
// composes the top-scoring KILLED mutants instead, to ask whether composition ever turns two
// near-misses into an escape. Reported separately; excluded from the ALL totals.
const rankedKilled = ranked.filter(m => !m.harness.escape_full);
const s4b = M.searchedMutants(rankedKilled, 50);
s4b.forEach((m, i) => { m.id = `S4b-${String(i + 1).padStart(3, '0')}`; m.stratum = 'S4b'; m.post_hoc = true; });
for (const m of s4b) { compileAndFilter(m); if (m.status === 'non-equivalent') harness(m); }

// ---------- 5. statistics ----------
const STRATA = ['S1', 'S2', 'S3', 'S4'];
function rate(k, n) {
  const cp = clopperPearson(k, n);
  return { escapes: k, n, point: n ? k / n : null, cp95_lower: cp.lower, cp95_upper: cp.upper, one_sided_upper95: oneSidedUpper(k, n) };
}
const perStratum = {};
for (const st of [...STRATA, 'ALL', 'S4b_post_hoc']) {
  const ms = st === 'S4b_post_hoc' ? s4b : all.filter(m => st === 'ALL' || m.stratum === st);
  const ne = ms.filter(m => m.status === 'non-equivalent');
  perStratum[st] = {
    generated: ms.length,
    uncompilable: ms.filter(m => m.status === 'uncompilable').length,
    equivalent: ms.filter(m => m.status === 'equivalent').length,
    non_equivalent: ne.length,
    full_harness: rate(ne.filter(m => m.harness.escape_full).length, ne.length),
    universal_plus_invariants_only: rate(ne.filter(m => m.harness.escape_invariants_only).length, ne.length),
    universal_plus_residual_only: rate(ne.filter(m => m.harness.escape_residual_only).length, ne.length),
    universal_only: rate(ne.filter(m => m.harness.escape_universal_only).length, ne.length),
    escapees_failing_holdout: ne.filter(m => m.harness.escape_full && !m.harness.holdout.pass).length,
    killed_by: {
      universal: ne.filter(m => !m.harness.universal.pass).length,
      invariants_only: ne.filter(m => m.harness.universal.pass && !m.harness.invariants.pass).length,
      residual_only_after_others_pass: ne.filter(m => m.harness.universal.pass && m.harness.invariants.pass && !m.harness.residual.pass).length,
    },
  };
}
const nonEq = all.filter(m => m.status === 'non-equivalent');
const escapees = nonEq.filter(m => m.harness.escape_full);

// Which universal gate / invariant killed what (first failure only).
const killHistogram = {};
for (const m of nonEq) {
  const k = !m.harness.universal.pass ? `universal:${m.harness.universal.failure.gate}`
    : !m.harness.invariants.pass ? `invariant:${m.harness.invariants.failure.invariant}`
    : !m.harness.residual.pass ? `residual:${m.harness.residual.failed[0].name.split(' ')[0]}` : 'escape';
  killHistogram[k] = (killHistogram[k] || 0) + 1;
}

// ---------- 6. disagreement inputs (R19 §2.1) ----------
const DIS_SEED = 0x5eed0003, DIS_CAP = 20000;
const candidates = escapees.length ? escapees : ranked.slice(0, 10);
const population = [{ id: 'REFERENCE', _fn: reference, description: 'reference kernel' }, ...candidates];
const pairs = [];
function summariseDisagreement(outA, outB) {
  const ja = JSON.stringify(outA), jb = JSON.stringify(outB);
  if (ja === jb) return null;
  const rowsA = outA.effects.find(e => e.type === 'emit')?.rows || [], rowsB = outB.effects.find(e => e.type === 'emit')?.rows || [];
  for (let i = 0; i < Math.max(rowsA.length, rowsB.length); i++) {
    const a = rowsA[i], b = rowsB[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (!a || !b) return { where: `row ${i}`, A: a ? 'a row' : 'no row', B: b ? 'a row' : 'no row' };
    for (const k of ['classification', 'delta', 'sources']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return { where: `row ${i} (${a.point}, ${a.reading_id}) .${k}`, A: a[k], B: b[k] };
    for (const k of ['converted', 'expected']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return { where: `row ${i} (${a.point}) .${k}`, A: a[k] && { value: a[k].value, sources: a[k].sources }, B: b[k] && { value: b[k].value, sources: b[k].sources } };
    return { where: `row ${i}`, A: a, B: b };
  }
  const tA = outA.effects.find(e => e.type === 'summary')?.totals, tB = outB.effects.find(e => e.type === 'summary')?.totals;
  if (JSON.stringify(tA) !== JSON.stringify(tB)) return { where: 'summary.totals', A: tA, B: tB };
  if (JSON.stringify(outA.state) !== JSON.stringify(outB.state)) return { where: 'state', A: outA.state, B: outB.state };
  return { where: 'effects (order or extra)', A: outA.effects.map(e => e.type), B: outB.effects.map(e => e.type) };
}
for (let i = 0; i < population.length; i++) {
  for (let j = i + 1; j < population.length; j++) {
    const A = population[i], B = population[j];
    const rnd = (await import('./src/inputs.mjs')).mulberry32(DIS_SEED);
    const { randomEvent, randomState } = await import('./src/inputs.mjs');
    let found = null, draws = 0;
    const t0 = performance.now();
    while (draws < DIS_CAP) {
      draws++;
      const state = randomState(rnd), event = randomEvent(rnd);
      const ra = E.runGuarded(A._fn, JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(event)));
      const rb = E.runGuarded(B._fn, JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(event)));
      if (!ra.ok || !rb.ok) { found = { input: { state, event }, summary: { where: 'exception', A: ra.ok ? 'ok' : ra.error, B: rb.ok ? 'ok' : rb.error }, outA: ra.out, outB: rb.out }; break; }
      const s = summariseDisagreement(ra.out, rb.out);
      if (s) { found = { input: { state, event }, summary: s, outA: ra.out, outB: rb.out }; break; }
    }
    pairs.push({ A: A.id, B: B.id, A_description: A.description, B_description: B.description, draws, found: found !== null, ms: performance.now() - t0, summary: found && found.summary, _found: found });
  }
}
const foundPairs = pairs.filter(p => p.found);
const refPairs = foundPairs.filter(p => p.A === 'REFERENCE');
const example = refPairs[0] || foundPairs[0] || null;

// Freeze the first reference-vs-candidate disagreement as a new test (the person answers in the
// reference's favour here; the reference is this probe's oracle). Re-run the escapees.
let frozen = null, rerun = null;
if (example) {
  const input = example._found.input;
  const expected = reference(JSON.parse(JSON.stringify(input.state)), JSON.parse(JSON.stringify(input.event)));
  frozen = { name: 'D1 person-authored disagreement input (answered for the reference)', input, expected_effects: expected.effects, expected_state: expected.state };
  writeJson(R('frozen-disagreement-test.json'), { origin_pair: { A: example.A, B: example.B }, draws: example.draws, choice: example.summary, test: frozen });
  const frozenTest = {
    name: frozen.name,
    run(fn) {
      const out = fn(JSON.parse(JSON.stringify(input.state)), JSON.parse(JSON.stringify(input.event)));
      if (JSON.stringify(out.effects) !== JSON.stringify(expected.effects) || JSON.stringify(out.state) !== JSON.stringify(expected.state)) throw new Error('disagrees with the person-authored answer');
    },
  };
  const newEvalHash = sha(fs.readFileSync(path.join(here, 'src/evaluator.mjs')) + fs.readFileSync(path.join(here, 'src/inputs.mjs')) + fs.readFileSync(R('frozen-disagreement-test.json')));
  fs.writeFileSync(R('evaluator-plus-frozen-test.sha256'), `${newEvalHash}  src/evaluator.mjs+src/inputs.mjs+receipt/frozen-disagreement-test.json\n`);
  const subjects = escapees.length ? escapees : candidates;
  const results = subjects.map(m => { const r = E.evaluate(m._fn, [frozenTest]); return { id: m.id, description: m.description, escaped_before: m.harness.escape_full, escapes_after: r.escape_full }; });
  rerun = {
    subjects: subjects.length,
    previously_escaping: results.filter(r => r.escaped_before).length,
    now_killed_among_previously_escaping: results.filter(r => r.escaped_before && !r.escapes_after).length,
    still_escaping: results.filter(r => r.escaped_before && r.escapes_after).map(r => r.id),
    killed_among_subjects: results.filter(r => !r.escapes_after).length,
    results,
    evaluator_plus_frozen_test_sha256: newEvalHash,
  };
}

// ---------- 7. cost ----------
const harnessMs = nonEq.map(m => m.harness.ms);
const diffMs = all.filter(m => m.differential_ms !== undefined).map(m => m.differential_ms);
const totalMs = performance.now() - runStart;
const stat = xs => ({ n: xs.length, median: median(xs), p95: quantile(xs, 0.95), min: Math.min(...xs), max: Math.max(...xs), sum: xs.reduce((a, b) => a + b, 0) });

// ---------- 8. receipts ----------
const envAfter = env('after');
writeJson(R('env-after.json'), envAfter);
fs.writeFileSync(R('mutants.jsonl'), [...all, ...s4b].map(m => JSON.stringify({ post_hoc: m.post_hoc,
  id: m.id, stratum: m.stratum, description: m.description, note: m.note, parents: m.parents, edits: m.edits, source_sha256: m.source_sha256,
  status: m.status, compile_error: m.compile_error, first_difference: m.first_difference, differential_ms: m.differential_ms,
})).join('\n') + '\n');
fs.writeFileSync(R('harness.jsonl'), [...nonEq, ...s4b.filter(m => m.status === 'non-equivalent')].map(m => JSON.stringify({ post_hoc: m.post_hoc, id: m.id, stratum: m.stratum, description: m.description, ...m.harness })).join('\n') + '\n');
writeJson(R('disagreement.json'), {
  seed: DIS_SEED, cap: DIS_CAP, population: population.map(p => ({ id: p.id, description: p.description })),
  pairs: pairs.map(({ _found, ...p }) => p),
  draws_median: median(pairs.map(p => p.draws)), draws_p95: quantile(pairs.map(p => p.draws), 0.95), draws_min: Math.min(...pairs.map(p => p.draws)), draws_max: Math.max(...pairs.map(p => p.draws)),
  pairs_found: foundPairs.length, pairs_total: pairs.length,
  example: example && { A: example.A, B: example.B, draws: example.draws, choice: example.summary, input: example._found.input },
  rerun,
});
const summary = {
  probe: 'P-03-escape-rate-method', label: 'Recorded (probe)', scope: 'METHOD validation on a toy task; not Endoforge\'s escape rate',
  precommit_sha256: fs.readFileSync(R('precommit.sha256'), 'utf8').trim(), evaluator_sha256: fs.readFileSync(R('evaluator.sha256'), 'utf8').trim().split('\n'),
  freeze_timestamp: fs.readFileSync(R('freeze-timestamp.txt'), 'utf8').trim(), run_timestamp: envBefore.timestamp,
  reference_passes_evaluator: E.evaluate(reference).escape_full,
  differential: { seed: DIFF_SEED, inputs: DIFF_N, invariant_inputs: E.INVARIANT_INPUT_COUNT, invariant_seed: E.INVARIANT_INPUT_SEED },
  per_stratum: perStratum,
  kill_histogram: killHistogram,
  s4b_post_hoc_escapees: s4b.filter(m => m.status === 'non-equivalent' && m.harness.escape_full).map(m => ({ id: m.id, parents: m.parents, description: m.description, holdout_pass: m.harness.holdout.pass })),
  escapees: escapees.map(m => ({ id: m.id, stratum: m.stratum, description: m.description, note: m.note, holdout_pass: m.harness.holdout.pass, holdout_failed: m.harness.holdout.failed })),
  disagreement: { pairs_total: pairs.length, pairs_found: foundPairs.length, draws_median: median(pairs.map(p => p.draws)), draws_max: Math.max(...pairs.map(p => p.draws)), example: example && { A: example.A, B: example.B, draws: example.draws, choice: example.summary }, rerun: rerun && { previously_escaping: rerun.previously_escaping, now_killed: rerun.now_killed_among_previously_escaping, still_escaping: rerun.still_escaping, killed_among_subjects: rerun.killed_among_subjects, subjects: rerun.subjects } },
  cost_ms: { harness_per_mutant: stat(harnessMs), differential_per_mutant: stat(diffMs), total_run: totalMs },
  environment: { before: { loadavg: envBefore.loadavg, mem_available: envBefore.memory.MemAvailable }, after: { loadavg: envAfter.loadavg, mem_available: envAfter.memory.MemAvailable }, cpu: envBefore.cpu_model, cpus: envBefore.cpu_count, node: envBefore.node, kernel: envBefore.kernel },
};
writeJson(R('summary.json'), summary);
// SHA256SUMS over receipt files
const files = fs.readdirSync(R('')).filter(f => f !== 'SHA256SUMS').sort();
fs.writeFileSync(R('SHA256SUMS'), files.map(f => `${shaFile(R(f))}  ${f}`).join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
