// Reference kernel for probe P-03. Plain JavaScript on purpose: the subject of the
// probe is the seeded-fault harness, not the kernel route (AssemblyScript, Rust, ...).
//
// Contract: kernel(state, event) -> { state, effects }. Data in, data out, no I/O.
//
// Toy task in the Field OS spirit: join pressure readings (psi | psig | kPa | bar, with a
// `basis` of gauge | absolute, each carrying a source id) against a reference table,
// convert to a target unit and basis, classify discrepancies, and emit rows where every
// value cites the source id of every input it was derived from (source-bound return).
//
// Event shape:
//   { type: 'reconcile',
//     readings:  [{ id, point, source, value, unit, basis }],
//     reference: [{ point, source, value, unit, basis }],
//     atmosphere: { value_kpa, source } | null,
//     target: { unit, basis },
//     tolerance: { minor, major } }           // in target unit, inclusive bounds
//
// Effects: [{ type: 'emit', rows }, { type: 'summary', totals }]
// State:   { seen: { [point]: classification } }   (re-applying the same event is idempotent)

const KPA_PER_UNIT = { psi: 6.894757293168, psig: 6.894757293168, kPa: 1, bar: 100 };
const CLASSES = ['match', 'minor', 'major', 'no-reference', 'unresolved-basis', 'unconvertible'];

function resolveBasis(q) {
  // psig is a gauge unit by definition; it overrides a missing or contradictory basis.
  if (q.unit === 'psig') return 'gauge';
  if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;
  return null;
}

function toTarget(q, target, atmosphere) {
  // Returns { value, sources } in target unit and basis, or null if unconvertible.
  const basis = resolveBasis(q);
  if (basis === null) return null;
  const factor = KPA_PER_UNIT[q.unit];
  if (factor === undefined) return null;
  let kpa = q.value * factor;
  const sources = [q.source];
  if (basis !== target.basis) {
    if (!atmosphere) return null;
    kpa = basis === 'gauge' ? kpa + atmosphere.value_kpa : kpa - atmosphere.value_kpa;
    sources.push(atmosphere.source);
  }
  const out = kpa / KPA_PER_UNIT[target.unit];
  return { value: out, unit: target.unit, basis: target.basis, sources };
}

function classify(delta, tolerance) {
  const d = Math.abs(delta);
  if (d <= tolerance.minor) return 'match';
  if (d <= tolerance.major) return 'minor';
  return 'major';
}

export function kernel(state, event) {
  if (!event || event.type !== 'reconcile') {
    return { state, effects: [] };
  }
  const refByPoint = new Map();
  for (const r of event.reference) refByPoint.set(r.point, r);
  const matchedRef = new Set();
  const rows = [];
  const totals = {};
  for (const c of CLASSES) totals[c] = 0;
  totals.rows = 0;
  totals.unmatched_reference = 0;

  for (const reading of event.readings) {
    const row = {
      point: reading.point,
      reading_id: reading.id,
      sources: [reading.source],
      converted: null,
      expected: null,
      delta: null,
      classification: null,
    };
    const ref = refByPoint.get(reading.point);
    if (ref !== undefined) matchedRef.add(reading.point);
    if (resolveBasis(reading) === null) {
      row.classification = 'unresolved-basis';
    } else {
      const conv = toTarget(reading, event.target, event.atmosphere);
      if (conv === null) {
        row.classification = 'unconvertible';
      } else {
        row.converted = conv;
        for (const s of conv.sources) if (!row.sources.includes(s)) row.sources.push(s);
        if (ref === undefined) {
          row.classification = 'no-reference';
        } else {
          const exp = toTarget(ref, event.target, event.atmosphere);
          if (exp === null) {
            row.classification = 'unconvertible';
          } else {
            row.expected = exp;
            for (const s of exp.sources) if (!row.sources.includes(s)) row.sources.push(s);
            row.delta = conv.value - exp.value;
            row.classification = classify(row.delta, event.tolerance);
          }
        }
      }
    }
    totals[row.classification] += 1;
    totals.rows += 1;
    rows.push(row);
  }
  for (const r of event.reference) {
    if (!matchedRef.has(r.point)) totals.unmatched_reference += 1;
  }

  const seen = { ...(state && state.seen ? state.seen : {}) };
  for (const row of rows) seen[row.point] = row.classification;

  return {
    state: { seen },
    effects: [
      { type: 'emit', rows },
      { type: 'summary', totals },
    ],
  };
}
