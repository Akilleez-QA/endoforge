// Fixed repair stage (policy.repairStage): compose-draft -> repair (sees only the failing tests) -> compose (final) -> reviews.
const CANONICAL = ['kernel.wasm', 'kernel.wat', 'kernel.ts', 'CONTRACT.md', 'tests.json', 'glue.json', 'gates.json', 'failures.json', 'frozen.sha256'];
const REVIEW_SET = ['CONTRACT.md', 'glue.json', 'gates.json', 'tests.json'];
/** The compose helper writes a fixed set of files; make the compose atom's declared outputs match it and remap references to anything else. */
export function normalizeCompose(doc) {
  const atoms = doc.atoms.map((a) => structuredClone(a));
  const compose = atoms.find((a) => a.kind === 'compose');
  if (!compose || compose.worker.model === 'script') return { ...doc, atoms };
  const kept = [], dropped = [];
  for (const o of compose.outputs) { const base = o.path.replace(/\/+$/, '').split('/').pop(); if (CANONICAL.includes(base)) kept.push({ ...o, path: base }); else dropped.push(o.name); }
  const byPath = new Map(kept.map((o) => [o.path, o]));
  for (const p of CANONICAL) if (!byPath.has(p)) { const o = { name: p.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase(), path: p, describe: `${p} written by the compose helper` }; if (kept.some((k) => k.name === o.name)) o.name = `file-${o.name}`; kept.push(o); byPath.set(p, o); }
  compose.outputs = kept;
  if (dropped.length) for (const at of atoms) if (at.id !== compose.id) at.inputs = (at.inputs ?? []).flatMap((i) => (i.from === compose.id && dropped.includes(i.output)) ? REVIEW_SET.map((p) => ({ from: compose.id, output: byPath.get(p).name })) : [i]).filter((i, idx, arr) => arr.findIndex((x) => x.from === i.from && x.output === i.output) === idx);
  return { ...doc, atoms, normalizedCompose: { dropped, outputs: kept.map((o) => o.path) } };
}
export function augment(doc0, policy) {
  const doc = normalizeCompose(doc0);
  if (!policy.repairStage) return doc;
  const atoms = doc.atoms.map((a) => structuredClone(a));
  const compose = atoms.find((a) => a.kind === 'compose');
  const kernels = atoms.filter((a) => a.kind === 'kernel' && a.worker.model !== 'script');
  if (!compose || !kernels.length || atoms.some((a) => a.kind === 'repair' || a.kind === 'compose-draft')) return doc;
  const X = compose.id;
  const draft = structuredClone(compose);
  draft.id = `${X}-draft`; draft.kind = 'compose-draft'; draft.title = `${compose.title ?? X} (draft)`;
  const kernelIds = new Set(kernels.map((k) => k.id));
  const failuresName = draft.outputs.find((o) => o.path === 'failures.json').name;
  const repairInputs = [{ from: draft.id, output: failuresName }];
  for (const k of kernels) {
    repairInputs.push({ from: k.id });
    for (const i of k.inputs ?? []) if (i.from !== 'need' && !kernelIds.has(i.from) && !repairInputs.some((r) => r.from === i.from && r.output === i.output)) repairInputs.push({ ...i });
  }
  const paths = kernels.flatMap((k) => k.outputs.map((o) => o.path));
  const collide = new Set(paths.filter((p, i) => paths.indexOf(p) !== i));
  const repairOutputs = kernels.flatMap((k) => k.outputs.map((o) => ({ name: `${k.id}-${o.name}`, path: collide.has(o.path) ? `${k.id}--${o.path}` : o.path, describe: `${o.describe ?? o.name} (repaired where the kernel was wrong, else unchanged)` })));
  repairOutputs.push({ name: 'notes', path: 'repair-notes.md', describe: 'what was repaired and why, or that no gate failed' });
  const repair = {
    id: 'repair', kind: 'repair', title: 'One repair round against the failing tests of the draft',
    contract: 'Return every kernel part: repaired where a failing test proves the kernel wrong against the contract, interface and data; unchanged where the expectation is the wrong one, with the reason and the arithmetic in repair-notes.md. Never touch tests or the contract.',
    inputs: repairInputs, outputs: repairOutputs, verify: 'every kernel part present and non-empty; repair-notes.md present',
    worker: { model: 'sonnet', tools: ['Bash', 'Read', 'Write', 'Edit'], prompt: 'Repair only what a failing test proves wrong in the kernel. Where the expectation is wrong, leave the kernel alone and say so with the arithmetic, so the reviewers can judge.' },
    size: { work: 2, interface: 2 },
  };
  const final = structuredClone(compose);
  final.title = `${compose.title ?? X} (final, after one repair round)`;
  final.inputs = compose.inputs.filter((i) => !kernelIds.has(i.from));
  for (const o of repairOutputs) if (o.name !== 'notes') final.inputs.push({ from: 'repair', output: o.name });
  for (const a of atoms) if (a.kind === 'review') a.inputs = [...(a.inputs ?? []), { from: 'repair', output: 'notes' }];
  if (policy.scriptFirst) {
    const helper = (id) => ({ command: ['node', '{atomizer}/bin/compose-kernel.mjs', '--id', doc.need.id, '--in', '{in}', '--out', '{out}', '--work', '{work}', '--gate', '{gate}', '--preflight'], toolchain: ['node', 'asc', 'gate', 'atomizer'], note: 'deterministic compose; the agent runs only if the helper cannot compile the parts' });
    draft.worker.preflight = helper(draft.id); final.worker.preflight = helper(X);
    const map = []; let oi = 0;
    for (const k of kernels) for (const o of k.outputs) { map.push({ from: `/in/${k.id}/${o.path}`, to: `/out/${repairOutputs[oi].path}` }); oi++; }
    repair.worker.preflight = { command: ['node', '{atomizer}/bin/repair-noop.mjs', '--failures', `/in/${draft.id}/failures.json`, '--map', JSON.stringify(map)], toolchain: ['node', 'atomizer'], note: 'copy parts unchanged when the draft has no failing test' };
  }
  const others = atoms.filter((a) => a.id !== X);
  return { ...doc, atoms: [...others, draft, repair, final], augmented: { repairStage: true, draft: draft.id, repair: 'repair', final: X, repairSees: 'failing tests only (name, fn, args, expected, got), one round' } };
}
