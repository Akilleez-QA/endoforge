// Shared summary statistics. Input: array of numbers. Output: {n, median, p95, min, max, mean}.
export function summarize(xs) {
  const a = Float64Array.from(xs).sort();
  const n = a.length;
  if (n === 0) return { n: 0 };
  const q = (p) => a[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  let sum = 0; for (const x of a) sum += x;
  return { n, median: q(0.5), p95: q(0.95), min: a[0], max: a[n - 1], mean: sum / n };
}
