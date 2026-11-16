#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const settings = (() => { try { return JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR ?? '.', 'stand-in.json'), 'utf8')); } catch { return {}; } })();
const argv = process.argv.slice(2);
if (argv[0] === 'auth' && argv[1] === 'status') {
  process.stdout.write(`${JSON.stringify({ loggedIn: settings.loggedIn ?? true, authMethod: settings.authMethod ?? 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' })}\n`);
  process.exit(0);
}
if (argv[0] === '--version') { process.stdout.write('stand-in (P-72 test double, no model)\n'); process.exit(0); }

const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const capability = glue => '```capability\n' + JSON.stringify({ exports: glue.exports.map(entry => ({ name: entry.name, args: entry.args.map(({ name, kind, unit, range }) => ({ name, kind, unit, ...(range ? { range } : {}) })),
  result: entry.result })), traps: glue.traps.map(trap => trap.fn) }) + '\n```\n';

const h01Glue = id => ({ id, assumption: 'Mechanical horsepower of 745.699872 W.', question: 'How many horsepower is this electrical power?',
  exports: [{ name: 'kwToHp', label: 'Horsepower', args: [{ name: 'kw', kind: 'number', unit: 'kW', range: '0..10000' }], result: { kind: 'number', unit: 'hp', precision: 3 } }],
  traps: [{ fn: 'kwToHp', when: 'kw outside 0..10000 or NaN', message: 'Input is out of range.' }] });
const h05Glue = id => ({ id, assumption: 'Temperatures in degrees Fahrenheit.', question: 'Is the subcooling in its target band?',
  exports: [{ name: 'subcoolingF', label: 'Subcooling', args: [{ name: 'saturatedCondensingF', kind: 'number', unit: 'F', range: '-100..200' }, { name: 'liquidLineF', kind: 'number', unit: 'F', range: '-100..200' }], result: { kind: 'number', unit: 'F', precision: 1 } },
    { name: 'subcoolStatus', label: 'Subcooling status', args: [{ name: 'subcoolF', kind: 'number', unit: 'F' }, { name: 'targetLowF', kind: 'number', unit: 'F' }, { name: 'targetHighF', kind: 'number', unit: 'F' }], result: { kind: 'integer', unit: '1' } }],
  traps: [{ fn: 'subcoolingF', when: 'an input outside -100..200', message: 'Temperature is out of range.' }, { fn: 'subcoolStatus', when: 'targetLowF > targetHighF or NaN', message: 'The target band is invalid.' }] });

const specification = {
  H01: ({ oracle, wrong }) => {
    const contract = `# kwToHp\n\nkwToHp(kw: f64): f64 converts kilowatts to mechanical horsepower.\n\nkwToHp = kw * 1000 / 745.699872\n\nValid input is 0 <= kw <= 10000; any other input traps with abort(). Show 3 decimal places.\n\n${capability(h01Glue('x'))}`;
    const tests = [{ name: 'small', fn: 'kwToHp', args: [0.5], expect: 0.5 * 1000 / 745.699872, tol: 1e-9 }, { name: 'one', fn: 'kwToHp', args: [1], expect: wrong ? 1.3412 : 1000 / 745.699872, tol: 1e-9 },
      { name: 'neg', fn: 'kwToHp', args: [-1], expectError: true }];
    const reference = 'function kwToHp(kw) { if (!(kw >= 0 && kw <= 10000)) throw new Error("range"); return kw * 1000 / 745.699872; }';
    return { 'CONTRACT.md': contract, 'tests.json': JSON.stringify(tests), ...(oracle ? { 'reference.js': reference } : {}) };
  },
  H05: ({ oracle }) => {
    const contract = `# Subcooling\n\nsubcoolingF(saturatedCondensingF: f64, liquidLineF: f64): f64 returns saturatedCondensingF - liquidLineF; both inputs must be in -100..200, otherwise it traps with abort().\n\nsubcoolingF = saturatedCondensingF - liquidLineF\n\nsubcoolStatus(subcoolF: f64, targetLowF: f64, targetHighF: f64): i32 returns 0 below the band, 1 inside it, 2 above it. subcoolStatus traps with abort() on NaN input or when targetLowF > targetHighF.\n\nShow 1 decimal place.\n\n${capability(h05Glue('x'))}`;
    const tests = [{ name: 'sub', fn: 'subcoolingF', args: [110, 90], expect: 20, tol: 1e-9 }, { name: 'subRange', fn: 'subcoolingF', args: [201, 90], expectError: true },
      { name: 'below', fn: 'subcoolStatus', args: [7, 8, 14], expect: 0 }, { name: 'inside', fn: 'subcoolStatus', args: [10, 8, 14], expect: 1 }, { name: 'above', fn: 'subcoolStatus', args: [20, 8, 14], expect: 2 },
      { name: 'band', fn: 'subcoolStatus', args: [10, 14, 8], expectError: true }];
    const reference = 'function subcoolingF(s, l) { if (!(s >= -100 && s <= 200 && l >= -100 && l <= 200)) throw new Error("range"); return s - l; }\nfunction subcoolStatus(x, lo, hi) { if (Number.isNaN(x) || Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) throw new Error("band"); return x < lo ? 0 : x <= hi ? 1 : 2; }';
    return { 'CONTRACT.md': contract, 'tests.json': JSON.stringify(tests), ...(oracle ? { 'reference.js': reference } : {}) };
  },
};

const h01Kernel = divisor => `export function kwToHp(kw: f64): f64 { if (!(kw >= 0 && kw <= 10000)) abort(); return kw * 1000 / ${divisor}; }`;
const h05Kernel = ({ guard = 'finite', upper = '<=' } = {}) => `export function subcoolingF(saturatedCondensingF: f64, liquidLineF: f64): f64 {
  if (!(saturatedCondensingF >= -100 && saturatedCondensingF <= 200 && liquidLineF >= -100 && liquidLineF <= 200)) abort();
  return saturatedCondensingF - liquidLineF;
}
export function subcoolStatus(subcoolF: f64, targetLowF: f64, targetHighF: f64): i32 {
  ${guard === 'finite' ? 'if (!isFinite(subcoolF) || !isFinite(targetLowF) || !isFinite(targetHighF)) abort();' : 'if (isNaN(subcoolF) || isNaN(targetLowF) || isNaN(targetHighF)) abort();'}
  if (targetLowF > targetHighF) abort();
  if (subcoolF < targetLowF) return 0;
  if (subcoolF ${upper} targetHighF) return 1;
  return 2;
}`;
const edit = (path, content) => ({ name: 'edit_file', path, content });

function implementation(state) {
  const { need, arm, sample, id } = state, turn = state.implTurn;
  if (need === 'H01') {
    const glue = edit('glue.json', JSON.stringify(h01Glue(id)));
    if (arm === 'main' && sample === 3) return [edit('kernel.ts', h01Kernel('746.0')), glue, { name: 'done' }];
    if (turn === 1) return [edit('kernel.ts', h01Kernel('746.0')), glue, { name: 'check' }];
    if (turn === 2) return [edit('kernel.ts', h01Kernel('745.699872')), { name: 'check' }];
    return [{ name: 'done' }];
  }
  const glue = edit('glue.json', JSON.stringify(h05Glue(id)));
  if (arm === 'fixed' && sample === 0) return [edit('kernel.ts', h05Kernel({ upper: '<' })), glue, { name: 'done' }];
  if (arm === 'compact' && sample === 1 && turn === 1) return [edit('kernel.ts', h05Kernel({ guard: 'nan' })), glue, { name: 'check' }];
  return [edit('kernel.ts', h05Kernel()), glue, { name: 'done' }];
}

let state = null, cost = 0;
createInterface({ input: process.stdin }).on('line', line => {
  const text = JSON.parse(line).message.content[0].text;
  emit({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], apiKeySource: 'none', mcp_servers: [], model: 'stand-in' });
  if (text === '/clear') { state = null; return emit({ type: 'result', is_error: false, result: '', usage: {}, duration_api_ms: 0 }); }
  if (settings.mode === 'errors') return emit({ type: 'result', is_error: true, result: 'stand-in transport error', usage: {}, duration_api_ms: 0 });
  const id = text.match(/"id":"([^"]+)"/)?.[1];
  if (id) {
    const [need, arm, sample] = id.split('--');
    state = { ...(state ?? { specTurn: 0, implTurn: 0 }), id, need, arm, sample: Number(sample) };
  }
  if (text.includes('"stage":"implementation"')) state.stage = 'implementation';
  else if (text.includes('"stage":"specification"')) state.stage = 'specification';
  let calls;
  if (state.stage === 'specification') {
    state.specTurn += 1;
    const files = specification[state.need]({ oracle: text.includes('reference.js') || state.oracle, wrong: state.arm === 'oracle' && state.sample === 0 && state.specTurn === 1 });
    state.oracle ||= text.includes('reference.js');
    calls = [...Object.entries(files).map(([path, content]) => edit(path, content)), { name: 'done' }];
  } else {
    state.implTurn += 1;
    calls = implementation(state);
  }
  cost += 0.002;
  const output = state.stage === 'specification' ? 2000 : 1000;
  emit({ type: 'result', is_error: false, structured_output: { calls }, usage: { input_tokens: 10, output_tokens: output }, duration_api_ms: 5, total_cost_usd: cost });
});
