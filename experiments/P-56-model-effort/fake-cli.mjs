#!/usr/bin/env node
// Test double for the runner's smoke check only: a stream-json CLI stand-in that writes an
// H01 specification, then a wrong kernel, then the right one, so one failed round, a
// promotion and the held-out check are all exercised without a model.
import { createInterface } from 'node:readline';
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const contract = 'kwToHp(kw) = kw*1000/745.699872 for 0<=kw<=10000, else abort. Show 3 decimal places.';
const tests = JSON.stringify([{ name: 'zero', fn: 'kwToHp', args: [0], expect: 0 }, { name: 'one', fn: 'kwToHp', args: [1], expect: 1.341022089595028, tol: 1e-9 }, { name: 'neg', fn: 'kwToHp', args: [-1], expectError: true }]);
const kernel = divisor => `export function kwToHp(kw:f64):f64{if(!(kw>=0&&kw<=10000))abort();return kw*1000/${divisor}}`;
let implementationTurns = 0, cost = 0;
createInterface({ input: process.stdin }).on('line', line => {
  const text = JSON.parse(line).message.content[0].text;
  emit({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], apiKeySource: 'none', mcp_servers: [], model: 'fake' });
  if (text === '/clear') return emit({ type: 'result', is_error: false, result: '', usage: {}, duration_api_ms: 0 });
  let calls;
  const id = text.match(/"id":"([^"]+)"/)?.[1];
  if (text.includes('"stage":"specification"')) calls = [{ name: 'edit_file', path: 'CONTRACT.md', content: contract }, { name: 'edit_file', path: 'tests.json', content: tests }, { name: 'done' }];
  else {
    implementationTurns += 1;
    const glue = { id: id ?? 'unknown', assumption: 'Mechanical horsepower.', question: 'How many horsepower?', exports: [{ name: 'kwToHp', label: 'Horsepower', args: [{ name: 'kw', kind: 'number', unit: 'kW' }], result: { kind: 'number', unit: 'hp', precision: 3 } }],
      traps: [{ fn: 'kwToHp', when: 'kw outside 0..10000', message: 'Out of range.' }] };
    calls = implementationTurns === 1 ? [{ name: 'edit_file', path: 'kernel.ts', content: kernel('746.0') }, { name: 'edit_file', path: 'glue.json', content: JSON.stringify(glue) }, { name: 'check' }]
      : [{ name: 'edit_file', path: 'kernel.ts', content: kernel('745.699872') }, { name: 'done' }];
  }
  cost += 0.001;
  emit({ type: 'result', is_error: false, structured_output: { calls }, usage: { input_tokens: 10, output_tokens: 20 }, duration_api_ms: 5, total_cost_usd: cost });
});
