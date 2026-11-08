import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeSpecification } from '../../core/runtime/x1/oracle.mjs';
import { heldOut } from '../P-56-model-effort/heldout.mjs';
import { hNeeds } from '../P-56-model-effort/needs.mjs';

export function rivalRounds(rounds) {
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].failures && rounds[i - 1].failures && JSON.stringify(rounds[i].failures) === JSON.stringify(rounds[i - 1].failures)) return { rounds: rounds.slice(0, i + 1), stopped: true };
  }
  return { rounds, stopped: false };
}
const failedOf = rounds => rounds.filter(round => round.failures).length;

export function arms(rows) {
  const base = rows.filter(row => row.arm === 'base'), oracle = rows.filter(row => row.arm === 'oracle');
  const rival = base.map(row => { const cut = rivalRounds(row.rounds); return { ...row, arm: 'rival', rounds: cut.rounds, promoted: cut.stopped ? false : row.promoted, stopped: cut.stopped,
    calls: cut.stopped ? row.calls - (row.rounds.length - cut.rounds.length) : row.calls }; });
  return { base, oracle, rival };
}

const summary = list => {
  const promoted = list.filter(row => row.promoted).length, failed = list.reduce((n, row) => n + failedOf(row.rounds), 0), calls = list.reduce((n, row) => n + row.calls, 0);
  const escapes = list.filter(row => row.promoted && row.heldOut && !row.heldOut.clean).length;
  return { runs: list.length, promoted, failed, perPromoted: promoted ? failed / promoted : null, calls, callsPerPromoted: promoted ? calls / promoted : null, escapes, failedRuns: list.filter(row => !row.promoted).length };
};

function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function ratioInterval(treated, control, { resamples = 10000, seed = 69 } = {}) {
  const slots = [...new Set(control.map(row => `${row.need}/${row.rep}`))].filter(key => treated.some(row => `${row.need}/${row.rep}` === key));
  const pick = (list, key) => list.find(row => `${row.need}/${row.rep}` === key);
  const pairs = slots.map(key => ({ t: pick(treated, key), c: pick(control, key) }));
  const ratio = sample => {
    const tf = sample.reduce((n, p) => n + failedOf(p.t.rounds), 0), tp = sample.filter(p => p.t.promoted).length;
    const cf = sample.reduce((n, p) => n + failedOf(p.c.rounds), 0), cp = sample.filter(p => p.c.promoted).length;
    if (!tp || !cp || !cf) return null;
    return (tf / tp) / (cf / cp);
  };
  const random = seeded(seed), values = [];
  for (let i = 0; i < resamples; i++) { const value = ratio(pairs.map(() => pairs[Math.floor(random() * pairs.length)])); if (value !== null) values.push(value); }
  values.sort((a, b) => a - b);
  return { pairs: pairs.length, point: ratio(pairs), low: values[Math.floor(0.025 * values.length)] ?? null, high: values[Math.floor(0.975 * values.length) - 1] ?? null, usable: values.length };
}

function siblingOutcome(content, test) {
  const probe = { name: test.name, fn: test.fn, args: test.args, ...(test.expectError ? { expectError: true } : { expect: test.expect, ...(Number.isFinite(test.tol) ? { tol: test.tol } : {}) }) };
  const result = heldOut(content, [probe]);
  if (result.reason) return null;
  if (result.clean) return test.expectError ? { trap: true } : { value: test.expect };
  const got = result.failed[0]?.got;
  return typeof got === 'number' ? { value: got } : { trap: true };
}
const near = (a, b, tol) => a.trap || b.trap ? Boolean(a.trap) === Boolean(b.trap) : typeof a.value === 'number' && typeof b.value === 'number' && Math.abs(a.value - b.value) <= Math.max(tol, 1e-9 * Math.max(1, Math.abs(b.value)));

export function truthFor(row, test, contents) {
  const fn = hNeeds.find(h => h.id === row.need)?.reference?.[test.fn];
  if (fn) { if (!test.args.every(Number.isFinite)) return null; try { return { value: fn(...test.args), source: 'reference' }; } catch { return { trap: true, source: 'reference' }; } }
  const seen = contents.filter(c => c.need === row.need && c.key !== `${row.arm}/${row.rep}` && c.promoted).map(c => siblingOutcome(c.content, test)).filter(Boolean);
  for (const candidate of seen) {
    const agreeing = seen.filter(other => near(other, candidate, 0));
    if (agreeing.length >= 2 && agreeing.length * 2 > seen.length) return { ...candidate, source: 'siblings' };
  }
  return null;
}

export function frozenLabels(rows, output, stage) {
  const contents = rows.map(row => { const path = join(output, stage, `${row.need}--${row.arm}--${row.rep}.content.json`); return existsSync(path) ? { need: row.need, key: `${row.arm}/${row.rep}`, promoted: row.promoted, content: readFileSync(path, 'utf8') } : null; }).filter(Boolean);
  const out = [];
  for (const row of rows) {
    const mine = contents.find(c => c.need === row.need && c.key === `${row.arm}/${row.rep}`);
    if (!mine) continue;
    const files = JSON.parse(mine.content).files, tests = JSON.parse(files['tests.json']);
    const analysis = row.arm === 'base' ? analyzeSpecification({ 'CONTRACT.md': files['CONTRACT.md'], 'tests.json': files['tests.json'] }, { reference: false }) : null;
    tests.forEach((test, index) => {
      if (!Array.isArray(test.args)) return;
      const truth = truthFor(row, test, contents), literal = test.expectError ? { trap: true } : { value: test.expect };
      const label = !truth ? 'unknown' : typeof test.expect === 'string' || typeof test.expect === 'boolean' ? 'unknown' : near(literal, truth, Number.isFinite(test.tol) ? test.tol : 0) ? 'correct' : 'wrong';
      out.push({ need: row.need, arm: row.arm, rep: row.rep, index, label, truthSource: truth?.source ?? null, offline: analysis?.decisions[index]?.status ?? null });
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [output, stage = 'main'] = process.argv.slice(2);
  const rows = readFileSync(join(output, 'rows.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.stage === stage);
  const { base, oracle, rival } = arms(rows);
  const labels = frozenLabels([...base, ...oracle], output, stage);
  const baseLabels = labels.filter(l => l.arm === 'base'), oracleLabels = labels.filter(l => l.arm === 'oracle');
  const oracleReports = oracle.map(row => row.oracle).filter(Boolean);
  const freeze = oracleReports.map(report => report.ms).sort((a, b) => a - b);
  const result = {
    arms: { base: summary(base), oracle: summary(oracle), rival: summary(rival) },
    ratio: { oracle: ratioInterval(oracle, base), rival: ratioInterval(rival, base) },
    rivalStops: rival.filter(row => row.stopped).length,
    oracle: { corrected: oracleReports.reduce((n, r) => n + r.corrected, 0), flaggedAtFreeze: oracleReports.reduce((n, r) => n + r.flagged, 0), verified: oracleReports.reduce((n, r) => n + r.verified, 0), unverified: oracleReports.reduce((n, r) => n + r.unverified, 0),
      freezeMs: { needs: freeze.length, p50: freeze[Math.floor(freeze.length / 2)] ?? null, p95: freeze[Math.min(freeze.length - 1, Math.floor(0.95 * freeze.length))] ?? null, max: freeze.at(-1) ?? null } },
    frozenWrong: { base: baseLabels.filter(l => l.label === 'wrong').length, oracle: oracleLabels.filter(l => l.label === 'wrong').length,
      baseOfflineCaught: baseLabels.filter(l => l.label === 'wrong' && ['flagged', 'corrected'].includes(l.offline)).length,
      baseOfflineFalseFlags: baseLabels.filter(l => l.label === 'correct' && ['flagged', 'corrected'].includes(l.offline)).length, baseCorrect: baseLabels.filter(l => l.label === 'correct').length },
    calls: rows.reduce((n, row) => n + row.calls, 0),
    loaded: rows.filter(row => row.loadStart > 16 || row.loadEnd > 16).length, runs: rows.length,
  };
  writeFileSync(join(output, `analysis-${stage}.json`), JSON.stringify({ result, labels }, null, 1));
  console.log(JSON.stringify(result, null, 1));
}
