// Statistics for the X1 kit. Zero dependencies. Every function is pure.

/** Natural log of the gamma function (Lanczos approximation, g=7, n=9). */
export function lgamma(x) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized incomplete beta I_x(a, b) by Lentz's continued fraction (Numerical Recipes betacf). */
export function betainc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
  return 1 - bt * betacf(1 - x, b, a) / b;
}

function betacf(x, a, b) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Quantile of Beta(a, b) by bisection on betainc. */
export function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betainc(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact two-sided Clopper–Pearson interval for k successes in n trials. */
export function clopperPearson(k, n, conf = 0.95) {
  if (n <= 0) throw new Error('n must be positive');
  const alpha = 1 - conf;
  const lower = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const upper = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return { k, n, point: k / n, lower, upper, conf };
}

/** One-sided upper 95 % bound (used for "rate below p" claims). */
export function upperBound(k, n, conf = 0.95) {
  return k === n ? 1 : betaQuantile(conf, k + 1, n - k);
}

/** Cohen's kappa for two raters over the same items; labels are any strings. */
export function cohenKappa(a, b) {
  if (a.length !== b.length) throw new Error('rater arrays differ in length');
  const n = a.length;
  if (n === 0) return { kappa: NaN, n: 0, agreement: NaN };
  const labels = [...new Set([...a, ...b])];
  let agree = 0;
  const ca = Object.fromEntries(labels.map(l => [l, 0]));
  const cb = Object.fromEntries(labels.map(l => [l, 0]));
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    ca[a[i]]++; cb[b[i]]++;
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels) pe += (ca[l] / n) * (cb[l] / n);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { kappa, n, agreement: po, expected: pe };
}

/** C01 §3 decision bands at n = 20 and the n = 60 extension rule (DP-6). */
export function decideX1(k, n) {
  const ci = clopperPearson(k, n);
  const straddles = ci.lower < 0.2 && ci.upper > 0.2;
  let band, decision;
  if (n < 60) {
    if (ci.point < 0.10) { band = 'below 10 %'; decision = 'kill'; }
    else if (ci.point <= 0.35) { band = '10–35 %'; decision = 'extend to 60'; }
    else { band = 'above 35 %'; decision = 'pass'; }
  } else {
    band = 'n = 60';
    decision = ci.point < 0.2 ? 'kill' : 'pass';
  }
  return { ...ci, band, decision, pointEstimateDecision: straddles && decision !== 'extend to 60' };
}

/** Seeded PRNG (mulberry32) so order and the blind half are reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, seed) {
  const r = rng(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
