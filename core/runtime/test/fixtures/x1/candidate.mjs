import { hash } from '../../../x1/host.mjs';
const integer = name => ({ name, kind: 'integer', unit: '1' });
export const capabilityFor = (exports, traps = []) => '```capability\n' + JSON.stringify({ exports: exports.map(([name, args]) => ({ name, args: args.map(integer), result: { kind: 'integer', unit: '1' } })), traps }) + '\n```\n';
export const capabilityFence = capabilityFor([['add', ['a', 'b']]]);
const picked = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
export const capabilityFromGlue = glueText => {
  const glue = typeof glueText === 'string' ? JSON.parse(glueText) : glueText;
  const block = { exports: (glue?.exports ?? []).map(entry => ({ name: entry.name, args: (entry.args ?? []).map(arg => picked(arg, ['name', 'kind', 'unit', 'range', 'codes'])),
    result: picked(entry.result, ['kind', 'unit', 'precision', 'rounding', 'codes', 'labels']) })), traps: (glue?.traps ?? []).map(trap => trap.fn) };
  return '```capability\n' + JSON.stringify(block) + '\n```\n';
};
export const withCapability = (contract, glueText) => (String(contract).includes('```capability') ? contract : `${contract}\n\n${capabilityFromGlue(glueText)}`);
export function candidate() {
  const files = { 'CONTRACT.md': `Integer addition on [-10,10].\n\n${capabilityFence}`,'kernel.ts': 'export function add(a:i32,b:i32):i32{return a+b}',
    'tests.json': JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]),
    'glue.json': JSON.stringify({ id: 'addition', assumption: 'Inputs are integers from minus ten to ten.', question: 'Are integer inputs within this range sufficient?',
      exports: [{ name: 'add', label: 'Add two integers', args: ['a', 'b'].map(name => ({ name, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } }], traps: [] }) };
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  return { id: 'addition', files, compiled: { source: hash(files['kernel.ts']), wasm: 'AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=' } };
}
