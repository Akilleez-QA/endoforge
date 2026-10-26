// Iterate, measure, learn, improve the tool, repeat (Craig, 2026-10-26: "we ALWAYS work like this"). Every round, in
// either mode, writes rounds/rNN/LESSONS.md seeded with its own measurements, and keeps a ledger of lessons
// (<workdir>/lessons.json). A lesson stays open until a tool or PR change is recorded for it
// (`hillclimb.mjs lessons <campaign> --close <key> --by "PR #123"`); every round's report lists the open ones.
import fs from 'node:fs';
import path from 'node:path';

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/** Lessons a fan-out round's own measurements imply. Each has a stable key, so a recurrence counts up, not repeats. */
export function autoLessons(s) {
  const out = [], L = (key, stage, lesson) => out.push({ key, stage, lesson });
  for (const [engine, r] of Object.entries(s.smokes ?? {})) if (!r.ok) L(`smoke-${engine}`, 'parallelize', `the ${engine} smoke launch failed (exit ${r.exit}); fix the engine, login or flags before any wide launch`);
  for (const l of s.lanes ?? []) {
    if (l.exit == null) L(`lane-unfinished-${l.lane}`, 'parallelize', `lane ${l.lane} did not finish in the lane timeout; split the piece or raise fanout.laneTimeoutSec`);
    else if (l.exit !== 0) L(`lane-exit-${l.lane}`, 'parallelize', `lane ${l.lane} (${l.engine}:${l.account}) exited ${l.exit}; read logs/${l.lane}.log`);
  }
  for (const c of s.collect ?? []) {
    if (c.status === 'apply failed') L(`apply-${c.lane}`, 'recombine', `lane ${c.lane}'s diff did not apply; ownership or the contract between pieces is wrong`);
    if (c.status === 'check failed') L(`check-${c.lane}`, 'recombine', `lane ${c.lane} failed its piece check; the brief should say how to run it`);
    if (c.stray?.length) L(`stray-${c.lane}`, 'atomize', `lane ${c.lane} edited outside its files (${c.stray.join(', ')}); the piece needs a file it does not own, or a contract`);
  }
  for (const p of s.ratchet?.reverted ?? []) L(`regressed-${p.toLowerCase()}`, 'recombine', `piece ${p} raised its own HARD count and was reverted; tighten its brief or its evals`);
  if (s.ratchet?.scored === false) L('unscored', 'recombine', `the round could not be scored (${s.ratchet.why}); a gate that cannot run reports "not scored", never a number`);
  else if (s.ratchet && !s.ratchet.pass) L('ratchet-fail', 'recombine', `the round did not beat the baseline (score ${s.ratchet.scoreDelta >= 0 ? '+' : ''}${s.ratchet.scoreDelta}, HARD ${s.ratchet.hardDelta >= 0 ? '+' : ''}${s.ratchet.hardDelta})`);
  if (s.unattributed) L('unattributed', 'attribution', `${s.unattributed} findings belong to no piece; give the seam an owner (a piece with those keys or rules) or a contract`);
  for (const p of s.split ?? []) L(`split-${p.toLowerCase()}`, 'atomize', `piece ${p}'s findings cluster; split it finer next pass`);
  const w = s.wallClock;
  if (w?.longPole && w.medianAtomSec && w.longPoleSec >= 2 * w.medianAtomSec) L(`long-pole-${w.longPole}`, 'atomize', `lane ${w.longPole} took ${w.longPoleSec} s, ${(w.longPoleSec / w.medianAtomSec).toFixed(1)}x the median; split it or speculate on it`);
  if (w?.serialShare > 0.5) L('serial-share', 'parallelize', `serial stages are ${Math.round(w.serialShare * 100)} % of the round; cut them (stream recombination, reuse evals)`);
  const used = new Set((s.lanes ?? []).map((l) => `${l.engine}:${l.account}`));
  const idle = (s.logins ?? []).filter((x) => !used.has(x));
  if ((s.lanes ?? []).length >= (s.logins ?? []).length && idle.length) L('idle-login', 'parallelize', `logins idle while lanes waited: ${idle.join(', ')}`);
  return out;
}

/** Merge a round's lessons into the ledger: new keys open, recurrences count up; a closed lesson that recurs reopens. */
export function mergeLedger(ledger, lessons, round) {
  const next = { ...ledger };
  for (const l of lessons) {
    const old = next[l.key];
    next[l.key] = old ? { ...old, lesson: l.lesson, last: round, count: old.count + 1, ...(old.tool ? { tool: null, reopened: round, was: old.tool } : {}) }
      : { stage: l.stage, lesson: l.lesson, first: round, last: round, count: 1, tool: null };
  }
  return next;
}
export const openLessons = (ledger) => Object.entries(ledger).filter(([, v]) => !v.tool).map(([key, v]) => ({ key, ...v }));

const fmt = (n) => (n > 0 ? `+${n}` : String(n));
/** The round's LESSONS.md: measurements first, then this round's lessons, then every open lesson with no tool change. */
export function lessonsMarkdown({ round, mode, rows = [], perPiece = [], timings = {}, failures = [], lessons = [], open = [] }) {
  const t = (h, r) => [`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...r.map((x) => `| ${x.join(' | ')} |`)];
  return [`# Round ${round} lessons (${mode})`, '',
    'Seeded by the tool from this round\'s own measurements. Add what the numbers do not show under "By hand"; every lesson',
    'ends as a tool or PR change, recorded with `hillclimb.mjs lessons <campaign> --close <key> --by "<PR>"`.', '',
    '## Measurements', ...t(['measure', 'value'], rows), '',
    ...(perPiece.length ? ['## Per piece', ...t(['piece', 'lane', 'exit', 'seconds', 'HARD before → after', 'result'], perPiece), ''] : []),
    '## Timings (seconds)', ...t(['stage', 'seconds'], Object.entries(timings).map(([k, v]) => [k, v])), '',
    '## Failed launches and retries', ...(failures.length ? failures.map((f) => `- ${f}`) : ['- none']), '',
    '## Lessons this round', ...(lessons.length ? lessons.map((l) => `- \`${l.key}\` (${l.stage}): ${l.lesson}`) : ['- none detected']), '',
    '## Open lessons with no tool change yet', ...(open.length ? open.map((l) => `- \`${l.key}\` (${l.stage}, rounds ${l.first}–${l.last}, seen ${l.count}x): ${l.lesson}`) : ['- none']), '',
    '## By hand', '- ', ''].join('\n');
}

/** Write LESSONS.md and update the ledger; returns the open lessons for the round's report. */
export function recordLessons(c, dir, page, lessons) {
  const ledgerFile = path.join(c.workdir, 'lessons.json');
  const ledger = mergeLedger(readJSON(ledgerFile, {}), lessons, page.round);
  fs.mkdirSync(c.workdir, { recursive: true }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1) + '\n');
  const open = openLessons(ledger);
  fs.writeFileSync(path.join(dir, 'LESSONS.md'), lessonsMarkdown({ ...page, lessons, open }));
  return open;
}

/** Fan-out: LESSONS.md from the round summary. */
export function fanoutLessons(c, dir, s) {
  const r = s.ratchet;
  const rows = [['score (delta vs baseline)', r.scored === false ? 'not scored' : `${r.score} (${fmt(r.scoreDelta)})`], ['HARD (delta)', r.scored === false ? 'not scored' : `${r.hard} (${fmt(r.hardDelta)})`], ['ratchet', r.scored === false ? `not scored: ${r.why}` : r.pass ? 'pass' : 'FAIL'],
    ['wall clock T = serial + long pole', `${s.wallClock.T} s = ${s.wallClock.serial} + ${s.wallClock.longPoleSec} (${s.wallClock.longPole ?? '-'})`], ['serial share', `${Math.round(s.wallClock.serialShare * 100)} %`],
    ['lanes / logins', `${s.lanes.length} / ${(s.logins ?? []).length}`], ['frozen', s.frozen.join(', ') || '-'], ['unattributed findings', s.unattributed],
    ['max load1 / min MemAvailable', `${s.load?.maxLoad1 ?? '-'} / ${s.load?.minMemAvailGB ?? '-'} GB`], ['capacity dial', (s.load?.capacity ?? []).join(', ') || '-']];
  const col = Object.fromEntries((s.collect ?? []).map((x) => [x.lane, x.status]));
  const perPiece = s.lanes.map((l) => { const p = r.perPiece?.[l.piece]; return [l.piece, l.lane, l.exit ?? '-', l.sec ?? '-', p ? `${p.before} → ${p.after}` : '-', (r.reverted ?? []).includes(l.piece) ? 'reverted' : col[l.lane] ?? '-']; });
  const failures = [...Object.entries(s.smokes ?? {}).filter(([, v]) => !v.ok).map(([k, v]) => `smoke ${k}: exit ${v.exit}`),
    ...s.lanes.filter((l) => l.exit !== 0).map((l) => `${l.lane}: ${l.exit == null ? 'did not finish' : `exit ${l.exit}`}`)];
  const lessons = autoLessons(s);
  return recordLessons(c, dir, { round: s.round, mode: 'fanout', rows, perPiece, timings: s.stages, failures }, lessons);
}

/** Compete: LESSONS.md from the files the round left (score, render, fix summary, apply, Endoforge receipts). */
export function competeLessons(c, n, dir) {
  const score = readJSON(path.join(dir, 'score.json'), null), render = readJSON(path.join(dir, 'render.json'), {}), fix = readJSON(path.join(dir, 'fix-summary.json'), null);
  const apply = readJSON(path.join(dir, 'apply.json'), []), receipts = ['review', 'fix', 'judge'].map((k) => [k, readJSON(path.join(dir, `${k}-run`, 'run', 'receipt', 'run.json'), null)]).filter(([, v]) => v);
  const rows = score ? [['open (previous)', `${score.open} (${score.previous_open ?? '-'})`], ['weighted', score.weighted], ['blockers', score.blockers], ['new / carried / resolved', `${score.new} / ${score.carried} / ${score.resolved}`]] : [['score', 'no review this round']];
  const timings = { render: render.seconds ?? null, ...Object.fromEntries(receipts.map(([k, v]) => [k, Math.round(v.wallMs / 1000)])) };
  const failures = receipts.flatMap(([k, v]) => [...(v.lessons?.failedLaunches ?? []).map((f) => `${k} ${f.atom} attempt ${f.attempt}: exit ${f.exit}${f.reason ? ` (${f.reason})` : ''}`),
    ...(v.lessons?.retries ?? []).map((x) => `${k} ${x.atom}: ${x.attempts} attempts`)]);
  const lessons = [];
  for (const [k, v] of receipts) { if (v.lessons?.failedLaunches?.length) lessons.push({ key: `${k}-failed-launch`, stage: 'parallelize', lesson: `${v.lessons.failedLaunches.length} ${k} atom launches failed` });
    if (v.lessons?.slowestAtom && v.wallMs && v.lessons.slowestAtom.wallMs > 0.8 * v.wallMs && Object.keys(v.statuses ?? {}).length > 2) lessons.push({ key: `${k}-serial`, stage: 'parallelize', lesson: `${k}: one atom (${v.lessons.slowestAtom.atom}) was ${Math.round(100 * v.lessons.slowestAtom.wallMs / v.wallMs)} % of the stage` }); }
  for (const v of fix?.violations ?? []) lessons.push({ key: `scope-${v.owner.toLowerCase()}`, stage: 'atomize', lesson: `lane ${v.owner} patched outside its scope (${v.path})` });
  if (score && score.previous_open != null && score.weighted >= (readJSON(path.join(c.workdir, 'scoreboard.json'), []).find((h) => h.round === n - 1)?.weighted ?? Infinity)) lessons.push({ key: 'no-progress', stage: 'recombine', lesson: 'the weighted score did not drop this round; check the critics have a numeric gate (evals) to climb' });
  const perPiece = apply.map((a) => [a.owner, a.variant ?? '-', '-', '-', '-', a.status]);
  return recordLessons(c, dir, { round: n, mode: 'compete', rows, perPiece, timings, failures }, lessons);
}

/** `hillclimb.mjs lessons <campaign> [--close KEY --by "PR #n"] [--add KEY --stage S --text "..."]` */
export function lessonsCommand(c, flag) {
  const f = path.join(c.workdir, 'lessons.json'); let ledger = readJSON(f, {});
  if (flag('--close')) { const k = flag('--close'); if (!ledger[k]) throw new Error(`no lesson ${k}`); if (!flag('--by')) throw new Error('--close needs --by "<tool or PR>"'); ledger[k] = { ...ledger[k], tool: flag('--by') }; }
  if (flag('--add')) ledger = mergeLedger(ledger, [{ key: flag('--add'), stage: flag('--stage') ?? 'by hand', lesson: flag('--text') ?? '' }], Number(flag('--round')) || 0);
  if (flag('--close') || flag('--add')) fs.writeFileSync(f, JSON.stringify(ledger, null, 1) + '\n');
  return openLessons(ledger);
}
