import { execFile } from 'node:child_process';
// Runs model-written reference functions in a permission-restricted child with no
// file, network or child-process access. Each variant gets a fresh context.
const runner = `const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const vm = require('node:vm');
const out = input.variants.map(code => {
  const context = vm.createContext({ Math, Number, Error, RangeError, TypeError, isFinite, isNaN });
  try { vm.runInContext(code, context, { timeout: 2000 }); } catch (e) { return { load: String(e && e.message || e) }; }
  const started = Date.now();
  return { results: input.calls.map(t => {
    const f = context[t.fn];
    if (typeof f !== 'function' || !/^[A-Za-z_$][\\w$]*$/.test(t.fn)) return { missing: true };
    if (Date.now() - started > 4000) return { error: 'budget' };
    try {
      context.__args = t.args;
      const v = vm.runInContext(t.fn + '(...__args)', context, { timeout: 200 });
      if (typeof v === 'number' || typeof v === 'boolean') return { value: Number(v) };
      if (typeof v === 'string') return { value: v };
      if (typeof v !== 'object' || v === null) return { error: 'not a value', invalid: true };
      try {
        context.__value = v;
        const value = JSON.parse(vm.runInContext('JSON.stringify(__value)', context, { timeout: 200 }));
        return value && typeof value === 'object' ? { value } : { error: 'not a value', invalid: true };
      } catch (e) { return { error: String(e && e.message || e).slice(0, 200), invalid: true }; }
    } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
  }) };
});
process.stdout.write(JSON.stringify(out));`;
export function runReferences(variants, calls, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const flag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
    const child = execFile(process.execPath, [flag, '-e', runner], { timeout, maxBuffer: 64 * 1024 * 1024, env: {} }, (error, stdout) => {
      if (error) return reject(Error('reference sandbox failed or timed out'));
      try { resolve(JSON.parse(stdout)); } catch { reject(Error('reference sandbox returned no result')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ variants, calls }));
  });
}
