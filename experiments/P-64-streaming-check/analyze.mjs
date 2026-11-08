import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [workArg, outArg] = process.argv.slice(2);
const work = resolve(workArg), out = resolve(outArg);
const rows = (dir, name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const nearest = (values, q) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null; };
const stat = values => ({ n: values.filter(Number.isFinite).length, p50: nearest(values, 0.5), p95: nearest(values, 0.95), min: nearest(values, 1e-9), max: nearest(values, 1) });
const sum = values => values.reduce((total, value) => total + value, 0);
const round = value => value === null || value === undefined ? value : Math.round(value * 10) / 10;
const thinking = usage => usage?.output_tokens_details?.thinking_tokens ?? 0;
const tokensAfter = turn => turn.refusal && turn.toolChars ? Math.max(0, (turn.usage?.output_tokens ?? 0) - thinking(turn.usage)) * turn.refusal.charsAfter / turn.toolChars : 0;
const loaded = list => list.filter(row => Math.max(row.loadStart, row.loadEnd) > 16).length;

function candidateTails(row) {
  const baseChecks = sum(row.turns.map(turn => turn.base.roundTripMs));
  const nonModel = row.wallMs - row.modelMs;
  const fixed = Math.max(0, nonModel - baseChecks);
  const before = sum(row.turns.map(turn => turn.base.tailMs)) + fixed, after = sum(row.turns.map(turn => turn.stream.tailMs)) + fixed;
  return { before, after, fixed, nonModel, loopTail: nonModel + sum(row.turns.map(turn => turn.closeAt - turn.lastToken)), e2eBefore: row.wallMs, e2eAfter: row.wallMs - (before - after) };
}

function refusalSummary(turns) {
  const failing = turns.filter(turn => turn.checked && turn.base.failed);
  const refused = failing.filter(turn => turn.refusal), early = refused.filter(turn => turn.refusal.beforeLastToken);
  const falseRefusals = turns.filter(turn => turn.refusal && (!turn.base.failed || !turn.refusal.finalKernelSame));
  return { turns: turns.length, failing: failing.length, refused: refused.length, early: early.length, share: failing.length ? early.length / failing.length : null,
    savedMs: stat(early.map(turn => turn.refusal.savedMs)), savedMsTotal: sum(early.map(turn => turn.refusal.savedMs)), tokensAfter: stat(early.map(tokensAfter)), tokensAfterTotal: sum(early.map(tokensAfter)),
    savedShareOfTurn: stat(early.map(turn => turn.refusal.savedMs / turn.lastToken)),
    notRefusedGates: failing.filter(turn => !turn.refusal).map(turn => ({ label: turn.label, stage: turn.stage, calls: turn.calls.join(','), late: false })),
    falseRefusals: falseRefusals.map(turn => ({ label: turn.label, failed: turn.base.failed, same: turn.refusal.finalKernelSame })) };
}

const result = {};
const h = rows(out, 'h-rows.jsonl');
if (h.length) {
  const turns = h.flatMap(row => row.turns.map(turn => ({ ...turn, run: row.name })));
  const tails = h.map(candidateTails);
  const verdictDiffs = h.filter(row => row.promoted !== row.recordedPromoted || JSON.stringify(row.rounds) !== JSON.stringify(row.recordedRounds)).map(row => row.name);
  const turnDiffs = turns.filter(turn => turn.checked && turn.stream.failed !== turn.base.failed).map(turn => `${turn.run}:${turn.stage}`);
  const keyProblems = h.flatMap(row => row.keysMatched.map((matched, i) => ({ matched, i, after: row.turns.slice(0, i).some(turn => turn.checked && turn.base.failed) })).filter(k => !k.matched && !k.after).map(k => `${row.name}:${k.i}`));
  const missingTurns = h.filter(row => row.turns.length !== row.recordedTurns).map(row => row.name);
  const refusals = refusalSummary(turns);
  result.h = { runs: h.length, loadedRuns: loaded(h), promoted: h.filter(row => row.promoted).length,
    turnTail: { before: stat(turns.map(turn => turn.base.tailMs)), after: stat(turns.map(turn => turn.stream.tailMs)), exitLag: stat(turns.map(turn => turn.closeAt - turn.lastToken)), resultLag: stat(turns.map(turn => turn.resultAt - turn.lastToken)),
      baseCheck: stat(turns.filter(turn => turn.stage === 'implementation').map(turn => turn.base.roundTripMs)), kernelLead: stat(turns.filter(turn => turn.prechecks.length && turn.stage === 'implementation').map(turn => turn.lastToken - turn.prechecks[0].at)) },
    candidateTail: { before: stat(tails.map(t => t.before)), after: stat(tails.map(t => t.after)), fixed: stat(tails.map(t => t.fixed)), loopTail: stat(tails.map(t => t.loopTail)),
      dropP50: 1 - nearest(tails.map(t => t.after), 0.5) / nearest(tails.map(t => t.before), 0.5) },
    latency: { before: stat(tails.map(t => t.e2eBefore)), after: stat(tails.map(t => t.e2eAfter)), dropP50: 1 - nearest(tails.map(t => t.e2eAfter), 0.5) / nearest(tails.map(t => t.e2eBefore), 0.5),
      tailShareP50: nearest(tails.map(t => t.before / t.e2eBefore), 0.5) },
    verdicts: { runDiffs: verdictDiffs, turnDiffs, keyProblems, missingTurns, checkedTurns: turns.filter(turn => turn.checked).length },
    refusals };
}

const seeded = rows(out, 'seeded-rows.jsonl');
if (seeded.length) {
  const turns = seeded.map(row => ({ ...row.turn, operator: row.operator }));
  const byOperator = Object.fromEntries([...new Set(turns.map(turn => turn.operator))].map(op => [op, refusalSummary(turns.filter(turn => turn.operator === op))]));
  for (const value of Object.values(byOperator)) delete value.notRefusedGates;
  result.seeded = { mutants: seeded.length, loaded: loaded(seeded), equivalent: turns.filter(turn => !turn.base.failed).length, verdictDiffs: turns.filter(turn => turn.stream.failed !== turn.base.failed).length,
    all: refusalSummary(turns), byOperator };
  result.seeded.all.notRefusedGates = result.seeded.all.notRefusedGates.length;
}

const p57 = rows(out, 'p57-rows.jsonl');
if (p57.length) {
  const tails = p57.map(candidateTails), turns = p57.flatMap(row => row.turns);
  result.p57 = { candidates: p57.length, loaded: loaded(p57), wrongVerdicts: p57.filter(row => row.promoted !== row.expected).map(row => `${row.name}-${row.index}`), errors: p57.filter(row => row.error).length,
    turnDiffs: turns.filter(turn => turn.checked && turn.stream.failed !== turn.base.failed).length,
    turnTail: { before: stat(turns.map(turn => turn.base.tailMs)), after: stat(turns.map(turn => turn.stream.tailMs)) },
    candidateTail: { before: stat(tails.map(t => t.before)), after: stat(tails.map(t => t.after)), loopTail: stat(tails.map(t => t.loopTail)), dropP50: 1 - nearest(tails.map(t => t.after), 0.5) / nearest(tails.map(t => t.before), 0.5) },
    latency: { before: stat(tails.map(t => t.e2eBefore)), after: stat(tails.map(t => t.e2eAfter)), dropP50: 1 - nearest(tails.map(t => t.e2eAfter), 0.5) / nearest(tails.map(t => t.e2eBefore), 0.5),
      tailShareP50: nearest(tails.map(t => t.before / t.e2eBefore), 0.5) } };
}

const hedges = rows(work, 'rows.jsonl').filter(row => row.kind === 'hedge');
if (h.length) {
  const byName = new Map(hedges.map(row => [row.name, row]));
  let useful = 0, wasted = 0, alwaysWaste = 0;
  const runs = [];
  for (const row of h) {
    let clock = 0, launch = null;
    for (const turn of row.turns) {
      if (launch === null && turn.stage === 'implementation' && turn.refusal?.beforeLastToken) launch = clock + turn.refusal.finishedAt;
      if (turn.stage === 'implementation' && turn.checked && !turn.base.failed) alwaysWaste += turn.closeAt - (turn.firstOutput ?? 0);
      clock += turn.closeAt + turn.base.tailMs;
    }
    const hedge = launch === null ? null : byName.get(row.name);
    const current = row.promoted ? row.wallMs : Infinity;
    if (!hedge) { if (row.promoted) useful += row.modelMs; runs.push({ name: row.name, hedged: false }); continue; }
    const hedgeEnd = hedge.promoted ? launch + hedge.wallMs : Infinity;
    const currentModelAfter = row.modelMs - Math.min(row.modelMs, launch);
    let winner = null, waste = 0;
    if (current <= hedgeEnd && current < Infinity) { winner = 'current'; useful += row.modelMs; waste = Math.min(hedge.modelMs, current - launch); }
    else if (hedgeEnd < Infinity) { winner = 'hedge'; useful += Math.min(row.modelMs, launch) + hedge.modelMs; waste = Math.min(currentModelAfter, hedgeEnd - launch); }
    else waste = hedge.modelMs;
    wasted += waste;
    runs.push({ name: row.name, hedged: true, launch, current: Number.isFinite(current) ? current : null, hedgeEnd: Number.isFinite(hedgeEnd) ? hedgeEnd : null, winner, wasteMs: waste, hedgePromoted: hedge.promoted, hedgeWall: hedge.wallMs, hedgeModel: hedge.modelMs, hedgeCalls: hedge.liveCalls });
  }
  const failingRuns = runs.filter(run => run.hedged);
  result.speculation = { usefulModelMs: useful, failTriggered: { hedged: failingRuns.length, wastedModelMs: wasted, wastePerUseful: useful ? wasted / useful : null, runs: failingRuns,
    failingRunLatency: failingRuns.map(run => ({ name: run.name, before: run.current, after: run.winner === 'hedge' ? run.hedgeEnd : run.current })) },
    alwaysHedge: { wastedModelMs: alwaysWaste, wastePerUseful: useful ? alwaysWaste / useful : null, note: 'lower bound: cost of a parallel attempt cancelled when the current implementation turn passes, from first output to exit' } };
}
result.calls = existsSync(join(work, 'calls.json')) ? JSON.parse(readFileSync(join(work, 'calls.json'), 'utf8')) : null;
const rounded = JSON.parse(JSON.stringify(result, (key, value) => typeof value === 'number' && !Number.isInteger(value) ? round(value * (Math.abs(value) < 1 ? 1000 : 1)) / (Math.abs(value) < 1 ? 1000 : 1) : value));
writeFileSync(join(out, 'analysis.json'), JSON.stringify(rounded, null, 1));
console.log(JSON.stringify(rounded, null, 1));
