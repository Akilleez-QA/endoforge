import { readFileSync } from 'node:fs';

const blank = () => ({ spawns: [], execs: [], writes: [], reads: [] });
const buckets = { generated: 'toCommit', need: 'toAdmit', admitting: 'admit', admitted: 'toCommit', committing: 'commit' };
export function windows(file) {
  const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const parent = new Map(), transportRoots = new Set();
  for (const event of events) {
    if (event.kind === 'child') parent.set(event.child, event.pid);
    if (event.kind === 'spawn' && event.sys === 'execve' && /\/claude$/.test(event.path)) transportRoots.add(event.pid);
  }
  const inTransport = pid => {
    for (let at = pid; at !== undefined; at = parent.get(at)) if (transportRoots.has(at)) return true;
    return false;
  };
  const out = {};
  let current = null, id = null, bucket = null;
  const fresh = () => ({ toAdmit: blank(), admit: blank(), toCommit: blank(), commit: blank(), model: blank(), transport: blank() });
  for (const event of events) {
    if (event.kind === 'mark') {
      const [name, stage] = event.path.split('/');
      id = name;
      out[id] ||= fresh();
      if (stage === 'model') current = out[id].model;
      else if (stage === 'model-returned') current = out[id][bucket];
      else if (stage === 'returned') { current = null; bucket = null; }
      else if (buckets[stage]) { bucket = buckets[stage]; current = out[id][bucket]; }
      continue;
    }
    if (event.kind === 'child' || !id || !out[id] || (!current && !inTransport(event.pid))) continue;
    const target = inTransport(event.pid) ? out[id].transport : current;
    if (event.kind === 'spawn') (event.sys.startsWith('exec') ? target.execs : target.spawns).push(event.sys);
    if (event.kind === 'write') target.writes.push(`${event.sys} ${event.path}`);
    if (event.kind === 'read') target.reads.push(event.path);
  }
  return out;
}
export const counts = window => ({ spawns: window.spawns.length, execs: window.execs.length, writes: window.writes.length, reads: window.reads.length });
