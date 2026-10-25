// Structural validation of atoms.json against the schema in README.md and policy.json. Zero dependencies.
import { topo, deps } from './dag.mjs';
const KINDS = new Set(['interface', 'contract', 'tests', 'kernel', 'glue', 'data', 'compose', 'compose-draft', 'direct', 'review', 'repair', 'acceptance', 'other']);
const MODELS = new Set(['sonnet', 'opus', 'codex', 'script']);
export function validate(doc, policy) {
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  if (doc?.schema !== 'endoforge/atoms/1') E(`schema must be "endoforge/atoms/1" (got ${JSON.stringify(doc?.schema)})`);
  if (!doc?.need?.id || !doc?.need?.text) E('need.id and need.text are required');
  if (!Array.isArray(doc?.acceptance) || doc.acceptance.length === 0) E('acceptance must be a non-empty list written from the need');
  for (const [i, a] of (doc?.acceptance ?? []).entries()) {
    if (!a.id || !a.statement) E(`acceptance[${i}] needs id and statement`);
    if (!a.check || !['command', 'oracle', 'manual'].includes(a.check.kind)) E(`acceptance ${a.id ?? i}: check.kind must be command | oracle | manual`);
  }
  const atoms = Array.isArray(doc?.atoms) ? doc.atoms : [];
  if (!atoms.length) E('atoms must be a non-empty list');
  if (atoms.length > policy.maxAtoms) E(`${atoms.length} atoms exceed policy.maxAtoms ${policy.maxAtoms}`);
  const ids = new Set();
  for (const a of atoms) {
    if (!a.id || typeof a.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(a.id)) E(`atom id invalid: ${JSON.stringify(a.id)}`);
    if (ids.has(a.id)) E(`duplicate atom id ${a.id}`); ids.add(a.id);
    if (!KINDS.has(a.kind)) E(`${a.id}: kind must be one of ${[...KINDS].join(', ')}`);
    if (!a.contract || a.contract.length < 20) E(`${a.id}: contract missing or too short to verify against`);
    if (!Array.isArray(a.outputs) || !a.outputs.length) E(`${a.id}: at least one output`);
    for (const o of a.outputs ?? []) if (!o.name || !o.path || /\.\.|^\//.test(o.path)) E(`${a.id}: output needs name and a relative path (got ${JSON.stringify(o)})`);
    if (!a.verify) E(`${a.id}: verify (how the scheduler checks the output without a model) is required`);
    if (!a.worker || !MODELS.has(a.worker.model)) E(`${a.id}: worker.model must be sonnet | opus | codex | script`);
    if (a.worker?.model === 'script' && !Array.isArray(a.worker.command)) E(`${a.id}: a script worker needs worker.command (array)`);
    if (a.worker?.model !== 'script' && !a.worker?.prompt) E(`${a.id}: a model worker needs worker.prompt`);
    const work = Number(a.size?.work), iface = Number(a.size?.interface);
    if (!(work >= 1 && work <= 5) || !(iface >= 1 && iface <= 5)) E(`${a.id}: size.work and size.interface must be 1..5`);
    else { if (work > policy.singleShotMaxWork) E(`${a.id}: size.work ${work} > ${policy.singleShotMaxWork}: split further (not single-shot)`); if (iface > work) W(`${a.id}: interface ${iface} > work ${work}: over-atomized, consider merging`); }
  }
  const byId = new Map(atoms.map((a) => [a.id, a]));
  for (const a of atoms) for (const i of a.inputs ?? []) {
    if (i.from === 'need') continue;
    if (!byId.has(i.from)) { E(`${a.id}: input from unknown atom ${JSON.stringify(i.from)}`); continue; }
    if (i.output && !(byId.get(i.from).outputs ?? []).some((o) => o.name === i.output)) E(`${a.id}: input names output ${i.output} that ${i.from} does not declare`);
    const fk = byId.get(i.from).kind;
    for (const [src, dst, why] of policy.forbiddenEdges) if (fk === src && a.kind === dst) E(`${i.from} (${src}) -> ${a.id} (${dst}) is forbidden: ${why}`);
  }
  const t = topo(atoms);
  if (t.cycle.length) E(`cycle among ${t.cycle.join(', ')}`);
  const compose = atoms.filter((a) => a.kind === 'compose');
  const direct = atoms.filter((a) => a.kind === 'direct');
  if (direct.length) { if (atoms.length !== 1) E('a direct atom must be the only atom'); }
  else if (compose.length !== 1) E(`exactly one compose atom required (got ${compose.length})`);
  if (compose.length === 1 && !t.cycle.length) {
    const anc = new Set(); const stack = [compose[0].id];
    while (stack.length) { const id = stack.pop(); for (const d of deps(byId.get(id))) if (byId.has(d) && !anc.has(d)) { anc.add(d); stack.push(d); } }
    for (const a of atoms) if (a.id !== compose[0].id && !anc.has(a.id) && a.kind !== 'acceptance' && a.kind !== 'review') W(`${a.id} does not feed compose (dangling)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
