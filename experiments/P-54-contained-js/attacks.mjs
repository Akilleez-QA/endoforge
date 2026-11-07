const prelude = String.raw`
const rootOf = value => { let at = value; for (let i = 0; i < 64; i++) { const up = Object.getPrototypeOf(at); if (up === null) return at; at = up; } return at; };
const foreign = value => { try { if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false; if (Object.getPrototypeOf(value) === null) return false; return rootOf(value) !== Object.prototype; } catch { return false; } };
const report = { reached: [], foreign: [], notes: {} };
const note = (key, value) => { report.notes[key] = value; };
const use = (P, I, via) => {
  const out = { via };
  const step = (key, run) => { try { out[key] = run(); } catch (error) { out[key] = 'denied:' + String(error && (error.code || error.message)).slice(0, 80); } };
  const need = name => P.getBuiltinModule ? P.getBuiltinModule(name) : null;
  step('env', () => P.env && P.env.EF_CANARY);
  step('read', () => need('node:fs').readFileSync(I.canary, 'utf8'));
  step('write', () => { need('node:fs').writeFileSync(I.marker + '.write', via); return 'wrote'; });
  step('spawn', () => { need('node:child_process').execFileSync('/bin/sh', ['-c', 'echo x > "$0"', I.marker + '.spawn']); return 'spawned'; });
  step('net', () => { need('node:net').connect(I.port, '127.0.0.1'); return 'attempted'; });
  step('worker', () => { const { Worker } = need('node:worker_threads'); new Worker('1', { eval: true }); return 'started'; });
  step('signal', () => { P.kill(I.decoy, 'SIGKILL'); return 'sent'; });
  report.reached.push(out);
};
const tryFunction = (F, I, via) => {
  try { const P = F('return typeof process === "object" ? process : null')(); if (P) use(P, I, via); else note(via, 'no process'); }
  catch (error) { note(via, 'blocked:' + String(error && error.message).slice(0, 80)); }
};
const leakUse = (value, I, via) => {
  try {
    const hostRoot = rootOf(value), fired = [];
    Object.defineProperty(hostRoot, 'then', { configurable: true, get() { fired.push('then'); return undefined; } });
    Object.defineProperty(hostRoot, 'type', { configurable: true, get() { fired.push('type'); return undefined; } });
    hostRoot.__ef_polluted = via;
    note('leakUse', { fired, keys: Object.getOwnPropertyNames(hostRoot).length });
  } catch (error) { note('leakUse', String(error && error.message).slice(0, 60)); }
};
const inspect = (value, I, via) => {
  if (foreign(value)) { report.foreign.push(via); leakUse(value, I, via); try { tryFunction(value.constructor.constructor, I, via); } catch (error) { note(via, 'inspect:' + String(error && error.message).slice(0, 80)); } }
  else { try { if (value && value.constructor && foreign(value.constructor)) { report.foreign.push(via + '.constructor'); tryFunction(value.constructor.constructor, I, via); } } catch {} }
};
`;
const guest = body => `${prelude}\n${body}`;
const main = body => guest(`exports.main = async I => {\n${body}\nreturn report;\n};`);
export const ATTACKS = [
  { name: 'ctor-global', source: main(`inspect(globalThis, I, 'global'); inspect(this, I, 'this'); inspect(Object.getPrototypeOf(globalThis), I, 'globalproto');
    try { tryFunction(globalThis.constructor.constructor, I, 'global.ctor.ctor'); } catch (e) { note('g', String(e)); }
    try { tryFunction(this.constructor.constructor, I, 'this.ctor.ctor'); } catch (e) { note('t', String(e)); }`) },
  { name: 'ctor-function', source: main(`for (const [n, f] of [['arrow', () => {}], ['async', async () => {}], ['gen', function* () {}], ['agen', async function* () {}]]) { inspect(f, I, n); tryFunction(f.constructor, I, n + '.ctor'); }`) },
  { name: 'ctor-handed', source: main(`for (const [n, v] of [['require', require], ['module', module], ['exports', exports], ['input', I], ['ports', (() => { try { return require('host:ports'); } catch (e) { return e; } })()]]) { inspect(v, I, n); try { tryFunction(v.constructor.constructor, I, n + '.ctor.ctor'); } catch (e) { note(n, String(e)); } }`) },
  { name: 'caller-chain', source: guest(`function up(I) { let f = up, seen = []; for (let i = 0; i < 12 && f; i++) { try { f = f.caller; } catch (e) { note('caller' + i, String(e.message)); break; } if (f) { seen.push(String(f.name)); inspect(f, I, 'caller' + i); } } note('seen', seen); }
    exports.main = function (I) { up(I); return report; };`) },
  { name: 'proto-pollution', input: true, ports: { echo: { maxCalls: 4, maxBytes: 10000 } }, source: main(`Object.prototype.polluted = 'guest'; Array.prototype.polluted = 'guest';
    const echo = require('host:ports').echo; if (echo) { const back = echo(JSON.parse('{"__proto__":{"polluted":"port"},"constructor":{"prototype":{"polluted":"port"}}}')); note('backProto', Object.getPrototypeOf(back) === Object.prototype); }
    report.__proto_note = JSON.parse('{"__proto__":{"polluted":"output"},"constructor":{"prototype":{"polluted":"output"}}}');`) },
  { name: 'prepare-stack', source: main(`let hits = []; const hook = (e, sites) => { hits.push(sites.length); for (const s of sites) { for (const m of ['getFunction', 'getThis']) { try { const v = s[m](); if (v) inspect(v, I, 'site.' + m); } catch {} } } return 'x'; };
    for (const [n, a] of [['assign', () => { Error.prepareStackTrace = hook; }], ['define', () => Object.defineProperty(Error, 'prepareStackTrace', { value: hook })], ['replace', () => { globalThis.Error = { prepareStackTrace: hook }; }], ['range', () => { RangeError.prepareStackTrace = hook; }], ['limit', () => { Error.stackTraceLimit = 50; }], ['capture', () => { const o = {}; Error.captureStackTrace(o); return o.stack; }]]) { try { a(); note(n, 'allowed'); } catch (e) { note(n, 'refused:' + String(e.message).slice(0, 60)); } }
    note('stack', String(new Error('x').stack)); note('hits', hits);`) },
  { name: 'import-rejection', expectReason: ['dynamic_import'], source: main(`for (const spec of ['node:fs', 'file://' + I.canary, 'data:text/javascript,export default 1', './nope.js']) { try { const m = await Promise.race([import(spec), new Promise(r => { let n = 0; const tick = () => n++ > 2000 ? r('pending') : Promise.resolve().then(tick); tick(); })]); note(spec, m === 'pending' ? 'pending' : 'imported'); if (m !== 'pending' && m && m.readFileSync) use({ getBuiltinModule: () => m }, I, 'import'); } catch (e) { inspect(e, I, 'import:' + spec); note('rej:' + spec, String(e && e.code || e)); } }`) },
  { name: 'import-then-only', expectReason: ['dynamic_import'], source: guest(`exports.main = I => import('node:fs').then(m => { if (m.readFileSync) use({ getBuiltinModule: () => m }, I, 'import'); return report; }, e => { inspect(e, I, 'importrej'); note('rej', String(e && e.code || e)); return report; });`) },
  { name: 'import-near-overflow', expectReason: ['dynamic_import'], source: guest(`exports.main = I => { const go = () => { try { go(); } catch (e) { try { import('node:fs'); } catch (f) { inspect(f, I, 'import-sync'); } throw e; } }; try { go(); } catch {} return report; };`) },
  { name: 'import-comment-forms', expectReason: ['dynamic_import'], source: guest(`exports.main = () => import/* a */ /* b */
    // c
    ('node:fs');`) },
  { name: 'import-html-comment', expectReason: ['dynamic_import'], source: 'exports.main = () => import<!-- c\n(1);' },
  { name: 'import-in-string-false-positive', expectReason: ['dynamic_import'], source: 'exports.main = () => "import (x)";' },
  { name: 'unhandled-rejection', source: guest(`exports.main = () => { Promise.reject({ get stack() { for (;;); }, get message() { for (;;); } }); Promise.reject(new Error('x')); return { value: 'after rejection' }; };`) },
  { name: 'stack-near-port', ports: { echo: { maxCalls: 100000, maxBytes: 1000 } }, source: guest(`exports.main = I => { const echo = require('host:ports').echo, caught = new Array(5000).fill(null); let count = 0; const go = () => { try { go(); } catch (e) { if (count < 2500) caught[count++] = e; try { echo(1); } catch (f) { if (count < 2500) caught[count++] = f; } throw e; } };
    try { go(); } catch (e) { inspect(e, I, 'top'); } for (let i = 0; i < count; i++) inspect(caught[i], I, 'overflow'); note('count', count); return report; };`) },
  { name: 'stack-near-error', source: guest(`exports.main = I => { const caught = new Array(5000).fill(null); let count = 0; const keep = v => { if (count < 2500) caught[count++] = v; }; const go = () => { try { go(); } catch (e) { keep(e); try { void new Error('x').stack; } catch (f) { keep(f); } try { 1n + 1; } catch (f) { keep(f); } try { null.x; } catch (f) { keep(f); } throw e; } };
    try { go(); } catch (e) { keep(e); } for (let i = 0; i < count; i++) inspect(caught[i], I, 'overflow'); note('count', count); return report; };`) },
  { name: 'port-handler-throws', ports: { boom: { maxCalls: 2, maxBytes: 1000 } }, source: main(`try { require('host:ports').boom(1); note('r', 'returned'); } catch (e) { inspect(e, I, 'boom'); note('m', String(e.message)); }`) },
  { name: 'port-hostile-value', ports: { echo: { maxCalls: 6, maxBytes: 1000 } }, source: main(`const echo = require('host:ports').echo;
    for (const [n, v] of [['getter', { get x() { throw new TypeError('g'); } }], ['tojson', { toJSON() { throw new TypeError('t'); } }], ['cycle', (() => { const a = {}; a.a = a; return a; })()], ['bigint', 1n], ['fn', () => {}], ['large', 'x'.repeat(5000)]]) { try { note(n, echo(v)); } catch (e) { inspect(e, I, 'port-' + n); note(n, 'threw:' + String(e.message).slice(0, 40)); } }
    note('ports', Object.getOwnPropertyNames(require('host:ports')));`) },
  { name: 'ungranted-port', source: main(`try { note('p', Object.keys(require('host:ports'))); } catch (e) { note('e', String(e.message)); } for (const m of ['node:fs', 'fs', 'child_process', '../../../etc/passwd']) { try { const x = require(m); note(m, 'got'); if (x.readFileSync) use({ getBuiltinModule: () => x }, I, 'require'); } catch (e) { note(m, String(e.message).slice(0, 40)); inspect(e, I, m); } }`) },
  { name: 'globals-walk', source: main(`const seen = new Set(); const walk = (v, p, d) => { if (d > 3 || v === null || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) return; seen.add(v); inspect(v, I, p); for (const k of Reflect.ownKeys(v)) { let c; try { const de = Reflect.getOwnPropertyDescriptor(v, k); c = de.value ?? de.get; } catch { continue; } walk(c, p + '.' + String(k), d + 1); } }; walk(globalThis, 'global', 0);
    note('walked', seen.size); note('absent', ['process', 'require', 'Buffer', 'console', 'fetch', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'structuredClone', 'performance', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'ArrayBuffer', 'Uint8Array', 'Intl', 'Temporal', 'WeakRef', 'FinalizationRegistry', 'ShadowRealm', 'eval'].filter(n => typeof globalThis[n] !== 'undefined')); note('names', Object.getOwnPropertyNames(globalThis).sort().join());`) },
  { name: 'codegen', source: main(`for (const [n, f] of [['eval', () => eval('1+1')], ['indirect', () => (0, eval)('1+1')], ['Function', () => Function('return 1')()], ['async', () => (async () => {}).constructor('return 1')()], ['gen', () => (function* () {}).constructor('yield 1')().next()]]) { try { note(n, 'ran:' + String(f())); } catch (e) { note(n, String(e.name)); inspect(e, I, n); } }`) },
  { name: 'shared-memory', source: main(`note('SAB', typeof SharedArrayBuffer); note('Atomics', typeof Atomics); note('Wasm', typeof WebAssembly); try { const m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }); note('sab', String(m.buffer)); } catch (e) { note('mem', String(e.message).slice(0, 60)); }`) },
  { name: 'atomics-wait', source: main(`try { const s = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(s), 0, 0); note('w', 'waited'); } catch (e) { note('w', String(e.message).slice(0, 60)); }`) },
  { name: 'wasm', source: main(`const bytes = [0, 97, 115, 109, 1, 0, 0, 0]; try { new WebAssembly.Module(new Uint8Array(bytes)); note('m', 'compiled'); } catch (e) { note('m', String(e.message).slice(0, 60)); } try { await WebAssembly.instantiate(new Uint8Array(bytes)); note('i', 'instantiated'); } catch (e) { note('i', String(e.message).slice(0, 60)); }`) },
  { name: 'off-heap', source: main(`try { const b = new ArrayBuffer(2 ** 33); note('ab', b.byteLength); } catch (e) { note('ab', String(e.message).slice(0, 60)); } try { const t = new Uint8Array(1); note('ta', 'present'); } catch (e) { note('ta', String(e.message).slice(0, 60)); }`) },
  { name: 'clock-random', source: main(`const tryIt = (n, f) => { try { note(n, String(f())); } catch (e) { note(n, 'refused:' + e.name); } }; tryIt('now', () => Date.now()); tryIt('newDate', () => new Date().getTime()); tryIt('Date()', () => Date()); tryIt('ctorDate', () => new (new Date(0).constructor)().getTime()); tryIt('ctorNow', () => new Date(0).constructor.now()); tryIt('random', () => Math.random()); tryIt('perf', () => performance.now()); tryIt('Intl', () => new Intl.DateTimeFormat().resolvedOptions().timeZone); tryIt('Temporal', () => Temporal.Now.instant()); tryIt('WeakRef', () => new WeakRef({}).deref()); tryIt('FR', () => new FinalizationRegistry(() => {})); tryIt('fixedDate', () => new Date(0).toISOString()); tryIt('tz', () => new Date(0).getTimezoneOffset()); tryIt('locale', () => 'a'.localeCompare('b'));`) },
  { name: 'async-microtask-loop', expectReason: ['deadline'], source: guest(`exports.main = () => { (function loop() { Promise.resolve().then(loop); })(); return 1; };`) },
  { name: 'async-thenable-chain', expectReason: ['deadline'], source: guest(`exports.main = () => { const t = { then(r) { Promise.resolve().then(() => t.then(r)); } }; return Promise.resolve(t); };`) },
  { name: 'async-never', expectReason: ['never_settled'], source: guest(`exports.main = () => new Promise(() => {});`) },
  { name: 'loop', expectReason: ['deadline'], source: guest(`exports.main = () => { for (;;); };`) },
  { name: 'loop-swallow', expectReason: ['deadline'], source: guest(`exports.main = () => { for (;;) { try { for (;;); } catch {} finally { continue; } } };`) },
  { name: 'heap', expectReason: ['heap'], source: guest(`exports.main = () => { const a = []; for (;;) a.push(new Array(1e5).fill(0)); };`) },
  { name: 'heap-objects', expectReason: ['heap'], source: guest(`exports.main = () => { const a = []; for (;;) a.push({ a: 1, b: 2, c: [] }); };`) },
  { name: 'stack', expectReason: ['stack'], source: guest(`exports.main = function f() { return f() + 1; };`) },
  { name: 'string-repeat-limit', source: guest(`exports.main = () => 'x'.repeat(2 ** 30).length;`) },
  { name: 'string-flatten', source: guest(`exports.main = () => { const s = 'x'.repeat(2 ** 29 - 24); return s.indexOf('y'); };`) },
  { name: 'string-flatten-many', source: guest(`exports.main = () => { const kept = []; for (let i = 0; i < 40; i++) { const s = 'x'.repeat(2 ** 28 + i); s.indexOf('y'); kept.push(s); } return kept.length; };`) },
  { name: 'leak-use', source: guest(`exports.main = I => { const caught = new Array(5000).fill(null); let count = 0; const keep = v => { if (count < 4000) caught[count++] = v; }; const actions = [() => new Error('x').stack, () => { throw new Error('y'); }, () => String(Symbol()), () => JSON.parse('{'), () => new Date(NaN).toISOString(), () => [].reduce((a) => a), () => require('nope')]; const go = () => { try { go(); } catch (e) { keep(e); for (const f of actions) { try { f(); } catch (g) { keep(g); } } throw e; } }; try { go(); } catch (e) { keep(e); } for (let i = 0; i < count; i++) inspect(caught[i], I, 'near'); note('count', count); return report; };`) },
  { name: 'string-concat', source: guest(`exports.main = () => { let s = 'ab'; for (;;) { s += s; s.charCodeAt(0); } };`) },
  { name: 'string-pad', source: guest(`exports.main = () => ''.padEnd(2 ** 29 - 24, 'ab').lastIndexOf('c');`) },
  { name: 'string-join', source: guest(`exports.main = () => new Array(2 ** 28).join('xx').length;`) },
  { name: 'string-json', source: guest(`exports.main = () => JSON.stringify('"'.repeat(2 ** 28)).length;`) },
  { name: 'string-regex', source: guest(`exports.main = () => 'x'.repeat(2 ** 28).replace(/x/g, 'yy').length;`) },
  { name: 'string-split', source: guest(`exports.main = () => 'x'.repeat(2 ** 26).split('').length;`) },
  { name: 'array-fatal', source: guest(`exports.main = () => { const a = new Array(2 ** 32 - 1); a.fill(0); return a.length; };`) },
  { name: 'array-grow', source: guest(`exports.main = () => { const a = []; for (let i = 0; ; i++) a[i] = i; };`) },
  { name: 'map-table-limit', source: guest(`exports.main = () => { const m = new Map(); for (let i = 0; ; i++) m.set(i, i); };`) },
  { name: 'set-table-limit', source: guest(`exports.main = () => { const m = new Set(); for (let i = 0; ; i++) m.add(i); };`) },
  { name: 'object-dictionary', source: guest(`exports.main = () => { const o = {}; for (let i = 0; ; i++) o['k' + i] = i; };`) },
  { name: 'bigint-big', source: guest(`exports.main = () => { let b = 3n; for (;;) b = b * b; };`) },
  { name: 'bigint-pow', source: guest(`exports.main = () => String(3n ** (2n ** 40n)).length;`) },
  { name: 'regex-catastrophe', expectReason: ['deadline'], source: guest(`exports.main = () => /(a+)+$/.test('a'.repeat(64) + '!');`) },
  { name: 'regex-huge-pattern', source: guest(`exports.main = () => new RegExp('(a|b)*'.repeat(2 ** 20)).test('x');`) },
  { name: 'regex-deep-pattern', source: guest(`exports.main = () => new RegExp('('.repeat(2 ** 20) + ')'.repeat(2 ** 20)).test('x');`) },
  { name: 'deep-json-parse', source: guest(`exports.main = () => JSON.parse('['.repeat(2 ** 24)).length;`) },
  { name: 'deep-json-stringify', source: guest(`exports.main = () => { let a = []; for (let i = 0; i < 1e6; i++) a = [a]; return JSON.stringify(a).length; };`) },
  { name: 'deep-flat', source: guest(`exports.main = () => { let a = [1]; for (let i = 0; i < 1e6; i++) a = [a]; return a.flat(Infinity).length; };`) },
  { name: 'deep-proxy', source: guest(`exports.main = () => { let p = {}; for (let i = 0; i < 1e6; i++) p = new Proxy(p, {}); return p.x; };`) },
  { name: 'deep-bind', source: guest(`exports.main = () => { let f = () => 1; for (let i = 0; i < 1e6; i++) f = f.bind(); return f(); };`) },
  { name: 'deep-tostring', source: guest(`exports.main = () => { let a = []; for (let i = 0; i < 1e6; i++) a = [a]; return String(a).length; };`) },
  { name: 'sort-big', source: guest(`exports.main = () => { const a = Array.from({ length: 4e6 }, (_, i) => 4e6 - i); a.sort(() => { for (;;); }); return a[0]; };`) },
  { name: 'poison-result', source: guest(`const then = Promise.prototype.then; Promise.prototype.then = function () { throw new Error('poison then'); }; JSON.stringify = () => { throw new Error('poison stringify'); }; JSON.parse = () => { throw new Error('poison parse'); };
    exports.main = () => ({ get then() { throw new TypeError('poison thenable'); }, toJSON() { throw new TypeError('poison tojson'); }, [Symbol.toPrimitive]() { throw new TypeError('poison primitive'); } });`) },
  { name: 'poison-tojson-output', source: guest(`exports.main = () => ({ toJSON() { return { value: 'from toJSON', proto: JSON.parse('{"__proto__":{"polluted":"output"}}') }; } });`) },
  { name: 'non-json-outputs', source: guest(`exports.main = () => function () {};`) },
  { name: 'output-too-large', expectReason: ['output_too_large'], source: guest(`exports.main = () => 'x'.repeat(2 ** 22);`) },
  { name: 'import-meta-syntax', expectReason: ['compile'], source: 'exports.main = () => import.meta.url;' },
  { name: 'esm-syntax', expectReason: ['compile'], source: 'export const main = () => 1;' },
  { name: 'wrapper-break', expectReason: ['compile'], source: '}); globalThis.pwned = 1; (function () {' },
];
export const ASSUME_BREACH = { name: 'assume-breach', source: main(`const b = globalThis.__breach(); const P = b.process, req = b.require;
  note('processKeysLeft', ['binding', 'kill', '_kill', 'getBuiltinModule', 'dlopen', 'mainModule'].filter(k => typeof P[k] === 'function' || P[k])); note('hasRequire', !!req);
  use(req ? { env: P.env, kill: P.kill, getBuiltinModule: n => req(n) } : P, I, 'breach');
  try { tryFunction(b.Function, I, 'breach.Function'); } catch (e) { note('f', String(e)); }
  try { const r = P.binding && P.binding('fs'); note('binding', r ? 'present' : 'absent'); } catch (e) { note('binding', String(e.code || e.message).slice(0, 80)); }
  try { P.dlopen({ exports: {} }, I.canary); note('dlopen', 'loaded'); } catch (e) { note('dlopen', String(e.code || e.message).slice(0, 80)); }`) };
export const DEPTH = guest(`exports.main = () => { let depth = 0; const go = () => { depth += 1; go(); }; try { go(); } catch {} return depth; };`);
export const FATAL_KINDS = ['string-regex', 'array-fatal', 'map-table-limit', 'object-dictionary'];
export const BREACHES = {
  heap: `exports.main = () => { const a = []; for (;;) a.push(new Array(1e5).fill(0)); };`,
  loop: `exports.main = () => { for (;;); };`,
  stack: `exports.main = function f() { return f() + 1; };`,
};
export const BENIGN = `exports.main = I => { let total = 0; for (let i = 0; i < I.spin; i++) total = (total + i * 31) % 1000003; return { total, kind: 'benign' }; };`;
