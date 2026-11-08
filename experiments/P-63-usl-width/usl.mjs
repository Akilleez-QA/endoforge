export const usl = (n, { lambda, sigma, kappa }) => lambda * n / (1 + sigma * (n - 1) + kappa * n * (n - 1));

const shape = (n, sigma, kappa) => n / (1 + sigma * (n - 1) + kappa * n * (n - 1));

function scored(points, sigma, kappa) {
  let xg = 0, gg = 0;
  for (const { n, x } of points) { const g = shape(n, sigma, kappa); xg += x * g; gg += g * g; }
  const lambda = gg > 0 ? xg / gg : 0;
  let sse = 0;
  for (const { n, x } of points) { const r = x - lambda * shape(n, sigma, kappa); sse += r * r; }
  return { lambda, sigma, kappa, sse };
}

export function fitUsl(input) {
  const points = input.map(p => Array.isArray(p) ? { n: p[0], x: p[1] } : p).filter(p => p.n >= 1 && Number.isFinite(p.x));
  if (new Set(points.map(p => p.n)).size < 3) throw new Error('fitUsl needs at least three distinct widths');
  const KMAX = 0.25, steps = 120;
  const kappaAt = t => t <= 0 ? 0 : KMAX * 10 ** (-7 * (1 - t));
  let best = null;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const fit = scored(points, i / steps, kappaAt(j / steps));
    if (!best || fit.sse < best.sse) best = { ...fit, i: i / steps, j: j / steps };
  }
  let span = 1 / steps;
  for (let round = 0; round < 40; round++) {
    const centre = best;
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
      const i = Math.min(1, Math.max(0, centre.i + a * span / 4)), j = Math.min(1, Math.max(0, centre.j + b * span / 4));
      const fit = scored(points, i, kappaAt(j));
      if (fit.sse < best.sse) best = { ...fit, i, j };
    }
    span /= 2;
  }
  const { lambda, sigma, kappa, sse } = best;
  const peak = kappa > 0 ? Math.sqrt(Math.max(0, 1 - sigma) / kappa) : Infinity;
  const mean = points.reduce((s, p) => s + p.x, 0) / points.length;
  const sst = points.reduce((s, p) => s + (p.x - mean) ** 2, 0);
  return { lambda, sigma, kappa, peak, sse, r2: sst > 0 ? 1 - sse / sst : 1, points: points.length };
}

export function pickWidth(fit, { min = 1, max = 32 } = {}) {
  let width = min, rate = -Infinity;
  for (let n = min; n <= max; n++) { const x = usl(n, fit); if (x > rate) { rate = x; width = n; } }
  return { width, predicted: rate };
}

export async function calibrateWidth(measure, { widths = [1, 4, 8, 16, 24, 32], min = 1, max = 32 } = {}) {
  const started = performance.now(), points = [];
  for (const n of widths) points.push({ n, x: await measure(n) });
  const fit = fitUsl(points);
  return { ...pickWidth(fit, { min, max }), fit, points, calibrationMs: Math.round(performance.now() - started) };
}
