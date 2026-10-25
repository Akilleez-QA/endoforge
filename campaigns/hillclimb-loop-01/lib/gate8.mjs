// G8 (loop-1 gate addition; Q-new level only): every range the glue states is enforced by the kernel.
//   For every export argument whose glue `range` is stated as a leading interval or bound ("-40..40 F fit range", ">= 0",
//   "> 0, <= 100"), a value outside it must trap. Descriptive or conditional range strings are not parsed and not enforced.
// A capability that states a fit range it does not enforce (the CC-009 canary) fails here and nowhere in G1–G7.
// NaN inputs are probed on the consumer sheet but not gated here.
import fs from 'node:fs';
import path from 'node:path';
import { loadCapability, parseRange, probeValues } from './sheet.mjs';

export function runGate8(dir) {
  const result = { at: new Date().toISOString(), ok: true, checks: [] };
  let cap;
  try { cap = loadCapability(dir); } catch (e) { result.ok = false; result.why = `cannot load capability: ${e.message}`; fs.writeFileSync(path.join(dir, 'result8.json'), JSON.stringify(result, null, 2) + '\n'); return result; }
  const check = (fn, args, expectTrap, why) => {
    let trapped = false, out = null;
    try { out = cap.fresh().exports[fn](...args); } catch { trapped = true; }
    const ok = expectTrap ? trapped : (!trapped && Number.isFinite(Number(out)));
    result.checks.push({ fn, args: args.map((v) => (Number.isNaN(v) ? 'NaN' : v)), why, expect: expectTrap ? 'trap' : 'finite', got: trapped ? 'trap' : String(out), ok });
    if (!ok) result.ok = false;
  };
  for (const x of cap.glue.exports) {
    if (!cap.exportNames.includes(x.name)) continue;
    const base = cap.tests.find((t) => t.fn === x.name && !t.expectError)?.args;
    if (!base) continue;
    x.args.forEach((a, i) => {
      if (a.kind === 'code') return;
      for (const p of probeValues(parseRange(a.range))) check(x.name, base.map((v, j) => (j === i ? p.v : v)), true, `${a.name} ${p.kind} stated range "${a.range}"`);
    });
  }
  if (!result.ok) result.why = result.checks.filter((c) => !c.ok).slice(0, 8).map((c) => `${c.fn}(${c.args.join(', ')}) ${c.why}: expected ${c.expect}, got ${c.got}`).join('; ');
  fs.writeFileSync(path.join(dir, 'result8.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('gate8.mjs')) {
  const r = runGate8(path.resolve(process.argv[2]));
  console.log(JSON.stringify({ ok: r.ok, why: r.why ?? null, checks: r.checks.length }));
  process.exit(r.ok ? 0 : 1);
}
