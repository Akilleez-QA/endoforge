// Adopt a job that is already running on older scripts without losing its progress. The old manifest becomes an
// endoforge/job/1 manifest, the old loop state becomes the Conductor's state, and the old lanes (units, worktrees) are
// tracked where they stand, so a lane still running lands into the Conductor. Universal mechanism only: everything
// about the old layout and how its atoms map to aspects and capabilities is DATA in a map file (see
// examples/*.adopt-map.json):
//   layout:  { unit, worktree, base, prompt, log, collected } templates over {round}, {atom} (lower case), {ATOM},
//            {lanes}, {logs}; `base` may end in #field to read one field of a JSON file
//   atoms:   [{ when?: { field?: <key present on the old atom>, files?: <regex> }, aspects?, capabilities? }], first match
//   primarySource, criticalPath, by
// The adopted job starts at `staged`: its card is new, so it needs one go from the user (a relayed go never counts).
// What the old manifest cannot say is listed in `missing` for the coordinator; the gates refuse the go until it is there.
import fs from 'node:fs';
import path from 'node:path';
import { validate } from '../../job/lib/validate.mjs';
import { writeJSONAtomic } from '../../lib/lock.mjs';
import { initState, stateFile } from './state.mjs';

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { if (d !== undefined) return d; throw new Error(`cannot read ${f}`); } };
const firstPath = (s) => /(\/[^\s,()]+)/.exec(String(s))?.[1] ?? null;
const STATUS = { running: 'launched', frozen: 'frozen', 'needs-coordinator': 'needs-coordinator' };
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
function fromTemplate(t, v) {
  if (!t) return null;
  const [p, field] = fill(t, v).split('#');
  return field ? readJSON(p, {})[field] ?? null : p;
}

/** o: { legacy, loopState?, atoms?: [extra ids], map: {layout, atoms, primarySource?, criticalPath?, by?}, lanesDir, logsDir,
 *       repo, out, kind, notes, deadline, checks: [{ id, statement, run, json?, atoms? }], slice?, baseline? } */
export function adopt(o) {
  const L = readJSON(o.legacy), loop = o.loopState ? readJSON(o.loopState, {}) : {}, map = o.map ?? {};
  if (!map.layout?.worktree || !map.layout?.base) throw new Error('the adopt map needs layout.worktree and layout.base (where the old lanes and their base commits are)');
  const ids = [...new Set([...Object.keys(loop), ...(o.atoms ?? [])])];
  const sources = Object.entries(L.governing ?? L.sources ?? {}).map(([k, g]) => {
    const raw = typeof g === 'string' ? g : g.path, p = firstPath(raw) ?? (raw ? path.join(o.repo, raw) : null);
    return { id: k, path: p, governs: [k], what: typeof g === 'string' ? k : g.governs, ...(k === (map.primarySource ?? Object.keys(L.governing ?? {})[0]) ? { primary: true } : {}) };
  });
  const rule = (a) => (map.atoms ?? []).find((r) => !r.when || ((!r.when.field || a[r.when.field] != null) && (!r.when.files || a.files.some((f) => new RegExp(r.when.files).test(f))))) ?? {};
  const atoms = ids.map((id) => {
    const a = L.atoms?.[id]; if (!a) throw new Error(`atom ${id} is not in ${o.legacy}`);
    const r = rule(a), aspects = (r.aspects ?? sources.map((s) => s.id)).filter((x) => sources.some((s) => s.id === x));
    return { id, engine: a.engine, ...(a.account ? { account: a.account } : {}), files: a.files, aspects, sources: aspects, capabilities: r.capabilities ?? ['edit'],
      checks: (o.checks ?? []).filter((k) => !k.atoms || k.atoms.includes(id)).map((k) => k.id), ...(r.contract ?? L.contract ? { contract: r.contract ?? L.contract } : {}) };
  });
  const criteria = (o.checks?.length ? o.checks : (L.checks ?? []).map((t, i) => ({ id: `L${i + 1}`, statement: t })))
    .map((k) => ({ id: k.id, statement: k.statement, satisfiedBy: k.atoms ?? ids, requires: [], ...(k.run ? { check: { kind: 'command', run: k.run } } : {}) }));
  const job = {
    schema: 'endoforge/job/1', id: (o.id ?? L.title ?? 'adopted').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40), kind: o.kind ?? 'generic', title: L.title,
    goal: { verbatim: (Array.isArray(L.goal) ? L.goal : [L.goal]).join(' / '), by: map.by ?? o.by ?? 'the user' },
    brief: { objective: L.title, acceptance: (L.checks ?? []).join('; '), scope: `the adopted atoms: ${ids.join(', ')}`, authority: 'adopted mid-run; the adopted card needs the user\'s go',
      assumptions: { stated: Array.isArray(L.goal) ? L.goal : [L.goal], inferred: [`adopted from ${o.legacy}${o.loopState ? ` and ${o.loopState}` : ''}`] } },
    sources, criteria, atoms, contracts: [], seams: [], gates: [], repo: o.repo, notes: o.notes, deadline: o.deadline,
    criticalPath: map.criticalPath ?? o.criticalPath ?? ids[0], rival: 'finish on the old scripts by hand',
    resources: { logins: 'discover', capacityDial: true, throttle: 'endoforge', gpu: 'gpu-queue', ownerBound: true },
    ratchet: o.baseline ? { baseline: o.baseline } : { kind: 'tests' }, lessonsFrom: o.notes ? [o.notes] : [],
    ...(L.knowledge ? { knowledge: L.knowledge } : {}),
    proofs: { smoke: { engines: Object.fromEntries([...new Set(atoms.map((a) => a.engine))].map((e) => [e, true])), receipt: o.loopState ?? o.legacy, adopted: true } },
    conductor: { launcher: 'systemd', ...(o.slice ? { slice: { command: o.slice } } : {}),
      checks: (o.checks ?? []).filter((k) => k.run).map((k) => ({ id: k.id, run: k.run, ...(k.json ? { json: true } : {}), ...(k.atoms ? { atoms: k.atoms } : {}) })) },
  };
  const state = initState(job);
  for (const id of ids) {
    const l = loop[id], a = L.atoms[id];
    if (!l) continue;                                              // extra atoms start pending
    const v = { round: l.round, atom: id.toLowerCase(), ATOM: id, lanes: o.lanesDir, logs: o.logsDir };
    Object.assign(state.atoms[id], { status: STATUS[l.status] ?? 'failed', iter: l.iter, history: l.history ?? [], adoptedFrom: { round: l.round, status: l.status } });
    if (l.status !== 'running') continue;
    const collected = fromTemplate(map.layout.collected, v);
    if (collected && fs.existsSync(collected)) { Object.assign(state.atoms[id], { status: 'checking', sha: null }); continue; }   // the old tool already collected it
    state.atoms[id].lane = { unit: fromTemplate(map.layout.unit, v), worktree: fromTemplate(map.layout.worktree, v), base: fromTemplate(map.layout.base, v),
      engine: a.engine, account: a.account ?? 'default', prompt: fromTemplate(map.layout.prompt, v), log: fromTemplate(map.layout.log, v), adopted: true };
  }
  if (fs.existsSync(stateFile(job, o.out))) throw new Error(`${stateFile(job, o.out)} exists; adopt into a fresh job directory`);
  writeJSONAtomic(o.out, job);
  writeJSONAtomic(stateFile(job, o.out), state);
  const v = validate(job, { gate: 'decide', confirmation: { ok: true } });
  return { job, state, missing: v.errors.filter((e) => !(e.inv === 'I14' && /retrieved/.test(e.msg))) };
}
