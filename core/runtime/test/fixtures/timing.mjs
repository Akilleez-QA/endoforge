import { loadavg } from 'node:os';

export const defaultLoadThreshold = 16;

export function loadGuard(env = process.env, load = () => loadavg()[0]) {
  if (env.ENDOFORGE_LOAD_GUARD !== '1') return null;
  const threshold = env.ENDOFORGE_LOAD_THRESHOLD === undefined ? defaultLoadThreshold : Number(env.ENDOFORGE_LOAD_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold <= 0) throw new TypeError('ENDOFORGE_LOAD_THRESHOLD must be a positive number');
  const value = load();
  return value > threshold ? { load: value, threshold } : null;
}

export function timingOnly(t, label, check, options = {}) {
  const loaded = loadGuard(options.env, options.load);
  if (loaded) {
    t.diagnostic(`skipped-loaded: ${label} (load ${loaded.load.toFixed(2)} > ${loaded.threshold})`);
    return { status: 'skipped-loaded', ...loaded };
  }
  check();
  return { status: 'checked' };
}
