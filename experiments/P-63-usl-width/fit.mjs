import { readFileSync, writeFileSync } from 'node:fs';
import { fitUsl, pickWidth, usl } from './usl.mjs';

const here = new URL('./', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, here), 'utf8'));
const rowsOf = (paths, keep, rate) => paths.flatMap(path => read(path).rows.filter(keep).map(row => ({ n: row.width, x: row[rate], loaded: !!row.loaded, source: path.split('/').pop() })));

const P58 = [1, 2].map(r => `../P-58-cohort-typecheck/receipt/route-round${r}-26.13.0.json`);
const P60 = [1, 2, 3, 4].map(r => `receipt/source/p60-route-round${r}.json`);
const P54 = v => `../P-54-contained-js/receipt/pressure/throughput-spin10-${v}.json`;
const P48 = read('../P-48-width/receipt/summary.json').runs;

const workloads = {
  'route fused-reuse16-base (P-60 default)': rowsOf(P60, r => r.check === 'fused-reuse16-base', 'acceptedPerSecond'),
  'route fused fresh (P-58 + P-60)': [...rowsOf(P58, r => r.check === 'fused', 'acceptedPerSecond'), ...rowsOf(P60, r => r.check === 'fused', 'acceptedPerSecond')],
  'route sibling fresh (P-58)': rowsOf(P58, r => r.check === 'sibling', 'acceptedPerSecond'),
  'route fused-reuse-base (P-60)': rowsOf(P60, r => r.check === 'fused-reuse-base', 'acceptedPerSecond'),
  'route supervisor (P-58 + P-60)': [...rowsOf(P58, r => r.check === 'supervisor', 'acceptedPerSecond'), ...rowsOf(P60, r => r.check === 'supervisor', 'acceptedPerSecond')],
  'runtime shared-reuse spin10 Node 26 (P-54)': rowsOf([P54('26.13.0')], r => r.arm === 'shared-reuse', 'perSecond'),
  'runtime shared-reuse spin10 Node 22 (P-54)': rowsOf([P54('22.23.3')], r => r.arm === 'shared-reuse', 'perSecond'),
  'runtime process-cell spin10 Node 26 (P-54)': rowsOf([P54('26.13.0')], r => r.arm === 'process-cell', 'perSecond'),
  'bare check threads (P-58 diagnose)': read('../P-58-cohort-typecheck/receipt/diagnose-26.13.0.json').rows.filter(r => r.kind === 'threads').map(r => ({ n: r.width, x: r.checksPerSecond, loaded: false, source: 'diagnose' })),
  'bare check processes (P-58 diagnose)': read('../P-58-cohort-typecheck/receipt/diagnose-26.13.0.json').rows.filter(r => r.kind === 'processes').map(r => ({ n: r.width, x: r.checksPerSecond, loaded: false, source: 'diagnose' })),
  ...Object.fromEntries(['calibration', 'compiler', 'touch', 'touch-process', 'full-process'].map(arm => [`P-48 ${arm}`, P48.filter(r => r.arm === arm).map(r => ({ n: r.size, x: r.unitsPerSecond, loaded: false, source: 'P-48' }))])),
};

const out = {};
for (const [name, all] of Object.entries(workloads)) {
  const points = all.filter(p => !p.loaded);
  const fit = fitUsl(points);
  const pick = pickWidth(fit, { max: 32 });
  const widths = [...new Set(points.map(p => p.n))].sort((a, b) => a - b);
  const residuals = widths.map(n => { const xs = points.filter(p => p.n === n).map(p => p.x), mean = xs.reduce((s, x) => s + x, 0) / xs.length; return { n, measuredMean: +mean.toFixed(1), fitted: +usl(n, fit).toFixed(1), relErr: +((usl(n, fit) - mean) / mean).toFixed(3) }; });
  const below16 = fitUsl(points.filter(p => p.n <= 16).length >= 3 && new Set(points.filter(p => p.n <= 16).map(p => p.n)).size >= 3 ? points.filter(p => p.n <= 16) : points);
  const at32 = points.filter(p => p.n === 32).map(p => p.x);
  const extrap32 = at32.length ? { predictedFrom1to16: +usl(32, below16).toFixed(1), measuredMean: +(at32.reduce((s, x) => s + x, 0) / at32.length).toFixed(1) } : null;
  out[name] = { lambda: +fit.lambda.toFixed(2), sigma: +fit.sigma.toFixed(4), kappa: +fit.kappa.toExponential(3), peak: Number.isFinite(fit.peak) ? +fit.peak.toFixed(1) : null, r2: +fit.r2.toFixed(3), points: fit.points, excludedLoaded: all.length - points.length, pick, residuals, extrap32, predict: Object.fromEntries([4, 12, 20, 24].map(n => [n, +usl(n, fit).toFixed(1)])) };
}
const target = process.argv[2];
if (target) writeFileSync(target, JSON.stringify(out, null, 1));
for (const [name, r] of Object.entries(out)) console.log(`${name}\n  sigma ${r.sigma} kappa ${r.kappa} N* ${r.peak} pick ${r.pick.width} r2 ${r.r2} n=${r.points} (loaded dropped ${r.excludedLoaded})\n  resid ${r.residuals.map(e => `${e.n}:${(e.relErr * 100).toFixed(1)}%`).join(' ')}\n  predict ${JSON.stringify(r.predict)} 32-from-<=16 ${JSON.stringify(r.extrap32)}`);
