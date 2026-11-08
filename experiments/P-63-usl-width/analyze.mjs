import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fitUsl, usl } from './usl.mjs';

const here = new URL('./receipt/', import.meta.url);
const pred = JSON.parse(readFileSync(new URL('predictions.json', here)));
const rowsOf = (w, label) => { const f = new URL(`measured/${w}-${label}-26.13.0.json`, here); return existsSync(f) ? JSON.parse(readFileSync(f)).rows : []; };
const out = {};
for (const w of Object.keys(pred)) {
  const r1 = rowsOf(w, 'round1'), r2 = rowsOf(w, 'round2');
  const widths = [...new Set([...r1, ...r2].map(r => r.width))].sort((a, b) => a - b);
  const table = widths.map(n => {
    const a = r1.find(r => r.width === n), b = r2.find(r => r.width === n);
    const ok = [a, b].filter(r => r && !r.loaded);
    const accept = ok.length ? Math.min(...ok.map(r => r.perSecond)) : null;
    const hs = [a, b].filter(Boolean).map(r => r.cgroup?.['heavy.slice'] ?? {});
    return { n, round1: a?.perSecond ?? null, round2: b?.perSecond ?? null, loaded: [a?.loaded, b?.loaded], accept, cpuMs: [a?.cpuMsPerAccepted, b?.cpuMsPerAccepted], busyCpus: [a?.busyCpus, b?.busyCpus], ipc: [a?.ipc, b?.ipc],
      dramPerAttempt: [a, b].map(r => r?.perfPerAttempt?.['ls_any_fills_from_sys.dram_io_all'] ?? null), nearCachePerAttempt: [a, b].map(r => r?.perfPerAttempt?.['ls_any_fills_from_sys.near_cache'] ?? null),
      dramGBps: [a, b].map(r => r?.perf?.['ls_any_fills_from_sys.dram_io_all'] ? +(r.perf['ls_any_fills_from_sys.dram_io_all'] * 64 / r.wallMs / 1e6).toFixed(2) : null),
      sliceCpus: hs.map(h => h.cpus ?? null), sliceThrottledMs: hs.map(h => h.throttled_ms ?? null), predicted: pred[w].predict[n] ?? pred[w].anchors[n] ?? null };
  });
  const fit = { lambda: pred[w].lambda, sigma: pred[w].sigma, kappa: pred[w].kappa };
  const newWidths = Object.keys(pred[w].predict).map(Number);
  const errors = newWidths.map(n => { const row = table.find(t => t.n === n); return { n, predicted: pred[w].predict[n], measured: row?.accept ?? null, err: row?.accept ? +((pred[w].predict[n] - row.accept) / row.accept).toFixed(3) : null }; });
  const at16 = table.find(t => t.n === 16)?.accept;
  const scale = at16 ? at16 / usl(16, fit) : null;
  const shapeOnly = newWidths.map(n => { const row = table.find(t => t.n === n); return { n, err: row?.accept && scale ? +((usl(n, fit) * scale - row.accept) / row.accept).toFixed(3) : null }; });
  const samples = table.flatMap(t => [t.round1, t.round2].map((x, i) => ({ n: t.n, x, loaded: t.loaded[i] }))).filter(p => p.x != null && !p.loaded);
  const refitAll = samples.length ? fitUsl(samples) : null;
  const low = samples.filter(p => p.n <= 16), refitLow = low.length ? fitUsl(low) : null;
  const extrap = refitLow ? table.filter(t => t.n > 16 && t.accept).map(t => ({ n: t.n, predictedFromLe16: +usl(t.n, refitLow).toFixed(1), measured: t.accept, err: +((usl(t.n, refitLow) - t.accept) / t.accept).toFixed(3) })) : [];
  const meanOf = t => { const xs = [t.round1, t.round2].filter((x, i) => x != null && !t.loaded[i]); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; };
  const residAll = refitAll ? table.filter(t => meanOf(t)).map(t => ({ n: t.n, err: +((usl(t.n, refitAll) - meanOf(t)) / meanOf(t)).toFixed(3) })) : [];
  const best = table.filter(t => t.accept).reduce((m, t) => (!m || t.accept > m.accept ? t : m), null);
  out[w] = { table, errors, bar1: errors.every(e => e.err !== null && Math.abs(e.err) <= 0.1), shapeOnly, refitAll: refitAll && { sigma: +refitAll.sigma.toFixed(4), kappa: +refitAll.kappa.toExponential(3), peak: +refitAll.peak.toFixed(1), r2: +refitAll.r2.toFixed(3) }, residAll,
    refitLe16: refitLow && { sigma: +refitLow.sigma.toFixed(4), kappa: +refitLow.kappa.toExponential(3), peak: Number.isFinite(refitLow.peak) ? +refitLow.peak.toFixed(1) : null }, extrapolatedPast16: extrap, bestWidth: best && { n: best.n, accept: best.accept }, width16: at16 };
}
const affinity = existsSync(new URL('measured/route-default-affinity-26.13.0.json', here)) ? JSON.parse(readFileSync(new URL('measured/route-default-affinity-26.13.0.json', here))).rows.map(r => ({ n: r.width, perSecond: r.perSecond, busyCpus: r.busyCpus, ipc: r.ipc, loaded: r.loaded, cpuMs: r.cpuMsPerAccepted })) : null;
out.affinity = affinity;
writeFileSync(new URL('analysis.json', here), JSON.stringify(out, null, 1));
for (const [w, r] of Object.entries(out)) { if (w === 'affinity') continue; console.log(`\n## ${w} bar1=${r.bar1} best=${JSON.stringify(r.bestWidth)} w16=${r.width16}`); console.log('n r1 r2 accept pred | busy ipc dram/att nearc/att GB/s sliceCPU thrMs'); for (const t of r.table) console.log(t.n, t.round1, t.round2, t.accept, t.predicted, '|', t.busyCpus.join('/'), t.ipc.join('/'), t.dramPerAttempt.join('/'), t.nearCachePerAttempt.join('/'), t.dramGBps.join('/'), t.sliceCpus.join('/'), t.sliceThrottledMs.join('/'), t.loaded.some(Boolean) ? 'LOADED' : ''); console.log('errors', JSON.stringify(r.errors)); console.log('shape-only', JSON.stringify(r.shapeOnly)); console.log('refit all', JSON.stringify(r.refitAll), 'resid', JSON.stringify(r.residAll)); console.log('refit<=16', JSON.stringify(r.refitLe16), 'extrap', JSON.stringify(r.extrapolatedPast16)); }
console.log('\naffinity', JSON.stringify(affinity));
