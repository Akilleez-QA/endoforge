// Mutant generation for probe P-03. Every mutant is an edit list over the reference source
// ({ start, end, replacement }, non-overlapping), so strata compose uniformly (S4).
//
// Written AFTER the evaluator was frozen (receipt/evaluator.sha256); see run.mjs which
// verifies the hash before using any of this.

// ---------- source utilities ----------

// Ranges to skip for mechanical mutation: comments and string literals.
export function protectedRanges(src) {
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; ranges.push([i, end, 'comment']); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; ranges.push([i, end, 'comment']); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      ranges.push([i, j + 1, 'string']); i = j + 1; continue;
    }
    i++;
  }
  return ranges;
}
function inRange(ranges, pos, kind) {
  return ranges.some(([s, e, k]) => pos >= s && pos < e && (!kind || k === kind));
}

export function applyEdits(src, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error('overlapping edits');
  }
  let out = src;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

export function compileKernel(src) {
  const body = src.replace(/^export\s+function\s+kernel/m, 'function kernel');
  try {
    const fn = new Function(body + '\nreturn kernel;')();
    if (typeof fn !== 'function') return { ok: false, error: 'kernel is not a function' };
    return { ok: true, fn };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// Find the n-th (0-based) occurrence of needle; error if absent. `count` enforces the total.
function locate(src, needle, nth = 0, count = null) {
  const positions = [];
  let from = 0;
  for (;;) { const p = src.indexOf(needle, from); if (p < 0) break; positions.push(p); from = p + needle.length; }
  if (count !== null && positions.length !== count) throw new Error(`expected ${count} occurrences of ${JSON.stringify(needle)}, found ${positions.length}`);
  if (positions.length <= nth) throw new Error(`occurrence ${nth} of ${JSON.stringify(needle)} not found`);
  return positions[nth];
}
function edit(src, needle, replacement, nth = 0, count = null) {
  const start = locate(src, needle, nth, count);
  return { start, end: start + needle.length, replacement };
}
function editAll(src, needle, replacement) {
  const edits = [];
  let from = 0;
  for (;;) { const p = src.indexOf(needle, from); if (p < 0) break; edits.push({ start: p, end: p + needle.length, replacement }); from = p + needle.length; }
  if (!edits.length) throw new Error(`no occurrence of ${JSON.stringify(needle)}`);
  return edits;
}

// ---------- S1 mechanical ----------

const UNIT_WORDS = ['psi', 'psig', 'kPa', 'bar'];
const BASIS_WORDS = ['gauge', 'absolute'];
const CLASS_WORDS = ['match', 'minor', 'major', 'no-reference', 'unresolved-basis', 'unconvertible'];
const EFFECT_WORDS = ['emit', 'summary'];

export function mechanicalMutants(src) {
  const ranges = protectedRanges(src);
  const out = [];
  const add = (desc, edits) => out.push({ stratum: 'S1', description: desc, edits });
  const okPos = p => !inRange(ranges, p);

  // Operator table. Order matters: longer operators first, and we skip positions inside longer ones.
  const ops = [
    ['===', ['!==']], ['!==', ['===']],
    ['<=', ['<', '>=', '>', '==']], ['>=', ['>', '<=', '<']],
    ['&&', ['||']], ['||', ['&&']],
    ['+=', ['-=']],
  ];
  const taken = new Set();
  for (const [op, reps] of ops) {
    let from = 0;
    for (;;) {
      const p = src.indexOf(op, from);
      if (p < 0) break;
      from = p + op.length;
      if (!okPos(p)) continue;
      for (let k = p; k < p + op.length; k++) taken.add(k);
      for (const r of reps) add(`op ${op} -> ${r} @${p}`, [{ start: p, end: p + op.length, replacement: r }]);
    }
  }
  // Single-char binary arithmetic and comparison operators, avoiding compound forms.
  const single = [['+', ['-', '*']], ['-', ['+']], ['*', ['/', '+']], ['/', ['*']], ['<', ['<=', '>']], ['>', ['>=', '<']]];
  for (let p = 0; p < src.length; p++) {
    if (!okPos(p) || taken.has(p)) continue;
    const c = src[p];
    const rule = single.find(([o]) => o === c);
    if (!rule) continue;
    const prev = src[p - 1], next = src[p + 1];
    if ('+-*/<>=!'.includes(prev) || '+-*/<>='.includes(next)) continue;      // compound or comment-like
    if (c === '-' && /[(,=?:[]\s*$/.test(src.slice(Math.max(0, p - 2), p))) continue; // unary minus
    if (c === '/' && (next === '/' || next === '*')) continue;
    if ((c === '<' || c === '>') && !/\s/.test(prev)) continue;                 // generics-ish / arrows
    for (const r of rule[1]) add(`op ${c} -> ${r} @${p}`, [{ start: p, end: p + 1, replacement: r }]);
  }
  // Negation removal: `!x` where not `!=`.
  for (let p = 0; p < src.length; p++) {
    if (src[p] === '!' && src[p + 1] !== '=' && okPos(p)) add(`drop negation @${p}`, [{ start: p, end: p + 1, replacement: '' }]);
  }
  // Numeric literals.
  const numRe = /(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g;
  let m;
  while ((m = numRe.exec(src))) {
    const p = m.index;
    if (!okPos(p)) continue;
    const v = Number(m[1]);
    const end = p + m[0].length;
    const reps = new Set([String(v + 1), String(v - 1), String(v * 2), String(-v), '0']);
    reps.delete(m[1]);
    for (const r of reps) add(`const ${m[1]} -> ${r} @${p}`, [{ start: p, end, replacement: r }]);
  }
  // null <-> undefined, true <-> false.
  for (const [w, r] of [['null', 'undefined'], ['undefined', 'null'], ['true', 'false'], ['false', 'true']]) {
    const re = new RegExp(`(?<![\\w$.])${w}(?![\\w$])`, 'g');
    while ((m = re.exec(src))) { if (okPos(m.index)) add(`${w} -> ${r} @${m.index}`, [{ start: m.index, end: m.index + w.length, replacement: r }]); }
  }
  // String-literal flips within known vocabularies.
  for (const [s, e, kind] of ranges) {
    if (kind !== 'string') continue;
    const lit = src.slice(s + 1, e - 1);
    const vocab = [UNIT_WORDS, BASIS_WORDS, CLASS_WORDS, EFFECT_WORDS].find(v => v.includes(lit));
    if (!vocab) continue;
    for (const alt of vocab) if (alt !== lit) add(`string '${lit}' -> '${alt}' @${s}`, [{ start: s + 1, end: e - 1, replacement: alt }]);
  }
  // Statement deletion: whole lines that are simple statements (call, assignment, continue), not declarations/returns/blocks.
  const lineRe = /^[ \t]*(?!const |let |var |return|import|export|if |for |else|function|\/\/)([A-Za-z_$][\w$.\[\]']*\s*(?:\([^;{}]*\)|[+\-*/]?=\s*[^;{}]+|\+\+|--)|continue);[ \t]*$/gm;
  while ((m = lineRe.exec(src))) {
    const p = m.index;
    if (!okPos(p)) continue;
    add(`delete statement ${JSON.stringify(m[0].trim().slice(0, 40))} @${p}`, [{ start: p, end: p + m[0].length, replacement: '' }]);
  }
  // Ternary branch swap.
  const terRe = /\?\s*([^:;?]+?)\s*:\s*([^;]+?);/g;
  while ((m = terRe.exec(src))) {
    if (!okPos(m.index)) continue;
    add(`swap ternary branches @${m.index}`, [{ start: m.index, end: m.index + m[0].length, replacement: `? ${m[2]} : ${m[1]};` }]);
  }
  // Return-value swaps.
  const retRe = /return ([^;]+);/g;
  while ((m = retRe.exec(src))) {
    if (!okPos(m.index)) continue;
    const r = m[1] === 'null' ? 'undefined' : 'null';
    add(`return ${m[1].slice(0, 30)} -> return ${r} @${m.index}`, [{ start: m.index, end: m.index + m[0].length, replacement: `return ${r};` }]);
  }
  // Condition negation on every `if (...)`.
  const ifRe = /if \(/g;
  while ((m = ifRe.exec(src))) {
    const open = m.index + 3;
    if (!okPos(m.index)) continue;
    let depth = 0, j = open;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')') { depth--; if (depth === 0) break; } }
    const cond = src.slice(open + 1, j);
    add(`negate condition (${cond.slice(0, 30)}) @${m.index}`, [{ start: open + 1, end: j, replacement: `!(${cond})` }]);
  }
  // Member/identifier swaps within a type class.
  const classes = [
    ['tolerance.minor', 'tolerance.major'],
    ['conv.value', 'exp.value'],
    ['reading.source', 'reading.id', 'reading.point'],
    ['event.readings', 'event.reference'],
    ['q.source', 'q.unit'],
    ['target.unit', 'q.unit'],
    ['conv.sources', 'exp.sources'],
  ];
  for (const cls of classes) {
    for (const w of cls) {
      const re = new RegExp(w.replace('.', '\\.') + '(?![\\w$])', 'g');
      while ((m = re.exec(src))) {
        if (!okPos(m.index)) continue;
        for (const alt of cls) if (alt !== w) add(`ident ${w} -> ${alt} @${m.index}`, [{ start: m.index, end: m.index + w.length, replacement: alt }]);
      }
    }
  }
  // Loose equality, abs removal, set-op swap.
  for (const [a, b] of [['===', '=='], ['!==', '!='], ['Math.abs(', '('], ['.add(', '.delete(']]) {
    let from = 0;
    for (;;) { const p = src.indexOf(a, from); if (p < 0) break; from = p + a.length; if (okPos(p)) add(`${a} -> ${b} @${p}`, [{ start: p, end: p + a.length, replacement: b }]); }
  }
  // Initialiser replacement: `const x = expr;` on one line -> `const x = undefined;`
  const initRe = /^([ \t]*(?:const|let) [\w$]+) = ([^;{}\n]+);[ \t]*$/gm;
  while ((m = initRe.exec(src))) {
    if (!okPos(m.index) || m[2] === 'undefined') continue;
    add(`init ${m[1].trim()} = undefined @${m.index}`, [{ start: m.index, end: m.index + m[0].length, replacement: `${m[1]} = undefined;` }]);
  }
  // Vocabulary string literals -> empty string.
  for (const [s, e, kind] of ranges) {
    if (kind !== 'string') continue;
    const lit = src.slice(s + 1, e - 1);
    if ([...UNIT_WORDS, ...BASIS_WORDS, ...CLASS_WORDS, ...EFFECT_WORDS, 'reconcile'].includes(lit)) add(`string '${lit}' -> '' @${s}`, [{ start: s + 1, end: e - 1, replacement: '' }]);
  }
  // Whole-line deletion of single-line `if (...) stmt;` and `for (...) stmt;`.
  const ctlRe = /^[ \t]*(?:if|for) \([^\n]*\) [^{\n]+;[ \t]*$/gm;
  while ((m = ctlRe.exec(src))) if (okPos(m.index)) add(`delete control line ${JSON.stringify(m[0].trim().slice(0, 40))} @${m.index}`, [{ start: m.index, end: m.index + m[0].length, replacement: '' }]);
  // Numeric literal x10 and /10.
  const numRe2 = /(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g;
  while ((m = numRe2.exec(src))) {
    if (!okPos(m.index) || Number(m[1]) === 0) continue;
    add(`const ${m[1]} -> x10 @${m.index}`, [{ start: m.index, end: m.index + m[0].length, replacement: String(Number(m[1]) * 10) }]);
  }
  // De-duplicate identical edits.
  const seen = new Set();
  return out.filter(mu => { const k = JSON.stringify(mu.edits); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- S2 domain-semantic (hand-written) ----------

export function domainSemanticMutants(src) {
  const L = [];
  const add = (description, edits) => L.push({ stratum: 'S2', description, edits: Array.isArray(edits) ? edits : [edits] });
  add('psig no longer forces gauge (psig treated like psi: basis field decides)',
    edit(src, "if (q.unit === 'psig') return 'gauge';", "", 0, 1));
  add('drop rows with missing basis instead of reporting them unresolved',
    edit(src, "row.classification = 'unresolved-basis';", "continue;", 0, 1));
  add('wrong psi conversion factor (6.89 instead of 6.894757293168)',
    editAll(src, '6.894757293168', '6.89'));
  add('wrong bar factor (1000 kPa per bar)',
    edit(src, 'bar: 100 }', 'bar: 1000 }', 0, 1));
  add('row cites reading id instead of its source id',
    edit(src, 'sources: [reading.source],', 'sources: [reading.id],', 0, 1));
  add('reverse join direction: iterate reference, drop readings with no reference, one row per reference entry',
    edit(src, 'for (const reading of event.readings) {',
      'for (const _ref of event.reference) {\n    const reading = event.readings.find(r => r.point === _ref.point);\n    if (!reading) continue;', 0, 1));
  add('treat absolute as gauge (resolveBasis returns gauge for any valid basis)',
    edit(src, "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;", "if (q.basis === 'gauge' || q.basis === 'absolute') return 'gauge';", 0, 1));
  add('gauge/absolute shift applied in the wrong direction',
    edit(src, "kpa = basis === 'gauge' ? kpa + atmosphere.value_kpa : kpa - atmosphere.value_kpa;", "kpa = basis === 'gauge' ? kpa - atmosphere.value_kpa : kpa + atmosphere.value_kpa;", 0, 1));
  add('atmosphere source not cited after a basis shift (stale source binding)',
    edit(src, 'sources.push(atmosphere.source);', '', 0, 1));
  add('atmosphere added in the source unit instead of kPa (dimensional error)',
    edit(src, "kpa + atmosphere.value_kpa : kpa - atmosphere.value_kpa", "kpa + atmosphere.value_kpa / factor : kpa - atmosphere.value_kpa / factor", 0, 1));
  add('row.sources takes the expected sources from the converted side (reference source never cited)',
    edit(src, 'for (const s of exp.sources) if (!row.sources.includes(s)) row.sources.push(s);', 'for (const s of conv.sources) if (!row.sources.includes(s)) row.sources.push(s);', 0, 1));
  add('minor tolerance boundary exclusive (< instead of <=)',
    edit(src, 'if (d <= tolerance.minor)', 'if (d < tolerance.minor)', 0, 1));
  add('unmatched_reference counts matched references instead',
    edit(src, 'if (!matchedRef.has(r.point)) totals.unmatched_reference += 1;', 'if (matchedRef.has(r.point)) totals.unmatched_reference += 1;', 0, 1));
  add('totals.rows counts only rows with a converted value',
    edit(src, 'totals.rows += 1;', 'if (row.converted) totals.rows += 1;', 0, 1));
  add('no-reference reported as unconvertible',
    edit(src, "row.classification = 'no-reference';", "row.classification = 'unconvertible';", 0, 1));
  add('target basis ignored: always convert to absolute',
    edit(src, 'if (basis !== target.basis) {', "if (basis !== 'absolute') {", 0, 1));
  add('target unit ignored: values left in kPa',
    edit(src, 'const out = kpa / KPA_PER_UNIT[target.unit];', 'const out = kpa;', 0, 1));
  add('delta sign reversed (expected minus converted)',
    edit(src, 'row.delta = conv.value - exp.value;', 'row.delta = exp.value - conv.value;', 0, 1));
  add('unresolvable basis treated as zero pressure instead of unconvertible',
    edit(src, 'if (basis === null) return null;\n  const factor', 'if (basis === null) return { value: 0, unit: target.unit, basis: target.basis, sources: [q.source] };\n  const factor', 0, 1));
  add('second reading on the same point loses its reference (join consumes the reference row)',
    edit(src, 'if (ref !== undefined) matchedRef.add(reading.point);', 'if (ref !== undefined) { matchedRef.add(reading.point); refByPoint.delete(reading.point); }', 0, 1));
  add('prior state discarded (seen rebuilt from this event only)',
    edit(src, 'const seen = { ...(state && state.seen ? state.seen : {}) };', 'const seen = {};', 0, 1));
  add('negative gauge pressure clamped to zero',
    edit(src, 'let kpa = q.value * factor;', 'let kpa = Math.max(0, q.value * factor);', 0, 1));
  add('psi also forced to gauge (psi/psig swapped semantics)',
    edit(src, "if (q.unit === 'psig') return 'gauge';", "if (q.unit === 'psig' || q.unit === 'psi') return 'gauge';", 0, 1));
  add('missing basis defaults to gauge (assumed atmosphere)',
    edit(src, "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;\n  return null;", "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;\n  return 'gauge';", 0, 1));
  return L;
}

// ---------- S3 model-plausible (hand-written realistic generator bugs) ----------

export function modelPlausibleMutants(src) {
  const L = [];
  const add = (description, edits, note) => L.push({ stratum: 'S3', description, edits: Array.isArray(edits) ? edits : [edits], note });
  add('unit lookup made case-insensitive (accepts PSI, kpa, Bar)',
    edit(src, 'const factor = KPA_PER_UNIT[q.unit];', "const _u = String(q.unit).toLowerCase(); const factor = KPA_PER_UNIT[q.unit] ?? KPA_PER_UNIT[_u === 'kpa' ? 'kPa' : _u];", 0, 1));
  add('missing basis defaults to absolute',
    edit(src, "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;\n  return null;", "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;\n  return 'absolute';", 0, 1));
  add('early return with no effects when there are no readings',
    edit(src, 'const refByPoint = new Map();', 'if (!event.readings.length) return { state, effects: [] };\n  const refByPoint = new Map();', 0, 1));
  add('early return with no effects when the reference table is empty',
    edit(src, 'const refByPoint = new Map();', 'if (!event.reference.length) return { state, effects: [] };\n  const refByPoint = new Map();', 0, 1));
  add('mutable aliasing: state.seen mutated in place instead of copied',
    edit(src, 'const seen = { ...(state && state.seen ? state.seen : {}) };', 'const seen = state && state.seen ? state.seen : {};', 0, 1));
  add('event type check loosened (any event with a type is processed)',
    edit(src, "if (!event || event.type !== 'reconcile') {", "if (!event || !event.type) {", 0, 1));
  add('epsilon-tolerant boundary comparison (accepts d within 1e-9 above minor)',
    edit(src, 'if (d <= tolerance.minor)', 'if (d < tolerance.minor || Math.abs(d - tolerance.minor) < 1e-9)', 0, 1), 'expected near-equivalent');
  add('converted value rounded to 3 decimals',
    edit(src, 'const out = kpa / KPA_PER_UNIT[target.unit];', 'const out = Math.round(kpa / KPA_PER_UNIT[target.unit] * 1000) / 1000;', 0, 1));
  add('row.sources sorted alphabetically',
    edit(src, 'totals[row.classification] += 1;', 'row.sources.sort();\n    totals[row.classification] += 1;', 0, 1), 'spec-ambiguous: order of sources is not specified');
  add('duplicate-source guard dropped for converted sources',
    edit(src, 'for (const s of conv.sources) if (!row.sources.includes(s)) row.sources.push(s);', 'for (const s of conv.sources) row.sources.push(s);', 0, 1), 'spec-ambiguous: duplicates in row.sources');
  add('major tolerance widened by the minor tolerance',
    edit(src, 'if (d <= tolerance.major)', 'if (d <= tolerance.major + tolerance.minor)', 0, 1));
  add('totals class keys not initialised (missing zero counts)',
    edit(src, 'for (const c of CLASSES) totals[c] = 0;', '', 0, 1));
  add('reference map first-wins instead of last-wins on duplicate points',
    edit(src, 'for (const r of event.reference) refByPoint.set(r.point, r);', 'for (const r of event.reference) if (!refByPoint.has(r.point)) refByPoint.set(r.point, r);', 0, 1), 'expected equivalent: generator never duplicates reference points');
  add('basis compared case-insensitively (accepts Gauge, ABS not)',
    edit(src, "if (q.basis === 'gauge' || q.basis === 'absolute') return q.basis;", "const _b = String(q.basis).toLowerCase(); if (_b === 'gauge' || _b === 'absolute') return _b;", 0, 1));
  add('reading_id falls back to point when id is missing',
    edit(src, 'reading_id: reading.id,', 'reading_id: reading.id ?? reading.point,', 0, 1), 'expected equivalent: ids always present');
  add('atmosphere required even when no basis shift is needed',
    edit(src, 'if (basis !== target.basis) {\n    if (!atmosphere) return null;', 'if (!atmosphere) return null;\n  if (basis !== target.basis) {', 0, 1));
  add('kPa key typed as kpa in the factor table',
    edit(src, 'kPa: 1,', 'kpa: 1,', 0, 1));
  add('psi factor from a rounded standard (6.895)',
    editAll(src, '6.894757293168', '6.895'));
  add('state.seen keyed by reading id instead of point',
    edit(src, 'seen[row.point] = row.classification;', 'seen[row.reading_id] = row.classification;', 0, 1));
  add('effects emitted in the other order (summary first)',
    edit(src, "{ type: 'emit', rows },\n      { type: 'summary', totals },", "{ type: 'summary', totals },\n      { type: 'emit', rows },", 0, 1), 'spec-ambiguous: effect order');
  add('delta reported as an absolute value',
    edit(src, 'row.delta = conv.value - exp.value;', 'row.delta = Math.abs(conv.value - exp.value);', 0, 1));
  add('reference only counted as matched when the reading has a usable basis',
    edit(src, 'if (ref !== undefined) matchedRef.add(reading.point);', 'if (ref !== undefined && resolveBasis(reading) !== null) matchedRef.add(reading.point);', 0, 1));
  return L;
}

// ---------- S4 searched: compose pairs of the highest-scoring non-equivalent mutants ----------

export function searchedMutants(ranked, minPairs = 50) {
  // ranked: non-equivalent S1–S3 mutants sorted by harness score descending.
  const out = [];
  const overlaps = (a, b) => a.some(x => b.some(y => x.start < y.end && y.start < x.end));
  for (let k = 2; k <= ranked.length && out.length < minPairs; k++) {
    out.length = 0;
    const top = ranked.slice(0, k);
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        if (overlaps(top[i].edits, top[j].edits)) continue;
        out.push({ stratum: 'S4', description: `compose [${top[i].id}] + [${top[j].id}]`, parents: [top[i].id, top[j].id], edits: [...top[i].edits, ...top[j].edits] });
      }
    }
  }
  return out;
}
