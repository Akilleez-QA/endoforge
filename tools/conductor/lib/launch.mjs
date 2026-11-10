import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { discoverLogins, assignLanes, workerCommand, workerCapacity, waveSize } from '../../hillclimb/lib/fanout.mjs';
import { exitWrapper, readExit } from '../../lib/exitfile.mjs';
import { stateDir } from './state.mjs';

export const LOST = -1;

const git = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr.trim()}`); return r.stdout.trim(); };
const codexOnPath = () => (process.env.PATH || '').split(':').map((d) => path.join(d, 'codex')).find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
export const unitName = (job, atom, iter) => `endoforge-${job.id}-${atom}-i${iter}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

export function assignLogins(job, state, logins = discoverLogins()) {
  const need = (job.atoms ?? []).filter((a) => !state.atoms[a.id]?.login && ['codex', 'claude'].includes(a.engine));
  if (!need.length) return;
  const pieces = Object.fromEntries(need.map((a) => [a.id, { files: a.files, engine: a.engine, account: a.account }]));
  for (const l of assignLanes({ pieces }, logins)) state.atoms[l.piece].login = { engine: l.engine, account: l.account, ...(l.configDir ? { configDir: l.configDir } : {}) };
}

export function slotsFree(job, state, env = process.env) {
  const running = Object.values(state.atoms).filter((a) => a.status === 'launched').length;
  return Math.max(0, waveSize(Object.keys(state.atoms).length, workerCapacity(env)) - running);
}

export function launchAtom(job, file, state, id, { prompt, images = [] }) {
  const a = (job.atoms ?? []).find((x) => x.id === id), st = state.atoms[id], c = job.conductor ?? {};
  if (state.budget.launches >= state.budget.maxLaunches) return { refused: 'budget' };
  const iter = st.iter + 1, dir = stateDir(job, file);
  const wt = path.join(c.worktrees ?? path.join(dir, 'worktrees'), `${id}-i${iter}`), branch = `conductor/${job.id}/${id}-i${iter}`.toLowerCase();
  const base = git(job.repo, 'rev-parse', 'HEAD');
  if (fs.existsSync(wt)) git(job.repo, 'worktree', 'remove', '--force', wt);
  git(job.repo, 'worktree', 'add', '-q', '-B', branch, wt, base);
  for (const l of c.links ?? []) fs.symlinkSync(l.target, path.join(wt, l.path));
  const promptFile = path.join(dir, 'prompts', `${id}-i${iter}.prompt`), log = path.join(dir, 'logs', `${id}-i${iter}.log`), exitFile = path.join(dir, 'logs', `${id}-i${iter}.exit`);
  for (const f of [promptFile, log]) fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(promptFile, prompt); fs.rmSync(exitFile, { force: true });
  const lane = { engine: st.login?.engine ?? a.engine, account: st.login?.account ?? 'default', configDir: st.login?.configDir };
  const { argv, env } = workerCommand({ fanout: { codexPool: c.codexPool, claudeBin: c.claudeBin, claudeModel: c.claudeModel, codexModel: c.codexModel, claudeTools: c.claudeTools } }, lane, { worktree: wt, prompt, images });
  if (lane.engine === 'codex') { const bin = process.env.CODEX_POOL_BIN || codexOnPath(); if (bin) env.CODEX_POOL_BIN = bin; }
  const wrapped = ['sh', '-c', exitWrapper(exitFile), 'atom', ...argv];
  let handle;
  if ((c.launcher ?? 'systemd') === 'local') {
    const child = spawn(wrapped[0], wrapped.slice(1), { cwd: wt, env: { ...process.env, ...env }, detached: true, stdio: [fs.openSync(promptFile, 'r'), fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
    child.unref(); handle = { pid: child.pid };
  } else {
    const unit = unitName(job, id, iter);
    spawnSync('systemctl', ['--user', 'reset-failed', unit], { stdio: 'ignore' });
    const r = spawnSync('systemd-run', ['--user', `--unit=${unit}`, '--slice=heavy.slice', `--working-directory=${wt}`, `--setenv=PATH=${process.env.PATH}`,
      ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), `--property=RuntimeMaxSec=${c.atomTimeoutSec ?? 2400}`,
      `--property=StandardInput=file:${promptFile}`, `--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`, '--', ...wrapped], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`systemd-run ${unit}: ${r.stderr.trim()}`);
    handle = { unit };
  }
  Object.assign(st, { status: 'launched', iter, lane: { ...handle, worktree: wt, branch, base, exitFile, log, prompt: promptFile, startedAt: new Date().toISOString(), engine: lane.engine, account: lane.account } });
  state.budget.launches++;
  return { iter, ...handle };
}

const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function unitEnded(unit) {
  const ctl = process.env.ENDOFORGE_SYSTEMCTL ?? 'systemctl';
  const active = spawnSync(ctl, ['--user', 'is-active', unit], { encoding: 'utf8' }).stdout?.trim();
  if (!active || ['active', 'activating', 'reloading'].includes(active)) return null;
  const show = spawnSync(ctl, ['--user', 'show', '-p', 'ExecMainStatus', '--value', unit], { encoding: 'utf8' });
  if (show.status !== 0) return null;
  const code = show.stdout.trim();
  return { code: code === '' ? 0 : Number(code) };
}

export function laneExit(st) {
  const lane = st.lane;
  if (lane?.exitFile) {
    const code = readExit(lane.exitFile);
    if (code != null) return code;
    if (lane.unit) {
      const ended = unitEnded(lane.unit);
      if (!ended) return null;
      return readExit(lane.exitFile) ?? (ended.code > 0 ? ended.code : LOST);
    }
    if (lane.pid && !groupAlive(lane.pid)) return readExit(lane.exitFile) ?? LOST;
    return null;
  }
  if (!lane?.unit) return null;
  return unitEnded(lane.unit)?.code ?? null;
}

export function stopLanes(state) {
  for (const st of Object.values(state.atoms)) {
    if (st.status !== 'launched' || !st.lane) continue;
    if (st.lane.unit) spawnSync('systemctl', ['--user', 'stop', st.lane.unit], { stdio: 'ignore' });
    else if (st.lane.pid) { try { process.kill(-st.lane.pid, 'SIGTERM'); } catch {} }
    st.status = 'failed'; st.last = 'stopped';
  }
}
