#!/usr/bin/env node
// Endoforge hill-climb: render → review (consult references → critique) → fix → apply, round after round, with a scoreboard.
//
//   hillclimb.mjs round <campaign.json> [--pr]              one full round (stops early when the stop rule says so)
//   hillclimb.mjs render <campaign.json> [--round N]         host: start round N (default next), run render jobs, make sheets
//   hillclimb.mjs plan-review | review <campaign.json> [--round N]
//   hillclimb.mjs refs <campaign.json> [--round N] [--fetch id,id|all]   list the consult's new reference candidates; fetch approved ones
//   hillclimb.mjs plan-fix | fix <campaign.json> [--round N]
//   hillclimb.mjs apply <campaign.json> [--round N] [--pr]   host: one branch per owner, git apply, postApply, gates, commit
//   hillclimb.mjs score <campaign.json>                      history and the stop decision
//   (inside atoms) compose-review <campaign.json> <fixlist.json> <out> [--previous f] | compose-fix <campaign.json> <in> <out>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCampaign, validateCampaign, roundDir, lastRound, vars, expand } from '../lib/campaign.mjs';
import { validateFixlist, toMarkdown } from '../lib/fixlist.mjs';
import { scoreRound, decide } from '../lib/scoreboard.mjs';
import { reviewAtoms, fixAtoms, patchPaths, inScope } from '../lib/plan.mjs';
import { validate } from '../../atomizer/lib/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLICY = JSON.parse(fs.readFileSync(path.join(HERE, '../../atomizer/policy.json'), 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt = null) => { const i = rest.indexOf(name); return i < 0 ? dflt : rest[i + 1] ?? true; };
const has = (name) => rest.includes(name);
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const log = (...a) => console.error('hillclimb:', ...a);
function run(argv, opts = {}) {
  log('$', argv.join(' ').slice(0, 240));
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${argv[0]} exited ${r.status}`);
}
const out = (s) => process.stdout.write(s + '\n');

function campaignAndRound(next = false) {
  const file = path.resolve(rest[0]);
  const c = loadCampaign(file);
  const n = Number(flag('--round', 0)) || (next ? lastRound(c) + 1 : lastRound(c));
  if (!n) throw new Error('no round yet: run `render` first');
  return { c, file, n, dir: roundDir(c, n) };
}

function previousFixlist(c, n) {
  for (let k = n - 1; k >= 1; k--) { const f = path.join(roundDir(c, k), 'fixlist.json'); if (fs.existsSync(f)) return f; }
  return null;
}

function cmdRender() {
  const { c, file, n, dir } = campaignAndRound(true);
  fs.mkdirSync(path.join(dir, 'stills'), { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'campaign.json'));
  const prev = previousFixlist(c, n);
  if (prev) fs.copyFileSync(prev, path.join(dir, 'previous.fixlist.json'));
  for (const job of c.render) {
    const o = path.join(dir, 'stills', job.id); fs.mkdirSync(o, { recursive: true });
    run(expand(job.command, vars(c, n, { out: o })), { cwd: c.repo || undefined });
  }
  run(['python3', '-I', path.join(HERE, '../scripts/sheets.py'), path.join(dir, 'stills'), path.join(dir, 'sheets'), ...(c.sheets?.brighten ? ['--brighten', c.sheets.brighten.join(',')] : [])]);
  out(dir);
}

function writeAtoms(kind, docv, dir) {
  const v = validate(docv, POLICY);
  if (!v.ok) throw new Error(`${kind} atoms invalid: ${v.errors.join('; ')}`);
  const f = path.join(dir, `${kind}.atoms.json`); writeJSON(f, docv); return f;
}

function runAtoms(c, f, outDir, stage) {
  const runner = c.runner ?? [path.join(process.env.HOME, '.local/bin/endoforge'), 'run'];
  run([...runner, f, '--out', outDir, '--concurrency', String(c.concurrency ?? 3), '--timeout', String(c.runTimeoutSec ?? 14400)],
    { env: { ...process.env, ENDOFORGE_WORKER: c.workers?.[stage] ?? c.worker ?? 'native' } });  // e.g. review on Claude (vision), fix on Codex
  return path.join(outDir, 'run', 'atoms');
}

function cmdPlanReview(go) {
  const { c, n, dir } = campaignAndRound();
  const f = writeAtoms('review', reviewAtoms(c, n, { hasPrevious: fs.existsSync(path.join(dir, 'previous.fixlist.json')) }), dir);
  if (!go) return out(f);
  const atoms = runAtoms(c, f, path.join(dir, 'review-run'), 'review');
  for (const [a, files] of [['consult', ['references.json', 'consult.md']], ['critique', ['fixlist.json']], ['compose', ['FIXLIST.md', 'score.json']]])
    for (const x of files) fs.copyFileSync(path.join(atoms, a, 'out', x), path.join(dir, x));
  const hist = path.join(c.workdir, 'scoreboard.json');
  const h = fs.existsSync(hist) ? readJSON(hist) : [];
  writeJSON(hist, [...h.filter((r) => r.round !== n), readJSON(path.join(dir, 'score.json'))].sort((a, b) => a.round - b.round));
  out(path.join(dir, 'FIXLIST.md'));
}

function cmdComposeReview() {
  const [campaignFile, fixFile, outDir] = rest;
  const c = readJSON(campaignFile);
  const fl = readJSON(fixFile);
  const prevFile = flag('--previous');
  const previous = prevFile && fs.existsSync(prevFile) ? readJSON(prevFile) : null;
  const v = validateFixlist(fl, { owners: c.owners, count: c.critique.count, previous });
  if (!v.ok) { console.error(v.errors.join('\n')); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'FIXLIST.md'), toMarkdown(fl, c));
  writeJSON(path.join(outDir, 'score.json'), scoreRound(fl, previous));
}

function cmdRefs() {
  const { c, dir } = campaignAndRound();
  const refs = readJSON(path.join(dir, 'references.json'));
  const cand = refs.new ?? [];
  const R = c.references?.research ?? {};
  const allowed = (r) => (R.sources ?? []).some((s) => { try { return new URL(r.url).hostname.endsWith(s); } catch { return false; } })
    && (R.licences ?? []).some((l) => String(r.licence ?? '').toLowerCase().includes(l.toLowerCase()));
  cand.forEach((r, i) => out(`${i + 1}\t${allowed(r) ? 'ok' : 'NOT ALLOWED'}\t${r.licence}\t${r.subject}\t${r.url}`));
  const want = flag('--fetch');
  if (!want) return;
  if (!R.store) throw new Error('references.research.store is not set; nowhere to put fetched references');
  const store = expand(R.store, vars(c, 0));
  const ids = want === 'all' ? cand.map((_, i) => i + 1) : String(want).split(',').map(Number);
  const inv = path.join(store, 'hillclimb-inventory.csv');
  fs.mkdirSync(path.join(store, 'hillclimb'), { recursive: true });
  if (!fs.existsSync(inv)) fs.writeFileSync(inv, 'url,title,source,licence,subject,local_file,sha256,fetched\n');
  for (const id of ids) {
    const r = cand[id - 1];
    if (!r || !allowed(r)) { log(`skip ${id}: not an allowed source and licence`); continue; }
    const name = `${crypto.createHash('sha1').update(r.url).digest('hex').slice(0, 12)}${path.extname(new URL(r.url).pathname) || '.jpg'}`;
    const dst = path.join(store, 'hillclimb', name);
    run(['curl', '-fsSL', '--max-filesize', '40000000', '-A', 'endoforge-hillclimb (reference research)', '-o', dst, r.url]);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex');
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    fs.appendFileSync(inv, [r.url, r.title, r.source, r.licence, r.subject, `hillclimb/${name}`, sha, new Date().toISOString()].map(q).join(',') + '\n');
  }
}

function cmdPlanFix(go) {
  const { c, n, dir } = campaignAndRound();
  const fl = readJSON(path.join(dir, 'fixlist.json'));
  const f = writeAtoms('fix', fixAtoms(c, n, fl), dir);
  if (!go) return out(f);
  const atoms = runAtoms(c, f, path.join(dir, 'fix-run'), 'fix');
  for (const a of fs.readdirSync(atoms).filter((x) => x.startsWith('fix-'))) {
    const d = path.join(dir, 'fix', a.slice(4).toUpperCase()); fs.mkdirSync(d, { recursive: true });
    for (const x of ['patch.diff', 'report.json']) if (fs.existsSync(path.join(atoms, a, 'out', x))) fs.copyFileSync(path.join(atoms, a, 'out', x), path.join(d, x));
  }
  fs.copyFileSync(path.join(atoms, 'compose', 'out', 'fix-summary.json'), path.join(dir, 'fix-summary.json'));
  out(path.join(dir, 'fix-summary.json'));
}

function cmdComposeFix() {
  const [campaignFile, inDir, outDir] = rest;
  const c = readJSON(campaignFile);
  const summary = { lanes: [], violations: [] };
  for (const a of fs.readdirSync(inDir).filter((x) => x.startsWith('fix-'))) {
    const owner = a.slice(4).toUpperCase(), o = c.owners[owner];
    const diffF = path.join(inDir, a, 'patch.diff'), repF = path.join(inDir, a, 'report.json');
    const diff = fs.existsSync(diffF) ? fs.readFileSync(diffF, 'utf8') : '';
    const files = patchPaths(diff);
    const bad = files.filter((p) => !inScope(p, o?.scope ?? []));
    for (const p of bad) summary.violations.push({ owner, path: p });
    const rep = fs.existsSync(repF) ? readJSON(repF) : { items: [] };
    const st = (s) => (rep.items ?? []).filter((i) => i.status === s).length;
    summary.lanes.push({ owner, files: files.length, binary_hunks: (diff.match(/^Binary files /gm) ?? []).length,
      fixed: st('fixed'), partial: st('partial'), not_fixed: st('not_fixed'), needs_human: rep.needs_human ?? [] });
  }
  writeJSON(path.join(outDir, 'fix-summary.json'), summary);
  if (summary.violations.length) { console.error('scope violations:', JSON.stringify(summary.violations)); process.exit(1); }
}

function cmdApply() {
  const { c, n, dir } = campaignAndRound();
  if (!c.repo) throw new Error('campaign.repo is required to apply patches');
  const base = c.apply?.base ?? 'origin/main';
  const wtRoot = expand(c.apply?.worktrees ?? path.join(c.workdir, 'worktrees'), vars(c, n));
  run(['git', '-C', c.repo, 'fetch', '-q', 'origin']);
  const results = [];
  for (const owner of fs.readdirSync(path.join(dir, 'fix'))) {
    const patch = path.join(dir, 'fix', owner, 'patch.diff');
    if (!fs.existsSync(patch) || !fs.statSync(patch).size) { results.push({ owner, status: 'empty patch' }); continue; }
    const branch = expand(c.apply?.branch ?? 'hillclimb/${id}-${round}-${owner}', { ...vars(c, n), id: c.id, round: `r${String(n).padStart(2, '0')}`, owner: owner.toLowerCase() });
    const wt = path.join(wtRoot, `${c.id}-r${n}-${owner.toLowerCase()}`);
    if (!fs.existsSync(wt)) run(['git', '-C', c.repo, 'worktree', 'add', '-q', '-B', branch, wt, base]);
    run(['git', '-C', wt, 'apply', '--whitespace=nowarn', patch]);
    const v = vars(c, n, { worktree: wt, owner });
    for (const cmdv of [...(c.owners[owner].postApply ?? []), ...(c.apply?.gates ?? [])]) run(expand(cmdv, v), { cwd: wt });
    run(['git', '-C', wt, 'add', '--', ...patchPaths(fs.readFileSync(patch, 'utf8')), ...(c.owners[owner].commitAlso ?? [])]);
    const rep = fs.existsSync(path.join(dir, 'fix', owner, 'report.json')) ? readJSON(path.join(dir, 'fix', owner, 'report.json')) : { items: [] };
    const fixed = (rep.items ?? []).filter((i) => i.status === 'fixed').map((i) => `#${i.id}`).join(' ');
    run(['git', '-C', wt, 'commit', '-q', '-m', `${c.id} hill-climb round ${n}, lane ${owner}: ${fixed || 'partial fixes'}`, '-m', c.apply?.trailer ?? '']);
    results.push({ owner, branch, worktree: wt, status: 'committed' });
    if (has('--pr')) {
      run(['git', '-C', wt, 'push', '-q', '-u', 'origin', branch]);
      const body = [`Hill-climb round ${n} of \`${c.id}\`, lane ${owner} (${c.owners[owner].describe}).`, '', '## Items', ...(rep.items ?? []).map((i) => `- #${i.id} ${i.status}: ${i.what ?? ''}`),
        '', '## Local checks', ...[...(c.owners[owner].postApply ?? []), ...(c.apply?.gates ?? [])].map((g) => `- \`${expand(g, v).join(' ')}\` → passed`), '', c.apply?.prFooter ?? ''].join('\n');
      run(['gh', 'pr', 'create', '--base', base.replace(/^origin\//, ''), '--head', branch, '--title', `${c.id} hill-climb r${n} ${owner}`, '--body', body], { cwd: wt });
    }
  }
  writeJSON(path.join(dir, 'apply.json'), results);
  out(JSON.stringify(results));
}

function cmdScore() {
  const c = loadCampaign(path.resolve(rest[0]));
  const hist = fs.existsSync(path.join(c.workdir, 'scoreboard.json')) ? readJSON(path.join(c.workdir, 'scoreboard.json')) : [];
  for (const h of hist) out(`r${h.round}\topen ${h.open}\tblockers ${h.blockers}\tweighted ${h.weighted}\tnew ${h.new}\tcarried ${h.carried}\tresolved ${h.resolved}`);
  out(JSON.stringify(decide(hist, c.stop)));
}

function cmdRound() {
  cmdRender();
  rest.push('--round', String(lastRound(loadCampaign(path.resolve(rest[0])))));
  cmdPlanReview(true);
  const c = loadCampaign(path.resolve(rest[0]));
  const d = decide(readJSON(path.join(c.workdir, 'scoreboard.json')), c.stop);
  log(d.why);
  if (d.stop) return;
  cmdPlanFix(true);
  cmdApply();
}

const table = { render: cmdRender, 'plan-review': () => cmdPlanReview(false), review: () => cmdPlanReview(true), refs: cmdRefs,
  'plan-fix': () => cmdPlanFix(false), fix: () => cmdPlanFix(true), apply: cmdApply, score: cmdScore, round: cmdRound,
  'compose-review': cmdComposeReview, 'compose-fix': cmdComposeFix,
  check: () => { const v = validateCampaign(readJSON(rest[0])); out(JSON.stringify(v)); process.exit(v.ok ? 0 : 1); } };
if (!table[cmd]) { console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(2); }
try { table[cmd](); } catch (e) { log(e.message); process.exit(1); }
