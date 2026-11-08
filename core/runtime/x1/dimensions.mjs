const Q = (dims, scale = null, affine = null, family = null) => ({ kind: 'q', dims, scale, affine, family });
const CODE = { kind: 'code' }, UNKNOWN = { kind: 'unknown' };
const lit = value => ({ kind: 'literal', value });
const T = { K: 1 }, TIME = { T: 1 }, M = { M: 1 }, L = { L: 1 }, P = { M: 1, L: -1, T: -2 }, MDOT = { M: 1, T: -1 }, POWER = { M: 1, L: 2, T: -3 }, ENERGY = { M: 1, L: 2, T: -2 }, VDOT = { L: 3, T: -1 };
const atoms = {
  degf: Q(T, 5 / 9, null, 'T'), f: Q(T, 5 / 9, null, 'T'), fahrenheit: Q(T, 5 / 9, null, 'T'),
  degc: Q(T, 1, null, 'T'), c: Q(T, 1, null, 'T'), celsius: Q(T, 1, null, 'T'), k: Q(T, 1, null, 'T'), kelvin: Q(T, 1, null, 'T'), degr: Q(T, 5 / 9, null, 'T'), rankine: Q(T, 5 / 9, null, 'T'),
  psig: Q(P, 6894.757), psia: Q(P, 6894.757), psi: Q(P, 6894.757), psid: Q(P, 6894.757), kpa: Q(P, 1e3), pa: Q(P, 1), mpa: Q(P, 1e6), bar: Q(P, 1e5), inhg: Q(P, 3386.389),
  kg: Q(M, 1), g: Q(M, 1e-3), gram: Q(M, 1e-3), grams: Q(M, 1e-3), lb: Q(M, 0.45359237), lbs: Q(M, 0.45359237), lbm: Q(M, 0.45359237), oz: Q(M, 0.0283495), pound: Q(M, 0.45359237), pounds: Q(M, 0.45359237),
  m: Q(L, 1), metre: Q(L, 1), metres: Q(L, 1), meter: Q(L, 1), meters: Q(L, 1), mm: Q(L, 1e-3), cm: Q(L, 1e-2), ft: Q(L, 0.3048), feet: Q(L, 0.3048), foot: Q(L, 0.3048), in: Q(L, 0.0254), inch: Q(L, 0.0254), inches: Q(L, 0.0254),
  s: Q(TIME, 1, null, 't'), sec: Q(TIME, 1, null, 't'), second: Q(TIME, 1, null, 't'), seconds: Q(TIME, 1, null, 't'), ms: Q(TIME, 1e-3, null, 't'), milliseconds: Q(TIME, 1e-3, null, 't'), millisecond: Q(TIME, 1e-3, null, 't'),
  min: Q(TIME, 60, null, 't'), minute: Q(TIME, 60, null, 't'), minutes: Q(TIME, 60, null, 't'), h: Q(TIME, 3600, null, 't'), hr: Q(TIME, 3600, null, 't'), hour: Q(TIME, 3600, null, 't'), hours: Q(TIME, 3600, null, 't'),
  day: Q(TIME, 86400, null, 't'), days: Q(TIME, 86400, null, 't'),
  kw: Q(POWER, 1e3), w: Q(POWER, 1), watt: Q(POWER, 1), watts: Q(POWER, 1), hp: Q(POWER, 745.7), btuh: Q(POWER, 0.29307), mbh: Q(POWER, 293.07), btu: Q(ENERGY, 1055.06), kj: Q(ENERGY, 1e3), j: Q(ENERGY, 1), kwh: Q(ENERGY, 3.6e6),
  cfm: Q(VDOT, 0.000471947), gpm: Q(VDOT, 0.0000630902),
  '%': Q({}, 0.01), percent: Q({}, 0.01), pct: Q({}, 0.01), dimensionless: Q({}, 1), ratio: Q({}, 1), fraction: Q({}, 1), unitless: Q({}, 1), 1: Q({}, 1),
  mass: Q(M, null), time: Q(TIME, null, null, 't'), circuits: Q({}, 1), circuit: Q({}, 1), count: Q({}, 1), characters: Q({}, 1), items: Q({}, 1),
};
const labelWords = /\b(?:code|codes|status|state|flag|mask|action|classification|comparison|identifier|id|index|ordinal|indicator|membership|inclusion|decision|label|role|presence|assessment|type|scale|contribution|position|selected|same|verdict|band|boolean|enum|category)\b/i;
const differenceWords = /\b(?:difference|delta|rise|drop|change|span|interval|offset|duration|superheat|subcooling|approach|split)\b/i;
const pointWords = /\b(?:since|epoch|unix|utc day index|timestamp|absolute|reading)\b/i;
const combine = (a, b, sign) => {
  const dims = { ...a };
  for (const [k, v] of Object.entries(b)) dims[k] = (dims[k] ?? 0) + sign * v;
  for (const k of Object.keys(dims)) if (!dims[k]) delete dims[k];
  return dims;
};
const sameDims = (a, b) => { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); return [...keys].every(k => (a[k] ?? 0) === (b[k] ?? 0)); };
const dimText = d => (Object.keys(d).length ? Object.entries(d).map(([k, v]) => (v === 1 ? k : `${k}^${v}`)).join(' ') : 'dimensionless');
export function unitDimension(text) {
  if (typeof text !== 'string') return null;
  const s = text.toLowerCase().replace(/°\s*/g, 'deg').replace(/\bdegrees?\s+(fahrenheit|celsius)/g, '$1').trim();
  if (labelWords.test(s)) return null;
  const head = s.split(/[;,(]/)[0].trim().replace(/\s+(?:by|of)\s+.*$/, '').replace(/\s+per\s+/g, '/').replace(/\s*\/\s*/g, '/');
  const words = head.split(/\s+/).filter(Boolean);
  let parsed = null;
  for (const word of words) {
    const parts = word.split('/');
    let value = Q({}, 1), ok = true;
    parts.forEach((part, i) => {
      const a = atoms[part.replace(/[^a-z%]/g, '') || part];
      if (!a) { ok = false; return; }
      value = Q(combine(value.dims, a.dims, i ? -1 : 1), value.scale !== null && a.scale !== null ? (i ? value.scale / a.scale : value.scale * a.scale) : null, parts.length === 1 ? a.affine : null, parts.length === 1 ? a.family : null);
    });
    if (ok && parts.length) { if (parsed) return null; parsed = value; }
    else if (!['utc', 'unix', 'since', 'of', 'the', 'epoch', 'difference', 'delta', 'temperature', 'absolute', 'gauge', 'rh', 'caller', 'labelled', 'caller-labelled', 'rise', 'drop', 'index'].includes(word.replace(/[^a-z]/g, '')) && !/^\d/.test(word)) return null;
  }
  if (!parsed) return null;
  if (parsed.family === 'T') parsed = { ...parsed, affine: differenceWords.test(s) ? 'diff' : 'point' };
  if (parsed.family === 't') parsed = { ...parsed, affine: pointWords.test(s) ? 'point' : 'diff' };
  return parsed;
}
const camel = name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[\s_]+/).filter(Boolean);
const nameAtoms = { f: 'f', c: 'c', k: 'k', psig: 'psig', psia: 'psia', psi: 'psi', kpa: 'kpa', bar: 'bar', lb: 'lb', lbs: 'lbs', kg: 'kg', g: 'g', grams: 'g', ft: 'ft', feet: 'ft', kw: 'kw', hp: 'hp', btu: 'btu', btuh: 'btuh', cfm: 'cfm', gpm: 'gpm', ms: 'ms', seconds: 's', sec: 's', hours: 'h', days: 'day', percent: '%', pct: '%', ratio: 'ratio', fraction: 'fraction' };
export function nameDimension(name) {
  const parts = camel(name), lower = parts.map(p => p.toLowerCase());
  if (parts.length < 2) return null;
  const last = lower.at(-1), before = lower.at(-2);
  if (lower.includes('from') && !lower.includes('to')) return null;
  if (before === 'per') { const [a, b] = [nameAtoms[lower.at(-3)], nameAtoms[last]]; return a && b ? Q(combine(atoms[a].dims, atoms[b].dims, -1)) : null; }
  if (lower.includes('per')) return null;
  const unit = nameAtoms[last];
  if (!unit || (nameAtoms[before] && before !== 'to')) return null;
  return atoms[unit];
}
function tokenize(src) {
  const out = [], re = /\s+|(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_$][\w$]*)|(===|!==|==|!=|<=|>=|&&|\|\||\*\*|<<|>>>|>>|[-+*/%<>!?:=(){}[\];,.&|^~@])/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[3]) out.push({ t: 'str', v: m[3] });
    else if (m[4]) out.push({ t: 'num', v: Number(m[4]) });
    else if (m[5]) out.push({ t: 'id', v: m[5] });
    else if (m[6]) out.push({ t: 'op', v: m[6] });
  }
  return out;
}
const binary = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '===': 6, '!==': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '**': 11 };
function parseExpression(tokens, start) {
  let i = start;
  const peek = () => tokens[i], next = () => tokens[i++];
  const isOp = v => peek()?.t === 'op' && peek().v === v;
  function primary() {
    const tok = next();
    if (!tok) throw new Error('end');
    if (tok.t === 'num') return { n: 'num', v: tok.v };
    if (tok.t === 'str') return { n: 'str' };
    if (tok.t === 'op' && tok.v === '(') { const e = ternary(); if (!isOp(')')) throw new Error('paren'); i++; return e; }
    if (tok.t === 'op' && tok.v === '<') { while (peek() && !(peek().t === 'op' && peek().v === '>')) i++; i++; return unary(); }
    if (tok.t === 'op' && ['-', '+', '!', '~'].includes(tok.v)) return { n: 'unary', op: tok.v, a: unary() };
    if (tok.t === 'id') {
      let name = tok.v;
      if (name === 'true' || name === 'false') return { n: 'bool' };
      while (isOp('.') && tokens[i + 1]?.t === 'id') { name += `.${tokens[i + 1].v}`; i += 2; }
      if (isOp('<') && tokens[i + 1]?.t === 'id' && tokens[i + 2]?.t === 'op' && tokens[i + 2].v === '>') i += 3;
      if (isOp('(')) {
        i++;
        const args = [];
        while (!isOp(')')) { args.push(ternary()); if (isOp(',')) i++; else if (!isOp(')')) throw new Error('call'); }
        i++;
        return { n: 'call', name, args };
      }
      return { n: 'id', name };
    }
    throw new Error(`token ${tok.v}`);
  }
  function unary() {
    let e = primary();
    while (peek()?.t === 'id' && peek().v === 'as') { i += 2; }
    return e;
  }
  function binaryAt(level) {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok?.t !== 'op' || !(tok.v in binary) || binary[tok.v] < level) return left;
      i++;
      const right = binaryAt(binary[tok.v] + 1);
      left = { n: 'bin', op: tok.v, a: left, b: right };
    }
  }
  function ternary() {
    const c = binaryAt(1);
    if (isOp('?')) { i++; const a = ternary(); if (!isOp(':')) throw new Error('ternary'); i++; const b = ternary(); return { n: 'cond', c, a, b }; }
    return c;
  }
  const expr = ternary();
  return { expr, end: i };
}
function functions(source) {
  const tokens = tokenize(source), found = new Map(), constants = new Map();
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === 'op' && tok.v === '{') depth++;
    if (tok.t === 'op' && tok.v === '}') depth--;
    if (depth === 0 && tok.t === 'id' && (tok.v === 'const' || tok.v === 'let') && tokens[i + 1]?.t === 'id') {
      let j = i + 2;
      while (tokens[j] && !(tokens[j].t === 'op' && (tokens[j].v === '=' || tokens[j].v === ';'))) j++;
      if (tokens[j]?.v === '=') { try { constants.set(tokens[i + 1].v, parseExpression(tokens, j + 1).expr); } catch {} }
    }
    if (depth === 0 && tok.t === 'id' && tok.v === 'function' && tokens[i + 1]?.t === 'id') {
      const name = tokens[i + 1].v, params = [];
      let j = i + 2;
      if (tokens[j]?.v === '<') { while (tokens[j] && tokens[j].v !== '>') j++; j++; }
      if (tokens[j]?.v !== '(') continue;
      j++;
      let expectName = true, paren = 0;
      for (; tokens[j] && !(paren === 0 && tokens[j].v === ')'); j++) {
        const t = tokens[j];
        if (t.v === '(') paren++;
        if (t.v === ')') paren--;
        if (paren === 0 && t.v === ',') { expectName = true; continue; }
        if (expectName && t.t === 'id') { params.push(t.v); expectName = false; }
      }
      while (tokens[j] && tokens[j].v !== '{') j++;
      const bodyStart = j + 1;
      let d = 1, k = bodyStart;
      for (; tokens[k] && d; k++) { if (tokens[k].v === '{') d++; if (tokens[k].v === '}') d--; }
      found.set(name, { params, body: tokens.slice(bodyStart, k - 1) });
    }
  }
  for (const [name, fn] of found) {
    const locals = new Map(), assigned = new Map(), returns = [];
    const t = fn.body;
    for (let i = 0; i < t.length; i++) {
      try {
        if (t[i].t === 'id' && (t[i].v === 'const' || t[i].v === 'let' || t[i].v === 'var') && t[i + 1]?.t === 'id') {
          let j = i + 2;
          while (t[j] && !(t[j].t === 'op' && (t[j].v === '=' || t[j].v === ';'))) j++;
          if (t[j]?.v === '=') { const { expr, end } = parseExpression(t, j + 1); locals.set(t[i + 1].v, expr); i = end - 1; }
          else locals.set(t[i + 1].v, null);
        } else if (t[i].t === 'id' && t[i + 1]?.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(t[i + 1].v) && (i === 0 || t[i - 1].v === ';' || t[i - 1].v === '{' || t[i - 1].v === '}' || t[i - 1].v === ')' || t[i - 1].v === 'else')) {
          assigned.set(t[i].v, true);
        } else if (t[i].t === 'id' && t[i].v === 'return' && !(t[i + 1]?.t === 'op' && t[i + 1].v === ';')) {
          const { expr, end } = parseExpression(t, i + 1); returns.push(expr); i = end - 1;
        }
      } catch { returns.push(null); }
    }
    for (const name of assigned.keys()) locals.set(name, null);
    fn.locals = locals; fn.returns = returns;
  }
  return { found, constants };
}
const join = (a, b) => {
  if (a.kind === 'unknown' || b.kind === 'unknown') return UNKNOWN;
  if (a.kind === 'literal' && b.kind === 'literal') return CODE;
  if (a.kind === 'code' && (b.kind === 'code' || b.kind === 'literal')) return CODE;
  if (b.kind === 'code' && a.kind === 'literal') return CODE;
  if (a.kind === 'literal') return b;
  if (b.kind === 'literal') return a;
  if (a.kind === 'q' && b.kind === 'q' && sameDims(a.dims, b.dims)) return Q(a.dims, a.scale === b.scale ? a.scale : null, a.affine === b.affine ? a.affine : null, a.family === b.family ? a.family : null);
  return UNKNOWN;
};
function evaluate(program, fnName, env, imbalances, depth = 0) {
  const fn = program.found.get(fnName);
  const memo = new Map();
  const value = (expr, seen = new Set()) => {
    if (!expr) return UNKNOWN;
    switch (expr.n) {
      case 'num': return lit(expr.v);
      case 'bool': return CODE;
      case 'str': return UNKNOWN;
      case 'id': {
        if (env.has(expr.name)) return env.get(expr.name);
        if (fn.locals.has(expr.name)) {
          if (seen.has(expr.name)) return UNKNOWN;
          if (!memo.has(expr.name)) memo.set(expr.name, value(fn.locals.get(expr.name), new Set([...seen, expr.name])));
          return memo.get(expr.name);
        }
        if (program.constants.has(expr.name)) { const c = program.constants.get(expr.name); return c?.n === 'num' ? lit(c.v) : value(c, seen); }
        if (/^(?:Infinity|NaN|f64\.MAX_VALUE|f64\.EPSILON|i32\.MAX_VALUE)$/.test(expr.name)) return lit(Infinity);
        return UNKNOWN;
      }
      case 'unary': {
        const a = value(expr.a, seen);
        if (expr.op === '!') return CODE;
        if (expr.op === '-' && a.kind === 'literal') return lit(-a.value);
        if (expr.op === '-' && a.kind === 'q' && a.family === 'T' && a.affine === 'point') return Q(a.dims, a.scale, null, a.family);
        return a;
      }
      case 'cond': value(expr.c, seen); return join(value(expr.a, seen), value(expr.b, seen));
      case 'call': {
        const args = expr.args.map(a => value(a, seen));
        const base = expr.name.replace(/^(?:Math|NativeMath|Mathf)\./, '');
        if (['floor', 'ceil', 'round', 'trunc', 'abs', 'f64', 'f32', 'i32', 'i64', 'u32', 'nearest', 'fround', 'Number'].includes(base) && args.length === 1) return base === 'abs' && args[0].kind === 'q' && args[0].family === 'T' ? Q(args[0].dims, args[0].scale, args[0].affine === 'diff' ? 'diff' : null, 'T') : args[0];
        if (['isFinite', 'isNaN', 'isInteger'].includes(base)) return CODE;
        if (['min', 'max'].includes(base) && args.length === 2) return balance(args[0], args[1], `${base}()`) ?? join(args[0], args[1]);
        if (base === 'sqrt' && args[0]?.kind === 'q' && Object.values(args[0].dims).every(v => v % 2 === 0)) return Q(Object.fromEntries(Object.entries(args[0].dims).map(([k, v]) => [k, v / 2])));
        if (program.found.has(expr.name) && depth < 4 && expr.name !== fnName) {
          const callee = program.found.get(expr.name), inner = new Map(callee.params.map((p, i) => [p, args[i] ?? UNKNOWN]));
          return evaluate(program, expr.name, inner, imbalances, depth + 1);
        }
        return UNKNOWN;
      }
      case 'bin': {
        const a = value(expr.a, seen), b = value(expr.b, seen), op = expr.op, out = binaryValue(a, b, op);
        return out.kind === 'q' && [a, b].every(x => x.kind === 'literal' || x.definite) ? { ...out, definite: true } : out;
      }
      default: return UNKNOWN;
    }
  };
  const binaryValue = (a, b, op) => {
    {
        if (['&&', '||', '==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) { if (!['&&', '||'].includes(op)) balance(a, b, op); return CODE; }
        if (['|', '&', '^', '<<', '>>', '>>>'].includes(op)) return CODE;
        if (a.kind === 'unknown' || b.kind === 'unknown') return UNKNOWN;
        if (op === '+' || op === '-') {
          if (a.kind === 'literal' && b.kind === 'literal') return lit(op === '+' ? a.value + b.value : a.value - b.value);
          if (a.kind === 'code' || b.kind === 'code') return (a.kind === 'q' || b.kind === 'q') ? UNKNOWN : CODE;
          if (a.kind === 'literal' || b.kind === 'literal') { const q = a.kind === 'q' ? a : b; return q.family === 'T' && q.affine === 'point' ? Q(q.dims, null, null, 'T') : q; }
          if (!sameDims(a.dims, b.dims)) { balance(a, b, op); return UNKNOWN; }
          let affine = null;
          if (a.family && a.family === b.family && a.affine && b.affine) {
            if (op === '-') affine = a.affine === 'point' && b.affine === 'point' ? 'diff' : a.affine === 'point' && b.affine === 'diff' ? 'point' : a.affine === 'diff' && b.affine === 'diff' ? 'diff' : null;
            else affine = a.affine === 'diff' && b.affine === 'diff' ? 'diff' : a.affine !== b.affine ? 'point' : null;
          }
          return Q(a.dims, a.scale === b.scale ? a.scale : null, affine, a.family === b.family ? a.family : null);
        }
        if (op === '*' || op === '/' || op === '%') {
          if (a.kind === 'literal' && b.kind === 'literal') return lit(op === '*' ? a.value * b.value : op === '/' ? a.value / b.value : a.value % b.value);
          if (a.kind === 'code' && b.kind === 'code') return CODE;
          if (a.kind === 'code' && b.kind === 'literal') return op === '*' ? CODE : UNKNOWN;
          if (b.kind === 'code' && a.kind === 'literal') return op === '*' ? CODE : UNKNOWN;
          if (a.kind === 'code' || b.kind === 'code') return UNKNOWN;
          if (op === '%') return a.kind === 'q' ? a : UNKNOWN;
          if (a.kind === 'literal' || b.kind === 'literal') return [a, b].some(x => x.kind === 'literal' && Math.abs(x.value) === 1) ? (a.kind === 'literal' ? (op === '*' ? b : UNKNOWN) : a) : UNKNOWN;
          return Q(combine(a.dims, b.dims, op === '*' ? 1 : -1));
        }
        return UNKNOWN;
    }
  };
  function balance(a, b, op) {
    if (a.kind === 'q' && b.kind === 'q' && a.definite && b.definite && !sameDims(a.dims, b.dims)) { imbalances.push(`${fnName}: ${op} joins ${dimText(a.dims)} with ${dimText(b.dims)}`); return UNKNOWN; }
    return null;
  }
  const results = fn.returns.map(r => value(r));
  if (!results.length || results.some(r => !r)) return UNKNOWN;
  return results.reduce((x, y) => join(x, y));
}
const tokensOf = text => new Set(camel(String(text)).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1));
const overlap = (a, b) => { const y = tokensOf(b); return [...tokensOf(a)].filter(w => y.has(w)).length; };
const neverReturned = /\b(?:never (?:returned|emitted|produced|used)|reserved|unused)\b/i;
export function unitFindings(glue, { source = '', outputs = [] } = {}) {
  const problems = [], checks = {};
  let program = null;
  try { program = functions(source); } catch { program = null; }
  for (const entry of glue?.exports ?? []) {
    const fields = [...entry.args.map(arg => ({ field: `${entry.name}.${arg.name}`, name: arg.name, kind: arg.kind, unit: arg.unit })), { field: `${entry.name} result`, name: entry.name, kind: entry.result.kind, unit: entry.result.unit }];
    for (const f of fields) {
      const d = unitDimension(f.unit);
      if ((f.kind === 'code' || f.kind === 'boolean') && d && (Object.keys(d.dims).length || d.scale === 0.01)) problems.push(`K: ${f.field} is a ${f.kind} but its unit ${f.unit} is a physical quantity`);
      const n = nameDimension(f.name);
      if (n && d) {
        if (!sameDims(n.dims, d.dims)) problems.push(`N: ${f.field} unit ${f.unit} is ${dimText(d.dims)}, its name says ${dimText(n.dims)}`);
        else if (n.scale !== null && d.scale !== null && Math.abs(n.scale / d.scale - 1) > 1e-3) problems.push(`N: ${f.field} unit ${f.unit} has a different scale from its name`);
      }
    }
    entry.args.forEach((arg, a) => {
      const next = entry.args[a + 1];
      if (!next || arg.unit === next.unit) return;
      if (overlap(arg.name, next.unit) > overlap(arg.name, arg.unit) && overlap(next.name, arg.unit) > overlap(next.name, next.unit)) problems.push(`L: ${entry.name} units of ${arg.name} and ${next.name} fit their names better swapped`);
    });
    if (entry.result.codes) {
      const returned = new Set(outputs.filter(o => o.fn === entry.name && o.err === null).map(o => String(o.out)));
      for (const [code, label] of Object.entries(entry.result.codes)) if (neverReturned.test(label) && returned.has(code)) problems.push(`C: ${entry.name} labels code ${code} as never returned, and the frozen tests return it`);
    }
    if (!program?.found.has(entry.name)) { checks[entry.name] = 'no source'; continue; }
    const fn = program.found.get(entry.name);
    if (fn.params.length !== entry.args.length) { checks[entry.name] = 'arity'; continue; }
    const env = new Map(fn.params.map((p, i) => { const d = unitDimension(entry.args[i].unit); return [p, d ? { ...d, definite: true } : (entry.args[i].kind === 'code' || entry.args[i].kind === 'boolean') ? CODE : UNKNOWN]; }));
    const imbalances = [];
    let inferred = UNKNOWN;
    try { inferred = evaluate(program, entry.name, env, imbalances); } catch { inferred = UNKNOWN; }
    problems.push(...imbalances.map(x => `D: ${x}`));
    if (inferred.kind === 'code' || inferred.kind === 'literal') for (const arg of entry.args) if (arg.unit === entry.result.unit && tokensOf(arg.unit).size >= 2 && overlap(arg.name, arg.unit) > overlap(`${entry.name} ${entry.label}`, arg.unit)) problems.push(`R: ${entry.name} computes a new code but shows the unit of its argument ${arg.name}`);
    const declared = unitDimension(entry.result.unit);
    checks[entry.name] = inferred.kind === 'q' ? dimText(inferred.dims) + (inferred.affine ? ` ${inferred.affine}` : '') : inferred.kind;
    if (!declared) continue;
    if (inferred.kind === 'code' && (Object.keys(declared.dims).length || declared.scale === 0.01)) problems.push(`D: ${entry.name} returns a computed code, the glue shows ${entry.result.unit}`);
    else if (inferred.kind === 'q' && !sameDims(inferred.dims, declared.dims)) problems.push(`D: ${entry.name} returns ${dimText(inferred.dims)}, the glue shows ${entry.result.unit} (${dimText(declared.dims)})`);
    else if (inferred.kind === 'q' && inferred.definite && inferred.family && inferred.family === declared.family && inferred.affine === 'point' && declared.affine === 'diff') problems.push(`D: ${entry.name} returns a ${inferred.family === 'T' ? 'temperature' : 'time'} ${inferred.affine}, the glue shows a ${declared.affine} (${entry.result.unit})`);
  }
  return { problems, checks };
}
