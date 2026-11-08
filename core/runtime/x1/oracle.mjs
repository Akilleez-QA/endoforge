import vm from 'node:vm';
import { exportBlocks } from './contract.mjs';
import { maximumRelativeTolerance } from './gates.mjs';

export const referenceFile = 'reference.js';
export const relativeFloor = 1e-9;
export const referenceRule = `Also write ${referenceFile}: plain JavaScript defining one function per export, with the same name and parameters, that computes exactly what CONTRACT.md states in double precision using only Math and Number, and throws an Error wherever the contract traps. State each export's formula in CONTRACT.md as one line \`name = expression\` over its parameters (intermediate lines \`variable = expression\` are allowed). Every number test needs tol. The supervisor recomputes every expect from CONTRACT.md and ${referenceFile} before freezing.`;
const functions = { sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2, exp: Math.exp, pow: Math.pow, abs: Math.abs, min: Math.min, max: Math.max,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, floor: Math.floor, ceil: Math.ceil, hypot: Math.hypot };
const arity = { sqrt: [1, 1], cbrt: [1, 1], ln: [1, 1], log: [1, 1], log10: [1, 1], log2: [1, 1], exp: [1, 1], abs: [1, 1], sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1],
  floor: [1, 1], ceil: [1, 1], pow: [2, 2], atan2: [2, 2], min: [2, Infinity], max: [2, Infinity], hypot: [1, Infinity] };
const constants = { pi: Math.PI, PI: Math.PI, true: 1, false: 0 };
const conditional = /\b(?:if|when|unless|otherwise|else|where\s+\w+\s*[<>]|for\s+\w+\s*[<>])\b/i;
const bareGuard = /^\s*(?:[A-Z][\w ]{0,20}:\s+)?([A-Za-z_]\w*)\s+([-+]?\d+(?:\.\d+)?)\s+(?:uses?|returns?|means|is|gives|yields)\b\s*:?\s*/i;
const guard = /\b(?:if|when|whenever|unless|for)\s+([A-Za-z_]\w*)\s*(?:==?(?!=)|!=|≠|<=?|>=?|≤|≥|\bis\b|\bequals?\b|(?=[-+]?\d))|\b(?:otherwise|else)\b|^[^:=\n]*?(?:<=?|>=?|≤|≥|!=|≠)[^:=\n]*:(?!=)/i;
const clauses = text => text.split(/;\s*|\.\s+(?=[A-Za-z(])/);
export const guardOf = text => { const bare = bareGuard.exec(text.replace(/^\s*(?:[-*+>]|\d+[.)]|\(\w\))\s+/, '')); if (bare) return { subject: bare[1] }; const match = guard.exec(text); return match ? { subject: match[1] ?? null } : null; };

export function tokenize(text) {
  const source = String(text).replace(/Math\./g, '').replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3').replace(/\*\*/g, '^')
    .replace(/(?<![\d.,])(\d{1,3})((?:,\d{3}){2,})(?![\d,])/g, (_, head, groups) => head + groups.replace(/,/g, ''));
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|<|>|≤|≥|≠)|([-+*/^%(),])|(\S))/y;
  let match;
  while ((match = pattern.exec(source))) {
    const index = match.index + match[0].length - match[0].trimStart().length;
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]), index });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', value: match[2], index });
    else if (match[3] !== undefined) tokens.push({ kind: 'cmp', value: match[3], index });
    else if (match[4] !== undefined) tokens.push({ kind: 'op', value: match[4], index });
    else { tokens.push({ kind: 'stop', value: match[5], index }); break; }
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
        if (args.length < arity[token.value][0] || args.length > arity[token.value][1]) throw Error('arity');
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
  const relational = () => {
    const left = additive();
    if (peek()?.kind !== 'cmp') return left;
    const cmp = tokens[at++].value;
    return { cmp, left, right: additive() };
  };
  try {
    const tree = relational(), next = peek();
    if (next?.kind === 'cmp') return null;
    if (next?.kind === 'op' && next.value !== ',' && next.value !== '(') return null;
    if (next?.kind === 'number') return null;
    const rest = next ? tokens.source.slice(next.index).split(/\.(?:\s|$)/)[0] : '';
    const prose = next?.kind === 'op' && next.value === ',' ? (/^,\s*(?:shown|displayed|rounded|show|display)\b[^,]*\bdecimal/i.test(rest) ? rest.replace(/^,[^,]*\bdecimal\s+places?/i, '').split(',')[0]
      : /^,\s*(?:in|as|expressed|measured|with|where|using)\b/i.test(rest) ? rest.slice(1).split(',')[0] : rest) : rest;
    if (/\d|=/.test(prose)) return null;
    return { tree, complete: !next, names: namesOf(tree), comparison: Boolean(tree.cmp) };
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
  if (tree.cmp) {
    const a = evaluateTree(tree.left, env), b = evaluateTree(tree.right, env);
    return Number({ '<': a < b, '<=': a <= b, '≤': a <= b, '>': a > b, '>=': a >= b, '≥': a >= b, '==': a === b, '!=': a !== b, '≠': a !== b }[tree.cmp]);
  }
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
const validCase = /^(?:all\s+|any\s+|every\s+)?(?:valid|finite|accepted|permitted|supported|allowed|in-range)\b/i;
const trapValue = /^\s*(?:it\s+|the\s+kernel\s+|the\s+function\s+)?(?:must\s+)?(?:traps?|aborts?|throws?|errors?|rejects?|is\s+invalid)\b/i;
const caseShape = /^\s*[A-Za-z_]\w*\s*(?:==?|!=|≠|<|>|≤|≥|\bis\b|\bequals?\b|[-+]?\d)/i;
function guardIn(clause) {
  const text = clause.replace(bullet, '');
  let m;
  if ((m = /^\W*(?:otherwise|else)\b[,:]?\s*(?:it\s+)?(.*)$/is.exec(text))) return { guard: { otherwise: true }, value: m[1], bare: true };
  if ((m = bareGuard.exec(text))) return { guard: { cond: `${m[1]} == ${m[2]}`, subject: m[1] }, value: text.slice(m[0].length), bare: true, subjectOnly: true };
  if ((m = /^\W*(?:[A-Z][\w ]{0,20}:\s+)?(?:and\s+|or\s+|but\s+)?(?:exactly\s+|only\s+)?(if|when|whenever|unless|for)\s+(.+?)(?:\s*,\s*(?:then\s+)?|\s*:(?!=)\s*|\s+then\s+)(.*)$/is.exec(text))) {
    if (validCase.test(m[2])) return { guard: null, value: m[3] };
    return { guard: { cond: m[2], negate: /unless/i.test(m[1]) }, value: m[3], bare: true };
  }
  if ((m = /^([^:=\n]*?(?:<=?|>=?|≤|≥|!=|≠)[^:=\n]*):(?!=)\s*(.*)$/s.exec(text))) return { guard: { cond: m[1] }, value: m[2], bare: true };
  if ((m = /^(.*?\S)\s*,?\s+(exactly\s+|only\s+)?(if|when|whenever|unless|for)\s+(.+)$/is.exec(text)) && !/(?:^|[^<>=!])=(?!=)/.test(m[4])) {
    if (validCase.test(m[4])) return { guard: null, value: m[1] };
    if (/for/i.test(m[3]) && !caseShape.test(m[4]) && !/\b(?:or|otherwise)\b[^.]*\bfor\b/i.test(m[4]) && !/[-+*/×^]\s*[\w.()]+\s*$/.test(m[1])) return null;
    return { guard: { cond: m[4], negate: /unless/i.test(m[3]) }, value: m[1], exact: /exactly/i.test(m[2] ?? '') };
  }
  return null;
}
function codeList(clause) {
  const m = /^.*?\b(?:returns?|codes?|results?)\b\s*(?:code\s+)?:?\s*([-+]?\d.*)$/is.exec(clause);
  if (!m) return null;
  const items = m[1].split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+(?=[-+]?\d+(?:\.\d+)?\s+(?:for|when|if)\b)/).filter(Boolean)
    .map(item => /^([-+]?\d+(?:\.\d+)?)\s+(?:for|when|if)\s+(.+?)\.?\s*$/is.exec(item));
  if (items.length < 2 || items.some(item => !item)) return null;
  return items.map(item => ({ value: item[1], cond: item[2] }));
}
const operand = '(-?\\d+(?:\\.\\d+)?|[A-Za-z_]\\w*)';
function wordOperators(text, parameters) {
  const known = word => /^-?\d/.test(word) || parameters.includes(word);
  let out = text.replace(new RegExp(`\\bthe\\s+(?:exact\\s+)?(?:mathematical\\s+)?(sum|product|difference|quotient)\\s+of\\s+${operand}\\s+and\\s+${operand}\\b`, 'gi'),
    (all, kind, a, b) => known(a) && known(b) ? `(${a} ${{ sum: '+', product: '*', difference: '-', quotient: '/' }[kind.toLowerCase()]} ${b})` : all);
  for (let pass = 0; pass < 4; pass++) out = out.replace(new RegExp(`${operand}\\s+(plus|minus|times|divided\\s+by|multiplied\\s+by)\\s+${operand}\\b`, 'i'),
    (all, a, word, b) => known(a) && known(b) ? `${a} ${{ plus: '+', minus: '-', times: '*' }[word.toLowerCase()] ?? (/divided/i.test(word) ? '/' : '*')} ${b}` : all);
  return out;
}
const identityTail = /^([A-Za-z_]\w*)\s+(?:unchanged|as[- ]is|itself|in\s+both\s+states|in\s+all\s+(?:valid\s+)?cases|for\s+every\s+(?:valid\s+|accepted\s+)?input|always)\b/i;
const suppliedValue = /^the\s+(?:supplied|input|given|validated|verified|same)(?:\s+(?:verified|validated|input|supplied))?(?:\s+(?:value|code|id|identifier|number|input|flag|ordinal|slot))?(?:\s+(?:unchanged|as\s+a\s+code|as\s+is))?\s*(?:[:.,;]|$)/i;
const universal = [/\breturns?\s+(?:code\s+)?(-?\d+(?:\.\d+)?)\b(?=[^.;]*\b(?:for\s+(?:every|all|any)\s+(?:valid\s+|accepted\s+)?inputs?|in\s+all\s+(?:valid\s+)?cases|always)\b)/i,
  /\balways\s+(?:returns?\s+)?(?:code\s+)?(-?\d+(?:\.\d+)?)\b/i, /\bevery\s+(?:valid|accepted)\s+input\s+returns\s+(?:code\s+)?(-?\d+(?:\.\d+)?)\b/i, /\bthen\s+returns?\s+(?:code\s+)?(-?\d+(?:\.\d+)?)\b(?!\s*(?:if|when|for)\b)/i];
function joinWrapped(lines, exported = []) {
  const declared = new RegExp(`(?:^|[\\s\`])(?:${exported.map(name => name.replace(/\W/g, '')).join('|') || '\\0'})\\s*\\([^()]*\\)[^()]*:\\s*$`);
  const out = [];
  for (const raw of lines) {
    const last = out.at(-1), open = last ? (last.text.match(/\(/g) ?? []).length - (last.text.match(/\)/g) ?? []).length : 0;
    if (last && /^\s+\S/.test(raw) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(raw) && (open > 0 || /[-+*/×(=]\s*$/.test(last.text) || declared.test(last.text))) last.text += ' ' + raw.trim();
    else out.push({ text: raw });
  }
  return out.map(entry => entry.text);
}
function statements(rawLines, parameters = [], exported = []) {
  const out = [];
  joinWrapped(rawLines, exported).forEach((raw, line) => {
    const text = wordOperators(raw.replace(/\*\*/g, ''), parameters);
    const pieces = [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    const signed = new RegExp(`^(?:export\\s+)?(?:function\\s+)?(?:${exported.map(name => name.replace(/\W/g, '')).join('|') || '\\0'})\\s*\\([^()]*\\)\\s*(?:(?::\\s*[A-Za-z_]\\w*|->\\s*[A-Za-z_]\\w*)\\s*(?::|—|–)|(?::|—|–)(?!\\s*(?:f32|f64|i32|i64|u32|u64|bool|boolean|number|void|string|int|float|double|code)\\b))\\s+(?!returns?\\b)(?=\\S)`);
    const body = text.replace(/`/g, '').replace(bullet, '').replace(/^\s*[A-Z][\w ,()'/-]{0,40}:\s+(?=[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*(?::\s*\w+)?\s*=[^=])/, '')
      .replace(signed, 'returns ').replace(/^\s*(?:formula|computation|calculation)\s*:\s+/i, 'returns ');
    for (const pattern of universal) { const m = pattern.exec(body); if (m && !guardOf(body)) { out.push({ line, kind: 'result', text: m[1], guard: null, constant: true }); break; } }
    for (const name of exported) { const m = new RegExp(`\\b${name}\\s*\\([^()]*\\)\\s*=(?![=<>])\\s*([^;]+?)(?:[,;]\\s+(?:using|with|where|for)\\b.*)?\\.?$`).exec(body); if (m && !/^\s*${name}/.test(body)) out.push({ line, kind: 'assign', name, text: m[1], guard: null }); }
    const segments = clauses(body).flatMap(clause => clause.split(/,\s*(?=(?:otherwise|else)\b)/i)).map(clause => {
      const found = guardIn(clause);
      if (!found) return { clause, value: clause, guard: guardOf(clause) || conditional.test(clause) ? { cond: null } : null };
      let { guard, value } = found;
      if (guard?.otherwise && value && guardIn(value)?.guard) return { clause, ...found, value: guardIn(value).value, guard: { cond: null } };
      const inner = guard && !guard.otherwise && value ? guardIn(value) : null;
      if (inner?.guard) {
        guard = inner.guard.otherwise || guard.negate || inner.guard.negate || guard.cond == null || inner.guard.cond == null ? { cond: null } : { cond: `${guard.cond} and ${inner.guard.cond}` };
        value = inner.value;
      }
      return { clause, ...found, value, guard: guard && found.subjectOnly && !inner ? { ...guard, subjectOnly: true } : guard };
    });
    segments.forEach((segment, i) => { if (segment.guard?.otherwise && !segments.slice(0, i).some(earlier => earlier.guard && !earlier.guard.otherwise)) segment.guard = { cond: null }; });
    for (const segment of segments) if (!segment.guard && pieces.some(piece => new RegExp(`${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+for\\s+(?!valid\\b|finite\\b|all\\b|any\\b|each\\b|every\\b|example\\b|display\\b|the\\b|this\\b|that\\b|a\\b|an\\b)[A-Za-z]`, 'i').test(segment.clause))) segment.guard = { cond: null };
    const segmentOf = piece => segments.find(segment => segment.clause.includes(piece.trim()));
    const parts = [], start = out.length;
    for (const segment of segments) {
      const list = codeList(segment.clause);
      if (list) { segment.listed = true; for (const item of list) out.push({ line, kind: 'result', text: item.value, guard: { cond: item.cond } }); continue; }
      if (segment.guard?.subjectOnly && segment.value && trapValue.test(segment.value)) continue;
      if (segment.guard && trapValue.test(segment.value)) continue;
      parts.push({ text: segment.value, quoted: false, guard: segment.guard, bare: segment.bare });
      const flip = { true: 'false', false: 'true', 1: '0', 0: '1' };
      const exactValue = segment.exact && segment.guard?.cond ? /(?:^|\s)(?:returns?\s+)?(true|false|[01])\s*$/i.exec(segment.value.replace(/^.*?\breturns?\b/i, 'returns')) : null;
      if (exactValue) out.push({ line, kind: 'result', text: flip[exactValue[1].toLowerCase()], guard: { cond: segment.guard.cond, negate: !segment.guard.negate } });
    }
    for (const piece of pieces) { const segment = segmentOf(piece); parts.push({ text: piece, quoted: true, guard: segment?.guard ?? null }); }
    const split = parts.flatMap(part => part.text.split(/;\s*|,\s*(?:with|where)\s+|,\s+(?=[A-Za-z_]\w*\s*=[^=])/).map((text, i, all) => ({ ...part, text, bare: part.bare && all.length === 1 })));
    for (const { text: piece, quoted, guard, bare } of split) {
      const fallback = text => guard ?? (conditional.test(text) ? { cond: null } : null);
      const assignment = /^\s*([A-Za-z_]\w*)\s*(?:\(([^()]*)\))?\s*(?::\s*[A-Za-z_]\w*)?\s*=(?![=<>])\s*(.+)$/.exec(piece);
      if (assignment) { out.push({ line, kind: 'assign', name: assignment[1], text: assignment[3], guard: assignment[2] !== undefined && Object.hasOwn(functions, assignment[1]) ? { cond: null } : fallback(assignment[3]) }); continue; }
      const returned = /(?:^|\s)(?:returns?|computes?|(?:the\s+)?result\s+is|equals|using)\s*:?\s*(.+)$/i.exec(piece);
      if (returned) {
        const value = returned[1].replace(/`/g, '').trim(), same = identityTail.exec(value);
        if (same && parameters.includes(same[1])) out.push({ line, kind: 'result', text: same[1], guard: fallback(piece), identity: true });
        else if (parameters.length === 1 && suppliedValue.test(value)) out.push({ line, kind: 'result', text: parameters[0], guard: fallback(piece), identity: true });
        else out.push({ line, kind: 'result', text: value, guard: fallback(piece) });
        continue;
      }
      const continued = /^\s*=(?![=<>])\s*(.+)$/.exec(piece);
      if (continued) { out.push({ line, kind: 'result', text: continued[1], guard: fallback(continued[1]) }); continue; }
      const plain = piece.replace(/[.,;:]\s*$/, '').trim();
      if (bare && guard && parseExpression(plain)?.complete) { out.push({ line, kind: 'result', text: plain, guard }); continue; }
      if (quoted || /^\s{4,}\S|^\t/.test(raw)) out.push({ line, kind: 'expression', text: piece, guard: fallback(piece) });
    }
    const produced = out.slice(start).map(s => s.guard);
    const silent = segments.some(segment => segment.guard && !segment.listed && !segment.guard.otherwise && !produced.includes(segment.guard) && !(segment.guard.subjectOnly && trapValue.test(segment.value)));
    if (silent) for (const s of out.slice(start)) if (s.guard?.otherwise) s.guard = { cond: null };
  });
  return out;
}

const relation = /(==|!=|≠|<=|>=|≤|≥|<|>|=|\bis\s+not\b|\bis\b|\bequals?\b)/i;
const compare = { '==': (a, b) => a === b, '=': (a, b) => a === b, is: (a, b) => a === b, equals: (a, b) => a === b, equal: (a, b) => a === b, '!=': (a, b) => a !== b, '≠': (a, b) => a !== b, 'is not': (a, b) => a !== b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '≤': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '≥': (a, b) => a >= b };
function operandOf(text, resolve) {
  const parsed = parseExpression(text.trim());
  if (!parsed?.complete) return null;
  const rename = tree => tree.name !== undefined ? (Object.hasOwn(constants, tree.name) ? tree : resolve(tree.name) ? { name: resolve(tree.name) } : null)
    : tree.number !== undefined ? tree : tree.call ? (tree.args.map(rename).every(Boolean) ? { call: tree.call, args: tree.args.map(rename) } : null)
      : (() => { const left = rename(tree.left), right = tree.right ? rename(tree.right) : undefined; return left && right !== null ? { op: tree.op, left, right } : null; })();
  return rename(parsed.tree);
}
function atomOf(atom, resolve) {
  let pieces = atom.trim().split(relation);
  if (pieces.length === 1) { const m = /^([A-Za-z_]\w*)\s+([-+]?\d+(?:\.\d+)?)$/.exec(atom.trim()); if (!m) return null; pieces = [m[1], '==', m[2]]; }
  const operands = pieces.filter((_, i) => i % 2 === 0).map(text => operandOf(text, resolve)), ops = pieces.filter((_, i) => i % 2 === 1).map(op => op.trim().toLowerCase().replace(/\s+/g, ' '));
  if (operands.some(o => !o) || !ops.every(op => Object.hasOwn(compare, op)) || !operands.some(o => namesOf(o).size)) return null;
  return env => { try { return ops.every((op, i) => compare[op](evaluateTree(operands[i], env), evaluateTree(operands[i + 1], env))); } catch { return undefined; } };
}
export function guardTest(guard, parameters) {
  if (!guard || guard.cond == null) return null;
  const lower = new Map();
  for (const name of parameters) { const key = name.toLowerCase(); lower.set(key, lower.has(key) ? null : name); }
  const resolve = name => parameters.includes(name) ? name : lower.get(name.toLowerCase()) ?? null;
  const text = guard.cond.replace(/`/g, '').replace(/\s*\((?![^()]*[-+*/^<>=])[^()]*\)/g, '').replace(/[.,;:]\s*$/, '').trim();
  const alternatives = text.split(/\s+or\s+/i).map(part => part.split(/\s+and\s+/i).map(atom => atomOf(atom, resolve)));
  if (alternatives.some(atoms => atoms.some(atom => !atom))) return null;
  return env => { const values = alternatives.map(atoms => atoms.map(atom => atom(env))); if (values.flat().some(v => v === undefined)) return undefined; const hit = values.some(atoms => atoms.every(Boolean)); return guard.negate ? !hit : hit; };
}

export function formulaReference(contract, fn, parameters) {
  const nullary = [...contract.matchAll(/`([A-Za-z_]\w*)\(\)\s*(?::\s*[A-Za-z_]\w*|->\s*[A-Za-z_]\w*)?`/g)].map(m => m[1]).filter(name => !Object.hasOwn(functions, name));
  const exported = [...contractSignatures(contract).keys(), fn, ...nullary].filter((name, i, all) => all.indexOf(name) === i), signatureCount = exported.length;
  const { blocks, shared } = exportBlocks(contract, exported);
  const scope = [...shared.map(text => ({ text, own: false })), ...(blocks[fn] ?? []).map(text => ({ text, own: true }))];
  const own = statements(scope.filter(entry => entry.own).map(entry => entry.text), parameters, exported).map(s => ({ ...s, own: true, group: `own:${s.line}` }));
  const common = statements(scope.filter(entry => !entry.own).map(entry => entry.text), parameters, exported).map(s => ({ ...s, own: false, group: `shared:${s.line}` }));
  const params = new Set(parameters);
  const parsedAll = [...common, ...own].map(s => ({ ...s, parsed: parseExpression(s.text) })).filter(s => s.parsed && !(s.parsed.comparison && s.kind === 'expression'))
    .filter(s => !s.guard?.subjectOnly || guardTest(s.guard, parameters)).filter(s => s.own || !(s.constant || s.identity))
    .map(s => ({ ...s, test: guardTest(s.guard, parameters) }));
  const assignedNames = new Set(parsedAll.filter(s => s.kind === 'assign').map(s => s.name));
  const evaluable = s => [...s.parsed.names].every(name => params.has(name) || assignedNames.has(name) || Object.hasOwn(constants, name));
  const operative = s => !s.parsed.tree.name && s.parsed.tree.number === undefined;
  const used = new Set(parsedAll.flatMap(s => [...s.parsed.names]));
  const formulaText = scope.map(entry => entry.text).filter(text => /[^<>=!]=[^=]/.test(text)).join('\n');
  const single = signatureCount <= 1, mentioned = parameters.filter(name => new RegExp(`\\b${name}\\b`).test(formulaText));
  return args => {
    if (args.length !== parameters.length || !args.every(Number.isFinite)) return null;
    const given = Object.fromEntries(parameters.map((name, i) => [name, args[i]]));
    const stateOf = s => {
      if (!s.guard) return true;
      if (s.guard.otherwise) {
        const siblings = parsedAll.filter(t => t.group === s.group && t.guard && !t.guard.otherwise).map(t => t.test ? t.test(given) : undefined);
        return !siblings.length || siblings.some(v => v === undefined) ? undefined : !siblings.some(Boolean);
      }
      return s.test ? s.test(given) : undefined;
    };
    const states = parsedAll.map(stateOf);
    const all = parsedAll.filter((s, i) => states[i] === true), skipped = parsedAll.filter((s, i) => states[i] === undefined && evaluable(s));
    const branch = all.some(s => s.guard);
    const computed = new Set(all.filter(s => s.kind === 'assign' && s.parsed.names.size).map(s => s.name));
    const assigns = all.filter(s => s.kind === 'assign' && !params.has(s.name) && s.name !== fn && (s.parsed.names.size || !computed.has(s.name) || s.guard));
    const direct = all.filter(s => (s.kind === 'assign' && s.name === fn) || (s.kind === 'result' && (s.guard || s.identity || s.constant || operative(s) || !params.has(s.parsed.tree.name))) || (s.kind === 'expression' && s.parsed.complete && operative(s) && [...s.parsed.names].some(name => params.has(name))));
    const dependsOn = (variable, parameter, seen = new Set()) => {
      if (variable === parameter) return true;
      if (seen.has(variable)) return false;
      seen.add(variable);
      return assigns.filter(s => s.name === variable).some(s => [...s.parsed.names].some(name => dependsOn(name, parameter, seen)));
    };
    const targets = [...new Set(assigns.map(s => s.name))];
    const conditionalNames = new Set(skipped.filter(s => s.kind === 'assign').map(s => s.name));
    const env = { ...given }, tainted = new Set(parameters), conflicted = new Set();
    const abstention = () => conflicted.size ? `conflicting definitions of ${[...conflicted].join(', ')}`
      : skipped.length ? 'conditional or piecewise rule' : branch ? 'piecewise branch not evaluable' : null;
    for (let pass = 0; pass < 2; pass++) for (const name of targets) {
      if (conflicted.has(name)) continue;
      const readings = [];
      let fromParameter = false;
      for (const s of assigns.filter(a => a.name === name)) {
        try {
          const value = evaluateTree(s.parsed.tree, { ...env, [name]: undefined });
          if (Number.isFinite(value)) { readings.push(value); if (s.guard || [...s.parsed.names].some(n => tainted.has(n))) fromParameter = true; }
        } catch { }
      }
      if (!readings.length) continue;
      if (readings.some(value => !close(value, readings[0])) || conditionalNames.has(name)) { conflicted.add(name); delete env[name]; tainted.delete(name); continue; }
      env[name] = readings[0];
      if (fromParameter) tainted.add(name);
    }
    const values = [];
    const consider = s => {
      if (!(s.guard || s.constant || [...s.parsed.names].some(name => tainted.has(name)))) return;
      try { const value = evaluateTree(s.parsed.tree, env); if (Number.isFinite(value)) values.push(value); } catch { }
    };
    direct.forEach(consider);
    if (!values.length) {
      const sinks = single ? assigns.filter(s => !used.has(s.name) && tainted.has(s.name) && mentioned.every(name => dependsOn(s.name, name))) : [];
      const names = [...new Set(sinks.map(s => s.name))];
      if (names.length === 1) values.push(env[names[0]]);
    }
    if (values.length && values.some(value => !close(value, values[0])) && conflicted.size) return { abstain: abstention() };
    if (values.length) return values;
    const reason = abstention();
    return reason ? { abstain: reason } : null;
  };
}

const comparison = '(<=|≤|<)';
const numberText = '(-?(?:\\d{1,3}(?:[, ]\\d{3})+(?!\\d)|\\d+)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?!\\d|\\.\\d|[eE][-+\\d]|\\s\\d)';
const num = text => Number(text.replace(/[, ]/g, ''));
const trapClause = /\b(?:traps?|trapping|aborts?|rejects?|throws?|errors?|invalid)\b/i;
const domainLine = /\b(?:valid|domain|range|bounds?|must|traps?|aborts?|allowed|accepts?|inputs?|limits?|outside|inclusive|exclusive|between|through)\b/i;
const notDomain = /\b(?:returns?|gives|yields|labels?|means|classif\w*|category|categories|codes?)\b|["“]|\d\s*=\s*[A-Za-z]/i;
const unitDependent = /\bequivalent\w*|\bsupplied unit\b|\beither unit\b|\bdepend\w*\b|\bper unit\b|\bunit\s+(?:code\s+)?[-+]?\d/i;
const collective = /^\W*(?:both|each|all|every|any)\b(?:\s+\w+){0,2}?\s+(?:inputs?|arguments?|parameters?|values?|args?)\b/i;
const intervals = [
  [new RegExp(`([\\[(])\\s*${numberText}\\s*,\\s*${numberText}\\s*([\\])])`, 'g'), m => [num(m[2]), m[1] === '(', num(m[3]), m[4] === ')']],
  [new RegExp(`(?<![\\d.])${numberText}\\s*(?:\\.\\.|–|—)\\s*${numberText}`, 'g'), m => [num(m[1]), false, num(m[2]), false]],
  [new RegExp(`(?:\\bfrom\\s+${numberText}\\s+(?:through|to)\\s+${numberText}|(?<![\\d.])${numberText}\\s+through\\s+${numberText})`, 'g'), m => m[1] !== undefined ? [num(m[1]), false, num(m[2]), false] : [num(m[3]), false, num(m[4]), false]],
  [new RegExp(`\\bbetween\\s+${numberText}\\s+and\\s+${numberText}`, 'g'), m => [num(m[1]), false, num(m[2]), false]],
];
const valueSet = /\b(?:must\s+be|is|are|accepts?|accepted\s+values\s+are|only)\s+(?:exactly\s+|either\s+|one\s+of\s+)?(-?\d+)((?:\s*,\s*-?\d+)*)\s*,?\s+or\s+(-?\d+)\b(?!\s*(?:\.\d|[A-Za-z%°]))/gi;
function ownLines(contract, names, fn) {
  const lines = contract.split('\n'), declares = name => new RegExp(`\`${name}\\s*\\(|\\bfunction\\s+${name}\\s*\\(|^\\s*(?:[-*+]\\s+|\\d+[.)]\\s*)?${name}\\s*\\(`);
  const mention = line => names.filter(name => declares(name).test(line) || new RegExp(`\`${name}\`|^\\s*(?:[-*+]\\s+)?${name}\\s*:`).test(line));
  let current = null, strict = null, bulletBlock = false;
  return lines.map(line => {
    const named = mention(line);
    if (named.length === 1) current = named[0];
    else if (named.length > 1 || /^#/.test(line)) current = null;
    const signature = names.filter(name => declares(name).test(line));
    if (signature.length === 1) strict = signature[0];
    else if (named.length || !/^\s{2,}\S|^\s*[-*+]\s/.test(line) || (/^[-*+]\s/.test(line) && !bulletBlock)) strict = null;
    bulletBlock = signature.length === 1 ? !/^\s*[-*+]\s/.test(line) : bulletBlock && strict !== null;
    return { line, owner: current, strict: named.length === 1 ? named[0] : strict };
  }).filter(entry => !fn || entry.owner === null || entry.owner === fn);
}
export function rangeRules(contract, parameters, skipped = [], fn = null, loose = []) {
  const rules = [];
  let clauseGuard = null;
  const signatures = fn ? [...new Set([...contractSignatures(contract).keys(), fn])] : [];
  const add = (name, lo, loOpen, hi, hiOpen) => {
    if (!parameters.includes(name) || !(lo <= hi)) return;
    if (clauseGuard && clauseGuard.subject !== name) { skipped.push({ name, lo, loOpen, hi, hiOpen, guard: clauseGuard.subject }); return; }
    if (!rules.some(rule => rule.name === name && rule.lo === lo && rule.hi === hi && rule.loOpen === loOpen && rule.hiOpen === hiOpen)) rules.push({ name, lo, loOpen, hi, hiOpen });
  };
  const addSet = (name, values) => {
    if (!parameters.includes(name)) return;
    if (clauseGuard && clauseGuard.subject !== name) { skipped.push({ name, values, guard: clauseGuard.subject }); return; }
    if (!rules.some(rule => rule.name === name && JSON.stringify(rule.values) === JSON.stringify(values))) rules.push({ name, values });
  };
  const lower = new Map();
  for (const name of parameters) { const key = name.toLowerCase(); lower.set(key, lower.has(key) ? null : name); }
  const subjectsBefore = (before, owned, first) => {
    const words = [...before.matchAll(/[A-Za-z_]\w*/g)].filter(w => lower.get(w[0].toLowerCase()));
    const last = words.at(-1);
    if (last) {
      const gap = before.slice(last.index + last[0].length), lead = before.slice(0, last.index).trimEnd();
      if (gap.length <= 45 && !/[\d=<>+*/^×÷,]|\.\.|\]|\b[a-z]+[A-Z_]\w*/.test(gap) && !/[-+*/^×÷]$/.test(lead)) return [lower.get(last[0].toLowerCase())];
      return [];
    }
    if (owned && first && /\d|\.\./.test(before) === false) {
      if (collective.test(before)) return parameters;
      if (parameters.length === 1 && !/\b(?:results?|outputs?|sums?|products?|values?\s+returned)\b/i.test(before)) return parameters;
    }
    return [];
  };
  const entries = ownLines(contract, signatures, fn);
  if (fn && entries.some(entry => entry.strict === fn && /\b(?:never|does\s+not|doesn't|cannot|no)\s+traps?\b|\bwithout\s+trapping\b/i.test(entry.line))) return rules;
  let section = false;
  for (const { line: raw, strict } of entries) {
    const line = raw.replace(/\*\*/g, '').replace(/(?:message|with|text)?\s*:?\s*(?:"[^"\n]*"|“[^”\n]*”)/gi, ' ').replace(/`/g, '');
    if (/^\s*#/.test(line)) { section = domainLine.test(line) && !notDomain.test(line); continue; }
    if (!section && !domainLine.test(line) && !/^\s*[-*]\s+[A-Za-z_]\w*\s*:/.test(line)) continue;
    if (notDomain.test(line) || unitDependent.test(line)) continue;
    const owned = Boolean(fn) && (strict === fn || signatures.length <= 1);
    for (const sentence of clauses(line)) {
      const clause = sentence.replace(bullet, '').replace(/\s*\((?=[^()]*[A-Za-z]{2})[^()\d\[\]]*\)/g, '');
      clauseGuard = trapClause.test(clause) ? null : guardOf(clause);
      if (clauseGuard && !clauseGuard.subject) clauseGuard = null;
      const leading = /^\W*(?:and\s+|or\s+|but\s+)?(?:if|when|whenever|unless|for)\s+([^,]+?)\s*,/i.exec(clause);
      if (!clauseGuard && !trapClause.test(clause) && leading && !validCase.test(leading[1])) clauseGuard = { subject: '\0' };
      const taken = [];
      for (const m of clause.matchAll(new RegExp(`${numberText}\\s*${comparison}\\s*([A-Za-z_]\\w*)\\s*${comparison}\\s*${numberText}`, 'g'))) {
        taken.push([m.index, m.index + m[0].length]);
        if (m[3] === 'x' || m[3] === 'value') { const owner = /^\s*[-*]?\s*([A-Za-z_]\w*)\s*:/.exec(line); if (owner) add(owner[1], num(m[1]), m[2] === '<', num(m[5]), m[4] === '<'); continue; }
        add(m[3], num(m[1]), m[2] === '<', num(m[5]), m[4] === '<');
      }
      const found = [];
      for (const [pattern, bounds] of intervals) for (const m of clause.matchAll(pattern)) {
        const span = [m.index, m.index + m[0].length];
        if ([...taken, ...found.map(f => f.span)].some(([a, b]) => span[0] < b && a < span[1])) continue;
        found.push({ span, bounds: bounds(m) });
      }
      for (const m of clause.matchAll(valueSet)) {
        const span = [m.index, m.index + m[0].length];
        if ([...taken, ...found.map(f => f.span)].some(([a, b]) => span[0] < b && a < span[1])) continue;
        found.push({ span, values: [m[1], ...(m[2].match(/-?\d+/g) ?? []), m[3]].map(Number) });
      }
      found.sort((a, b) => a.span[0] - b.span[0]);
      let from = 0;
      for (const { span, bounds, values } of found) {
        const before = clause.slice(from, span[0]), first = from === 0;
        from = span[1];
        const subjects = subjectsBefore(before, owned, first);
        for (const name of subjects) values ? addSet(name, values) : add(name, ...bounds);
        const hints = [...before.matchAll(/[A-Za-z]{4,}/g)].map(w => w[0].toLowerCase()).filter(w => !/^(?:must|finite|valid|values?|inputs?|range|inclusive|exclusive|within|between|from|through|outside|bounds?|each|both|every|with|that|this|trap|traps|when|either)$/.test(w));
        const hinted = parameters.filter(name => hints.some(w => name.toLowerCase().includes(w.replace(/s$/, ''))));
        if (!subjects.length && bounds && !clauseGuard && hinted.length) loose.push({ names: hinted, lo: bounds[0], loOpen: bounds[1], hi: bounds[2], hiOpen: bounds[3] });
      }
    }
  }
  return rules;
}
const extraTrap = /resulting|results?\s+(?:must|outside|exceeds?|above|below|is\s+(?:above|below|outside))|outputs?\s+(?:must|outside|exceeds?|above|below|range|bound)|quotient|\bexceed|overflow|divi\w+ by zero|\b[a-z]\w*\s*(?:<=?|>=?|≤|≥)\s*[a-z]\w*\b|at (?:least|most)\s+[a-z]|not\s+(?:exceed|greater|less)|midnight|\b(?:equal|equals|match|matches|matching|differ|differs)\s+(?:the\s+)?[a-z]\w*[A-Z_]\w*/;
const integral = /\binteger|whole number|fraction(?:al)?\b|non-?integ/i;
const conditionalTrap = /\b(?:if|when|unless|whenever)\b[^.;]*\b(?:throw|traps?|abort|error|reject|must)|\b(?:throw|traps?|aborts?|rejects?)\b[^.;]*\b(?:if|when|unless|whenever)\b/i;
const rangeTrap = /outside|range|bounds?|\[|\.\.|non-?finite|invalid|nan\b|infinit|violat|out of|not in|exceeds?|below|above|negative/i;
export function domainComplete(contract, fn, parameters, rules, args) {
  if (!parameters.every(name => rules.some(rule => rule.name === name))) return false;
  const names = [...new Set([...contractSignatures(contract).keys(), fn])], { blocks, shared } = exportBlocks(contract, names);
  const text = [...shared, ...(blocks[fn] ?? [])].join('\n');
  if (extraTrap.test(text) || (integral.test(text) && !args.every(Number.isInteger))) return false;
  const constrained = [...text.matchAll(/\b([A-Za-z_]\w*)\s*(?:must\s+be\s*|is\s*)?(?:<=?|>=?|≤|≥|≠|!=)\s*-?\d|\b([A-Za-z_]\w*)\s+must\s+(?:be\s+)?(?:positive|negative|non-?zero|non-?negative|greater|less|strictly|above|below|differ)/g)].map(m => m[1] ?? m[2]);
  if (constrained.some(name => !parameters.includes(name) && !/^(?:x|value|it|result|code|codes|and|or)$/i.test(name))) return false;
  return !text.split(/[.;\n]/).some(clause => conditionalTrap.test(clause) && !rangeTrap.test(clause));
}
export function outsideRange(rules, parameters, args) {
  return rules.some(rule => {
    const value = args[parameters.indexOf(rule.name)];
    if (!Number.isFinite(value)) return false;
    if (rule.values) return !rule.values.includes(value);
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
  const formulas = {}, ranges = {}, skippedRanges = {}, looseRanges = {};
  for (const fn of fnNames) {
    const parameters = signatures.get(fn);
    if (!parameters) continue;
    formulas[fn] = formulaReference(contract, fn, parameters);
    ranges[fn] = rangeRules(contract, parameters, skippedRanges[fn] = [], fn, looseRanges[fn] = []);
  }
  const decisions = tests.map((test, index) => {
    if (!test || typeof test !== 'object' || !Array.isArray(test.args) || typeof test.fn !== 'string') return { index, status: 'unverified', why: 'malformed' };
    const literal = test.expectError === true ? { trap: true } : { value: test.expect }, tol = Number.isFinite(test.tol) ? test.tol : 0;
    if (!test.expectError && typeof test.expect === 'string') return { index, status: 'unverified', why: 'string result' };
    const opinions = [], abstentions = [];
    const numeric = test.args.every(Number.isFinite), parameters = signatures.get(test.fn);
    if (numeric && parameters) {
      if (ranges[test.fn]?.length && outsideRange(ranges[test.fn], parameters, test.args)) opinions.push({ source: 'range', outcome: { trap: true } });
      else if (test.expectError && domainComplete(contract, test.fn, parameters, ranges[test.fn] ?? [], test.args)) {
        const values = formulas[test.fn]?.(test.args);
        if (Array.isArray(values) && values.length) opinions.push({ source: 'domain', outcome: { value: values[0] }, readings: values });
      }
      else if (!test.expectError && (typeof test.expect === 'number' || typeof test.expect === 'boolean')) {
        const values = formulas[test.fn]?.(test.args);
        if (values?.abstain) abstentions.push(values.abstain);
        else if (values) {
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
    if (numeric && parameters && test.expectError && !opinions.length && skippedRanges[test.fn]?.length && outsideRange(skippedRanges[test.fn], parameters, test.args)) abstentions.push('conditional range');
    if (!opinions.length) return abstentions.length ? { index, status: 'abstained', why: abstentions.join('; ') } : { index, status: 'unverified', why: 'no formula or reference' };
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
    const pastLooseBound = only.source === 'formula' && !literal.trap && (looseRanges[test.fn] ?? []).some(bound => test.args.some((x, i) => {
      if (!bound.names.includes(parameters?.[i])) return false;
      const span = Math.max(Math.abs(bound.hi - bound.lo), 1e-12), near = Math.max(1, 0.01 * span);
      return (x < bound.lo || (bound.loOpen && x === bound.lo)) && bound.lo - x <= near || (x > bound.hi || (bound.hiOpen && x === bound.hi)) && x - bound.hi <= near;
    }));
    if (agrees(only, literal, tol) && pastLooseBound) return { index, status: 'abstained', why: 'value just past a stated bound the parser could not attribute' };
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
    report: { verified: count('verified'), corrected: count('corrected'), flagged: count('flagged'), unverified: count('unverified'), abstained: count('abstained'),
      spec_errors: analysis.decisions.filter(d => d.status === 'corrected' || d.status === 'flagged').map(d => ({ index: d.index, status: d.status, sources: d.sources, literal: d.literal, computed: d.computed })),
      ms: performance.now() - begin } };
}
