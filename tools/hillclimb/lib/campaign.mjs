// Hill-climb campaigns (`endoforge/hillclimb/1`): what to render, what references exist, how to critique, who fixes what.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateFanout } from './fanout.mjs';

export const SCHEMA = 'endoforge/hillclimb/1';
const expandHome = (p) => (typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** Replace ${name} placeholders in strings (deep). Unknown names are left as they are. */
export function expand(value, vars) {
  if (typeof value === 'string') return value.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  if (Array.isArray(value)) return value.map((v) => expand(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, vars)]));
  return value;
}

export function validateCampaign(c) {
  const errors = [];
  const E = (m) => errors.push(m);
  if (c?.schema !== SCHEMA) E(`schema must be ${SCHEMA}`);
  if (!c?.id || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) E('id must be a lowercase slug');
  if (!c?.goal || c.goal.length < 20) E('goal must state what better means (at least 20 characters)');
  if (!c?.workdir) E('workdir is required (rounds live in <workdir>/rounds/rNN)');
  if (!Array.isArray(c?.render) || !c.render.length) E('render must list at least one job');
  for (const [i, r] of (c?.render ?? []).entries()) {
    if (!r.id || !Array.isArray(r.command)) E(`render[${i}] needs id and command (array)`);
    // A job wrapped in systemd-run --scope leaves the round's cgroup, so stopping the round leaves it running
    else if (/systemd-run\b[^|;&]*--scope/.test(r.command.join(' '))) E(`render[${i}] must not wrap jobs in systemd-run --scope; use blender-cpu or heavy-run`);
  }
  if (c?.mode != null && !['compete', 'fanout'].includes(c.mode)) E('mode must be fanout or compete (the default)');
  const fanout = c?.mode === 'fanout';
  if (fanout) errors.push(...validateFanout(c));
  const owners = fanout ? {} : c?.owners ?? {};
  if (!fanout && !Object.keys(owners).length) E('owners must name at least one fix lane');
  for (const [k, o] of Object.entries(owners)) {
    if (!/^[A-Z][A-Z0-9]*$/.test(k)) E(`owner key ${k} must be uppercase letters/digits (it tags fix-list items)`);
    if (!o.describe) E(`owner ${k} needs describe (what it owns, shown to the critic)`);
    if (!Array.isArray(o.scope) || !o.scope.length) E(`owner ${k} needs scope (repo-relative paths its patch may touch)`);
  }
  const n = c?.critique?.count ?? 0;
  if (!fanout && !(n >= 1 && n <= 500)) E('critique.count must be 1..500');
  const s = c?.stop ?? {};
  if (!(s.maxRounds >= 1)) E('stop.maxRounds must be at least 1');
  return { ok: !errors.length, errors };
}

export function loadCampaign(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = validateCampaign(c);
  if (!v.ok) throw new Error(`campaign ${file}: ${v.errors.join('; ')}`);
  c.workdir = expandHome(c.workdir);
  if (c.repo) c.repo = expandHome(c.repo);
  return c;
}

export const roundName = (n) => `r${String(n).padStart(2, '0')}`;
export const roundDir = (c, n) => path.join(c.workdir, 'rounds', roundName(n));

/** The highest round that has a directory (0 when none). */
export function lastRound(c) {
  const d = path.join(c.workdir, 'rounds');
  if (!fs.existsSync(d)) return 0;
  return Math.max(0, ...fs.readdirSync(d).map((x) => Number(/^r(\d+)$/.exec(x)?.[1] ?? 0)));
}

export function vars(c, n, extra = {}) {
  return { repo: c.repo ?? '', workdir: c.workdir, round: n, roundDir: roundDir(c, n), tool: path.resolve(new URL('..', import.meta.url).pathname), ...extra };
}
