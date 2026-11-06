import { readFileSync } from 'node:fs';

export function windows(file) {
  const out = {};
  let current = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.kind === 'mark') {
      const [id, stage] = event.path.split('/');
      out[id] ||= { toCommit: blank(), commit: blank() };
      current = stage === 'generated' ? out[id].toCommit : stage === 'committing' ? out[id].commit : null;
      continue;
    }
    if (!current) continue;
    if (event.kind === 'spawn') (event.sys.startsWith('exec') ? current.execs : current.spawns).push(event.sys);
    if (event.kind === 'write') current.writes.push(`${event.sys} ${event.path}`);
    if (event.kind === 'read') current.reads.push(event.path);
  }
  return out;
}
const blank = () => ({ spawns: [], execs: [], writes: [], reads: [] });
export const counts = window => ({ spawns: window.spawns.length, execs: window.execs.length, writes: window.writes.length, reads: window.reads.length });
