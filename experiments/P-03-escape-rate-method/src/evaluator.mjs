// Frozen evaluator for probe P-03. Three layers in the shape Edition 3 §6 describes:
//   1. universal gates   (schema, determinism, forbidden effects, resource bound, purity)
//   2. domain invariants (dimensional consistency, source-bound return, totals reconcile, idempotence)
//   3. task residual     (six example-based tests derived from the plain-language statement)
// plus a HOLDOUT of six more examples that no layer uses; it is reported, never gates.
//
// This file and src/inputs.mjs are hashed into receipt/evaluator.sha256 before any mutant
// is generated. The evaluator does not import the kernel; it receives a candidate function.

import { makeInputs } from './inputs.mjs';

export const EVALUATOR_VERSION = 'p03-evaluator-2'; // rev 1: invariants precondition guard + exception-safe checks; see receipt/evaluator-revision-1.md
export const INVARIANT_INPUT_SEED = 0x5eed0001;
export const INVARIANT_INPUT_COUNT = 60;
export const WALL_CAP_MS = 50;
export const ALLOWED_EFFECT_TYPES = ['emit', 'summary'];
const CLASSES = ['match', 'minor', 'major', 'no-reference', 'unresolved-basis', 'unconvertible'];

// Independent conversion table (written separately from the kernel's; psi via its reciprocal).
const KPA_PER = { psi: 1 / 0.14503773773, psig: 1 / 0.14503773773, kPa: 1, bar: 100 };
const REL_TOL = 1e-9;

function approxEqual(a, b) {
  return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export const invariantInputs = makeInputs(INVARIANT_INPUT_SEED, INVARIANT_INPUT_COUNT);

// Run a candidate once under the resource bound; never throws.
export function runGuarded(fn, state, event) {
  const t0 = performance.now();
  try {
    const out = fn(state, event);
    const ms = performance.now() - t0;
    return { ok: true, out, ms };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), ms: performance.now() - t0 };
  }
}

// ---------- Layer 1: universal gates ----------
function checkSchema(out) {
  if (!out || typeof out !== 'object') return 'result not an object';
  if (!('state' in out) || !('effects' in out)) return 'result lacks state/effects';
  if (!Array.isArray(out.effects)) return 'effects not an array';
  if (!out.state || typeof out.state !== 'object' || typeof out.state.seen !== 'object' || out.state.seen === null) return 'state.seen missing';
  for (const e of out.effects) {
    if (!e || typeof e.type !== 'string') return 'effect lacks type';
    if (e.type === 'emit') {
      if (!Array.isArray(e.rows)) return 'emit.rows not an array';
      for (const r of e.rows) {
        if (typeof r.point !== 'string') return 'row.point not a string';
        if (typeof r.reading_id !== 'string') return 'row.reading_id not a string';
        if (!Array.isArray(r.sources) || r.sources.length === 0) return 'row.sources empty';
        if (!CLASSES.includes(r.classification)) return `row.classification invalid: ${r.classification}`;
        for (const k of ['converted', 'expected']) {
          const q = r[k];
          if (q === null) continue;
          if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value)) return `${k}.value not finite`;
          if (typeof q.unit !== 'string' || typeof q.basis !== 'string') return `${k} lacks unit/basis`;
          if (!Array.isArray(q.sources) || q.sources.length === 0) return `${k}.sources empty`;
        }
        if (r.delta !== null && !(typeof r.delta === 'number' && Number.isFinite(r.delta))) return 'delta not finite';
      }
    } else if (e.type === 'summary') {
      if (!e.totals || typeof e.totals !== 'object') return 'summary.totals missing';
      for (const c of [...CLASSES, 'rows', 'unmatched_reference']) {
        if (!Number.isInteger(e.totals[c]) || e.totals[c] < 0) return `totals.${c} not a non-negative integer`;
      }
    }
  }
  try { JSON.stringify(out); } catch { return 'result not JSON-serialisable'; }
  return null;
}

export function universalGates(fn, inputs = invariantInputs) {
  const checks = { schema: 0, determinism: 0, forbidden_effects: 0, resource_bound: 0, purity: 0 };
  let failure = null;
  for (let i = 0; i < inputs.length; i++) {
    const { state, event } = inputs[i];
    const s1 = clone(state), e1 = clone(event);
    const r1 = runGuarded(fn, s1, e1);
    if (!r1.ok) { failure ||= { gate: 'resource_bound', input: i, detail: `threw: ${r1.error}` }; continue; }
    if (r1.ms > WALL_CAP_MS) { failure ||= { gate: 'resource_bound', input: i, detail: `${r1.ms.toFixed(1)} ms > ${WALL_CAP_MS}` }; } else checks.resource_bound++;
    if (!same(s1, state) || !same(e1, event)) { failure ||= { gate: 'purity', input: i, detail: 'input mutated' }; } else checks.purity++;
    const schemaErr = checkSchema(r1.out);
    if (schemaErr) { failure ||= { gate: 'schema', input: i, detail: schemaErr }; } else checks.schema++;
    const r2 = runGuarded(fn, clone(state), clone(event));
    if (!r2.ok || !same(r1.out, r2.out)) { failure ||= { gate: 'determinism', input: i, detail: 'two runs differ' }; } else checks.determinism++;
    const types = (r1.out && Array.isArray(r1.out.effects)) ? r1.out.effects.map(e => e && e.type) : [];
    const bad = types.find(t => !ALLOWED_EFFECT_TYPES.includes(t));
    const emits = types.filter(t => t === 'emit').length, sums = types.filter(t => t === 'summary').length;
    const isReconcile = event && event.type === 'reconcile';
    if (bad !== undefined || (isReconcile && (emits !== 1 || sums !== 1)) || (!isReconcile && types.length !== 0)) {
      failure ||= { gate: 'forbidden_effects', input: i, detail: `effect types ${JSON.stringify(types)}` };
    } else checks.forbidden_effects++;
  }
  const passedChecks = Object.values(checks).reduce((a, b) => a + b, 0);
  return { pass: failure === null, failure, passedChecks, totalChecks: inputs.length * 5 };
}

// ---------- Layer 2: domain invariants ----------
function refBasis(q) {
  if (q.unit === 'psig') return 'gauge';
  if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;
  return null;
}
function refConvert(q, target, atmosphere) {
  const b = refBasis(q);
  if (b === null) return null;
  if (!(q.unit in KPA_PER)) return null;
  let kpa = q.value * KPA_PER[q.unit];
  const sources = [q.source];
  if (b !== target.basis) {
    if (!atmosphere) return null;
    kpa += b === 'gauge' ? atmosphere.value_kpa : -atmosphere.value_kpa;
    sources.push(atmosphere.source);
  }
  return { value: kpa / KPA_PER[target.unit], sources };
}

export function domainInvariants(fn, inputs = invariantInputs) {
  const checks = { dimensional: 0, source_bound: 0, totals: 0, idempotence: 0 };
  let failure = null;
  for (let i = 0; i < inputs.length; i++) {
   try {
    const { state, event } = inputs[i];
    const r1 = runGuarded(fn, clone(state), clone(event));
    if (!r1.ok || checkSchema(r1.out)) { failure ||= { invariant: 'precondition', input: i, detail: 'did not produce a schema-valid result' }; continue; }
    const out = r1.out;
    if (event.type !== 'reconcile') { checks.dimensional++; checks.source_bound++; checks.totals++; checks.idempotence++; continue; }
    const emitEffect = out.effects.find(e => e.type === 'emit');
    const summaryEffect = out.effects.find(e => e.type === 'summary');
    if (!emitEffect || !summaryEffect) { failure ||= { invariant: 'precondition', input: i, detail: 'reconcile event produced no emit/summary effect' }; continue; }
    const rows = emitEffect.rows;
    const totals = summaryEffect.totals;
    const sourceIds = new Set([...event.readings.map(r => r.source), ...event.reference.map(r => r.source)]);
    if (event.atmosphere) sourceIds.add(event.atmosphere.source);
    const readingById = new Map(event.readings.map(r => [r.id, r]));
    const refByPoint = new Map(event.reference.map(r => [r.point, r]));

    // Dimensional consistency: every converted/expected value equals the independent conversion.
    let dimErr = null;
    for (const row of rows) {
      const reading = readingById.get(row.reading_id);
      if (!reading) { dimErr = `row cites unknown reading ${row.reading_id}`; break; }
      if (row.converted) {
        const want = refConvert(reading, event.target, event.atmosphere);
        if (!want) { dimErr = `converted value present for unconvertible reading ${row.reading_id}`; break; }
        if (!approxEqual(row.converted.value, want.value)) { dimErr = `converted ${row.converted.value} != ${want.value} (${row.reading_id})`; break; }
        if (row.converted.unit !== event.target.unit || row.converted.basis !== event.target.basis) { dimErr = 'converted not in target unit/basis'; break; }
      }
      if (row.expected) {
        const ref = refByPoint.get(row.point);
        if (!ref) { dimErr = `expected value for point without reference ${row.point}`; break; }
        const want = refConvert(ref, event.target, event.atmosphere);
        if (!want || !approxEqual(row.expected.value, want.value)) { dimErr = `expected mismatch at ${row.point}`; break; }
        if (row.converted && !approxEqual(row.delta, row.converted.value - row.expected.value)) { dimErr = `delta mismatch at ${row.point}`; break; }
      }
    }
    if (dimErr) failure ||= { invariant: 'dimensional', input: i, detail: dimErr }; else checks.dimensional++;

    // Source-bound return: every cited source exists; converted cites the reading's source
    // (and the atmosphere's when a basis shift happened); expected cites the reference row's.
    let srcErr = null;
    for (const row of rows) {
      const reading = readingById.get(row.reading_id);
      for (const s of row.sources) if (!sourceIds.has(s)) { srcErr = `unknown source ${s}`; break; }
      if (srcErr) break;
      if (reading && !row.sources.includes(reading.source)) { srcErr = `row does not cite reading source ${reading.source}`; break; }
      if (row.converted) {
        const want = refConvert(reading, event.target, event.atmosphere);
        if (want && !same([...row.converted.sources].sort(), [...want.sources].sort())) { srcErr = `converted.sources ${JSON.stringify(row.converted.sources)} != ${JSON.stringify(want.sources)}`; break; }
        for (const s of row.converted.sources) if (!row.sources.includes(s)) { srcErr = 'row.sources omits a converted source'; break; }
      }
      if (row.expected) {
        const ref = refByPoint.get(row.point);
        const want = ref && refConvert(ref, event.target, event.atmosphere);
        if (want && !same([...row.expected.sources].sort(), [...want.sources].sort())) { srcErr = `expected.sources mismatch at ${row.point}`; break; }
        for (const s of row.expected.sources) if (!row.sources.includes(s)) { srcErr = 'row.sources omits an expected source'; break; }
      }
    }
    if (srcErr) failure ||= { invariant: 'source_bound', input: i, detail: srcErr }; else checks.source_bound++;

    // Totals reconcile: one row per reading, class counts match rows, unmatched references counted.
    let totErr = null;
    if (rows.length !== event.readings.length) totErr = `rows ${rows.length} != readings ${event.readings.length}`;
    else if (totals.rows !== rows.length) totErr = `totals.rows ${totals.rows} != ${rows.length}`;
    else {
      const counts = Object.fromEntries(CLASSES.map(c => [c, 0]));
      for (const r of rows) counts[r.classification]++;
      for (const c of CLASSES) if (counts[c] !== totals[c]) { totErr = `totals.${c} ${totals[c]} != ${counts[c]}`; break; }
      if (!totErr) {
        const sum = CLASSES.reduce((a, c) => a + totals[c], 0);
        if (sum !== totals.rows) totErr = 'class totals do not sum to rows';
      }
      if (!totErr) {
        const readPoints = new Set(event.readings.map(r => r.point));
        const unmatched = event.reference.filter(r => !readPoints.has(r.point)).length;
        if (totals.unmatched_reference !== unmatched) totErr = `unmatched_reference ${totals.unmatched_reference} != ${unmatched}`;
      }
      if (!totErr) {
        const ids = rows.map(r => r.reading_id), want = event.readings.map(r => r.id);
        if (!same(ids, want)) totErr = 'rows are not one-per-reading in input order';
      }
    }
    if (totErr) failure ||= { invariant: 'totals', input: i, detail: totErr }; else checks.totals++;

    // Idempotence: applying the same event to the returned state reproduces state and effects.
    const r2 = runGuarded(fn, clone(out.state), clone(event));
    if (!r2.ok || !same(r2.out.state, out.state) || !same(r2.out.effects, out.effects)) {
      failure ||= { invariant: 'idempotence', input: i, detail: 'second application differs' };
    } else checks.idempotence++;
   } catch (e) {
    // A checker exception on a candidate's output is a failure of the layer, never a crash.
    failure ||= { invariant: 'checker_exception', input: i, detail: String(e && e.message || e) };
   }
  }
  const passedChecks = Object.values(checks).reduce((a, b) => a + b, 0);
  return { pass: failure === null, failure, passedChecks, totalChecks: inputs.length * 4 };
}

// ---------- Layer 3: task residual ----------
// Plain-language statement the examples were derived from (this is what the person would confirm):
//   "For each reading, find the reference entry for the same point. Convert both to the target
//    unit and basis; psig is always gauge; a reading with no usable basis is reported as
//    unresolved, not dropped. Shifting between gauge and absolute needs the atmosphere value;
//    without it the row is unconvertible. A difference up to and including the minor tolerance
//    is a match, up to and including the major tolerance is minor, beyond it is major. Readings
//    with no reference are reported as such. Every row says which sources it came from. The
//    summary counts every row once and counts reference entries no reading matched."

export const RESIDUAL_STATEMENT = `For each reading, find the reference entry for the same point. Convert both to the target unit and basis; psig is always gauge; a reading with no usable basis is reported as unresolved, not dropped. Shifting between gauge and absolute needs the atmosphere value; without it the row is unconvertible. A difference up to and including the minor tolerance is a match, up to and including the major tolerance is minor, beyond it is major. Readings with no reference are reported as such. Every row says which sources it came from. The summary counts every row once and counts reference entries no reading matched.`;

const ATM = { value_kpa: 101.325, source: 'src:baro-1' };
const KPA_ABS = { unit: 'kPa', basis: 'absolute' };
const PSI_G = { unit: 'psi', basis: 'gauge' };

function ev(readings, reference, extra = {}) {
  return { type: 'reconcile', readings, reference, atmosphere: ATM, target: KPA_ABS, tolerance: { minor: 0.5, major: 5 }, ...extra };
}
function rowsOf(out) { return out.effects.find(e => e.type === 'emit').rows; }
function totalsOf(out) { return out.effects.find(e => e.type === 'summary').totals; }
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// Each test: run the candidate, assert; throws a message on failure.
export const residualTests = [
  {
    name: 'R1 psig reading matches kPa-absolute reference within minor tolerance',
    run(fn) {
      // 30 psig = 206.8427 kPa gauge = 308.1677 kPa absolute; reference 308.2 -> |delta| 0.032 <= 0.5
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: 30, unit: 'psig', basis: 'absolute' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 308.2, unit: 'kPa', basis: 'absolute' }]));
      const [r] = rowsOf(out);
      expect(r.classification === 'match', `classification ${r.classification}`);
      expect(Math.abs(r.converted.value - 308.16771879504) < 1e-6, `converted ${r.converted.value}`);
      expect(r.converted.sources.includes('src:sensor-1') && r.converted.sources.includes('src:baro-1'), 'converted sources');
      expect(r.sources.includes('ref:table-1#0'), 'row cites reference source');
    },
  },
  {
    name: 'R2 difference exactly at the minor tolerance is a match; one above is minor',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: 100.5, unit: 'kPa', basis: 'absolute' },
         { id: 'b', point: 'pt-01', source: 'src:sensor-2', value: 100.6, unit: 'kPa', basis: 'absolute' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 100, unit: 'kPa', basis: 'absolute' }]));
      const [a, b] = rowsOf(out);
      expect(a.classification === 'match', `at-boundary ${a.classification}`);
      expect(b.classification === 'minor', `above-boundary ${b.classification}`);
    },
  },
  {
    name: 'R3 difference exactly at the major tolerance is minor; beyond it is major (negative delta)',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-02', source: 'src:sensor-1', value: 195, unit: 'kPa', basis: 'absolute' },
         { id: 'b', point: 'pt-02', source: 'src:sensor-1', value: 150, unit: 'kPa', basis: 'absolute' }],
        [{ point: 'pt-02', source: 'ref:table-1#0', value: 200, unit: 'kPa', basis: 'absolute' }]));
      const [a, b] = rowsOf(out);
      expect(a.classification === 'minor', `at-major ${a.classification}`);
      expect(b.classification === 'major', `beyond-major ${b.classification}`);
      expect(Math.abs(a.delta - -5) < 1e-9, `delta ${a.delta}`);
    },
  },
  {
    name: 'R4 missing basis is unresolved, not dropped; no reference is reported; totals reconcile',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-03', source: 'src:sensor-1', value: 2, unit: 'bar' },
         { id: 'b', point: 'pt-09', source: 'src:sensor-2', value: 2, unit: 'bar', basis: 'absolute' },
         { id: 'c', point: 'pt-03', source: 'src:sensor-3', value: 2, unit: 'bar', basis: 'absolute' }],
        [{ point: 'pt-03', source: 'ref:table-1#0', value: 200, unit: 'kPa', basis: 'absolute' },
         { point: 'pt-04', source: 'ref:table-1#1', value: 1, unit: 'bar', basis: 'absolute' }]));
      const rows = rowsOf(out), t = totalsOf(out);
      expect(rows.length === 3, `rows ${rows.length}`);
      expect(rows[0].classification === 'unresolved-basis', `a ${rows[0].classification}`);
      expect(rows[1].classification === 'no-reference', `b ${rows[1].classification}`);
      expect(rows[2].classification === 'match', `c ${rows[2].classification}`);
      expect(t.rows === 3 && t['unresolved-basis'] === 1 && t['no-reference'] === 1 && t.match === 1, 'totals');
      expect(t.unmatched_reference === 1, `unmatched_reference ${t.unmatched_reference}`);
    },
  },
  {
    name: 'R5 gauge/absolute shift without atmosphere is unconvertible; with it, the atmosphere source is cited',
    run(fn) {
      const readings = [{ id: 'a', point: 'pt-05', source: 'src:sensor-1', value: 14.7, unit: 'psi', basis: 'gauge' }];
      const reference = [{ point: 'pt-05', source: 'ref:table-2#0', value: 29.4, unit: 'psi', basis: 'absolute' }];
      const noAtm = fn({ seen: {} }, ev(readings, reference, { atmosphere: null, target: { unit: 'psi', basis: 'absolute' }, tolerance: { minor: 0.1, major: 1 } }));
      expect(rowsOf(noAtm)[0].classification === 'unconvertible', `no-atm ${rowsOf(noAtm)[0].classification}`);
      const withAtm = fn({ seen: {} }, ev(readings, reference, { target: { unit: 'psi', basis: 'absolute' }, tolerance: { minor: 0.1, major: 1 } }));
      const r = rowsOf(withAtm)[0];
      // 14.7 psig + 101.325 kPa (= 14.6959 psi) = 29.3959 psia; reference 29.4 -> match
      expect(r.classification === 'match', `with-atm ${r.classification}`);
      expect(r.converted.sources.includes('src:baro-1'), 'atmosphere cited');
      expect(!r.expected.sources.includes('src:baro-1'), 'reference already absolute; atmosphere not cited for it');
    },
  },
  {
    name: 'R6 reference in gauge, target in gauge psi: direct conversion, no atmosphere cited; state records classification',
    run(fn) {
      const out = fn({ seen: { 'pt-06': 'major' } }, ev(
        [{ id: 'a', point: 'pt-06', source: 'src:sensor-4', value: 0.5, unit: 'bar', basis: 'gauge' }],
        [{ point: 'pt-06', source: 'ref:table-1#0', value: 7.25, unit: 'psig', basis: 'absolute' }],
        { target: PSI_G, tolerance: { minor: 0.01, major: 0.5 } }));
      const [r] = rowsOf(out);
      // 0.5 bar = 50 kPa = 7.2519 psi; reference 7.25 psig (psig overrides stated basis) -> delta 0.0019 -> match
      expect(r.classification === 'match', `classification ${r.classification}`);
      expect(r.converted.sources.length === 1 && r.expected.sources.length === 1, 'no atmosphere source');
      expect(out.state.seen['pt-06'] === 'match', `state ${JSON.stringify(out.state.seen)}`);
    },
  },
];

// Holdout: extra examples NOT used by any layer. Reported only.
export const holdoutTests = [
  {
    name: 'H1 negative gauge reading converts through atmosphere',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: -5, unit: 'psig', basis: 'gauge' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 66.85, unit: 'kPa', basis: 'absolute' }]));
      const [r] = rowsOf(out);
      expect(Math.abs(r.converted.value - 66.85121353416) < 1e-6, `converted ${r.converted.value}`);
      expect(r.classification === 'match', r.classification);
    },
  },
  {
    name: 'H2 zero minor tolerance: exact equality is a match, any difference is at least minor',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: 100, unit: 'kPa', basis: 'absolute' },
         { id: 'b', point: 'pt-01', source: 'src:sensor-1', value: 100.001, unit: 'kPa', basis: 'absolute' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 100, unit: 'kPa', basis: 'absolute' }],
        { tolerance: { minor: 0, major: 1 } }));
      const [a, b] = rowsOf(out);
      expect(a.classification === 'match' && b.classification === 'minor', `${a.classification}/${b.classification}`);
    },
  },
  {
    name: 'H3 unrecognised unit string is unconvertible',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: 1, unit: 'PSI', basis: 'absolute' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 100, unit: 'kPa', basis: 'absolute' }]));
      expect(rowsOf(out)[0].classification === 'unconvertible', rowsOf(out)[0].classification);
    },
  },
  {
    name: 'H4 reference with unusable basis makes the row unconvertible even though the reading converts',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-01', source: 'src:sensor-1', value: 100, unit: 'kPa', basis: 'absolute' }],
        [{ point: 'pt-01', source: 'ref:table-1#0', value: 100, unit: 'kPa', basis: 'Gauge' }]));
      const [r] = rowsOf(out);
      expect(r.classification === 'unconvertible', r.classification);
      expect(r.converted !== null, 'reading side still converted');
    },
  },
  {
    name: 'H5 non-reconcile event yields no effects and leaves state untouched',
    run(fn) {
      const out = fn({ seen: { 'pt-01': 'major' } }, { type: 'noop' });
      expect(out.effects.length === 0, 'effects present');
      expect(out.state.seen['pt-01'] === 'major', 'state changed');
    },
  },
  {
    name: 'H6 two readings on one point both match the single reference; unmatched_reference zero',
    run(fn) {
      const out = fn({ seen: {} }, ev(
        [{ id: 'a', point: 'pt-02', source: 'src:sensor-1', value: 1.0, unit: 'bar', basis: 'absolute' },
         { id: 'b', point: 'pt-02', source: 'src:sensor-2', value: 100.2, unit: 'kPa', basis: 'absolute' }],
        [{ point: 'pt-02', source: 'ref:table-1#0', value: 14.5038, unit: 'psi', basis: 'absolute' }]));
      const t = totalsOf(out);
      expect(t.match === 2 && t.rows === 2 && t.unmatched_reference === 0, JSON.stringify(t));
    },
  },
];

export function runTests(fn, tests) {
  const results = [];
  for (const t of tests) {
    const t0 = performance.now();
    try {
      t.run((s, e) => {
        const r = runGuarded(fn, s, e);
        if (!r.ok) throw new Error(`threw: ${r.error}`);
        return r.out;
      });
      results.push({ name: t.name, pass: true, ms: performance.now() - t0 });
    } catch (e) {
      results.push({ name: t.name, pass: false, detail: String(e && e.message || e), ms: performance.now() - t0 });
    }
  }
  return { pass: results.every(r => r.pass), results, passedChecks: results.filter(r => r.pass).length, totalChecks: tests.length };
}

// Full harness. Returns per-layer outcomes; escape = all three layers pass.
export function evaluate(fn, extraFrozenTests = []) {
  const t0 = performance.now();
  const universal = universalGates(fn);
  const invariants = domainInvariants(fn);
  const residual = runTests(fn, [...residualTests, ...extraFrozenTests]);
  const holdout = runTests(fn, holdoutTests);
  const ms = performance.now() - t0;
  return {
    universal: { pass: universal.pass, failure: universal.failure, passedChecks: universal.passedChecks, totalChecks: universal.totalChecks },
    invariants: { pass: invariants.pass, failure: invariants.failure, passedChecks: invariants.passedChecks, totalChecks: invariants.totalChecks },
    residual: { pass: residual.pass, failed: residual.results.filter(r => !r.pass).map(r => ({ name: r.name, detail: r.detail })), passedChecks: residual.passedChecks, totalChecks: residual.totalChecks },
    holdout: { pass: holdout.pass, failed: holdout.results.filter(r => !r.pass).map(r => r.name), passedChecks: holdout.passedChecks, totalChecks: holdout.totalChecks },
    escape_full: universal.pass && invariants.pass && residual.pass,
    escape_invariants_only: universal.pass && invariants.pass,
    escape_residual_only: universal.pass && residual.pass,
    escape_universal_only: universal.pass,
    score: universal.passedChecks + invariants.passedChecks + residual.passedChecks,
    ms,
  };
}
