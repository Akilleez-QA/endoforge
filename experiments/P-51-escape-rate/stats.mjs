import { createHash } from 'node:crypto';
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x, t = x + 5.5, s = 1.000000000190015;
  t -= (x + 0.5) * Math.log(t);
  for (const v of c) s += v / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
function fraction(a, b, x) {
  const floor = v => Math.abs(v) < 1e-300 ? 1e-300 : v;
  let c = 1, d = 1 / floor(1 - (a + b) * x / (a + 1)), h = d;
  for (let m = 1; m <= 1000; m++) {
    const even = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 / floor(1 + even * d); c = floor(1 + even / c); h *= d * c;
    const odd = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 / floor(1 + odd * d); c = floor(1 + odd / c);
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < 1e-15) return h;
  }
  throw Error('incomplete beta did not converge');
}
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const scale = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? scale * fraction(a, b, x) / a : 1 - scale * fraction(b, a, 1 - x) / b;
}
function quantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (incompleteBeta(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function clopperPearson(k, n, confidence = 0.95) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) throw Error('integer counts 0 <= k <= n required');
  if (n === 0) return { k, n, rate: null, lower: null, upper: null, oneSidedUpper: null };
  const alpha = 1 - confidence;
  return { k, n, rate: k / n, lower: k === 0 ? 0 : quantile(alpha / 2, k, n - k + 1), upper: k === n ? 1 : quantile(1 - alpha / 2, k + 1, n - k), oneSidedUpper: k === n ? 1 : quantile(confidence, k + 1, n - k) };
}
export function requiredN(rate, allowedEscapes = 0, confidence = 0.95) {
  let n = allowedEscapes + 1;
  const under = m => clopperPearson(allowedEscapes, m, confidence).oneSidedUpper < rate;
  while (!under(n)) n *= 2;
  let lo = Math.floor(n / 2), hi = n;
  while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (under(mid)) hi = mid; else lo = mid; }
  return hi;
}
export function clusterBootstrap(rows, cluster, escaped, { rounds = 2000, seed = 'P-51' } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = cluster(row);
    if (!groups.has(key)) groups.set(key, [0, 0]);
    const group = groups.get(key); group[1]++; if (escaped(row)) group[0]++;
  }
  const values = [...groups.values()], rates = [];
  if (!values.length) return { clusters: 0, lower: null, upper: null };
  let state = createHash('sha256').update(seed).digest(), offset = 0;
  const next = () => {
    if (offset + 4 > state.length) { state = createHash('sha256').update(state).digest(); offset = 0; }
    const value = state.readUInt32LE(offset); offset += 4; return value;
  };
  for (let r = 0; r < rounds; r++) {
    let k = 0, n = 0;
    for (let i = 0; i < values.length; i++) { const [a, b] = values[next() % values.length]; k += a; n += b; }
    rates.push(k / n);
  }
  rates.sort((a, b) => a - b);
  return { clusters: values.length, lower: rates[Math.floor(rounds * 0.025)], upper: rates[Math.ceil(rounds * 0.975) - 1] };
}
