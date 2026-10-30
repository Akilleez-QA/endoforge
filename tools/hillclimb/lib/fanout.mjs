import { fileURLToPath } from 'node:url';
// Fan-out mode (campaign `mode: "fanout"`): parallelize by decomposition, not by competition. A round is three
// transformations of the problem, each with a check before the next (docs/PLAYBOOK-deadline-fanout.md):
//   atomize      pieces own disjoint files, contracts are owned by nobody, a split is proven a no-op;
//   parallelize  logins discovered, one smoke launch per engine, then every piece at once under the capacity dial;
//   recombine    each piece's diff restricted to its own files, applied, rendered, evaluated, scored on a ratchet,
//                and the findings attributed to the piece that owns them feed the next round.
// This file is the pure logic (no git, no processes) so it can be tested directly; bin/hillclimb.mjs drives it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = /^[A-Z][A-Z0-9]*$/;
const norm = (p) => p.replace(/\/\*\*$/, '').replace(/\/+$/, '');
/** Two repo paths overlap when they are the same file or one is a directory holding the other. */
export const overlaps = (a, b) => { const x = norm(a), y = norm(b); return x === y || x.startsWith(y + '/') || y.startsWith(x + '/'); };

/** Atomize check: every file has exactly one owning piece, and no piece owns a frozen contract. */
export function ownershipMap(c) {
  const errors = [], owner = {};
  const pieces = Object.entries(c.pieces ?? {});
  for (const [i, [a, pa]] of pieces.entries()) {
    for (const f of pa.files ?? []) {
      owner[f] = a;
      for (const [b, pb] of pieces.slice(i + 1)) for (const g of pb.files ?? []) if (overlaps(f, g)) errors.push(`pieces ${a} and ${b} share ${f === g ? f : `${f} / ${g}`}: one writer per file`);
      for (const k of c.contracts ?? []) if (overlaps(f, k)) errors.push(`piece ${a} owns ${f}, inside contract ${k}: contracts are read-only to every piece`);
    }
  }
  return { owner, errors };
}

/** Fan-out fields of a campaign (the shared fields are checked in campaign.mjs). */
export function validateFanout(c) {
  const errors = [], E = (m) => errors.push(m);
  const pieces = c.pieces ?? {};
  if (Object.keys(pieces).length < 2) E('fanout mode needs at least two pieces (one piece is not a decomposition)');
  for (const [k, p] of Object.entries(pieces)) {
    if (!KEY.test(k)) E(`piece key ${k} must be uppercase letters/digits`);
    if (!Array.isArray(p.files) || !p.files.length) E(`piece ${k} needs files (the repo paths it alone may change)`);
    if (!p.brief || p.brief.length < 20) E(`piece ${k} needs a brief (what it is, what better means for it)`);
    if (p.engine && !['codex', 'claude'].includes(p.engine)) E(`piece ${k} engine must be codex or claude`);
    if (p.speculate != null && !(Number.isInteger(p.speculate) && p.speculate >= 1 && p.speculate <= 3)) E(`piece ${k} speculate must be 1..3 (duplicates belong on the critical path only)`);
    if (p.stills != null && !Array.isArray(p.stills)) E(`piece ${k} stills must be a list of paths under the round's stills`);
  }
  const spec = Object.entries(pieces).filter(([, p]) => (p.speculate ?? 1) > 1);
  if (spec.length > 1) E(`only one piece may speculate (the long pole), not ${spec.map(([k]) => k).join(', ')}`);
  if (!Array.isArray(c.evals?.command) || !c.evals.command.length) E('fanout mode needs evals.command: evals come first, and the ratchet scores them');
  errors.push(...ownershipMap(c).errors);
  return errors;
}

/** Logins, discovered: Codex homes (~/.codex as "default", ~/.codex-accounts/<name>) and Claude config dirs
 *  (~/.claude-accts/<name>). Only the presence of the credential file is checked; nothing is read. */
export function discoverLogins({ home = os.homedir(), env = process.env } = {}) {
  const has = (...p) => fs.existsSync(path.join(...p));
  const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };
  const primary = env.CODEX_POOL_PRIMARY || path.join(home, '.codex'), accts = env.CODEX_POOL_ACCOUNTS_DIR || path.join(home, '.codex-accounts');
  const codex = [...(has(primary, 'auth.json') ? ['default'] : []), ...dirs(accts).filter((n) => has(accts, n, 'auth.json'))];
  const croot = env.ENDOFORGE_CLAUDE_ACCOUNTS || path.join(home, '.claude-accts');
  const claude = dirs(croot).filter((n) => has(croot, n, '.credentials.json')).map((name) => ({ name, dir: path.join(croot, name) }));
  return { codex, claude };
}

/** Lanes for a round: one per piece (more for the one speculating piece), each on a login. Explicit accounts and
 *  engines are placed first; the rest go to the least-loaded login, so no login sits idle (NOTES #10, #11). */
export function assignLanes(c, logins, { skip = [] } = {}) {
  const slots = [...logins.claude.map((a) => ({ engine: 'claude', account: a.name, dir: a.dir, n: 0 })),
    ...logins.codex.map((name) => ({ engine: 'codex', account: name, n: 0 }))];
  if (!slots.length) throw new Error('no logins found (need ~/.codex/auth.json, ~/.codex-accounts/*/auth.json or ~/.claude-accts/*/.credentials.json)');
  const want = [];
  for (const [piece, p] of Object.entries(c.pieces)) {
    if (skip.includes(piece)) continue;
    for (let v = 0; v < (p.speculate ?? 1); v++) want.push({ piece, variant: (p.speculate ?? 1) > 1 ? v + 1 : null, engine: p.engine, account: p.account });
  }
  const lanes = [], order = [...want].sort((a, b) => (b.account ? 2 : b.engine ? 1 : 0) - (a.account ? 2 : a.engine ? 1 : 0));
  for (const w of order) {
    const used = lanes.filter((l) => l.piece === w.piece).map((l) => l.engine + l.account);
    const fits = slots.filter((s) => (!w.engine || s.engine === w.engine) && (!w.account || s.account === w.account));
    if (!fits.length) throw new Error(`piece ${w.piece}: no ${w.engine ?? ''} login ${w.account ?? ''} available`);
    const s = fits.sort((a, b) => used.includes(a.engine + a.account) - used.includes(b.engine + b.account) || a.n - b.n)[0];   // duplicates spread across logins
    s.n++;
    lanes.push({ piece: w.piece, variant: w.variant, engine: s.engine, account: s.account, ...(s.dir ? { configDir: s.dir } : {}) });
  }
  return lanes.sort((a, b) => a.piece.localeCompare(b.piece) || (a.variant ?? 0) - (b.variant ?? 0));
}
export const laneId = (l) => (l.variant ? `${l.piece}-v${l.variant}` : l.piece).toLowerCase();

/** The worker's argv. Codex: the prompt goes BEFORE the -i flags, because -i takes many values and swallows a
 *  trailing prompt (NOTES #7). Claude: CLAUDE_CONFIG_DIR picks the login; images are paths it reads. */
export function workerCommand(c, lane, { worktree, prompt, images = [] }) {
  const f = c.fanout ?? {};
  if (lane.engine === 'codex') {
    return { argv: [f.codexPool ?? fileURLToPath(new URL('../../runtime/agent-pool.mjs', import.meta.url)), 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', worktree,
      ...(f.codexModel ? ['-m', f.codexModel] : []), prompt, ...images.flatMap((i) => ['-i', i])], env: {} };
  }
  const dirs = [...new Set(images.map((i) => path.dirname(i)))];
  return { argv: [f.claudeBin ?? 'claude', '-p', prompt, '--model', f.claudeModel ?? 'opus', '--permission-mode', 'acceptEdits',
    '--allowedTools', f.claudeTools ?? 'Read Edit Write Glob Grep Bash(node:*) Bash(git diff:*) Bash(ls:*)', ...dirs.flatMap((d) => ['--add-dir', d])],
  env: lane.configDir ? { CLAUDE_CONFIG_DIR: lane.configDir } : {} };
}

/** A piece's stills for this round: its declared selection, resolved under the round's stills directory. */
export const pieceStills = (p, stillsDir) => (p.stills ?? []).map((s) => path.join(stillsDir, s)).filter((s) => fs.existsSync(s));

/** One worker's brief: critique AND fix its own piece, in one stage, from its stills and its own eval findings. */
export function piecePrompt(c, piece, { stills = [], found = [], note = '', round = 1 } = {}) {
  const p = c.pieces[piece], others = Object.entries(c.pieces).filter(([k]) => k !== piece);
  const lines = (xs) => xs.map((x) => `- ${x}`).join('\n');
  return [`${c.goal}`, '',
    `You are one of ${Object.keys(c.pieces).length} workers in round ${round}; each owns different files. YOUR PIECE: ${piece}. ${p.brief}`,
    `You own ONLY these paths; edit nothing else:\n${lines(p.files)}`,
    ...(c.contracts?.length ? [`Frozen contracts between pieces (read, never edit):\n${lines(c.contracts)}`] : []),
    `The other pieces (read-only to you): ${others.map(([k, o]) => `${k} (${o.files.join(', ')})`).join('; ')}.`,
    stills.length ? `Current outputs of your piece (inspect every one):\n${lines(stills)}` : 'No outputs selected for this piece; read its files.',
    found.length ? `The evals' findings attributed to your piece (fix these first):\n${lines(found.map((f) => `[${f.level} ${f.rule ?? ''}] ${f.detail}${f.frames.length ? ` (frames ${f.frames.join(', ')})` : ''}`))}`
      : 'The evals found nothing attributed to your piece; critique it against the goal yourself.',
    ...(note ? [`Notes from the host: ${note}`] : []),
    ...(p.check ? [`Check your work with \`${p.check.join(' ')}\` and leave it passing.`] : []),
    'Critique your piece, then fix it, in this one pass. Do not run the campaign\'s render or evals: the host runs them after every piece lands.',
    'When done, reply with what you changed and why, in five lines or fewer.'].join('\n\n');
}

/** Normalise an evals file to findings. Accepts {findings: [{<key>, rule, level, detail, frames}]} or the rule shape
 *  {rules: [{id, level, name, reason, failing: [{<key>, frames}]}]}. */
export function findings(evals, key = 'piece') {
  if (Array.isArray(evals.findings)) return evals.findings.map((x) => ({ key: x[key] ?? null, rule: x.rule ?? null, level: x.level ?? 'HARD', detail: x.detail ?? x.reason ?? '', frames: x.frames ?? [] }));
  return (evals.rules ?? []).flatMap((r) => (r.failing ?? []).map((x) => ({ key: x[key] ?? null, rule: r.id, level: r.level ?? 'HARD', detail: `${r.name ?? ''}: ${r.reason ?? ''}`.trim(), frames: x.frames ?? [] })));
}

/** Attribution: route each finding to the piece that owns it. A piece's `rules` (eval rule ids it alone fixes, such
 *  as narration length for the script) win over `keys` (the eval key values it owns, default its lower-cased name).
 *  A finding nobody owns is a seam or a global finding: it is reported, never handed to an arbitrary worker. */
export function attribute(c, evals) {
  const byKey = {}, byRule = {};
  for (const [k, p] of Object.entries(c.pieces)) {
    for (const key of p.keys ?? [k.toLowerCase()]) byKey[key] = k;
    for (const r of p.rules ?? []) byRule[r] = k;
  }
  const byPiece = Object.fromEntries(Object.keys(c.pieces).map((k) => [k, []])), unattributed = [];
  for (const f of findings(evals, c.evals?.key)) { const k = byRule[f.rule] ?? byKey[f.key]; (k ? byPiece[k] : unattributed).push(f); }
  return { byPiece, unattributed };
}

/** Totals of one evals file: a declared score, or HARD 5 / other 1 per finding. */
export function totals(evals, key) {
  const fs_ = findings(evals, key), hard = fs_.filter((f) => f.level === 'HARD').length;
  return { score: evals.score ?? 5 * hard + (fs_.length - hard), hard: evals.hardFails ?? hard, style: evals.styleFails ?? fs_.length - hard };
}

/** Ratchet: the round passes when neither the score nor the HARD count rises over the baseline. A piece whose own
 *  HARD count rose is named, so its commit (and only its) can be reverted. */
export function ratchet(c, baseline, before, after) {
  const t = totals(after, c.evals?.key), A = attribute(c, after).byPiece, B = attribute(c, before).byPiece;
  const hardOf = (x) => x.filter((f) => f.level === 'HARD').length;
  const perPiece = Object.fromEntries(Object.keys(c.pieces).map((k) => [k, { before: hardOf(B[k]), after: hardOf(A[k]) }]));
  const regressed = Object.entries(perPiece).filter(([, v]) => v.after > v.before).map(([k]) => k);
  const pass = t.score <= baseline.score && t.hard <= baseline.hard;
  return { pass, score: t.score, hard: t.hard, scoreDelta: t.score - baseline.score, hardDelta: t.hard - baseline.hard, perPiece, regressed,
    baseline: pass ? { score: t.score, hard: t.hard } : baseline };
}

/** Re-atomize each pass: freeze a piece after `freezeAfter` clean rounds; flag a piece whose findings cluster
 *  (at least `splitAbove` and twice the median) as a candidate to split finer. */
export function reatomize(c, history) {
  const f = c.fanout ?? {}, freezeAfter = f.freezeAfter ?? 2, splitAbove = f.splitAbove ?? 5;
  const frozen = [], split = [];
  for (const k of Object.keys(c.pieces)) {
    const tail = history.slice(-freezeAfter).map((h) => h.perPiece?.[k]?.after);
    if (tail.length === freezeAfter && tail.every((n) => n === 0)) frozen.push(k);
  }
  const last = history.at(-1)?.perPiece ?? {}, counts = Object.values(last).map((v) => v.after).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  for (const [k, v] of Object.entries(last)) if (v.after >= splitAbove && v.after >= 2 * Math.max(1, median)) split.push(k);
  return { frozen, split };
}

/** Wall-clock model: T = serial stages + the longest atom. The serial share is what fan-out cannot speed up. */
export function wallClock(stages, atoms) {
  const serial = Object.values(stages).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(atoms).sort((a, b) => b[1] - a[1]), long = sorted[0] ?? [null, 0];
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)][1] : 0;
  return { T: serial + long[1], serial, longPole: long[0], longPoleSec: long[1], medianAtomSec: median, serialShare: serial + long[1] ? +(serial / (serial + long[1])).toFixed(2) : 0 };
}

export function workerCapacity(env = process.env) {
  const stateDir = env.WORKER_STATE_DIR || path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'workers');
  if (fs.existsSync(path.join(stateDir, 'DRAIN'))) return 0;
  try { const n = parseInt(fs.readFileSync(path.join(stateDir, 'CAPACITY'), 'utf8'), 10); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100; } catch { return 100; }
}
/** How many lanes may run at once at a capacity percentage (at least one unless draining). */
export const waveSize = (total, pct) => (pct <= 0 ? 0 : Math.max(1, Math.floor((total * pct) / 100)));
