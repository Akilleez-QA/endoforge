import { hash } from '../../../x1/host.mjs';
export function candidate() {
  const files = { 'CONTRACT.md': 'Integer addition on [-10,10].', 'kernel.ts': 'export function add(a:i32,b:i32):i32{return a+b}',
    'tests.json': JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]),
    'glue.json': JSON.stringify({ id: 'addition', assumption: 'Inputs are integers from minus ten to ten.', question: 'Are integer inputs within this range sufficient?',
      exports: [{ name: 'add', label: 'Add two integers', args: ['a', 'b'].map(name => ({ name, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } }], traps: [] }) };
  files['frozen.sha256'] = JSON.stringify({ contract: hash(files['CONTRACT.md']), tests: hash(files['tests.json']) });
  return { id: 'addition', files, compiled: { source: hash(files['kernel.ts']), wasm: 'AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=' } };
}
