// Deterministic runner: every suite against every frozen-truth kernel of its request. No model calls.
import fs from 'node:fs'; import vm from 'node:vm';
const fx = JSON.parse(fs.readFileSync('receipt/fixtures.json', 'utf8'));
const cases = fx.cases.filter((c) => c.truth !== 'unknown');
const strip = (t) => { const m = String(t).match(/\{[\s\S]*\}|\[[\s\S]*\]/); return m ? m[0] : ''; };
function loadSuite(id, arm) {
  const raw = (f) => fs.readFileSync(`receipt/suites/${id}.${f}`, 'utf8');
  if (arm === 'OLD-sonnet') return { cases: JSON.parse(raw('OLD-sonnet.tests.json')).map(oldCase), properties: [], requiredInputs: [] };
  if (arm === 'OLD-codex') { const t = raw('OLD-codex.raw.txt'); const m = t.match(/=== FILE: tests\.json ===\s*([\s\S]*?)=== END FILE ===/); return { cases: JSON.parse(m ? m[1] : strip(t)).map(oldCase), properties: [], requiredInputs: [] }; }
  const j = JSON.parse(strip(raw(`${arm}.raw.txt`))); return { cases: (j.cases ?? []).map((c) => ({ name: c.name, fn: c.fn, args: c.args, refuse: !!c.refuse, expect: c.expect, tol: c.tol })), properties: j.properties ?? [], requiredInputs: j.requiredInputs ?? [] };
}
function oldCase(t) { return { name: t.name, fn: t.fn, args: t.args, refuse: !!t.expectError, expect: t.expect, tol: t.tol }; }
const num = (x) => (x === 'NaN' ? NaN : x);
function inst(wasm) { return new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasm)), { env: { abort() { throw new Error('abort'); } } }); }
function callK(k, fn, args) { const f = k.exports[fn]; if (typeof f !== 'function') return { missing: true }; try { const v = f(...args.map(num)); return { value: typeof v === 'bigint' ? Number(v) : Number(v) }; } catch { return { refused: true }; } }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function evaluate(suite, wasm) {
  const fails = [];
  for (const r of suite.requiredInputs) if (r.argName == null || r.argName === '') fails.push(`required input has no argument: ${r.fact}`);
  for (const c of suite.cases) {
    const k = inst(wasm); const r = callK(k, c.fn, c.args ?? []);
    if (r.missing) { fails.push(`case ${c.name}: export ${c.fn} missing`); continue; }
    if (c.refuse) { if (!r.refused && Number.isFinite(r.value)) fails.push(`case ${c.name}: expected refusal, got ${r.value}`); continue; }
    if (r.refused) { fails.push(`case ${c.name}: refused, expected ${c.expect}`); continue; }
    const e = Number(c.expect), tol = c.tol != null ? Number(c.tol) : Math.max(1e-6, Math.abs(e) * 1e-6);
    if (typeof c.expect === 'boolean') { if ((r.value !== 0) !== c.expect) fails.push(`case ${c.name}: expected ${c.expect}, got ${r.value}`); }
    else if (!(Math.abs(r.value - e) <= tol)) fails.push(`case ${c.name}: expected ${e} +/- ${tol}, got ${r.value}`);
  }
  for (const p of suite.properties) {
    let fnCheck; try { fnCheck = new vm.Script(`(a, out) => (${p.check})`).runInNewContext({ Math, Number, isFinite, Infinity, NaN }, { timeout: 200 }); } catch (e) { fails.push(`property ${p.name}: unparsable check`); continue; }
    const rand = rng(20261018); let bad = null;
    for (let s = 0; s < 200 && !bad; s++) {
      const args = (p.ranges ?? []).map(([lo, hi]) => { const intLike = Number.isInteger(lo) && Number.isInteger(hi) && hi - lo <= 20; const v = lo + rand() * (hi - lo); return intLike ? Math.round(v) : v; });
      const k = inst(wasm); const r = callK(k, p.fn, args);
      if (r.missing) { bad = `export ${p.fn} missing`; break; }
      const out = r.refused ? null : r.value; let ok; try { ok = !!fnCheck(args, out); } catch { ok = false; }
      if (!ok) bad = `fails at ${JSON.stringify(args.map((x) => +x.toFixed?.(3) || x))} (out ${out})`;
    }
    if (bad) fails.push(`property ${p.name}: ${bad}`);
  }
  return { accept: fails.length === 0, fails };
}
const arms = ['OLD-sonnet', 'OLD-codex', 'NEW-sonnet', 'NEW-codex']; const rows = [];
for (const c of cases) for (const arm of arms) { let suite; try { suite = loadSuite(c.request, arm); } catch (e) { rows.push({ request: c.request, kernel: c.kernel, truth: c.truth, arm, error: `suite unparsable: ${e.message}` }); continue; } const r = evaluate(suite, c.wasm); rows.push({ request: c.request, kernel: c.kernel, truth: c.truth, arm, verdict: r.accept ? 'accept' : 'reject', correct: (r.accept ? 'accept' : 'reject') === c.truth, nCases: suite.cases.length, nProps: suite.properties.length, nRequired: suite.requiredInputs.length, fails: r.fails.slice(0, 4) }); }
fs.writeFileSync('receipt/results.json', JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.request.padEnd(7)} ${r.kernel.padEnd(8)} truth=${r.truth.padEnd(6)} ${r.arm.padEnd(10)} ${r.error ?? `${r.verdict.padEnd(6)} ${r.correct ? 'OK ' : 'MISS'} [${r.nCases}c/${r.nProps}p/${r.nRequired}r] ${(r.fails[0] ?? '').slice(0, 90)}`}`);
