// Post-hoc (not part of the P-08 precommit): CC-034's kernels against the property core, a deterministic sourced eval.
import fs from 'node:fs'; import { satF, source } from '../../../tools/property-core/lookup.mjs';
const L1 = '/home/user/Work/endoforge/campaigns/hillclimb-loop-01/work/runs/s5';
const out = { at: new Date().toISOString(), label: 'post-hoc, not precommitted', reference: `${source.library} ${source.version} (${source.gitrevision.slice(0, 10)}), R-404A dew line, sea level`, tolF: 1.0, kernels: [] };
for (const arm of ['A-inc-low', 'B-Snew-Gnew', 'E-Snew-Gnew-D02']) {
  const w = `${L1}/${arm}-CC-034/CC-034/kernel.wasm`; if (!fs.existsSync(w)) continue;
  const mod = new WebAssembly.Module(fs.readFileSync(w)); const ex = WebAssembly.Module.exports(mod).filter((e) => e.kind === 'function').map((e) => e.name);
  const fn = ex.find((n) => /sat/i.test(n) && /404/i.test(n)) ?? ex.find((n) => /sat/i.test(n));
  const pts = [];
  for (const p of [0, 15, 32.6, 85.4, 147.4, 236.8, 312.1]) {
    const k = new WebAssembly.Instance(mod, { env: { abort() { throw new Error('a'); } } }); let got = null;
    const arity = k.exports[fn]?.length ?? 0; const args = [p, 0, 0, 0].slice(0, Math.max(arity, 1));
    try { got = Number(k.exports[fn](...args)); } catch { got = 'refused'; }
    const ref = satF('R-404A', p); pts.push({ psig: p, kernelF: typeof got === 'number' ? +got.toFixed(2) : got, coreDewF: +ref.toFixed(2), deltaF: typeof got === 'number' ? +(got - ref).toFixed(2) : null });
  }
  const worst = Math.max(...pts.filter((x) => x.deltaF != null).map((x) => Math.abs(x.deltaF)));
  out.kernels.push({ arm: arm[0], fn, exports: ex, verdict: worst <= out.tolF ? 'accept' : 'reject', worstDeltaF: worst, points: pts });
}
fs.writeFileSync('experiments/P-08-request-blind-evals/receipt/cc034-core-check.json', JSON.stringify(out, null, 1));
for (const k of out.kernels) console.log(k.arm, k.fn, k.verdict, 'worst', k.worstDeltaF, 'F |', k.points.map((p) => `${p.psig}:${p.deltaF}`).join(' '));
