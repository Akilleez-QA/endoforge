import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewAtoms, fixAtoms, judgeAtoms } from '../lib/plan.mjs';
import { campaignPolicy, TOOL_DIR } from '../lib/runner.mjs';
import { roundDir } from '../lib/campaign.mjs';
import { atomBinds } from '../../atomizer/lib/binds.mjs';
import { runIsolated } from '../../atomizer/lib/isolate.mjs';
import { toolchainFor } from '../../atomizer/lib/workers.mjs';
import { validate } from '../../atomizer/lib/validate.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SHARED = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/atomizer/policy.json'), 'utf8'));
const bwrap = spawnSync('bwrap', ['--ro-bind', '/', '/', 'true']).status === 0;

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-mounts-'));
  const work = path.join(tmp, 'campaign');
  const c = {
    schema: 'endoforge/hillclimb/1', id: 'mount-test', goal: 'stills read more clearly at a glance than last round',
    workdir: work, render: [{ id: 'still', command: ['true'] }], owners: { A: { describe: 'lighting', scope: ['scene'] } },
    critique: { count: 3 }, stop: { maxRounds: 1 }, fix: { compete: true },
  };
  const rd = roundDir(c, 1);
  fs.mkdirSync(path.join(rd, 'judge'), { recursive: true });
  fs.writeFileSync(path.join(rd, 'campaign.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(rd, 'judge/lanes.json'), '{}');
  const fixlist = { schema: 'endoforge/hillclimb-fixlist/1', round: 1, items: [{ id: 1, still: 'still.png', problem: 'the key light is far too flat', owner: 'A', severity: 'major' }] };
  const docs = { review: reviewAtoms(c, 1), fix: fixAtoms(c, 1, fixlist), judge: judgeAtoms(c, 1, { A: ['opus', 'codex'] }) };
  return { tmp, c, docs, fixlist, policy: campaignPolicy(SHARED, c) };
}

const scriptAtoms = (doc) => doc.atoms.filter((a) => a.worker?.model === 'script');

async function inSandbox(atom, policy, cmd, dirs) {
  const { mounts, errors } = atomBinds(atom, policy);
  assert.deepEqual(errors, []);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hillclimb-mounts-home-'));
  try {
    return await runIsolated({
      homeTemplate: home,
      mounts: [{ host: dirs.in, guest: '/in', mode: 'ro' }, { host: dirs.out, guest: '/out', mode: 'rw' }, { host: dirs.work, guest: '/work', mode: 'rw' }, ...mounts],
      toolchain: toolchainFor(atom.worker.toolchain ?? ['node'], policy, REPO), cmd, stdin: null, cwd: '/work', timeoutMs: 60_000,
    });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function dirsIn(tmp, id) {
  const d = { in: path.join(tmp, id, 'in'), out: path.join(tmp, id, 'out'), work: path.join(tmp, id, 'work') };
  for (const x of Object.values(d)) fs.mkdirSync(x, { recursive: true });
  return d;
}

test('every compose atom binds what its script imports and the stage policy accepts those binds', () => {
  const { tmp, docs, policy } = setup();
  try {
    for (const [stage, doc] of Object.entries(docs)) {
      const atoms = scriptAtoms(doc);
      assert.ok(atoms.length, `${stage} has no script atom`);
      for (const a of atoms) {
        const { mounts, errors } = atomBinds(a, policy);
        assert.deepEqual(errors, [], `${stage}/${a.id}`);
        const guests = mounts.map((m) => m.guest);
        const script = a.worker.command[1];
        assert.ok(guests.some((g) => script.startsWith(g + '/')), `${stage}/${a.id}: ${script} is not under any bind`);
        for (const rel of ['tools/lib/lock.mjs', 'core/runtime/subscription-guard.mjs']) {
          const host = fs.realpathSync(path.join(REPO, rel));
          assert.ok(mounts.some((m) => m.host === host || host.startsWith(m.host + '/')), `${stage}/${a.id}: ${rel} is not mounted`);
        }
      }
      assert.ok(validate(doc, policy).ok, `${stage}: ${JSON.stringify(validate(doc, policy))}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('model atoms see no more of the repository than the hillclimb tool', () => {
  const { tmp, docs, policy } = setup();
  try {
    for (const doc of Object.values(docs)) for (const a of doc.atoms.filter((x) => x.worker?.model !== 'script')) {
      for (const m of atomBinds(a, policy).mounts) assert.ok(!(fs.realpathSync(REPO) + '/').startsWith(m.host + '/') && !m.host.startsWith(fs.realpathSync(path.join(REPO, 'core'))), `${a.id} mounts ${m.host}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('hillclimb.mjs links and runs inside each compose atom\'s sandbox mount layout', { skip: !bwrap && 'bwrap cannot start here' }, async () => {
  const { tmp, docs, policy } = setup();
  try {
    for (const [stage, doc] of Object.entries(docs)) for (const a of scriptAtoms(doc)) {
      const r = await inSandbox(a, policy, [a.worker.command[0], a.worker.command[1]], dirsIn(tmp, `${stage}-${a.id}-bare`));
      assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/, `${stage}/${a.id}: ${r.stderr}`);
      assert.equal(r.exit, 2, `${stage}/${a.id}: ${r.stderr}`);
      assert.match(r.stderr, /compose-review/);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the review compose command writes FIXLIST.md and score.json inside its sandbox', { skip: !bwrap && 'bwrap cannot start here' }, async () => {
  const { tmp, docs, policy, fixlist } = setup();
  try {
    const a = scriptAtoms(docs.review)[0];
    const d = dirsIn(tmp, 'review-run');
    fs.mkdirSync(path.join(d.in, 'critique'));
    fs.writeFileSync(path.join(d.in, 'critique/fixlist.json'), JSON.stringify(fixlist));
    const r = await inSandbox(a, policy, a.worker.command, d);
    assert.equal(r.exit, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(d.out, 'FIXLIST.md'), 'utf8'), /key light is far too flat/);
    assert.ok(fs.statSync(path.join(d.out, 'score.json')).size > 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the tool directory the policy grants is this checkout\'s hillclimb', () => {
  assert.equal(TOOL_DIR, path.join(REPO, 'tools/hillclimb'));
});
