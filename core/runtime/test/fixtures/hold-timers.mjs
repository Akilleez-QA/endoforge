export function holdTimers(t, delay) {
  const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
  const held = new Set();
  globalThis.setTimeout = (callback, ms, ...rest) => {
    if (ms !== delay) return realSet(callback, ms, ...rest);
    const handle = { callback };
    held.add(handle);
    return handle;
  };
  globalThis.clearTimeout = handle => { if (!held.delete(handle)) realClear(handle); };
  t.after(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; });
  return {
    get count() { return held.size; },
    fire() {
      const [handle] = held;
      held.delete(handle);
      handle.callback();
    },
  };
}

export function liveTimers(t, delays) {
  const { setTimeout: realSet, clearTimeout: realClear } = globalThis;
  const live = new Map();
  globalThis.setTimeout = (callback, ms, ...rest) => {
    const handle = realSet((...args) => { live.delete(handle); callback(...args); }, ms, ...rest);
    if (delays.includes(ms)) live.set(handle, ms);
    return handle;
  };
  globalThis.clearTimeout = handle => { live.delete(handle); realClear(handle); };
  t.after(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; });
  return () => [...live.values()];
}
