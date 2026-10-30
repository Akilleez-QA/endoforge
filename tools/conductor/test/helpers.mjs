// Shared scratch-repo setup for the conductor tests: fake logins, a git repo, a staged and confirmed job.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadJob } from '../../job/lib/load.mjs';
import { cardHash } from '../../job/lib/card.mjs';
import * as C from '../lib/commands.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), JOBCLI = path.join(HERE, '../../job/bin/job.mjs');
export const sh = (cwd, ...a) => { const r = spawnSync(a[0], a.slice(1), { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

export function scratch(tmp, workerScript) {
  const home = path.join(tmp, 'home');
  for (const p of ['.codex/auth.json', '.claude-accts/a1/.credentials.json']) { fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true }); fs.writeFileSync(path.join(home, p), ''); }
  Object.assign(process.env, { HOME: home, ENDOFORGE_NOTIFY: 'none', ENDOFORGE_JOBS: path.join(tmp, 'none'), ENDOFORGE_VOLATILE: '/nonexistent-volatile', WORKER_STATE_DIR: path.join(tmp, 'workers') });
  for (const k of Object.keys(process.env)) if (k.startsWith('CODEX_POOL_')) delete process.env[k];

  // The stub worker: finds its owned file in the compiled prompt; "bad" → good; "breaks" → a syntax error the first
  // time, fixed once its prompt carries the gate's error; "stuck" → always broken.
  const worker = path.join(tmp, 'worker.sh');
  fs.writeFileSync(worker, workerScript ?? `#!/bin/bash
  for a in "$@"; do case "$a" in *READY*) echo READY; exit 0;; *"You own ONLY"*) brief="$a";; esac; done
  f=$(printf '%s\\n' "$brief" | sed -n '/You own ONLY/{n;s/^- //p;q}')
  case "$(cat "$f")" in
    bad) echo good > "$f";;
    breaks) if printf '%s' "$brief" | grep -q "reverted at the collect gate"; then echo good > "$f"; else echo "SYNTAX ERROR" > "$f"; fi;;
    stuck) echo "SYNTAX ERROR" > "$f";;
  esac
  echo stray > stray.txt
  `, { mode: 0o755 });

  function setup(name, contents, conductor = {}, edit = () => {}) {
    const d = path.join(tmp, name), repo = path.join(d, 'repo'); fs.mkdirSync(path.join(repo, 'game'), { recursive: true });
    for (const [f, v] of Object.entries(contents)) fs.writeFileSync(path.join(repo, 'game', f), v + '\n');
    sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', 'config', 'user.email', 't@t'); sh(repo, 'git', 'config', 'user.name', 't');
    sh(repo, 'git', 'add', 'game'); sh(repo, 'git', 'commit', '-q', '-m', 'seed');
    fs.writeFileSync(path.join(d, 'REQUEST.md'), 'Make each fixture line pass its check.\n'); fs.writeFileSync(path.join(d, 'NOTES.md'), '# notes\n'); fs.writeFileSync(path.join(d, 'smoke.json'), '{}');
    const ids = Object.keys(contents).map((f) => f.replace('.txt', '').toUpperCase());
    const job = { schema: 'endoforge/job/1', id: name, kind: 'code', title: name, repo,
      goal: { verbatim: 'Make each fixture line pass its check.', by: 'operator' }, brief: { objective: 'o', acceptance: 'a', scope: 's', authority: 'au', assumptions: { stated: [], inferred: [] } },
      sources: [{ id: 'req', primary: true, path: path.join(d, 'REQUEST.md'), governs: ['text'], what: 'the request' }],
      criteria: [{ id: 'T1', statement: 'lines read good', satisfiedBy: ids, requires: ['edit'], check: { kind: 'tests', run: 'true' } }],
      atoms: ids.map((id, i) => ({ id, engine: i % 2 ? 'claude' : 'codex', aspects: ['text'], capabilities: ['edit'], files: [`game/${id.toLowerCase()}.txt`], sources: ['req'], checks: ['T1'] })),
      gates: [], resources: { capacityDial: true, throttle: 'endoforge', ownerBound: true, health: ['true'] }, ratchet: { kind: 'tests' },
      criticalPath: ids[0], rival: 'by hand', deadline: '2099-01-01T00:00:00Z', notes: path.join(d, 'NOTES.md'),
      proofs: { smoke: { engines: { codex: true, claude: true }, receipt: path.join(d, 'smoke.json') } },
      conductor: { launcher: 'local', codexPool: worker, claudeBin: worker, maxIterations: 2, gate: '! grep -q "SYNTAX ERROR" game/*.txt', ...conductor } };
    edit(job);
    const f = path.join(d, 'job.json'); fs.writeFileSync(f, JSON.stringify(job));
    assert.equal(spawnSync(process.execPath, [JOBCLI, 'stage', f], { encoding: 'utf8' }).status, 0);
    C.go(loadJob(f), f, { sha: cardHash(loadJob(f)), by: 'operator', words: 'go' });
    return { f, repo, d };
  }
  return setup;
}
