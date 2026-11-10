import { isBuffer, scalarLeaves } from './measure.mjs';
const nonFinite = /\b(?:non-?finite|nan|infinit(?:e|y|ies))\b/i;
const statedFinite = /\bmust be finite\b|\bfinite and\b/i;
const trapVerb = /\b(?:traps?|trapping|rejects?|rejecting|aborts?|throws?)\b/i;
const aboutTests = /\b(?:tests?|cases?|freezes?|frozen)\b/i;
const negated = /\b(?:never|not|no|cannot)\b/i;
const permits = /\b(?:returns?|yields?|propagates?|produces?)\b[^\n]*\b(?:non-?finite|nan|infinit(?:e|y|ies))\b|\b(?:non-?finite|nan|infinit(?:e|y|ies))\b[^\n]*\b(?:propagates?|returned)\b/i;
const excludes = /\b(?:non-?finite|nan|infinit\w*)\b[^\n]*\b(?:outside|excluded|out of scope|unsupported)\b|\bfinite inputs? (?:is|are) (?:the )?(?:boundary )?(?:precondition|assumption)|\bcallers? (?:supply|supplies|provide|provides) finite\b/i;
const promises = /\b(?:results?|returns?|outputs?)\b[^\n]*\bfinite\b|\bfinite\b[^\n]*\b(?:results?|returns?|outputs?)\b/i;
const words = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const decimals = /\b(\d+|zero|one|two|three|four|five|six)\s+decimal/gi;
const family = new Map(Object.entries({ f: 'F', degf: 'F', fahrenheit: 'F', c: 'C', degc: 'C', celsius: 'C', psig: 'psig', psia: 'psia', psi: 'psi', kpa: 'kPa', bar: 'bar', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', kg: 'kg', g: 'g', gram: 'g', grams: 'g', m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', ft: 'ft', feet: 'ft', kw: 'kW', hp: 'hp', usd: 'USD', percent: '%', pct: '%', cfm: 'cfm', gpm: 'gpm', btu: 'Btu', s: 's', sec: 's', second: 's', seconds: 's', min: 'min', minute: 'min', minutes: 'min', h: 'h', hr: 'h', hour: 'h', hours: 'h' }));
export function exportBlocks(contract, names) {
  const lines = contract.split('\n'), mention = line => names.filter(name => new RegExp(`\\b${name}\\s*\\(|\`${name}\``).test(line));
  const blocks = Object.fromEntries(names.map(name => [name, []])), shared = [];
  let current = null;
  for (const line of lines) {
    const named = mention(line);
    if (named.length === 1) current = named[0];
    else if (named.length > 1 || /^#/.test(line)) current = null;
    (current ? blocks[current] : shared).push(line);
  }
  return { blocks, shared };
}
const sentences = lines => lines.join('\n').split(/(?<=\.)\s+|\n/).filter(Boolean);
export function nonFiniteExpectation(contract, names) {
  const { blocks, shared } = exportBlocks(contract, names);
  const excluded = sentences(contract.split('\n')).some(sentence => excludes.test(sentence));
  return Object.fromEntries(names.map(name => {
    const relevant = sentences([...shared, ...blocks[name]]), any = pattern => relevant.some(sentence => pattern(sentence));
    if (any(s => permits.test(s) && !negated.test(s) && !trapVerb.test(s))) return [name, 'permitted'];
    if (any(s => (nonFinite.test(s) || statedFinite.test(s)) && trapVerb.test(s) && !aboutTests.test(s))) return [name, 'trap'];
    if (excluded) return [name, 'excluded'];
    if (any(s => promises.test(s) && !aboutTests.test(s))) return [name, 'finite'];
    return [name, 'silent'];
  }));
}
export function hasNonFinite(value) {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFinite);
  return value !== null && typeof value === 'object' && Object.values(value).some(hasNonFinite);
}
export function probeProblem(expectation, outcome) {
  if (outcome.problem) return outcome.problem;
  if (expectation === 'trap' && !outcome.trap) return 'returned where the contract requires a trap';
  if (expectation === 'finite' && !outcome.trap && hasNonFinite(outcome.value)) return 'returned a non-finite result the contract rules out';
  return null;
}
export function kernelParameters(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '), found = new Map();
  for (const match of clean.matchAll(/\bexport\s+function\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g)) {
    found.set(match[1], match[2].split(',').map(part => part.trim()).filter(Boolean).map(part => part.split(/[:=]/)[0].replace(/[?\s]/g, '')));
  }
  return found;
}
const unitFamily = unit => {
  const head = String(unit).toLowerCase().replace(/°/g, 'deg').split(/\s+/)[0];
  if (head === '%') return '%';
  const parts = head.split('/').map(part => family.get(part));
  return parts.every(Boolean) && parts.length <= 2 ? parts.join('/') : null;
};
const nameFamily = name => {
  const tokens = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[\s_]+/);
  if (tokens.length < 2) return null;
  const per = tokens.lastIndexOf('Per');
  const known = token => family.get(token.toLowerCase());
  if (per > 0 && per === tokens.length - 2) {
    const [top, bottom] = [known(tokens[per - 1]), known(tokens[per + 1])];
    return top && bottom ? `${top}/${bottom}` : null;
  }
  if (per >= 0) return null;
  return known(tokens[tokens.length - 1]) ?? null;
};
const tokens = text => new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1));
const overlap = (a, b) => [...tokens(a)].filter(word => tokens(b).has(word)).length;
export function unitDisagreements(glue) {
  const found = [];
  for (const entry of glue.exports) {
    const leaves = [...entry.args.flatMap(arg => scalarLeaves(arg, arg.name, arg.name)), ...scalarLeaves(entry.result, entry.name, entry.name)];
    for (const { name: label, type: { unit } } of leaves) {
      if (typeof unit !== 'string') continue;
      const fromName = nameFamily(label), fromUnit = unitFamily(unit);
      if (fromName && fromUnit && fromName !== fromUnit) found.push(`${label}: glue unit ${unit} disagrees with the name, which says ${fromName}`);
    }
  }
  return found;
}
const computation = /\bformula\b[^:\n]*:\s*(.+)$/i;
export function statesComputation(lines, parameters) {
  return lines.some(line => {
    const expressions = [...line.matchAll(/`([^`]+)`/g)].map(match => match[1]), labelled = computation.exec(line);
    if (labelled) expressions.push(labelled[1]);
    return expressions.some(expression => !/^\s*[A-Za-z_]\w*\s*\(/.test(expression) && /[-+*/%<>]/.test(expression)
      && parameters.some(name => new RegExp(`\\b${name}\\b`).test(expression)));
  });
}
export function glueProblems(glue, inputs) { return glueFindings(glue, inputs).problems; }
export function glueFindings(glue, { source, contract }) {
  const problems = [], advisory = [], parameters = kernelParameters(source), names = glue.exports.map(entry => entry.name);
  const { blocks, shared } = exportBlocks(contract, names);
  for (const entry of glue.exports) {
    const declared = parameters.get(entry.name), glueNames = entry.args.map(arg => arg.name);
    const compared = declared && isBuffer(entry.result) ? declared.slice(0, -1) : declared;
    if (declared && glueNames.join() !== compared.join()) problems.push(`${entry.name}: glue argument names ${glueNames.join(', ')} differ from kernel parameters ${declared.join(', ')}`);
    const block = blocks[entry.name] ?? [], stated = lines => [...new Set([...lines.join('\n').matchAll(decimals)].map(match => words[match[1].toLowerCase()] ?? Number(match[1])))];
    const own = stated(block), expected = own.length ? own : stated([...shared, ...Object.values(blocks).flat()]);
    if (expected.length === 1 && Number.isInteger(entry.result.precision) && entry.result.precision !== expected[0]) problems.push(`${entry.name}: glue precision ${entry.result.precision}, contract states ${expected[0]} decimal places`);
    if (entry.result.codes) {
      const table = new Map([...block.join('\n').matchAll(/(?<![\w.])(-?\d+)\s*(?:=|→|means)\s*([^,;\n]+)/g)].map(match => [match[1], match[2]]));
      const codes = Object.keys(entry.result.codes).filter(code => table.has(code));
      const found = statesComputation(block, declared ?? glueNames) ? advisory : problems;
      for (const a of codes) for (const b of codes) if (a < b) {
        const straight = overlap(entry.result.codes[a], table.get(a)) + overlap(entry.result.codes[b], table.get(b));
        const crossed = overlap(entry.result.codes[a], table.get(b)) + overlap(entry.result.codes[b], table.get(a));
        if (crossed > straight) found.push(`${entry.name}: labels for codes ${a} and ${b} fit the contract better swapped`);
      }
    }
  }
  return { problems, advisory };
}
export function capabilityBlock(contract) {
  const match = String(contract ?? '').match(/```capability\s*\n([\s\S]*?)```/);
  if (!match) return { block: null, error: 'CONTRACT.md has no ```capability block' };
  try { return { block: JSON.parse(match[1]) }; } catch { return { block: null, error: 'the ```capability block is not JSON' }; }
}
const NUMERAL = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const unitAliases = new Map(Object.entries({ '': 'dimensionless', 1: 'dimensionless', none: 'dimensionless', unitless: 'dimensionless', dimensionless: 'dimensionless',
  f: 'degF', '°f': 'degF', degf: 'degF', 'deg f': 'degF', fahrenheit: 'degF', c: 'degC', '°c': 'degC', degc: 'degC', 'deg c': 'degC', celsius: 'degC' }));
const spaced = text => String(text).trim().replace(/\s+/g, ' ');
const lowered = text => spaced(text).toLowerCase();
const sameUnit = text => unitAliases.get(lowered(text ?? '')) ?? spaced(text);
const rangeNote = text => lowered(text).replace(/\bfinite\b/g, '').replace(/^[\s,;.]+|[\s,;.]+$/g, '');
function sameRange(text) {
  if (text === undefined || text === null) return null;
  const value = spaced(text);
  let match = value.match(new RegExp(`^(${NUMERAL})\\s*\\.\\.\\s*(${NUMERAL})(.*)$`));
  if (match) return { low: Number(match[1]), high: Number(match[2]), lowOpen: false, highOpen: false, note: rangeNote(match[3]) };
  match = value.match(new RegExp(`^([\\[(])\\s*(${NUMERAL})\\s*,\\s*(${NUMERAL})\\s*([\\])])(.*)$`));
  if (match) return { low: Number(match[2]), high: Number(match[3]), lowOpen: match[1] === '(', highOpen: match[4] === ')', note: rangeNote(match[5]) };
  return { text: lowered(value) };
}
const labelTable = codes => codes && typeof codes === 'object' ? Object.fromEntries(Object.entries(codes).map(([code, label]) => [code, lowered(label)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : undefined;
const shownPart = value => (value === undefined ? 'nothing' : JSON.stringify(value));
function partDifferences(where, block, glue, keys) {
  const out = [];
  for (const [key, normal] of keys) {
    const want = normal(block?.[key]), have = normal(glue?.[key]);
    if (JSON.stringify(want) !== JSON.stringify(have)) out.push(`${where} ${key}: the capability block says ${shownPart(block?.[key])}, glue.json says ${shownPart(glue?.[key])}`);
  }
  return out;
}
const same = value => value;
const argumentKeys = [['kind', same], ['unit', sameUnit], ['range', sameRange], ['codes', labelTable]];
const resultKeys = [['kind', same], ['unit', sameUnit], ['precision', same], ['rounding', same], ['codes', labelTable], ['labels', labelTable]];
const declaredBound = { list: 'max', text: 'maxBytes' };
const isValue = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function valueDifferences(where, block, glue, keys) {
  const out = partDifferences(where, block, glue, keys);
  if (!isValue(block) || !isValue(glue) || block.kind !== glue.kind) return out;
  const bound = declaredBound[block.kind];
  if (bound && Object.hasOwn(block, bound)) out.push(...partDifferences(where, block, glue, [[bound, same]]));
  if (block.kind === 'list' && Object.hasOwn(block, 'items')) {
    if (!Object.hasOwn(glue, 'items')) out.push(`${where} items: the capability block declares list items, glue.json does not`);
    else out.push(...valueDifferences(`${where}[]`, block.items, glue.items, keys));
  }
  if (block.kind === 'record' && Object.hasOwn(block, 'fields')) {
    if (!Array.isArray(glue.fields)) out.push(`${where} fields: the capability block declares record fields, glue.json does not`);
    else if (!Array.isArray(block.fields)) out.push(`${where} fields: the capability block's fields are not a list`);
    else {
      const named = fields => new Map(fields.map(item => [item?.name, item]));
      const want = named(block.fields), have = named(glue.fields);
      for (const name of want.keys()) if (!have.has(name)) out.push(`${where}: the capability block declares field ${name}, which glue.json does not`);
      for (const name of have.keys()) if (!want.has(name)) out.push(`${where}: glue.json declares field ${name}, which the capability block does not`);
      for (const [name, item] of want) if (have.has(name)) out.push(...valueDifferences(`${where}.${name}`, item, have.get(name), keys));
    }
  }
  return out;
}
export const layoutKinds = Object.freeze(['integer', 'number', 'boolean', 'code', 'record', 'list', 'text']);
const bounded = (value, top) => Number.isInteger(value) && value >= 1 && value <= top;
function nestedProblems(where, value, named) {
  if (!isValue(value)) return [`${where} must be an object`];
  const problems = [];
  if (named && (typeof value.name !== 'string' || !value.name)) problems.push(`${where} needs a name`);
  if (!layoutKinds.includes(value.kind)) problems.push(`${where} kind must be one of ${layoutKinds.join(', ')}`);
  if (['integer', 'number', 'code'].includes(value.kind) && (typeof value.unit !== 'string' || !value.unit)) problems.push(`${where} needs a unit`);
  if (value.kind === 'code' && (!isValue(value.codes) || Object.keys(value.codes).length < 2)) problems.push(`${where} of kind code needs a codes table`);
  return [...problems, ...layoutProblems(where, value)];
}
export function layoutProblems(where, value) {
  if (!isValue(value)) return [];
  const problems = [];
  if (value.kind === 'text' && !bounded(value.maxBytes, 65536)) problems.push(`${where} of kind text needs maxBytes, an integer from 1 to 65536`);
  if (value.kind === 'list') {
    if (!bounded(value.max, 4096)) problems.push(`${where} of kind list needs max, an integer from 1 to 4096`);
    if (!Object.hasOwn(value, 'items')) problems.push(`${where} of kind list needs items, the layout of one item`);
    else problems.push(...nestedProblems(`${where}[]`, value.items, false));
  }
  if (value.kind === 'record') {
    if (!Array.isArray(value.fields) || !value.fields.length) problems.push(`${where} of kind record needs fields, a nonempty list of named fields with their kinds`);
    else {
      const names = value.fields.map(item => item?.name);
      for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) problems.push(`${where} declares field ${name} twice`);
      value.fields.forEach((item, index) => problems.push(...nestedProblems(`${where}.${item?.name ?? index}`, item, true)));
    }
  }
  return problems;
}
export function capabilityAgreement(block, glue) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.exports)) return ['the frozen ```capability block has no exports array'];
  const layout = block.exports.flatMap(item => [
    ...(Array.isArray(item?.args) ? item.args : []).map((arg, index) => layoutProblems(`${item?.name} argument ${index + 1} (${arg?.name})`, arg)),
    layoutProblems(`${item?.name} result`, item?.result),
  ]).flat().map(problem => `the capability block does not declare the layout: ${problem}`);
  const problems = [...layout], declared = new Map(block.exports.map(item => [item?.name, item])), described = new Map((glue?.exports ?? []).map(entry => [entry.name, entry]));
  for (const name of declared.keys()) if (!described.has(name)) problems.push(`the capability block exports ${name}, which glue.json does not describe`);
  for (const name of described.keys()) if (!declared.has(name)) problems.push(`glue.json describes ${name}, which the capability block does not export`);
  for (const [name, item] of declared) {
    const entry = described.get(name);
    if (!entry) continue;
    const want = Array.isArray(item.args) ? item.args : [], have = Array.isArray(entry.args) ? entry.args : [];
    if (want.length !== have.length) problems.push(`${name}: the capability block declares ${want.length} arguments, glue.json ${have.length}`);
    else want.forEach((arg, index) => problems.push(...valueDifferences(`${name} argument ${index + 1} (${arg?.name ?? have[index]?.name})`, arg, have[index], argumentKeys)));
    problems.push(...valueDifferences(`${name} result`, item.result, entry.result, resultKeys));
  }
  const blockTraps = new Set(Array.isArray(block.traps) ? block.traps : []), glueTraps = new Set((glue?.traps ?? []).map(trap => trap.fn));
  for (const name of blockTraps) if (!glueTraps.has(name)) problems.push(`the capability block lists ${name} as trapping, and glue.json has no trap for it`);
  for (const name of glueTraps) if (!blockTraps.has(name)) problems.push(`glue.json has a trap for ${name}, which the capability block does not list as trapping`);
  return problems;
}
