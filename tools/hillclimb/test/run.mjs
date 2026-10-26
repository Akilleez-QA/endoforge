// Tests for the hill-climb tool: campaign and fix-list validation, atoms the atomizer accepts, scoring and stop rules,
// patch scope checks, the hc-patch round trip, and the two compose steps run as the atoms run them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCampaign, expand } from '../lib/campaign.mjs';
import { validateFixlist, toMarkdown, SCHEMA } from '../lib/fixlist.mjs';
import { scoreRound, decide } from '../lib/scoreboard.mjs';
import { reviewAtoms, fixAtoms, judgeAtoms, laneOf, pick, patchPaths, inScope } from '../lib/plan.mjs';
import { validate } from '../../atomizer/lib/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '../bin/hillclimb.mjs');
const policy = JSON.parse(fs.readFileSync(path.join(HERE, '../../atomizer/policy.json'), 'utf8'));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ': ' + detail : ''}`); if (!ok) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-test-'));

const campaign = JSON.parse(fs.readFileSync(path.join(HERE, '../campaigns/stl-campus.json'), 'utf8'));
check('campus campaign validates', validateCampaign(campaign).ok, validateCampaign(campaign).errors.join('; '));
const bad = validateCampaign({ ...campaign, owners: { a: { describe: 'x', scope: [] } }, critique: { count: 0 } });
check('bad owner key, empty scope and zero count are rejected', !bad.ok && bad.errors.length >= 3, bad.errors.join('; '));
check('expand fills ${repo} and keeps shell $s', expand(['${repo}/x', 'for s in a; do echo $s; done'], { repo: '/r' }).join('|') === '/r/x|for s in a; do echo $s; done');

const item = (id, owner = 'A', extra = {}) => ({ id, still: 'S01', problem: 'downpipe crosses the lettering band', owner, severity: 'major', needs_reference: false, carried_from: null, ...extra });
const r1 = { schema: SCHEMA, round: 1, summary: 's', items: [item(1), item(2, 'BC'), item(3, 'G', { severity: 'blocker' })], resolved_from_previous: [] };
check('a good fix list validates', validateFixlist(r1, { owners: campaign.owners, count: 100 }).ok);
const r1bad = { ...r1, items: [item(1), item(1, 'ZZ'), { ...item(4), severity: 'huge' }] };
const e = validateFixlist(r1bad, { owners: campaign.owners, count: 100 }).errors.join('; ');
check('duplicate ids, unknown owners and bad severities are rejected', /duplicate/.test(e) && /not a campaign owner/.test(e) && /severity/.test(e), e);
const r2 = { schema: SCHEMA, round: 2, items: [item(1, 'A', { carried_from: 1 }), item(2, 'Y')], resolved_from_previous: [2, 3] };
check('carried items and resolutions are checked against the previous list', validateFixlist(r2, { owners: campaign.owners, previous: r1 }).ok);
check('carrying an id the previous list lacks is rejected', !validateFixlist({ ...r2, items: [item(1, 'A', { carried_from: 9 })] }, { owners: campaign.owners, previous: r1 }).ok);
check('markdown has a row per item', toMarkdown(r1, campaign).split('\n').filter((l) => /^\| \d+ \|/.test(l)).length === 3);

const s1 = scoreRound(r1, null), s2 = scoreRound(r2, r1);
check('score counts open, blockers and weighted', s1.open === 3 && s1.blockers === 1 && s1.weighted === 5 + 2 + 2);
check('score counts carried, new and resolved', s2.carried === 1 && s2.new === 1 && s2.resolved === 2 && s2.previous_open === 3);
const stop = { maxRounds: 5, targetOpen: 2, patience: 2 };
check('stops at the target when there are no blockers', decide([s1, s2], stop).stop);
check('keeps going while improving', !decide([{ weighted: 50, open: 30, blockers: 1 }, { weighted: 40, open: 25, blockers: 1 }], stop).stop);
check('stops on a plateau', decide([{ weighted: 30, open: 20, blockers: 1 }, { weighted: 31, open: 20, blockers: 1 }, { weighted: 30, open: 21, blockers: 1 }], stop).stop);
check('stops at the round limit', decide(Array(5).fill({ weighted: 9, open: 9, blockers: 1 }).map((h, i) => ({ ...h, weighted: 50 - i })), stop).stop);

// atoms are validated against a temporary campaign whose binds exist and sit under the test's bind roots
const tc = JSON.parse(JSON.stringify(campaign));
tc.repo = path.join(tmp, 'crepo'); tc.workdir = path.join(tmp, 'cwork');
tc.references.binds = [{ host: '${repo}/refs', guest: '/ref/kit-pack' }];
for (const d of [path.join(tc.repo, 'refs'), path.join(tc.workdir, 'rounds/r01'), path.join(tc.workdir, 'rounds/r02')]) fs.mkdirSync(d, { recursive: true });
const tpolicy = { ...policy, bindRoots: [tmp, path.resolve(HERE, '..')] };
const rv = reviewAtoms(tc, 1, { hasPrevious: false }), fx = fixAtoms(tc, 2, r2);
const vr = validate(rv, tpolicy), vf = validate(fx, tpolicy);
check('review atoms pass the atomizer validator', vr.ok, vr.errors.join('; '));
check('fix atoms pass the atomizer validator', vf.ok, vf.errors.join('; '));
check('one fix atom per owner with items, plus compose', fx.atoms.map((a) => a.id).sort().join(',') === 'compose,fix-a,fix-y');
check('review has one critic per model plus a merge', rv.atoms.map((a) => a.id).join(',') === 'consult,critic-opus,critic-codex,critique,compose');
check('fix lanes use different models in the same round', new Set(fx.atoms.filter((a) => a.id.startsWith('fix-')).map((a) => a.worker.model)).size === 2);
check('models rotate between rounds (no fixed roles)', pick(tc, 1, 0) !== pick(tc, 2, 0) && fixAtoms(tc, 3, r2).atoms[0].worker.model !== fx.atoms[0].worker.model);
check('mix off keeps one critic and the owner model', reviewAtoms({ ...tc, mix: false }, 1).atoms.map((a) => a.id).join(',') === 'consult,critique,compose');
const cx2 = fixAtoms({ ...tc, fix: { compete: true } }, 2, r2);
check('compete runs every model on every lane', cx2.atoms.map((a) => a.id).sort().join(',') === 'compose,fix-a--codex,fix-a--opus,fix-y--codex,fix-y--opus');
check('compete fix atoms pass the atomizer validator', validate(cx2, tpolicy).ok, validate(cx2, tpolicy).errors.join('; '));
check('lane ids parse back to owner and variant', laneOf('fix-bc--codex').owner === 'BC' && laneOf('fix-bc--codex').variant === 'codex' && laneOf('fix-y').variant === null);
const jd = judgeAtoms(tc, 2, { A: ['opus', 'codex'] });
check('judge atoms pass the atomizer validator', validate(jd, tpolicy).ok, validate(jd, tpolicy).errors.join('; '));
check('fix atoms carry only their own items', JSON.parse(fx.atoms.find((a) => a.id === 'fix-y').contract.split('\n').find((l) => l.startsWith('['))).map((i) => i.id).join() === '2');
check('research tools only when research is allowed (Claude consult rounds)', reviewAtoms(tc, 2).atoms[0].worker.model === 'opus' && reviewAtoms(tc, 2).atoms[0].worker.tools.includes('WebSearch') && !reviewAtoms({ ...tc, references: {} }, 2).atoms[0].worker.tools.includes('WebSearch'));

check('patch paths are read from diff headers', patchPaths('diff --git a/x/y.py b/x/y.py\n--- a/x/y.py\n').join() === 'x/y.py');
check('scope check is per path segment', inScope('a/b/c.py', ['a/b']) && !inScope('a/bc/c.py', ['a/b']) && inScope('a/b', ['a/b/**']));

// hc-patch round trip: copy scope, edit, diff, and the patch applies to the repo
const repo = path.join(tmp, 'repo'), work = path.join(tmp, 'work');
fs.mkdirSync(path.join(repo, 'scope'), { recursive: true }); fs.mkdirSync(path.join(repo, 'other'), { recursive: true });
fs.writeFileSync(path.join(repo, 'scope/f.txt'), 'one\ntwo\n'); fs.writeFileSync(path.join(repo, 'other/g.txt'), 'x\n');
const sh = (args, env = {}) => spawnSync('sh', [path.join(HERE, '../scripts/hc-patch.sh'), ...args], { encoding: 'utf8', env: { ...process.env, HC_WORK: work, ...env } });
spawnSync('git', ['-C', repo, 'init', '-q']); spawnSync('git', ['-C', repo, 'add', '.']); spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
fs.mkdirSync(work, { recursive: true });
const i1 = sh(['init', repo, 'scope/**']);
fs.writeFileSync(path.join(work, 'edit/scope/f.txt'), 'one\nTWO\n'); fs.writeFileSync(path.join(work, 'edit/scope/new.txt'), 'new\n');
const d1 = sh(['diff', repo, path.join(tmp, 'p.diff')]);
const diff = fs.readFileSync(path.join(tmp, 'p.diff'), 'utf8');
const applies = spawnSync('git', ['-C', repo, 'apply', '--check', path.join(tmp, 'p.diff')], { encoding: 'utf8' });
check('hc-patch init and diff run', i1.status === 0 && d1.status === 0, i1.stderr + d1.stderr);
check('hc-patch writes repo-relative paths (edit and new file)', patchPaths(diff).sort().join() === 'scope/f.txt,scope/new.txt', patchPaths(diff).join());
check('the patch applies to the repo with git apply', applies.status === 0, applies.stderr);

// compose steps exactly as the atoms call them
const cf = path.join(tmp, 'campaign.json'); fs.writeFileSync(cf, JSON.stringify(campaign));
fs.writeFileSync(path.join(tmp, 'r1.json'), JSON.stringify(r1)); fs.writeFileSync(path.join(tmp, 'r2.json'), JSON.stringify(r2));
const cr = spawnSync(process.execPath, [BIN, 'compose-review', cf, path.join(tmp, 'r2.json'), path.join(tmp, 'out'), '--previous', path.join(tmp, 'r1.json')], { encoding: 'utf8' });
check('compose-review writes FIXLIST.md and score.json', cr.status === 0 && fs.existsSync(path.join(tmp, 'out/FIXLIST.md')) && JSON.parse(fs.readFileSync(path.join(tmp, 'out/score.json'))).resolved === 2, cr.stderr);
fs.writeFileSync(path.join(tmp, 'bad.json'), JSON.stringify(r1bad));
check('compose-review fails a bad fix list', spawnSync(process.execPath, [BIN, 'compose-review', cf, path.join(tmp, 'bad.json'), path.join(tmp, 'out2')]).status === 1);
const fin = path.join(tmp, 'fin'); fs.mkdirSync(path.join(fin, 'fix-a'), { recursive: true }); fs.mkdirSync(path.join(fin, 'fix-y'), { recursive: true });
fs.writeFileSync(path.join(fin, 'fix-a/patch.diff'), 'diff --git a/media/nh3-kit/trial/yard/campus_v2/districts/A_historic/src/x.py b/media/nh3-kit/trial/yard/campus_v2/districts/A_historic/src/x.py\n');
fs.writeFileSync(path.join(fin, 'fix-a/report.json'), JSON.stringify({ items: [{ id: 1, status: 'fixed' }] }));
fs.writeFileSync(path.join(fin, 'fix-y/patch.diff'), 'diff --git a/AGENTS.md b/AGENTS.md\n');
const cx = spawnSync(process.execPath, [BIN, 'compose-fix', cf, fin, path.join(tmp, 'fo')], { encoding: 'utf8' });
const sum = JSON.parse(fs.readFileSync(path.join(tmp, 'fo/fix-summary.json'), 'utf8'));
check('compose-fix flags a patch outside its owner scope', cx.status === 1 && sum.violations.length === 1 && sum.violations[0].owner === 'Y');
check('compose-fix counts fixed items per lane', sum.lanes.find((l) => l.owner === 'A').fixed === 1);

// compose-judge: a winner must be one of the lane's variants
fs.writeFileSync(path.join(tmp, 'lanes.json'), JSON.stringify({ A: ['opus', 'codex'] }));
fs.writeFileSync(path.join(tmp, 'w-ok.json'), JSON.stringify({ A: { winner: 'codex', why: 'cleaner' } }));
fs.writeFileSync(path.join(tmp, 'w-bad.json'), JSON.stringify({ A: { winner: 'sonnet', why: '?' } }));
check('compose-judge accepts a listed winner', spawnSync(process.execPath, [BIN, 'compose-judge', path.join(tmp, 'lanes.json'), path.join(tmp, 'w-ok.json'), tmp]).status === 0);
check('compose-judge rejects an unlisted winner', spawnSync(process.execPath, [BIN, 'compose-judge', path.join(tmp, 'lanes.json'), path.join(tmp, 'w-bad.json'), tmp]).status === 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failure(s)` : 'all hillclimb tests passed');
process.exit(fails ? 1 : 0);
