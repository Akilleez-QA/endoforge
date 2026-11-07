(function install(host, policyText) {
  'use strict';
  const G = globalThis;
  const { apply, ownKeys, getPrototypeOf, deleteProperty, defineProperty, construct } = Reflect;
  const parse = JSON.parse, stringify = JSON.stringify, GuestError = Error, GuestTypeError = TypeError;
  const GuestRangeError = RangeError, GuestString = String, GuestPromise = Promise, then = Promise.prototype.then;
  const resolve = Promise.resolve, slice = String.prototype.slice, stringIndexOf = String.prototype.indexOf;
  const policy = parse(policyText), grants = policy.grants || {}, outputMax = policy.outputMaxBytes;
  const BINARY = ['ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
  const allowed = new Set(['globalThis', 'Infinity', 'NaN', 'undefined', 'Object', 'Function', 'Array', 'Number', 'Boolean', 'String', 'Symbol', 'BigInt', 'Math', 'JSON', 'Reflect', 'Proxy', 'Promise', 'RegExp', 'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Iterator', 'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'parseFloat', 'parseInt', 'isFinite', 'isNaN', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape', ...(grants.binary ? BINARY : [])]);
  const OTHER_LOCALE = [[Array.prototype, 'toLocaleString'], [Number.prototype, 'toLocaleString'], [BigInt.prototype, 'toLocaleString'], [Object.prototype, 'toLocaleString'],
    [String.prototype, 'localeCompare'], [String.prototype, 'toLocaleUpperCase'], [String.prototype, 'toLocaleLowerCase'],
    [Date.prototype, 'toLocaleString'], [Date.prototype, 'toLocaleDateString'], [Date.prototype, 'toLocaleTimeString']];
  const removeAll = target => {
    for (const key of ownKeys(target)) if (!allowed.has(key) && !deleteProperty(target, key)) throw new GuestError(`cannot remove ${GuestString(key)}`);
  };
  removeAll(G);
  for (let proto = getPrototypeOf(G); proto && proto !== Object.prototype; proto = getPrototypeOf(proto)) removeAll(proto);
  for (const [target, key] of OTHER_LOCALE) deleteProperty(target, key);
  for (const key of ownKeys(Error)) if (!['length', 'name', 'prototype'].includes(key)) deleteProperty(Error, key);
  defineProperty(Error, 'stackTraceLimit', { value: undefined, writable: false, configurable: false });
  defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false, configurable: false });
  defineProperty(G, 'Error', { writable: false, configurable: false });
  deleteProperty(Math, 'random');
  if (grants.random) {
    let state = grants.random.seed | 0;
    Math.random = function random() {
      state = state + 0x6d2b79f5 | 0;
      let mixed = Math.imul(state ^ state >>> 15, 1 | state);
      mixed = mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed) ^ mixed;
      return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
    };
  }
  const RealDate = Date, fixed = grants.clock ? grants.clock.fixedMs : undefined;
  deleteProperty(RealDate, 'now');
  const clockRefused = () => new GuestTypeError('the contract grants no clock');
  const GuestDate = new Proxy(RealDate, {
    apply() { if (fixed === undefined) throw clockRefused(); return apply(RealDate.prototype.toString, construct(RealDate, [fixed]), []); },
    construct(target, args, newTarget) {
      if (args.length) return construct(target, args, newTarget === GuestDate ? target : newTarget);
      if (fixed === undefined) throw clockRefused();
      return construct(target, [fixed], newTarget === GuestDate ? target : newTarget);
    },
  });
  if (fixed !== undefined) defineProperty(RealDate, 'now', { value: function now() { return fixed; }, writable: true, configurable: true });
  defineProperty(RealDate.prototype, 'constructor', { value: GuestDate, writable: true, configurable: true });
  G.Date = GuestDate;
  const portCalls = port => (...args) => {
    if (args.length !== 1) throw new GuestTypeError('a port takes one value');
    const text = stringify(args[0] === undefined ? null : args[0]);
    let reply;
    try { reply = host(port, text); } catch { throw new GuestError('port call failed'); }
    if (typeof reply !== 'string') throw new GuestError('port call failed');
    const decoded = parse(reply);
    if (decoded.refused !== undefined) throw new GuestError(`port refused: ${decoded.refused}`);
    return decoded.value;
  };
  const ports = { __proto__: null };
  for (const name of policy.ports || []) ports[name] = portCalls(name);
  const hostModule = { ports };
  const factories = new Map(), cache = new Map();
  const directoryOf = path => { const parts = path.split('/'); parts.pop(); return parts; };
  const normalize = (from, specifier) => {
    const parts = directoryOf(from);
    for (const part of specifier.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    return parts.join('/');
  };
  const load = path => {
    if (cache.has(path)) return cache.get(path).exports;
    const factory = factories.get(path), module = { exports: {} };
    cache.set(path, module);
    apply(factory, module.exports, [module.exports, specifier => requireFrom(path, specifier), module]);
    return module.exports;
  };
  const requireFrom = (from, specifier) => {
    if (typeof specifier !== 'string') throw new GuestTypeError('module name must be a string');
    if (specifier === 'host:ports') return hostModule.ports;
    if (specifier[0] === '.') {
      const base = normalize(from, specifier);
      for (const path of [base, `${base}.js`, `${base}/index.js`]) if (factories.has(path)) return load(path);
    }
    throw new GuestError(`module not granted: ${specifier}`);
  };
  let outcome = { state: 'never_settled' };
  const describe = value => {
    try { return apply(slice, GuestString(value && value.message !== undefined ? value.message : value), [0, 512]); } catch { return 'unprintable'; }
  };
  const kind = value => {
    try {
      if (value instanceof GuestRangeError && apply(stringIndexOf, value.message, ['call stack']) >= 0) return 'stack';
      if (value instanceof GuestRangeError && apply(stringIndexOf, value.message, ['string length']) >= 0) return 'string_limit';
    } catch { return 'thrown'; }
    return 'thrown';
  };
  const settleValue = value => {
    try {
      const text = stringify(value === undefined ? null : value);
      if (typeof text !== 'string') outcome = { state: 'refused', reason: 'output_not_json' };
      else if (text.length > outputMax) outcome = { state: 'refused', reason: 'output_too_large' };
      else outcome = { state: 'completed', output: text };
    } catch (error) { outcome = { state: 'refused', reason: kind(error), detail: describe(error) }; }
  };
  const settleError = error => { outcome = { state: 'refused', reason: kind(error), detail: describe(error) }; };
  const start = (entry, exportName, inputText) => {
    try {
      const exports = load(entry), value = exports[exportName](parse(inputText));
      if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value) apply(then, apply(resolve, GuestPromise, [value]), [settleValue, settleError]);
      else settleValue(value);
    } catch (error) { settleError(error); }
  };
  defineProperty(G, '__ef_start', { configurable: true, enumerable: false, value: () => { delete G.__ef_start; return start(policy.entry, policy.exportName, policy.input); } });
  return {
    register: (path, factory) => { factories.set(path, factory); },
    collect: () => { try { return stringify(outcome); } catch { return '{"state":"refused","reason":"unprintable"}'; } },
  };
})
