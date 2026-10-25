// Analysis helpers for loop 1. Zero dependencies; stats from the loop-0 kit (imported by path, byte-identical).
import { clopperPearson, cohenKappa, rng } from '../../x1-spec-study/lib/stats.mjs';
export { clopperPearson, cohenKappa, rng };

/** Exact binomial two-sided p for k successes of n at p0 = 0.5 (paired sign test on discordant pairs). */
export function signTest(improved, worsened) {
  const n = improved + worsened; if (n === 0) return { n: 0, p: 1 };
  const k = Math.min(improved, worsened);
  let cum = 0; for (let i = 0; i <= k; i++) cum += binom(n, i) / 2 ** n;
  return { n, improved, worsened, p: Math.min(1, 2 * cum) };
}
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }

/** Bootstrap CI (percentile) of the median of paired differences. */
export function bootstrapMedianCI(diffs, { B = 4000, seed = 7, conf = 0.95 } = {}) {
  if (!diffs.length) return null;
  const r = rng(seed); const meds = [];
  for (let b = 0; b < B; b++) { const s = diffs.map(() => diffs[Math.floor(r() * diffs.length)]).sort((a, c) => a - c); meds.push(median(s)); }
  meds.sort((a, c) => a - c);
  return { median: median(diffs.slice().sort((a, c) => a - c)), lower: meds[Math.floor(((1 - conf) / 2) * B)], upper: meds[Math.floor((1 - (1 - conf) / 2) * B) - 1], n: diffs.length };
}
export function median(sorted) { const n = sorted.length; if (!n) return NaN; return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2; }
export function quantile(sorted, q) { if (!sorted.length) return NaN; const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }

/** Difference of two paired binary vectors: counts and a CI on the difference of proportions by paired bootstrap. */
export function pairedBinary(a, b, { B = 4000, seed = 11 } = {}) {
  const n = a.length; let imp = 0, wor = 0, both = 0, neither = 0;
  for (let i = 0; i < n; i++) { if (a[i] && b[i]) both++; else if (!a[i] && !b[i]) neither++; else if (b[i]) imp++; else wor++; }
  const r = rng(seed); const ds = [];
  for (let k = 0; k < B; k++) { let sa = 0, sb = 0; for (let i = 0; i < n; i++) { const j = Math.floor(r() * n); sa += a[j] ? 1 : 0; sb += b[j] ? 1 : 0; } ds.push((sb - sa) / n); }
  ds.sort((x, y) => x - y);
  return { n, a: a.filter(Boolean).length, b: b.filter(Boolean).length, improved: imp, worsened: wor, both, neither, diff: (b.filter(Boolean).length - a.filter(Boolean).length) / n, ci: [ds[Math.floor(0.025 * B)], ds[Math.floor(0.975 * B) - 1]], sign: signTest(imp, wor) };
}

export function brier(forecasts) { const rows = forecasts.filter((f) => f.outcome === 0 || f.outcome === 1).map((f) => ({ ...f, brier: (f.p - f.outcome) ** 2 })); return { n: rows.length, mean: rows.length ? rows.reduce((s, f) => s + f.brier, 0) / rows.length : null, rows }; }

/** Inter-oracle agreement over items scored by all raters. rows: [{item, verdicts: {oracle: level}}]. */
export function agreement(rows, raters) {
  const LEVEL = { clean: 0, 'usable-with-change': 1, 'not-usable': 2 };
  const out = {};
  for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) {
    const a = [], b = []; for (const r of rows) { const va = r.verdicts[raters[i]], vb = r.verdicts[raters[j]]; if (va && vb) { a.push(va); b.push(vb); } }
    const exact = a.filter((x, k) => x === b[k]).length, within1 = a.filter((x, k) => Math.abs(LEVEL[x] - LEVEL[b[k]]) <= 1).length;
    const ab = a.map((x) => (x === 'clean' ? 'clean' : 'not')), bb = b.map((x) => (x === 'clean' ? 'clean' : 'not'));
    out[`${raters[i]}|${raters[j]}`] = { n: a.length, exact, within1, kappa3: cohenKappa(a, b).kappa, cleanAgree: ab.filter((x, k) => x === bb[k]).length, kappaClean: cohenKappa(ab, bb).kappa };
  }
  return out;
}
