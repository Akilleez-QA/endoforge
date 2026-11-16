import { createHash } from 'node:crypto';

export const compactFile = 'tests.txt';
export const compactRule = 'Write tests.txt, not tests.json: one test per line, fn(arg, ...) = expected | name, or fn(arg, ...) = expected ~ tol | name with a tolerance, or fn(arg, ...) = trap | name for a test that must trap. Values are JSON numbers, true, false, JSON strings, [lists] and {records} whose keys may be bare words. A line shape Item(id, done, title) lets a record be written Item(1, false, "milk"), and a line let empty = {nextId: 1, items: []} lets a value be written $empty. tests.txt is expanded to tests.json before the freeze.';
const word = /[A-Za-z_][A-Za-z0-9_]*/y;
const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const string = /"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/y;
const reserved = new Set(['true', 'false', 'null', 'trap', 'shape', 'let']);

class Refusal extends Error {}
function reader(line, shapes, values) {
  let at = 0;
  const fail = what => { throw new Refusal(`${what} at column ${at + 1}`); };
  const space = () => { while (line[at] === ' ' || line[at] === '\t') at++; };
  const match = pattern => { space(); pattern.lastIndex = at; const found = pattern.exec(line); if (found) at = pattern.lastIndex; return found?.[0] ?? null; };
  const take = text => { space(); if (line.startsWith(text, at)) { at += text.length; return true; } return false; };
  const expect = (text, what) => { if (!take(text)) fail(`expected ${what ?? text}`); };
  const sequence = (close, item) => {
    const items = [];
    if (take(close)) return items;
    do items.push(item()); while (take(','));
    expect(close);
    return items;
  };
  const value = () => {
    space();
    const start = at;
    if (take('[')) return sequence(']', value);
    if (take('{')) {
      const record = {};
      for (const [key, item] of sequence('}', () => { const key = match(string) ?? match(word); if (key === null) fail('expected a field name'); expect(':'); return [key[0] === '"' ? JSON.parse(key) : key, value()]; })) {
        if (Object.hasOwn(record, key)) { at = start; fail(`duplicate field ${key}`); }
        Object.defineProperty(record, key, { value: item, enumerable: true, writable: true, configurable: true });
      }
      return record;
    }
    if (take('$')) {
      const name = match(word);
      if (name === null || !values.has(name)) { at = start; fail(`unknown value $${name ?? ''}`); }
      return values.get(name);
    }
    const literal = match(string);
    if (literal !== null) return JSON.parse(literal);
    const digits = match(number);
    if (digits !== null) {
      const parsed = Number(digits);
      if (!Number.isFinite(parsed)) { at = start; fail(`number ${digits} is not finite`); }
      return parsed;
    }
    const name = match(word);
    if (name === 'true' || name === 'false') return name === 'true';
    if (name === 'null') return null;
    if (name !== null && shapes.has(name)) {
      const fields = shapes.get(name);
      expect('(', `( after ${name}`);
      const items = sequence(')', value);
      if (items.length !== fields.length) { at = start; fail(`${name} takes ${fields.length} values, got ${items.length}`); }
      return Object.fromEntries(fields.map((field, index) => [field, items[index]]));
    }
    at = start;
    return fail(name === null ? 'expected a value' : `${name} is not a value or a shape`);
  };
  return { value, match, take, expect, fail, sequence, rest: () => line.slice(at), end: () => { space(); if (at < line.length) fail('unexpected text'); } };
}
function declare(names, name, read) {
  if (name === null || reserved.has(name)) read.fail('expected a name that is not a keyword');
  if (names.has(name)) read.fail(`${name} is already defined`);
}
function parseLine(line, shapes, values) {
  const read = reader(line, shapes, values);
  if (/^\s*shape\s/.test(line)) {
    read.match(/\s*shape/y);
    const name = read.match(word);
    declare(shapes, name, read);
    read.expect('(');
    const fields = read.sequence(')', () => { const field = read.match(word); if (field === null) read.fail('expected a field name'); return field; });
    if (!fields.length || new Set(fields).size !== fields.length) read.fail(`${name} needs distinct field names`);
    read.end();
    shapes.set(name, fields);
    return null;
  }
  if (/^\s*let\s/.test(line)) {
    read.match(/\s*let/y);
    const name = read.match(word);
    declare(values, name, read);
    read.expect('=');
    const value = read.value();
    read.end();
    values.set(name, value);
    return null;
  }
  const fn = read.match(word);
  if (fn === null) read.fail('expected a function name, shape or let');
  read.expect('(', `( after ${fn}`);
  const args = read.sequence(')', read.value);
  read.expect('=', '= after the arguments');
  let outcome;
  if (read.match(/\s*trap\b/y) !== null) outcome = { expectError: true };
  else {
    outcome = { expect: read.value() };
    if (read.take('~')) {
      const tol = read.match(number);
      if (tol === null) read.fail('expected a number after ~');
      outcome.tol = Number(tol);
    }
  }
  read.expect('|', '| and a test name');
  const name = read.rest().trim();
  if (!name) read.fail('expected a test name after |');
  return { name, fn, args, ...outcome };
}
export function expandTests(source) {
  if (typeof source !== 'string' || !source.trim()) return { problems: [`${compactFile} is missing or empty`] };
  const shapes = new Map(), values = new Map(), tests = [], lines = [], problems = [];
  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    try {
      const test = parseLine(line, shapes, values);
      if (test) { tests.push(test); lines.push(index + 1); }
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      problems.push(`${compactFile} line ${index + 1}: ${error.message}`);
    }
  });
  if (!problems.length && !tests.length) problems.push(`${compactFile} has no test lines`);
  if (problems.length) return { problems: problems.slice(0, 20) };
  const locate = problem => { const index = /^test (\d+)/.exec(problem)?.[1]; return index === undefined ? problem : `${problem} (${compactFile} line ${lines[Number(index)]})`; };
  return { tests, lines, locate, text: `[\n${tests.map(test => JSON.stringify(test)).join(',\n')}\n]\n` };
}
export function expandedText(source) {
  const expanded = expandTests(source);
  if (expanded.problems) throw Error(`${compactFile} does not expand: ${expanded.problems[0]}`);
  return expanded.text;
}
export const compactRecord = (source, text) => ({ sha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source), chars: source.length,
  expandedBytes: Buffer.byteLength(text), tests: JSON.parse(text).length });
