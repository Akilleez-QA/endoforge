// Re-run each suite with its parts separated: required-input check, cases, properties; report which part rejects, and whether a physics-specific check fires.
import fs from 'node:fs'; import vm from 'node:vm';
const fx = JSON.parse(fs.readFileSync('receipt/fixtures.json', 'utf8')).cases.filter((c) => c.truth !== 'unknown');
const strip = (t) => (String(t).match(/\{[\s\S]*\}/) || [''])[0];
const inst = (w) => new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(w)), { env: { abort() { throw new Error('a'); } } });
const call = (w, fn, args) => { const f = inst(w).exports[fn]; if (typeof f !== 'function') return { missing: true }; try { return { value: Number(f(...args.map((x) => (x === 'NaN' ? NaN : x)))) }; } catch { return { refused: true }; } };
const out = [];
for (const c of fx) for (const arm of ['NEW-sonnet', 'NEW-codex']) {
  const j = JSON.parse(strip(fs.readFileSync(`receipt/suites/${c.request}.${arm}.raw.txt`, 'utf8')));
  const reqFails = (j.requiredInputs ?? []).filter((r) => r.argName == null).map((r) => r.fact.slice(0, 70));
  const caseFails = (j.cases ?? []).filter((t) => { const r = call(c.wasm, t.fn, t.args ?? []); if (r.missing) return true; if (t.refuse) return !(r.refused || !Number.isFinite(r.value)); if (r.refused) return true; return !(Math.abs(r.value - t.expect) <= (t.tol ?? 1e-6)); }).map((t) => t.name.slice(0, 80));
  let propFails = [];
  for (const p of j.properties ?? []) { const f = new vm.Script(`(a, out) => (${p.check})`).runInNewContext({ Math, Number, isFinite }); let s = 20261018 >>> 0; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; for (let i = 0; i < 200; i++) { const a = p.ranges.map(([lo, hi]) => { const v = lo + rnd() * (hi - lo); return Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 20 ? Math.round(v) : v; }); const r = call(c.wasm, p.fn, a); let ok; try { ok = !!f(a, r.refused ? null : r.value); } catch { ok = false; } if (!ok || r.missing) { propFails.push(p.name.slice(0, 80)); break; } } }
  out.push({ request: c.request, kernel: c.kernel, truth: c.truth, arm, rejectByRequired: reqFails.length > 0, rejectByCasesOrProps: caseFails.length + propFails.length > 0, caseFails, propFails, reqFails });
}
fs.writeFileSync('receipt/attribution.json', JSON.stringify(out, null, 1));
for (const o of out) console.log(`${o.request} ${o.kernel} ${o.arm}: required=${o.rejectByRequired} cases/props=${o.rejectByCasesOrProps}\n   cases: ${o.caseFails.join(' | ').slice(0, 260)}\n   props: ${o.propFails.join(' | ').slice(0, 200)}\n   required: ${o.reqFails.join(' | ').slice(0, 260)}`);
