#!/usr/bin/env node
// S-09 blind-test expectation check.
//   strip <tests.json> <cases.json>              write the test inputs without any expected value (Infinity as 1e999, NaN as "NaN")
//   merge <tests.json> <computed.json> <out.json> <report.json>
//        keep a test when the independent computation agrees (within max(tol, 0.2 % of |value|), refusals must match);
//        drop it when they disagree; keep-and-flag when the checker gave no answer; widen tol when they agree but differ by more than tol.
import fs from 'node:fs';
const [mode, ...f] = process.argv.slice(2);
const enc = (v) => (typeof v === 'number' ? (Number.isNaN(v) ? '"NaN"' : v === Infinity ? '1e999' : v === -Infinity ? '-1e999' : JSON.stringify(v)) : JSON.stringify(v));
const encArgs = (a) => '[' + a.map(enc).join(',') + ']';
const testText = (t) => '{' + Object.entries(t).map(([k, v]) => `${JSON.stringify(k)}:${k === 'args' ? encArgs(v) : enc(v)}`).join(',') + '}';
const tests = JSON.parse(fs.readFileSync(f[0], 'utf8'));
if (mode === 'strip') {
  fs.writeFileSync(f[1], '[\n' + tests.map((t) => testText({ name: t.name, fn: t.fn, args: t.args })).join(',\n') + '\n]\n');
  console.log(`stripped ${tests.length} cases`);
} else if (mode === 'merge') {
  let computed = []; try { computed = JSON.parse(fs.readFileSync(f[1], 'utf8')); } catch {}
  const byName = new Map((Array.isArray(computed) ? computed : []).map((c) => [String(c.name), c.value]));
  const kept = [], report = [];
  for (const t of tests) {
    const c = byName.get(String(t.name));
    const num = (x) => (x === '1e999' ? Infinity : x === '-1e999' ? -Infinity : typeof x === 'string' && x !== 'refuse' && !Number.isNaN(Number(x)) ? Number(x) : x);
    const cv = num(c);
    let action, why;
    if (c === undefined || c === null) { action = 'keep-unchecked'; why = 'checker gave no value'; }
    else if (t.expectError) { if (cv === 'refuse') action = 'keep'; else { action = 'drop'; why = `test expects a refusal, checker computed ${cv}`; } }
    else if (cv === 'refuse') { action = 'drop'; why = `test expects ${t.expect}, checker says the input must be refused`; }
    else if (typeof t.expect === 'boolean' || typeof cv === 'boolean') { const a = t.expect === true || t.expect === 1, b = cv === true || cv === 1; action = a === b ? 'keep' : 'drop'; if (a !== b) why = `boolean disagreement: test ${t.expect}, checker ${cv}`; }
    else if (typeof cv === 'number' && typeof t.expect === 'number') {
      const d = Math.abs(t.expect - cv), win = Math.max(t.tol ?? 0, 0.002 * Math.abs(cv), 1e-9);
      if (d <= win) { action = 'keep'; if (d > (t.tol ?? 0)) { t.tol = +(d + (t.tol ?? 0)).toPrecision(6); action = 'keep-widened'; why = `agree within 0.2 %; tol widened to ${t.tol}`; } }
      else { action = 'drop'; why = `test expects ${t.expect}, checker computed ${cv} (difference ${d.toPrecision(4)} > ${win.toPrecision(4)})`; }
    } else { action = 'keep-unchecked'; why = `incomparable checker value ${JSON.stringify(c)}`; }
    report.push({ name: t.name, fn: t.fn, action, why: why ?? null, expect: t.expectError ? 'refuse' : t.expect, checker: c ?? null });
    if (action !== 'drop') kept.push(t);
  }
  if (!kept.length) { for (const t of tests) kept.push(t); report.push({ action: 'restore-all', why: 'every test would have been dropped; kept the originals and flagged' }); }
  fs.writeFileSync(f[2], '[\n' + kept.map(testText).join(',\n') + '\n]\n');
  const s = report.reduce((m, r) => { m[r.action] = (m[r.action] ?? 0) + 1; return m; }, {});
  fs.writeFileSync(f[3], JSON.stringify({ summary: s, total: tests.length, kept: kept.length, report }, null, 1));
  console.log(JSON.stringify(s));
} else { console.error('usage: testcheck.mjs strip|merge ...'); process.exit(2); }
