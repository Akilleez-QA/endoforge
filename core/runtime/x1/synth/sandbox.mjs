import { execFile } from 'node:child_process';
const runner = `const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
if (input.hold > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, input.hold);
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
export const referenceLimits = Object.freeze({ loadMs: 2000, callMs: 400, variantMs: 4400, startupMs: 30000 });
export function referenceDeadline(variants, calls, { startupMs = referenceLimits.startupMs } = {}) {
  const v = Array.isArray(variants) ? variants.length : 0;
  const c = Array.isArray(calls) ? calls.length : 0;
  return startupMs + v * (referenceLimits.loadMs + Math.min(c * referenceLimits.callMs, referenceLimits.variantMs));
}
export function runReferences(variants, calls, { timeout, startupMs, hold = 0 } = {}) {
  const deadline = timeout ?? referenceDeadline(variants, calls, { startupMs });
  return new Promise((resolve, reject) => {
    const flag = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
    const begun = Date.now();
    let timedOut = false;
    const child = execFile(process.execPath, [flag, '-e', runner], { maxBuffer: 64 * 1024 * 1024, env: {} }, (error, stdout) => {
      clearTimeout(timer);
      if (timedOut) return reject(Error(`reference sandbox timed out after ${Date.now() - begun} ms (deadline ${deadline} ms)`));
      if (error) {
        const how = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'exceeded its output limit'
          : error.signal ? `exited with signal ${error.signal}` : `exited with code ${error.code}`;
        return reject(Error(`reference sandbox ${how}`));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(Error('reference sandbox returned no result')); }
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, deadline);
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ variants, calls, hold }));
  });
}
