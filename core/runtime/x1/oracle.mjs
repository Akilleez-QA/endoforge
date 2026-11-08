import vm from 'node:vm';
import { exportBlocks } from './contract.mjs';
import { maximumRelativeTolerance } from './gates.mjs';

export const referenceFile = 'reference.js';
export const relativeFloor = 1e-9;
export const referenceRule = `Also write ${referenceFile}: plain JavaScript defining one function per export, with the same name and parameters, that computes exactly what CONTRACT.md states in double precision using only Math and Number, and throws an Error wherever the contract traps. State each export's formula in CONTRACT.md as one line \`name = expression\` over its parameters (intermediate lines \`variable = expression\` are allowed). Every number test needs tol. The supervisor recomputes every expect from CONTRACT.md and ${referenceFile} before freezing.`;
const functions = { sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2, exp: Math.exp, pow: Math.pow, abs: Math.abs, min: Math.min, max: Math.max,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, floor: Math.floor, ceil: Math.ceil, hypot: Math.hypot };
const constants = { pi: Math.PI, PI: Math.PI };
const conditional = /\b(?:if|when|unless|otherwise|else|where\s+\w+\s*[<>]|for\s+\w+\s*[<>])\b/i;

export function tokenize(text) {
  const source = String(text).replace(/Math\./g, '').replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*\*/g, '^');
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^%(),])|(\S))/y;
  let match;
  while ((match = pattern.exec(source))) {
    const index = match.index + match[0].length - match[0].trimStart().length;
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]), index });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', value: match[2], index });
    else if (match[3] !== undefined) tokens.push({ kind: 'op', value: match[3], index });
    else { tokens.push({ kind: 'stop', value: match[4], index }); break; }
  }
  tokens.source = source;
  return tokens;
}

export function parseExpression(text) {
  const tokens = tokenize(text);
  let at = 0;
  const peek = () => tokens[at], isOp = value => peek()?.kind === 'op' && peek().value === value;
  const primary = () => {
    const token = tokens[at++];
    if (!token) throw Error('end');
    if (token.kind === 'number') return { number: token.value };
    if (token.kind === 'name') {
      if (isOp('(') && Object.hasOwn(functions, token.value)) {
        at++;
        const args = [additive()];
        while (isOp(',')) { at++; args.push(additive()); }
        if (!isOp(')')) throw Error('call');
        at++;
        return { call: token.value, args };
      }
      return { name: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      const inner = additive();
      if (!isOp(')')) throw Error('paren');
      at++;
      return inner;
    }
    throw Error('primary');
  };
  const power = () => {
    const base = primary();
    if (isOp('^')) { at++; return { op: '^', left: base, right: unary() }; }
    return base;
  };
  const unary = () => {
    if (isOp('-')) { at++; return { op: 'neg', left: unary() }; }
    if (isOp('+')) { at++; return unary(); }
    return power();
  };
  const multiplicative = () => {
    let left = unary();
    while (isOp('*') || isOp('/') || isOp('%')) { const op = tokens[at++].value; left = { op, left, right: unary() }; }
    return left;
  };
  const additive = () => {
    let left = multiplicative();
    while (isOp('+') || isOp('-')) { const op = tokens[at++].value; left = { op, left, right: multiplicative() }; }
    return left;
  };
  try {
    const tree = additive(), next = peek();
    if (next?.kind === 'op' && next.value !== ',' && next.value !== '(') return null;
    if (next?.kind === 'number') return null;
    const rest = next ? tokens.source.slice(next.index).split(/\.(?:\s|$)/)[0] : '';
    if (/\d|=/.test(rest)) return null;
    return { tree, complete: !next, names: namesOf(tree) };
  } catch { return null; }
}

function namesOf(tree, out = new Set()) {
  if (tree.name) out.add(tree.name);
  for (const child of [tree.left, tree.right, ...(tree.args ?? [])]) if (child) namesOf(child, out);
  return out;
}

export function evaluateTree(tree, env) {
  if (tree.number !== undefined) return tree.number;
  if (tree.name !== undefined) {
    if (Object.hasOwn(env, tree.name)) return env[tree.name];
    if (Object.hasOwn(constants, tree.name)) return constants[tree.name];
    throw Error(`unbound ${tree.name}`);
  }
  if (tree.call) return functions[tree.call](...tree.args.map(arg => evaluateTree(arg, env)));
  const left = evaluateTree(tree.left, env);
  if (tree.op === 'neg') return -left;
  const right = evaluateTree(tree.right, env);
  if (tree.op === '+') return left + right;
  if (tree.op === '-') return left - right;
  if (tree.op === '*') return left * right;
  if (tree.op === '/') return left / right;
  if (tree.op === '%') return left % right;
  return left ** right;
}

export function contractSignatures(contract) {
  const found = new Map();
  for (const match of contract.matchAll(/\b([A-Za-z_]\w*)\s*\(([^()\n]*)\)\s*(?::\s*([A-Za-z_]\w*)|->\s*([A-Za-z_]\w*))?/g)) {
    const [, fn, parameters, typed, arrow] = match;
    const names = parameters.split(',').map(part => part.trim()).filter(Boolean);
    if (!names.length || !names.every(part => /^[A-Za-z_]\w*\s*(?::\s*[A-Za-z_]\w*)?$/.test(part))) continue;
    if (!typed && !arrow && !names.some(part => part.includes(':')) && !/`/.test(contract.slice(Math.max(0, match.index - 1), match.index))) continue;
    if (Object.hasOwn(functions, fn) || found.has(fn)) continue;
    found.set(fn, names.map(part => part.split(':')[0].trim()));
  }
  return found;
}

const bullet = /^\s*(?:[-*+>]|\d+[.)]|\(\w\))\s+/;
function statements(lines) {
  const out = [];
  lines.forEach((raw, line) => {
    const text = raw.replace(/\*\*/g, '');
    const pieces = [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    const body = text.replace(/`/g, '').replace(bullet, '').replace(/^\s*[A-Z][\w ,()'/-]{0,40}:\s+(?=[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*(?::\s*\w+)?\s*=[^=])/, '');
    const parts = [...pieces.map(text => ({ text, quoted: true })), { text: body, quoted: false }]
      .flatMap(part => part.text.split(/;\s*|,\s*(?:with|where)\s+|,\s+(?=[A-Za-z_]\w*\s*=[^=])/).map(text => ({ text, quoted: part.quoted })));
    for (const { text: piece, quoted } of parts) {
      const assignment = /^\s*([A-Za-z_]\w*)\s*(?:\(([^()]*)\))?\s*(?::\s*[A-Za-z_]\w*)?\s*=(?![=<>])\s*(.+)$/.exec(piece);
      if (assignment) { out.push({ line, kind: 'assign', name: assignment[1], text: assignment[3], conditional: conditional.test(assignment[3]) }); continue; }
      const returned = /(?:^|\s)returns?\s*:?\s*(.+)$/i.exec(piece);
      if (returned) { out.push({ line, kind: 'result', text: returned[1].replace(/`/g, ''), conditional: conditional.test(piece) }); continue; }
      const continued = /^\s*=(?![=<>])\s*(.+)$/.exec(piece);
      if (continued) { out.push({ line, kind: 'result', text: continued[1], conditional: conditional.test(continued[1]) }); continue; }
      if (quoted || /^\s{4,}\S|^\t/.test(raw)) out.push({ line, kind: 'expression', text: piece, conditional: conditional.test(piece) });
    }
  });
  return out;
}

export function formulaReference(contract, fn, parameters) {
  const exported = [...contractSignatures(contract).keys(), fn].filter((name, i, all) => all.indexOf(name) === i), signatureCount = exported.length;
  const { blocks, shared } = exportBlocks(contract, exported);
  const scope = [...shared.map(text => ({ text, own: false })), ...(blocks[fn] ?? []).map(text => ({ text, own: true }))];
  const own = statements(scope.filter(entry => entry.own).map(entry => entry.text)).map(s => ({ ...s, own: true }));
  const common = statements(scope.filter(entry => !entry.own).map(entry => entry.text)).map(s => ({ ...s, own: false }));
  const all = [...common, ...own].filter(s => !s.conditional).map(s => ({ ...s, parsed: parseExpression(s.text) })).filter(s => s.parsed);
  const params = new Set(parameters);
  const assigns = all.filter(s => s.kind === 'assign' && !params.has(s.name) && s.name !== fn);
  const operative = s => !s.parsed.tree.name && s.parsed.tree.number === undefined;
  const direct = all.filter(s => (s.kind === 'assign' && s.name === fn) || (s.kind === 'result' && (operative(s) || !params.has(s.parsed.tree.name))) || (s.kind === 'expression' && s.parsed.complete && operative(s) && [...s.parsed.names].some(name => params.has(name))));
  const used = new Set(all.flatMap(s => [...s.parsed.names]));
  const formulaText = scope.map(entry => entry.text).filter(text => /[^<>=!]=[^=]/.test(text)).join('\n');
  const single = signatureCount <= 1, mentioned = parameters.filter(name => new RegExp(`\\b${name}\\b`).test(formulaText));
  const dependsOn = (variable, parameter, seen = new Set()) => {
    if (variable === parameter) return true;
    if (seen.has(variable)) return false;
    seen.add(variable);
    return assigns.filter(s => s.name === variable).some(s => [...s.parsed.names].some(name => dependsOn(name, parameter, seen)));
  };
  return args => {
    if (args.length !== parameters.length || !args.every(Number.isFinite)) return null;
    const env = Object.fromEntries(parameters.map((name, i) => [name, args[i]])), tainted = new Set(parameters);
    for (let pass = 0; pass < 2; pass++) for (const s of assigns) {
      try {
        const value = evaluateTree(s.parsed.tree, env);
        if (Number.isFinite(value)) { env[s.name] = value; if ([...s.parsed.names].some(name => tainted.has(name))) tainted.add(s.name); }
      } catch { }
    }
    const values = [];
    const consider = s => {
      if (![...s.parsed.names].some(name => tainted.has(name))) return;
      try { const value = evaluateTree(s.parsed.tree, env); if (Number.isFinite(value)) values.push(value); } catch { }
    };
    direct.forEach(consider);
    if (!values.length) {
      const sinks = single ? assigns.filter(s => !used.has(s.name) && tainted.has(s.name) && mentioned.every(name => dependsOn(s.name, name))) : [];
      const names = [...new Set(sinks.map(s => s.name))];
      if (names.length === 1) values.push(env[names[0]]);
    }
    return values.length ? values : null;
  };
}

const comparison = '(<=|≤|<)';
const numberText = '(-?(?:\\d{1,3}(?:[, ]\\d{3})+(?!\\d)|\\d+)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?!\\d|\\.\\d|[eE][-+\\d]|\\s\\d)';
const num = text => Number(text.replace(/[, ]/g, ''));
const domainLine = /\b(?:valid|domain|range|bounds?|must|traps?|aborts?|allowed|accepts?|inputs?|limits?)\b/i;
const notDomain = /\b(?:returns?|gives|yields|labels?|means|classif\w*|category|categories|codes?)\b|["“]|\d\s*=\s*[A-Za-z]/i;
export function rangeRules(contract, parameters) {
  const rules = [];
  const add = (name, lo, loOpen, hi, hiOpen) => { if (parameters.includes(name)) rules.push({ name, lo, loOpen, hi, hiOpen }); };
  let section = false;
  for (const raw of contract.split('\n')) {
    const line = raw.replace(/`/g, '').replace(/\*\*/g, '');
    if (/^\s*#/.test(line)) { section = domainLine.test(line) && !notDomain.test(line); continue; }
    if (!section && !domainLine.test(line) && !/^\s*[-*]\s+[A-Za-z_]\w*\s*:/.test(line)) continue;
    if (notDomain.test(line)) continue;
    for (const m of line.matchAll(new RegExp(`${numberText}\\s*${comparison}\\s*([A-Za-z_]\\w*)\\s*${comparison}\\s*${numberText}`, 'g'))) {
      if (m[3] === 'x' || m[3] === 'value') { const owner = /^\s*[-*]?\s*([A-Za-z_]\w*)\s*:/.exec(line); if (owner) add(owner[1], num(m[1]), m[2] === '<', num(m[5]), m[4] === '<'); continue; }
      add(m[3], num(m[1]), m[2] === '<', num(m[5]), m[4] === '<');
    }
    for (const m of line.matchAll(new RegExp(`\\b([A-Za-z_]\\w*)\\b[^\\[(\\n.;]{0,30}?\\b(?:in|within)\\s*([\\[(])\\s*${numberText}\\s*,\\s*${numberText}\\s*([\\])])`, 'g'))) add(m[1], num(m[3]), m[2] === '(', num(m[4]), m[5] === ')');
  }
  return rules;
}
export function outsideRange(rules, parameters, args) {
  return rules.some(rule => {
    const value = args[parameters.indexOf(rule.name)];
    if (!Number.isFinite(value)) return false;
    return (rule.loOpen ? value <= rule.lo : value < rule.lo) || (rule.hiOpen ? value >= rule.hi : value > rule.hi);
  });
}

export function referenceFunctions(code, names, { timeout = 50 } = {}) {
  if (typeof code !== 'string' || !code.trim()) return null;
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  try { vm.runInContext(code, context, { timeout }); } catch { return null; }
  const caller = vm.runInContext('(f, a) => { try { const v = f(...a); return typeof v === "number" || typeof v === "boolean" ? { value: v } : { value: null }; } catch { return { trap: true }; } }', context);
  const found = {};
  for (const name of names) {
    const fn = vm.runInContext(`typeof ${name} === 'function' ? ${name} : undefined`, context);
    if (fn) found[name] = args => {
      let got;
      try { got = vm.runInContext('call(f, a)', Object.assign(context, { call: caller, f: fn, a: [...args] }), { timeout }); } catch { return { trap: true, timeout: true }; }
      return got.trap ? { trap: true } : { value: got.value };
    };
  }
  return found;
}

const close = (a, b, tol = 0) => Math.abs(a - b) <= Math.max(tol, relativeFloor * Math.max(1, Math.abs(a), Math.abs(b)), 1e-12);
const sameOutcome = (a, b, tol) => a.trap || b.trap ? Boolean(a.trap) === Boolean(b.trap)
  : typeof a.value === 'boolean' || typeof b.value === 'boolean' ? Number(a.value) === Number(b.value)
    : typeof a.value === 'number' && typeof b.value === 'number' && close(a.value, b.value, tol);
const describe = outcome => outcome.trap ? 'a trap' : JSON.stringify(outcome.value);

export function analyzeSpecification(files, { reference = true } = {}) {
  let tests;
  try { tests = JSON.parse(files['tests.json']); } catch { return null; }
  if (!Array.isArray(tests)) return null;
  const contract = files['CONTRACT.md'] ?? '', signatures = contractSignatures(contract);
  const fnNames = [...new Set(tests.map(t => t?.fn).filter(fn => typeof fn === 'string' && /^[A-Za-z_]\w*$/.test(fn)))];
  const references = reference ? referenceFunctions(files[referenceFile], fnNames) : null;
  const formulas = {}, ranges = {};
  for (const fn of fnNames) {
    const parameters = signatures.get(fn);
    if (!parameters) continue;
    formulas[fn] = formulaReference(contract, fn, parameters);
    ranges[fn] = rangeRules(contract, parameters);
  }
  const decisions = tests.map((test, index) => {
    if (!test || typeof test !== 'object' || !Array.isArray(test.args) || typeof test.fn !== 'string') return { index, status: 'unverified', why: 'malformed' };
    const literal = test.expectError === true ? { trap: true } : { value: test.expect }, tol = Number.isFinite(test.tol) ? test.tol : 0;
    if (!test.expectError && typeof test.expect === 'string') return { index, status: 'unverified', why: 'string result' };
    const opinions = [];
    const numeric = test.args.every(Number.isFinite), parameters = signatures.get(test.fn);
    if (numeric && parameters) {
      if (ranges[test.fn]?.length && outsideRange(ranges[test.fn], parameters, test.args)) opinions.push({ source: 'range', outcome: { trap: true } });
      else if (!test.expectError && typeof test.expect === 'number') {
        const values = formulas[test.fn]?.(test.args);
        if (values) {
          const distinct = values.filter((v, i) => values.findIndex(w => close(v, w)) === i);
          opinions.push({ source: 'formula', outcome: { value: distinct[0] }, readings: distinct });
        }
      }
    }
    const run = references?.[test.fn];
    if (run && numeric) {
      const got = run(test.args);
      if (got.trap || typeof got.value === 'number' || typeof got.value === 'boolean') opinions.push({ source: 'reference', outcome: got.trap ? { trap: true } : { value: got.value } });
    }
    const agrees = (opinion, outcome, tolerance = 0) => opinion.readings ? opinion.readings.some(value => sameOutcome({ value }, outcome, tolerance)) : sameOutcome(opinion.outcome, outcome, tolerance);
    if (!opinions.length) return { index, status: 'unverified', why: 'no formula or reference' };
    const formula = opinions.find(o => o.source !== 'reference'), ref = opinions.find(o => o.source === 'reference');
    if (formula && ref) {
      if (agrees(formula, ref.outcome)) {
        if (sameOutcome(ref.outcome, literal, tol)) return { index, status: 'verified', sources: ['literal', formula.source, 'reference'] };
        return { index, status: 'corrected', sources: [formula.source, 'reference'], literal, computed: ref.outcome };
      }
      const backers = [formula, ref].filter(o => agrees(o, literal, tol));
      if (backers.length) return { index, status: 'verified', sources: ['literal', backers[0].source], disagreement: [formula.source, 'reference'] };
      return { index, status: 'flagged', sources: [formula.source, 'reference'], literal, computed: ref.outcome, alternative: formula.outcome };
    }
    const only = formula ?? ref;
    if (agrees(only, literal, tol)) return { index, status: 'verified', sources: ['literal', only.source] };
    if (only.readings && only.readings.length > 1) return { index, status: 'flagged', sources: [only.source], literal, computed: only.outcome, ambiguous: true };
    return { index, status: 'flagged', sources: [only.source], literal, computed: only.outcome };
  });
  return { tests, decisions };
}

export function freezeTests(tests, decisions) {
  const changes = [];
  const out = tests.map((test, index) => {
    const decision = decisions[index];
    let next = test;
    if (decision?.status === 'corrected') {
      const { expect: _e, tol: _t, expectError: _x, ...rest } = test;
      next = decision.computed.trap ? { ...rest, expectError: true } : { ...rest, expect: decision.computed.value };
    }
    if (!next.expectError && typeof next.expect === 'number' && Number.isFinite(next.expect)) {
      const floor = relativeFloor * Math.max(1, Math.abs(next.expect)), declared = Number.isFinite(next.tol) ? next.tol : 0;
      const tol = Math.min(Math.max(declared, floor), maximumRelativeTolerance * Math.max(1, Math.abs(next.expect)));
      if (tol !== next.tol) next = { ...next, tol };
    }
    if (next !== test) changes.push({ index, test: next });
    return next;
  });
  return { tests: out, changes };
}

export function applyChanges(text, changes) {
  if (!changes.length) return text;
  const tests = JSON.parse(text);
  for (const { index, test } of changes) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= tests.length) throw Error('oracle change out of range');
    const before = tests[index], keys = new Set([...Object.keys(before), ...Object.keys(test)]);
    for (const key of keys) if (!['expect', 'tol', 'expectError'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(test[key])) throw Error('oracle may change only expect, tol and expectError');
    tests[index] = test;
  }
  return JSON.stringify(tests, null, 1);
}

export function oracleProblems(analysis) {
  if (!analysis) return [];
  return analysis.decisions.filter(d => d.status === 'flagged').map(d => {
    const test = analysis.tests[d.index];
    return `test ${d.index} (${test.name ?? test.fn}): it expects ${describe(d.literal)}, but ${d.sources.join(' and ')} give ${describe(d.computed)}${d.alternative ? ` and ${describe(d.alternative)}` : ''}; make CONTRACT.md, ${referenceFile} and this test agree`;
  });
}

export function freezeSpecification(files, options) {
  const begin = performance.now(), analysis = analyzeSpecification(files, options);
  if (!analysis) return null;
  const { tests, changes } = freezeTests(analysis.tests, analysis.decisions);
  const count = status => analysis.decisions.filter(d => d.status === status).length;
  return { text: changes.length ? JSON.stringify(tests, null, 1) : files['tests.json'], changes,
    report: { verified: count('verified'), corrected: count('corrected'), flagged: count('flagged'), unverified: count('unverified'),
      spec_errors: analysis.decisions.filter(d => d.status === 'corrected' || d.status === 'flagged').map(d => ({ index: d.index, status: d.status, sources: d.sources, literal: d.literal, computed: d.computed })),
      ms: performance.now() - begin } };
}
