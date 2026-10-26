// JOB manifest (`endoforge/job/1`) validator: POODO executed as code. Task-agnostic. Every rule belongs to one
// POODO gate (lib/invariants.mjs GATES) and cites the invariant it enforces; kind plugins (lib/kinds.mjs) add only
// kind-specific checks. validate(job, { gate }) runs every rule up to and including that gate; `decide` is the gate
// before any spend, `orchestrate` the gate before the wide launch.
import fs from 'node:fs';
import path from 'node:path';
import { INVARIANTS, GATES, gateIndex } from './invariants.mjs';
import { KINDS } from './kinds.mjs';

export const SCHEMA = 'endoforge/job/1';
export const VOLATILE = ['/tmp', '/var/tmp', '/dev/shm', '/run/user'];
const norm = (p) => String(p).replace(/\/+$/, '');
export const overlaps = (a, b) => { const x = norm(a), y = norm(b); return x === y || x.startsWith(y + '/') || y.startsWith(x + '/'); };
export const PROXY_KINDS = ['eval', 'likeness', 'critic', 'site-rules'];   // checks that measure a proxy: calibrate and label them

/** Every durable path the manifest names, with where it came from. */
export function manifestPaths(job) {
  const out = [], add = (where, p) => { if (p) out.push({ where, path: p }); };
  for (const s of job.sources ?? []) add(`source ${s.id}`, s.path);
  for (const r of job.references ?? []) add(`reference ${r.id}`, r.path);
  for (const t of job.truth ?? []) add(`truth ${t.id}`, t.path);
  for (const c of job.criteria ?? []) { add(`criterion ${c.id} calibration good`, c.check?.calibration?.good); add(`criterion ${c.id} calibration bad`, c.check?.calibration?.bad); }
  for (const a of job.atoms ?? []) for (const i of a.inputs ?? []) add(`atom ${a.id} input`, i);
  for (const s of job.splits ?? []) add(`split ${s.from} proof`, s.proof);
  add('notes', job.notes); add('repo', job.repo); add('ratchet baseline', job.ratchet?.baseline);
  return out;
}

const readProof = (p, offline) => { try { return !offline && p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } };

/** The rules, in POODO order. Each returns a list of [invariant, message] for what is broken. */
const RULES = {
  pontificate(job, x) {
    const out = [], E = (i, m) => out.push([i, m]);
    if (job.schema !== SCHEMA) E('I1', `schema must be ${SCHEMA}`);
    if (!x.kind) E('I1', `kind must be one of ${Object.keys(KINDS).join(', ')}`);
    if (!job.goal?.verbatim || job.goal.verbatim.length < 10) E('I1', 'goal.verbatim must hold the user\'s own words');
    if (!job.goal?.by) E('I1', 'goal.by must name who said it');
    if (!x.sources.some((s) => s.primary)) E('I1', 'no primary source: brief from the source itself (the script, the issue, the spec), never from a summary');
    const b = job.brief ?? {};
    for (const k of ['objective', 'acceptance', 'scope', 'authority']) if (!b[k]) E('I1', `brief.${k} is missing (decompress the goal before observing)`);
    if (!Array.isArray(b.assumptions?.stated) || !Array.isArray(b.assumptions?.inferred)) E('I1', 'brief.assumptions must keep what the user stated apart from what was inferred');
    if (!job.notes) E('I14', 'notes: name the running NOTES.md (mistakes with their cost, findings)');
    return out;
  },
  observe(job, x) {
    const out = [], E = (i, m) => out.push([i, m]);
    for (const r of [...x.sources, ...x.refs]) {
      if (!r.id || !r.path || !r.what) E('I2', `source or reference ${r.id ?? '?'} needs id, path and what`);
      if (!Array.isArray(r.governs) || !r.governs.length) E('I2', `${r.id}: say what it governs (governs: ["model"], ["persona"], …)`);
    }
    for (const t of job.truth ?? []) if (!t.what || !t.path || !t.tolerance) E('I4', `truth ${t.id ?? '?'} needs what, path and tolerance`);
    if (x.kind?.requiresTruth && !(job.truth ?? []).length) E('I4', `a ${job.kind} job must name its truth package (survey, measurements, standards) with tolerances before building`);
    for (const { where, path: p } of manifestPaths(job)) {
      if (where.startsWith('split')) continue;                         // proofs are made in Orient
      if (!path.isAbsolute(p)) E('I7', `${where}: ${p} must be an absolute path`);
      else if (x.volatile.some((v) => p === v || p.startsWith(v + '/'))) E('I7', `${where}: ${p} is on volatile disk; move it to durable disk now`);
      else if (!x.offline && !fs.existsSync(p)) E('I7', `${where}: ${p} does not exist`);
    }
    return out;
  },
  orient(job, x) {
    const out = [], E = (i, m) => out.push([i, m]), { atoms, ids } = x, inputs = [...x.sources, ...x.refs];
    if (!atoms.length) E('I5', 'no atoms');
    for (const a of atoms) {
      if (!(a.aspects ?? []).length) E('I2', `atom ${a.id} needs aspects (what it works on), so its governing inputs can be matched`);
      const has = new Set([...(a.references ?? []), ...(a.sources ?? [])]);
      for (const r of inputs) {
        const hit = (r.governs ?? []).filter((g) => (a.aspects ?? []).includes(g));
        if (hit.length && !has.has(r.id)) E('I2', `atom ${a.id} works on ${hit.join(', ')}, which ${r.id} governs, but ${r.id} is not one of its inputs`);
      }
      for (const y of has) if (!inputs.some((r) => r.id === y)) E('I2', `atom ${a.id} names unknown input ${y}`);
      if (!(a.files ?? []).length) E('I5', `atom ${a.id} owns no files`);
      if (!(a.checks ?? []).length) E('I6', `atom ${a.id} has no local check (an atom you cannot check alone cannot run in parallel)`);
      for (const c of a.checks ?? []) if (!x.crit[c]) E('I6', `atom ${a.id} names unknown check ${c}`);
    }
    for (const [i, a] of atoms.entries()) for (const b of atoms.slice(i + 1))
      for (const f of a.files ?? []) for (const g of b.files ?? []) if (overlaps(f, g)) E('I5', `atoms ${a.id} and ${b.id} share ${f === g ? f : `${f} / ${g}`}`);
    const owned = (p) => atoms.find((a) => (a.files ?? []).some((f) => overlaps(f, p)));
    for (const k of job.contracts ?? []) {
      if (!k.owner || (k.owner !== 'frozen' && !ids.has(k.owner))) E('I5', `contract ${k.path} needs an owner (an atom id, or "frozen")`);
      const o = owned(k.path); if (o && o.id !== k.owner) E('I5', `contract ${k.path} sits inside atom ${o.id}'s files but is owned by ${k.owner}`);
    }
    for (const a of atoms) for (const p of a.reads ?? [])
      if (!owned(p) && !(job.contracts ?? []).some((k) => overlaps(k.path, p))) E('I5', `atom ${a.id} reads shared ${p}, which no atom or contract owns`);
    for (const s of job.seams ?? []) {
      if (!(s.between ?? []).length || !s.between.every((y) => ids.has(y))) E('I5', `seam ${s.id} is between unknown atoms`);
      if (!s.owner || (!ids.has(s.owner) && !(job.contracts ?? []).some((k) => k.path === s.contract))) E('I5', `seam ${s.id} needs an owner atom or a contract`);
    }
    for (const s of job.splits ?? []) {
      const p = readProof(s.proof, x.offline) ?? s.proofResult ?? null;
      const good = p?.ok === true && (p.kind === 'tests' ? x.kind?.splitByTests : typeof p.noiseFloor === 'number');
      if (!good) E('I6', `split of ${s.from} is not proven a no-op (${x.kind?.splitByTests ? 'tests before and after' : 'a pixel diff within a measured noise floor'})`);
    }
    if (!job.criticalPath || !ids.has(job.criticalPath)) E('I13', 'criticalPath must name the atom expected to be the long pole');
    for (const a of atoms) if ((a.speculate ?? 1) > 1 && a.id !== job.criticalPath) E('I13', `atom ${a.id} speculates but is not the critical path (${job.criticalPath})`);
    if (!job.rival) E('I13', 'rival: name the strongest rival approach and what would discriminate it');
    if (!job.deadline || Number.isNaN(Date.parse(job.deadline))) E('I13', 'deadline must be an ISO date-time');
    return out;
  },
  decide(job, x) {
    const out = [], E = (i, m) => out.push([i, m]), { criteria, refs, atoms } = x;
    if (!criteria.length) E('I3', 'no acceptance criteria');
    for (const c of criteria) {
      const k = c.check?.kind;
      if (!k) { E('I3', `criterion ${c.id} has no check`); continue; }
      if (k === 'human' && !x.gates[c.check.gate]) E('I3', `criterion ${c.id} is a human check without a listed gate`);
      if (k !== 'human' && !c.check.run) E('I3', `criterion ${c.id}: its check needs run (a command that can fail)`);
      if (c.check.reference && !refs.some((r) => r.id === c.check.reference)) E('I3', `criterion ${c.id} checks against unknown reference ${c.check.reference}`);
      if (!PROXY_KINDS.includes(k)) continue;
      if (!c.check.calibration?.good || !c.check.calibration?.bad) { E('I3', `criterion ${c.id}: a ${k} check needs calibration.good and calibration.bad (cases it must pass and fail)`); continue; }
      if (typeof c.check.proxy !== 'boolean') E('I3', `criterion ${c.id}: say whether the ${k} check is a proxy (proxy: true|false)`);
      const cal = job.proofs?.calibration?.[c.id];
      if (!(cal?.good === 0 && cal?.bad > 0)) E('I3', `criterion ${c.id} is not calibrated: run job.mjs calibrate (known-good must pass, known-bad must fail)`);
    }
    for (const r of refs) if (atoms.some((a) => (a.references ?? []).includes(r.id)) && !criteria.some((c) => c.check?.reference === r.id))
      E('I3', `reference ${r.id} governs atoms but no criterion measures against it (likeness or match is a check)`);
    for (const g of job.gates ?? []) {
      if (!g.id || !g.what || !g.who || typeof g.criticalPath !== 'boolean') E('I11', `gate ${g.id ?? '?'} needs id, what, who and criticalPath`);
      if (g.approval && g.approval.via !== 'direct') E('I11', `gate ${g.id}: a relayed approval never counts; it must come from ${g.who} directly`);
    }
    if (!job.ratchet?.baseline && !(job.ratchet?.kind === 'tests' && x.kind?.splitByTests)) E('I10', 'ratchet: precommit the baseline no change may worsen (ratchet.baseline, or kind "tests" for code)');
    const engines = [...new Set(atoms.map((a) => a.engine).filter(Boolean))], smoke = job.proofs?.smoke;
    if (!engines.length) E('I9', 'atoms need an engine (codex, claude, script, …) so each path gets a smoke launch');
    const missing = engines.filter((e) => smoke?.engines?.[e] !== true);
    if (missing.length) E('I9', `no smoke receipt for ${missing.join(', ')} (one atom per engine before the wide launch)`);
    if (smoke && Object.values(smoke.engines ?? {}).some(Boolean) && !smoke.receipt) E('I12', 'the smoke proof claims a pass without a receipt path');
    if (!x.confirmation) E('I1', 'the job card has not been confirmed by the user (job.mjs card, then job.mjs confirm)');
    else if (!x.confirmation.ok) E('I1', x.confirmation.why);
    return out;
  },
  orchestrate(job, x) {
    const out = [], E = (i, m) => out.push([i, m]), r = job.resources ?? {};
    if (r.capacityDial !== true) E('I8', 'resources.capacityDial must be true (launch under the fleet dial)');
    if (!['heavy-run', 'gpu-queue', 'endoforge', 'hillclimb-fanout'].includes(r.throttle)) E('I8', 'resources.throttle must name the throttle every atom runs under (heavy-run, gpu-queue, endoforge, hillclimb-fanout)');
    if (x.atoms.some((a) => a.gpu) && r.gpu !== 'gpu-queue') E('I8', 'atoms use the GPU: resources.gpu must be "gpu-queue"');
    if (!x.health) E('I8', 'the machine health check has not run (job.mjs validate --gate orchestrate runs it)');
    else if (!x.health.ok) E('I8', `machine health refuses the launch: ${x.health.why}`);
    return out;
  },
  loop(job, x) {
    const out = [], E = (i, m) => out.push([i, m]);
    for (const r of job.rounds ?? []) {
      if (!r.receipt || (!x.offline && !fs.existsSync(r.receipt))) E('I12', `round ${r.round}: no receipt on disk for what it claims`);
      if (!r.lessons || (!x.offline && !fs.existsSync(r.lessons))) E('I14', `round ${r.round}: no LESSONS.md`);
    }
    if (job.ratchet?.baseline && !x.offline && !fs.existsSync(job.ratchet.baseline)) E('I10', `the ratchet baseline ${job.ratchet.baseline} is missing`);
    return out;
  },
};

/** Which gates hold rules citing each invariant: it "holds" only once all of them have been checked. */
export const CITED = { I1: ['pontificate', 'decide'], I2: ['observe', 'orient'], I3: ['decide'], I4: ['observe'], I5: ['orient'], I6: ['orient'],
  I7: ['observe'], I8: ['orchestrate'], I9: ['decide'], I10: ['decide', 'loop'], I11: ['decide'], I12: ['decide', 'loop'], I13: ['orient'], I14: ['pontificate', 'loop'] };

/** Validate up to `gate`. Options: offline (skip disk), volatile roots, confirmation {ok, why} (job card hash check),
 *  health {ok, why} (machine health at Orchestrate). */
export function validate(job, { gate = 'orchestrate', offline = false, volatile = VOLATILE, confirmation = undefined, health = null } = {}) {
  job = job ?? {};
  const upto = gateIndex(gate);
  if (upto < 0) throw new Error(`unknown gate ${gate} (${GATES.map((g) => g.id).join(', ')})`);
  const atoms = job.atoms ?? [], criteria = job.criteria ?? [];
  const x = { kind: KINDS[job.kind], atoms, ids: new Set(atoms.map((a) => a.id)), sources: job.sources ?? [], refs: job.references ?? [], criteria,
    crit: Object.fromEntries(criteria.map((c) => [c.id, c])), gates: Object.fromEntries((job.gates ?? []).map((g) => [g.id, g])), offline, volatile,
    confirmation: confirmation === undefined ? (job.confirmed ? { ok: true } : null) : confirmation, health };
  const errors = [], warnings = [], gates = {};
  for (const [i, g] of GATES.entries()) {
    if (i > upto) { gates[g.id] = 'not checked'; continue; }
    const found = [...RULES[g.id](job, x), ...(x.kind?.checks?.[g.id]?.(job, x) ?? []).map(([inv, m]) => [inv, `${job.kind}: ${m}`])];
    for (const [inv, msg] of found) errors.push({ gate: g.id, inv, msg });
    gates[g.id] = found.length ? 'refused' : 'passed';
  }
  if (upto >= gateIndex('orchestrate') && (job.resources ?? {}).ownerBound !== true) warnings.push({ gate: 'orchestrate', inv: 'I8', msg: 'atoms are not bound to their owner (playbook gap G4); a stopped driver leaves them running' });
  for (const g of job.gates ?? []) if (g.criticalPath) warnings.push({ gate: 'decide', inv: 'I11', msg: `gate ${g.id} sits on the critical path; run it beside the loop if it can` });
  const checked = new Set(GATES.slice(0, upto + 1).map((g) => g.id));
  const status = Object.fromEntries(INVARIANTS.map((i) => [i.id,
    errors.some((e) => e.inv === i.id) ? 'broken' : !CITED[i.id].every((g) => checked.has(g)) ? 'pending'
      : warnings.some((w) => w.inv === i.id) ? 'partial' : 'holds']));
  return { ok: !errors.length, gate, gates, errors, warnings, status };
}
