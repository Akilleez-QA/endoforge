import { mkdirSync, readFileSync, rmdirSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let defaultRoot;

export function prepareCgroup(root) {
  try {
    root ||= defaultRoot ||= join('/sys/fs/cgroup', readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.*)$/m)[1]);
    if (statfsSync(root).type !== 0x63677270) return null;
    const controllers = ['memory', 'cpu', 'pids'];
    const enabled = readFileSync(join(root, 'cgroup.subtree_control'), 'utf8').split(/\s+/);
    const missing = controllers.filter(name => !enabled.includes(name));
    if (missing.length) {
      const available = readFileSync(join(root, 'cgroup.controllers'), 'utf8').split(/\s+/);
      if (missing.some(name => !available.includes(name))) return null;
      const occupants = readFileSync(join(root, 'cgroup.procs'), 'utf8').trim().split(/\s+/).filter(Boolean);
      if (occupants.some(pid => Number(pid) !== process.pid)) return null;
      if (occupants.length) {
        const supervisor = join(root, `ef-supervisor-${process.pid}`);
        mkdirSync(supervisor, { recursive: true });
        writeFileSync(join(supervisor, 'cgroup.procs'), String(process.pid));
      }
      writeFileSync(join(root, 'cgroup.subtree_control'), missing.map(name => `+${name}`).join(' '));
    }
    return root;
  } catch { return null; }
}

export function attachCgroup(pid, root, limits) {
  if (!root) return null;
  let directory;
  try {
    directory = join(root, `ef-workcell-${process.pid}-${pid}`);
    mkdirSync(directory);
    for (const [name, value] of Object.entries({ 'memory.max': limits.memoryMax,
      'memory.oom.group': 1, 'cpu.max': limits.cpuMax, 'pids.max': limits.pidsMax })) {
      writeFileSync(join(directory, name), String(value));
    }
    writeFileSync(join(directory, 'cgroup.procs'), String(pid));
    return directory;
  } catch {
    if (directory) releaseCgroup(directory);
    return null;
  }
}

export function releaseCgroup(directory) {
  if (!directory) return;
  try { writeFileSync(join(directory, 'cgroup.kill'), '1'); } catch { }
  try { rmdirSync(directory); } catch { }
}
