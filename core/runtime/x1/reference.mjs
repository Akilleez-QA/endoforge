import { execFile } from 'node:child_process';
const runner = `const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const vm = require('node:vm');
const context = vm.createContext({ Math, Number, Array, Object, JSON, Error, RangeError, TypeError, isFinite, isNaN });
vm.runInContext(input.code, context, { timeout: 2000 });
const out = input.tests.map(t => {
  const f = context[t.fn];
  if (typeof f !== 'function') return { missing: true };
  try { const v = vm.runInContext('f => a => f(...a)', context)(f)(t.args); return { value: typeof v === 'bigint' ? Number(v) : v }; }
  catch (e) { return { error: String(e && e.message || e) }; }
});
process.stdout.write(JSON.stringify(out));`;
export function evaluate(code, tests, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['--permission', '-e', runner], { timeout, maxBuffer: 4 * 1024 * 1024, env: {} }, (error, stdout) => {
      if (error) return reject(Error('reference evaluator failed'));
      resolve(JSON.parse(stdout));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ code, tests }));
  });
}
export async function fillExpected(code, tests) {
  const results = await evaluate(code, tests);
  return tests.map((t, i) => {
    const r = results[i];
    if (r.missing) throw Error(`reference has no function ${t.fn}`);
    if (t.expectError) {
      if (!('error' in r)) throw Error(`reference does not throw for ${t.name}`);
      return t;
    }
    if ('error' in r) throw Error(`reference throws for ${t.name}`);
    const v = r.value;
    if (typeof v === 'boolean') return { ...t, expect: v };
    if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`reference returns a non-finite or non-number value for ${t.name}`);
    const { expect, ...rest } = t;
    return Number.isInteger(v) || Number.isFinite(t.tol) ? { ...rest, expect: v } : { ...rest, expect: v, tol: 1e-9 * Math.max(1, Math.abs(v)) };
  });
}
