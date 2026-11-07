import { createHash } from 'node:crypto';
export const CLASSES = ['swapped_units', 'dropped_rows', 'off_by_one', 'reversed_inputs', 'wrong_join', 'stale_binding', 'wrong_constants', 'wrong_rounding', 'boundary_errors', 'sign_errors'];
export const CAP_PER_CLASS = 10;
const UNIT_FACTORS = [1000, 3.6, 6.89476, 14.5038, 2.20462, 0.453592, 1.8, 0.555556, 0.7457, 3.28084, 0.3048, 25.4, 3.41214];
const TYPES = new Set(['f64', 'f32', 'i32', 'u32', 'i64', 'u64', 'i16', 'u16', 'i8', 'u8', 'bool', 'usize', 'isize']);
const INTEGER_TYPES = new Set(['i32', 'u32', 'i64', 'u64', 'i16', 'u16', 'i8', 'u8', 'usize', 'isize']);
const KEYWORDS = new Set(['return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'function', 'export', 'throw', 'new', 'in', 'of', 'switch', 'case', 'typeof', 'as']);
const TRAPS = new Set(['abort', 'throw', 'unreachable']);
const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);
const lexer = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|0[xX][0-9a-fA-F_]+|(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|>>>=|>>>|===|!==|\*\*|>>=|<<=|==|!=|<=|>=|&&|\|\||=>|\+=|-=|\*=|\/=|%=|\+\+|--|<<|>>|[\s\S]/g;
export function tokenize(source) {
  const tokens = [];
  for (const match of source.matchAll(lexer)) {
    const text = match[0], start = match.index;
    if (/^\s+$/.test(text) || text.startsWith('//') || text.startsWith('/*')) continue;
    const kind = /^(?:0[xX]|\d|\.\d)/.test(text) ? 'number' : /^[A-Za-z_$]/.test(text) ? 'ident' : /^["'`]/.test(text) ? 'string' : 'op';
    tokens.push({ text, kind, start, end: start + text.length });
  }
  return tokens;
}
const isCast = (tokens, i) => tokens[i]?.text === '<' && TYPES.has(tokens[i + 1]?.text) && tokens[i + 2]?.text === '>';
function maskCasts(tokens) {
  const masked = new Set();
  tokens.forEach((token, i) => {
    if (isCast(tokens, i)) { masked.add(i); masked.add(i + 2); }
    if (token.text === ':' && TYPES.has(tokens[i + 1]?.text)) masked.add(i + 1);
    if (token.text === '<' && tokens[i - 1]?.kind === 'ident' && /^[A-Z]/.test(tokens[i - 1].text) && tokens[i + 2]?.text === '>') { masked.add(i); masked.add(i + 2); }
  });
  return masked;
}
const closing = (tokens, i) => {
  let depth = 0;
  for (let p = i; p < tokens.length; p++) {
    if (OPEN[tokens[p].text]) depth++;
    else if (CLOSE.has(tokens[p].text) && --depth === 0) return p;
  }
  return -1;
};
const opening = (tokens, i) => {
  let depth = 0;
  for (let p = i; p >= 0; p--) {
    if (CLOSE.has(tokens[p].text)) depth++;
    else if (OPEN[tokens[p].text] && --depth === 0) return p;
  }
  return -1;
};
function forwardPrimary(tokens, i) {
  let p = i;
  while (tokens[p]?.text === '<' && isCast(tokens, p)) p += 3;
  if (tokens[p]?.text === '-' || tokens[p]?.text === '!') p++;
  const token = tokens[p];
  if (!token) return -1;
  if (token.text === '(') return closing(tokens, p);
  if (token.kind === 'number') return p;
  if (token.kind !== 'ident' || KEYWORDS.has(token.text)) return -1;
  while (tokens[p + 1]?.text === '.' && tokens[p + 2]?.kind === 'ident') p += 2;
  if (tokens[p + 1]?.text === '(') return closing(tokens, p + 1);
  return p;
}
function backwardPrimary(tokens, i) {
  let p = i, token = tokens[p];
  if (!token) return -1;
  if (token.text === ')') {
    p = opening(tokens, p);
    if (p < 0) return -1;
    if (tokens[p - 1]?.kind === 'ident' && !KEYWORDS.has(tokens[p - 1].text)) p--;
    else return castStart(tokens, p);
  } else if (token.kind === 'number') return castStart(tokens, p);
  else if (token.kind !== 'ident' || KEYWORDS.has(token.text)) return -1;
  while (tokens[p - 1]?.text === '.' && tokens[p - 2]?.kind === 'ident') p -= 2;
  return castStart(tokens, p);
}
const castStart = (tokens, p) => { while (tokens[p - 1]?.text === '>' && isCast(tokens, p - 3)) p -= 3; return p; };
const unaryContext = token => !token || (token.kind === 'op' && !CLOSE.has(token.text)) || (token.kind === 'ident' && KEYWORDS.has(token.text));
function functions(tokens) {
  const found = [];
  tokens.forEach((token, i) => {
    if (token.text !== 'function' || tokens[i + 1]?.kind !== 'ident' || tokens[i + 2]?.text !== '(') return;
    const close = closing(tokens, i + 2);
    if (close < 0) return;
    const params = [];
    for (let p = i + 3; p < close; p++) {
      if (tokens[p].kind === 'ident' && tokens[p + 1]?.text === ':' && tokens[p + 2]?.kind === 'ident') { params.push({ name: tokens[p].text, type: tokens[p + 2].text, token: p, typeToken: p + 2 }); p += 2; }
    }
    let p = close + 1, returns = null;
    if (tokens[p]?.text === ':') { returns = tokens[p + 1]?.text; p += 2; while (tokens[p] && tokens[p].text !== '{') p++; }
    if (tokens[p]?.text !== '{') return;
    const end = closing(tokens, p);
    if (end < 0) return;
    found.push({ name: tokens[i + 1].text, exported: tokens[i - 1]?.text === 'export', params, returns, open: p, end });
  });
  return found;
}
function ifStatements(tokens, from = 0, to = tokens.length) {
  const found = [];
  for (let i = from; i < to; i++) {
    if (tokens[i].text !== 'if' || tokens[i + 1]?.text !== '(') continue;
    if (tokens[i - 1]?.text === 'else') continue;
    const condEnd = closing(tokens, i + 1);
    if (condEnd < 0) continue;
    let end;
    if (tokens[condEnd + 1]?.text === '{') end = closing(tokens, condEnd + 1);
    else { end = condEnd + 1; while (end < to && tokens[end].text !== ';') end++; }
    if (end < 0) continue;
    const trap = tokens.slice(condEnd + 1, end + 1).some(t => TRAPS.has(t.text));
    found.push({ start: i, condStart: i + 1, condEnd, end, trap, hasElse: tokens[end + 1]?.text === 'else' });
  }
  return found;
}
function returns(tokens, fn) {
  const found = [];
  for (let i = fn.open + 1; i < fn.end; i++) {
    if (tokens[i].text !== 'return' || tokens[i + 1]?.text === ';') continue;
    let p = i + 1, depth = 0;
    while (p < fn.end) {
      if (OPEN[tokens[p].text]) depth++;
      else if (CLOSE.has(tokens[p].text)) depth--;
      else if (tokens[p].text === ';' && depth === 0) break;
      p++;
    }
    if (p < fn.end) found.push({ first: i + 1, last: p - 1 });
  }
  return found;
}
function afterGuards(tokens, fn) {
  let position = fn.open;
  for (const guard of ifStatements(tokens, fn.open + 1, fn.end)) {
    if (guard.start !== position + 1 && !(position === fn.open && guard.start === fn.open + 1)) break;
    if (!guard.trap || guard.hasElse) break;
    position = guard.end;
  }
  return tokens[position].end;
}
function ternaries(tokens, masked) {
  const found = [];
  tokens.forEach((token, q) => {
    if (token.text !== '?' || masked.has(q)) return;
    let depth = 0, nested = 0, colon = -1, end = -1;
    for (let p = q + 1; p < tokens.length; p++) {
      const t = tokens[p].text;
      if (OPEN[t]) depth++;
      else if (CLOSE.has(t)) { if (depth === 0) { end = p - 1; break; } depth--; }
      else if (depth === 0 && t === '?') nested++;
      else if (depth === 0 && t === ':') { if (nested) nested--; else if (colon < 0) colon = p; }
      else if (depth === 0 && (t === ';' || (t === ',' ))) { end = p - 1; break; }
    }
    if (colon < 0 || end < 0) return;
    depth = 0;
    let start = -1;
    for (let p = q - 1; p >= 0; p--) {
      const t = tokens[p].text;
      if (CLOSE.has(t)) depth++;
      else if (OPEN[t]) { if (depth === 0) { start = p + 1; break; } depth--; }
      else if (depth === 0 && (t === '=' || t === 'return' || t === ',' || t === ';' || t === ':')) { start = p + 1; break; }
    }
    if (start >= 0) found.push({ start, q, colon, end });
  });
  return found;
}
const literal = text => Number(text.replaceAll('_', ''));
function formatLike(original, value) {
  if (!Number.isFinite(value)) return null;
  const text = Math.abs(value) >= 1e21 || (value !== 0 && Math.abs(value) < 1e-6) ? value.toExponential() : String(value);
  return /[.eE]/.test(original) && !/[.eE]/.test(text) ? `${text}.0` : text;
}
const significant = text => text.replace(/[eE].*$/, '').replaceAll('_', '').replace('.', '').replace(/^0+/, '').length;
function primaryConstants(tokens) {
  const names = new Set();
  tokens.forEach((token, i) => {
    if ((token.text === 'const') && tokens[i + 1]?.kind === 'ident') {
      let p = i + 2;
      if (tokens[p]?.text === ':') p += 2;
      if (tokens[p]?.text === '=' && tokens[p + 1]?.kind === 'number' && tokens[p + 2]?.text === ';') names.add(tokens[i + 1].text);
    }
  });
  return names;
}
function rankedPick(values, key) {
  return [...values].sort((a, b) => sha(`${key}|${a}`).localeCompare(sha(`${key}|${b}`)));
}
const sha = text => createHash('sha256').update(text).digest('hex');
export function enumerateKernel(source, { resultUnits = {} , decimalZero = new Set() } = {}) {
  const tokens = tokenize(source), masked = maskCasts(tokens), fns = functions(tokens), mutants = [];
  const emit = (fault, op, edits) => {
    const ordered = [...edits].sort((a, b) => b[0] - a[0]);
    let text = source;
    for (const [from, to, value] of ordered) text = text.slice(0, from) + value + text.slice(to);
    if (text !== source) mutants.push({ class: fault, op, site: mutants.length, source: text });
  };
  const span = (a, b) => source.slice(tokens[a].start, tokens[b].end);
  const replaceToken = (i, value) => [tokens[i].start, tokens[i].end, value];
  const constants = primaryConstants(tokens);
  const inBody = i => fns.some(fn => i > fn.open && i < fn.end) || constants.size > 0;
  const numbers = tokens.map((t, i) => [t, i]).filter(([t, i]) => t.kind === 'number' && !t.text.startsWith('0x') && !t.text.startsWith('0X') && inBody(i));
  const bodyNumbers = numbers.filter(([, i]) => !(tokens[i - 1]?.text === '[' && tokens[i + 1]?.text === ']'));
  const allLiterals = [...new Set(bodyNumbers.map(([t]) => t.text))];
  tokens.forEach((token, i) => {
    if (masked.has(i) || token.kind !== 'op') return;
    const prev = tokens[i - 1], next = tokens[i + 1], unary = unaryContext(prev);
    if (token.text === '*' && (next?.kind === 'number' || constants.has(next?.text)) && !unary) emit('swapped_units', 'mul_to_div_constant', [replaceToken(i, '/')]);
    if (token.text === '/' && (next?.kind === 'number' || constants.has(next?.text)) && !unary) emit('swapped_units', 'div_to_mul_constant', [replaceToken(i, '*')]);
    if ((token.text === '+' || token.text === '-') && !unary) {
      const end = forwardPrimary(tokens, i + 1);
      if (end > 0) {
        let last = end;
        while ((tokens[last + 1]?.text === '*' || tokens[last + 1]?.text === '/')) {
          const further = forwardPrimary(tokens, last + 2);
          if (further < 0) break;
          last = further;
        }
        emit('dropped_rows', 'drop_term', [[token.start, tokens[last].end, '']]);
      }
      emit('sign_errors', token.text === '+' ? 'plus_to_minus' : 'minus_to_plus', [replaceToken(i, token.text === '+' ? '-' : '+')]);
    }
    if (token.text === '-' && unary && next?.kind === 'number') emit('sign_errors', 'drop_negative_literal', [[token.start, token.end, '']]);
    if (token.text === '!' && next?.text === '(') emit('sign_errors', 'drop_not', [[token.start, token.end, '']]);
    if ((token.text === '-' || token.text === '/') && !unary) {
      const left = backwardPrimary(tokens, i - 1), right = forwardPrimary(tokens, i + 1);
      if (left >= 0 && right > 0) emit('reversed_inputs', token.text === '-' ? 'swap_minus_operands' : 'swap_div_operands', [[tokens[left].start, tokens[right].end, `${span(i + 1, right)} ${token.text} ${span(left, i - 1)}`]]);
    }
    if (token.text === '&&') emit('wrong_join', 'and_to_or', [replaceToken(i, '||')]);
    if (token.text === '||') emit('wrong_join', 'or_to_and', [replaceToken(i, '&&')]);
    if (token.text === '+' && !unary) emit('wrong_join', 'plus_to_times', [replaceToken(i, '*')]);
    if (token.text === '*' && !unary) emit('wrong_join', 'times_to_plus', [replaceToken(i, '+')]);
    const flip = { '<': '<=', '<=': '<', '>': '>=', '>=': '>' }[token.text];
    if (flip) {
      emit('boundary_errors', 'relax_or_tighten_comparison', [replaceToken(i, flip)]);
      emit('sign_errors', 'flip_comparison', [replaceToken(i, { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }[token.text])]);
    }
    if (token.text === '==' || token.text === '!=') emit('sign_errors', 'flip_equality', [replaceToken(i, token.text === '==' ? '!=' : '==')]);
  });
  tokens.forEach((token, i) => {
    if (token.text === 'Math' && tokens[i + 1]?.text === '.' && tokens[i + 3]?.text === '(') {
      const name = tokens[i + 2].text, close = closing(tokens, i + 3);
      if (name === 'min' || name === 'max') emit('wrong_join', 'min_max_swap', [replaceToken(i + 2, name === 'min' ? 'max' : 'min')]);
      if (['floor', 'ceil', 'round', 'trunc'].includes(name)) {
        for (const other of ['floor', 'ceil', 'round', 'trunc'].filter(n => n !== name)) emit('wrong_rounding', `${name}_to_${other}`, [replaceToken(i + 2, other)]);
        if (close > 0) emit('wrong_rounding', 'strip_rounding', [[token.start, tokens[i + 3].start, '']]);
      }
      if (name === 'pow' && close > 0) {
        const commas = [];
        let depth = 0;
        for (let p = i + 4; p < close; p++) { if (OPEN[tokens[p].text]) depth++; else if (CLOSE.has(tokens[p].text)) depth--; else if (tokens[p].text === ',' && depth === 0) commas.push(p); }
        if (commas.length === 1) emit('reversed_inputs', 'swap_pow_args', [[tokens[i + 4].start, tokens[close - 1].end, `${span(commas[0] + 1, close - 1)}, ${span(i + 4, commas[0] - 1)}`]]);
      }
    }
    if (fns.some(fn => fn.name === token.text && i !== fn.open && tokens[i - 1]?.text !== 'function') && tokens[i + 1]?.text === '(') {
      const close = closing(tokens, i + 1), commas = [];
      let depth = 0;
      for (let p = i + 2; p < close; p++) { if (OPEN[tokens[p].text]) depth++; else if (CLOSE.has(tokens[p].text)) depth--; else if (tokens[p].text === ',' && depth === 0) commas.push(p); }
      if (commas.length >= 1) {
        const secondEnd = commas[1] ? commas[1] - 1 : close - 1;
        emit('reversed_inputs', 'swap_call_args', [[tokens[i + 2].start, tokens[secondEnd].end, `${span(commas[0] + 1, secondEnd)}, ${span(i + 2, commas[0] - 1)}`]]);
      }
    }
  });
  for (const [token, i] of bodyNumbers) {
    const value = literal(token.text);
    if (Number.isInteger(value)) {
      for (const delta of [1, -1]) {
        const next = value + delta;
        if (next >= 0) emit('off_by_one', delta > 0 ? 'literal_plus_one' : 'literal_minus_one', [replaceToken(i, formatLike(token.text, next))]);
      }
    }
    if (value !== 0 && value !== 1) {
      for (const [name, factor] of [['times_1_01', 1.01], ['times_1_1', 1.1], ['times_10', 10], ['times_0_1', 0.1]]) {
        const text = formatLike(token.text, value * factor);
        if (text) emit('wrong_constants', name, [replaceToken(i, text)]);
      }
    }
    if (value !== 0) {
      if (significant(token.text) > 3) emit('stale_binding', 'round_to_three_figures', [replaceToken(i, formatLike(`${token.text}.`, Number(value.toPrecision(3))))]);
      for (const [name, factor] of [['revision_plus_0_2pct', 1.002], ['revision_minus_0_2pct', 0.998]]) {
        const text = formatLike(`${token.text}.`, value * factor);
        if (text) emit('stale_binding', name, [replaceToken(i, text)]);
      }
      for (const other of rankedPick(allLiterals.filter(t => literal(t) !== value), `slot|${i}`).slice(0, 2)) emit('stale_binding', 'bound_to_other_literal', [replaceToken(i, other)]);
    }
  }
  for (const fn of fns) {
    const numericReturn = fn.returns === 'f64' || fn.returns === 'f32', integerReturn = INTEGER_TYPES.has(fn.returns);
    const countable = integerReturn || decimalZero.has(fn.name);
    for (const ret of returns(tokens, fn)) {
      const body = span(ret.first, ret.last), edit = value => [[tokens[ret.first].start, tokens[ret.last].end, value]];
      if (numericReturn) {
        for (const factor of rankedPick(UNIT_FACTORS, `ret|${fn.name}|${ret.first}`).slice(0, 2)) {
          emit('swapped_units', 'result_times_unit_factor', edit(`(${body}) * ${formatLike('1.', factor)}`));
          emit('swapped_units', 'result_over_unit_factor', edit(`(${body}) / ${formatLike('1.', factor)}`));
        }
        if (/^°?\s*[FC]$|deg|fahrenheit|celsius/i.test(resultUnits[fn.name] ?? '')) {
          emit('swapped_units', 'result_plus_32', edit(`(${body}) + 32.0`));
          emit('swapped_units', 'result_minus_32', edit(`(${body}) - 32.0`));
        }
        emit('wrong_rounding', 'add_floor', edit(`Math.floor(${body})`));
        emit('wrong_rounding', 'add_round', edit(`Math.round(${body})`));
        emit('wrong_rounding', 'add_ceil', edit(`Math.ceil(${body})`));
        emit('wrong_rounding', 'round_two_places', edit(`Math.round((${body}) * 100.0) / 100.0`));
        emit('wrong_rounding', 'round_one_place', edit(`Math.round((${body}) * 10.0) / 10.0`));
        emit('wrong_rounding', 'single_precision', edit(`<f64><f32>(${body})`));
        emit('wrong_rounding', 'truncate_to_int', edit(`<f64><i32>(${body})`));
      }
      if (countable) {
        const one = integerReturn ? '1' : '1.0';
        emit('off_by_one', 'result_plus_one', edit(`(${body}) + ${one}`));
        emit('off_by_one', 'result_minus_one', edit(`(${body}) - ${one}`));
      }
      if (numericReturn || (integerReturn && !fn.returns.startsWith('u') && fn.returns !== 'usize')) emit('sign_errors', 'negate_result', edit(`-(${body})`));
    }
    for (let a = 0; a + 1 < fn.params.length; a++) {
      const left = fn.params[a], right = fn.params[a + 1];
      if (left.type === right.type) emit('reversed_inputs', 'swap_adjacent_params', [replaceToken(left.token, right.name), replaceToken(right.token, left.name)]);
    }
    const insertion = afterGuards(tokens, fn);
    for (const param of fn.params.filter(p => p.type === 'f64')) {
      for (const factor of rankedPick(UNIT_FACTORS, `arg|${fn.name}|${param.name}`).slice(0, 2)) emit('swapped_units', 'input_times_unit_factor', [[insertion, insertion, ` ${param.name} = ${param.name} * ${formatLike('1.', factor)};`]]);
    }
  }
  for (const guard of ifStatements(tokens)) {
    if (guard.hasElse) continue;
    const removal = [[tokens[guard.start].start, tokens[guard.end].end, '']];
    if (guard.trap) {
      emit('boundary_errors', 'drop_guard', removal);
      const parts = [];
      let depth = 0, from = guard.condStart + 1;
      for (let p = guard.condStart + 1; p <= guard.condEnd; p++) {
        const t = tokens[p].text;
        if (p === guard.condEnd || (depth === 0 && t === '||')) { parts.push([from, p - 1]); from = p + 1; continue; }
        if (OPEN[t]) depth++;
        else if (CLOSE.has(t)) depth--;
      }
      if (parts.length > 1) parts.forEach((part, index) => {
        const kept = parts.filter((_, n) => n !== index).map(([a, b]) => span(a, b)).join(' || ');
        emit('boundary_errors', 'drop_guard_disjunct', [[tokens[guard.condStart + 1].start, tokens[guard.condEnd - 1].end, kept]]);
      });
    } else emit('dropped_rows', 'drop_branch', removal);
  }
  for (const t of ternaries(tokens, masked)) {
    const then = span(t.q + 1, t.colon - 1), other = span(t.colon + 1, t.end), whole = [[tokens[t.start].start, tokens[t.end].end]];
    emit('dropped_rows', 'ternary_keep_else', [[...whole[0], other]]);
    emit('dropped_rows', 'ternary_keep_then', [[...whole[0], then]]);
    emit('wrong_join', 'ternary_swap_arms', [[tokens[t.q + 1].start, tokens[t.end].end, `${other} : ${then}`]]);
  }
  tokens.forEach((token, i) => {
    if (token.text !== '[' || tokens[i - 1]?.kind === 'ident' || tokens[i - 1]?.text === ']' || tokens[i - 1]?.text === ')') return;
    const close = closing(tokens, i);
    if (close < 0) return;
    const commas = [];
    let depth = 0;
    for (let p = i + 1; p < close; p++) { if (OPEN[tokens[p].text]) depth++; else if (CLOSE.has(tokens[p].text)) depth--; else if (tokens[p].text === ',' && depth === 0) commas.push(p); }
    if (commas.length) commas.forEach((comma, n) => emit('dropped_rows', 'drop_array_row', [[tokens[comma].start, n + 1 < commas.length ? tokens[commas[n + 1]].start : tokens[close].start, '']]));
  });
  return mutants;
}
export function selectKernelMutants(key, mutants, cap = CAP_PER_CLASS) {
  const unique = new Map();
  for (const mutant of mutants) if (!unique.has(mutant.source)) unique.set(mutant.source, mutant);
  const byClass = new Map(CLASSES.map(name => [name, []]));
  for (const mutant of unique.values()) byClass.get(mutant.class).push(mutant);
  const selected = [], available = {};
  for (const [name, list] of byClass) {
    available[name] = list.length;
    selected.push(...list.map(m => ({ m, rank: sha(`${key}|${m.op}|${m.source}`) })).sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, cap).map(({ m }) => m));
  }
  return { selected, available };
}
export function enumerateGlue(glueText) {
  const glue = JSON.parse(glueText), mutants = [];
  const emit = (fault, op, change) => {
    const copy = structuredClone(glue);
    if (change(copy) !== false) {
      const text = JSON.stringify(copy);
      if (text !== JSON.stringify(glue)) mutants.push({ class: fault, op, glue: text });
    }
  };
  glue.exports.forEach((entry, e) => {
    const units = entry.args.map(a => a.unit).filter(Boolean);
    if (entry.result.unit) units.filter(u => u !== entry.result.unit).slice(0, 1).forEach(unit => emit('swapped_units', 'glue_result_unit_swapped', g => { g.exports[e].result.unit = unit; }));
    entry.args.forEach((arg, a) => {
      const next = entry.args[a + 1];
      if (next && arg.unit && next.unit && arg.unit !== next.unit) emit('swapped_units', 'glue_arg_units_swapped', g => { [g.exports[e].args[a].unit, g.exports[e].args[a + 1].unit] = [next.unit, arg.unit]; });
      if (next && arg.kind === next.kind) emit('reversed_inputs', 'glue_args_reordered', g => { [g.exports[e].args[a].name, g.exports[e].args[a + 1].name, g.exports[e].args[a].label, g.exports[e].args[a + 1].label] = [next.name, arg.name, next.label, arg.label]; if (g.exports[e].args[a].label === undefined) delete g.exports[e].args[a].label; if (g.exports[e].args[a + 1].label === undefined) delete g.exports[e].args[a + 1].label; });
    });
    if (Number.isInteger(entry.result.precision)) emit('wrong_rounding', 'glue_precision_changed', g => { g.exports[e].result.precision = entry.result.precision >= 2 ? entry.result.precision - 2 : entry.result.precision + 2; });
    if (entry.result.codes) {
      const codes = Object.keys(entry.result.codes);
      if (codes.length > 1 && entry.result.codes[codes[0]] !== entry.result.codes[codes[1]]) emit('wrong_join', 'glue_code_labels_swapped', g => { [g.exports[e].result.codes[codes[0]], g.exports[e].result.codes[codes[1]]] = [entry.result.codes[codes[1]], entry.result.codes[codes[0]]]; });
      codes.slice(0, 2).forEach(code => emit('dropped_rows', 'glue_code_row_dropped', g => { delete g.exports[e].result.codes[code]; }));
    }
    if (entry.result.labels && entry.result.labels.true !== entry.result.labels.false) emit('sign_errors', 'glue_boolean_labels_swapped', g => { [g.exports[e].result.labels.true, g.exports[e].result.labels.false] = [entry.result.labels.false, entry.result.labels.true]; });
  });
  return mutants;
}
