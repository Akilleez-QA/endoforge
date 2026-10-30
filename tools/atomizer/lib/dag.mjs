// DAG helpers for atoms.json: topological order, waves (levels), critical path, speedup bound.
export function deps(atom) {
  return (atom.inputs ?? []).filter((i) => i.from && i.from !== 'need').map((i) => i.from);
}
export function topo(atoms) {
  const ids = new Set(atoms.map((a) => a.id));
  const indeg = new Map(atoms.map((a) => [a.id, 0]));
  const out = new Map(atoms.map((a) => [a.id, []]));
  for (const a of atoms) for (const d of deps(a)) if (ids.has(d)) { indeg.set(a.id, indeg.get(a.id) + 1); out.get(d).push(a.id); }
  const queue = atoms.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  const level = new Map(queue.map((id) => [id, 0]));
  const order = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const n of out.get(id)) {
      level.set(n, Math.max(level.get(n) ?? 0, level.get(id) + 1));
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  const cycle = order.length === atoms.length ? [] : atoms.map((a) => a.id).filter((id) => !order.includes(id));
  return { order, level, cycle, out };
}
/** Work-weighted plan: waves, total work, critical path, Amdahl-style speedup bound (unit cost per work point). */
export function plan(atoms) {
  const t = topo(atoms);
  if (t.cycle.length) return { cycle: t.cycle };
  const byId = new Map(atoms.map((a) => [a.id, a]));
  const w = (a) => Number(a.size?.work ?? 1);
  const cp = new Map();
  for (const id of t.order) {
    const a = byId.get(id);
    const d = deps(a).filter((x) => byId.has(x)).map((x) => cp.get(x) ?? 0);
    cp.set(id, w(a) + (d.length ? Math.max(...d) : 0));
  }
  const total = atoms.reduce((s, a) => s + w(a), 0);
  const critical = Math.max(...cp.values());
  const waves = {};
  for (const [id, l] of t.level) (waves[l] ??= []).push(id);
  const criticalPath = [];
  let cur = [...cp.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  while (cur) { criticalPath.unshift(cur); const d = deps(byId.get(cur)).filter((x) => byId.has(x)); cur = d.sort((x, y) => (cp.get(y) ?? 0) - (cp.get(x) ?? 0))[0]; }
  return {
    order: t.order, waves, total, critical, criticalPath,
    speedupBound: +(total / critical).toFixed(2), serialFraction: +(critical / total).toFixed(2),
    width: Math.max(...Object.values(waves).map((x) => x.length)),
  };
}
