import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createController } from '../capacity/controller.mjs';

const TICKS = 100;
const PROC = existsSync('/proc/self/stat');
export const parseCpuTime = text => {
  const [clock, days = null] = text.trim().split('-').reverse();
  const parts = clock.split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return null;
  return (parts.reduce((total, part) => total * 60 + part, 0) + Number(days ?? 0) * 86400) * 1000;
};
const ps = (pids, field) => {
  try { return execFileSync('/bin/ps', ['-o', `${field}=`, '-p', pids.join(',')], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean); } catch { return null; }
};
const cpuOf = pids => {
  if (!PROC) {
    const lines = pids.length ? ps(pids, 'time') : [];
    if (!lines || lines.length !== pids.length) return null;
    const times = lines.map(parseCpuTime);
    return times.some(time => time === null) ? null : times.reduce((a, b) => a + b, 0);
  }
  let ticks = 0;
  for (const pid of pids) {
    try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); ticks += Number(fields[11]) + Number(fields[12]); } catch { return null; }
  }
  return ticks / TICKS * 1000;
};
const rssOf = pids => {
  if (!PROC) {
    const lines = pids.length ? ps(pids, 'rss') : [];
    return !lines || lines.length !== pids.length ? null : lines.reduce((total, line) => total + Number(line) / 1024, 0);
  }
  let pages = 0;
  for (const pid of pids) { try { pages += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]); } catch { return null; } }
  return pages * 4096 / 1048576;
};

export function createCohortSet({ plan, make, controller: controllerOptions = {} }) {
  const runners = plan.cohorts.map(cohort => make(cohort));
  const queue = [];
  let closed = false;
  const self0 = process.cpuUsage();
  const cpuMs = () => {
    const cohorts = cpuOf(runners.map(runner => runner.pid).filter(Boolean));
    if (cohorts === null) return null;
    const self = process.cpuUsage(self0);
    return cohorts + (self.user + self.system) / 1000;
  };
  const rssMb = () => rssOf(runners.map(runner => runner.pid).filter(Boolean));
  const controller = createController({ plan, cpuMs, rssMb, backlog: () => queue.length, apply: widths => { widths.forEach((width, index) => runners[index].setWidth(width)); pump(); }, ...controllerOptions });
  const free = runner => runner.width - runner.load;
  const pump = () => {
    while (queue.length) {
      let target = null;
      for (const runner of runners) if (free(runner) > 0 && (!target || free(runner) > free(target))) target = runner;
      if (!target) return;
      const { method, job, resolve, reject } = queue.shift();
      controller.started();
      target[method](job).then(result => {
        controller.completed(result.status === 'completed' || result.status === 'checked' || result.status === 'refused');
        resolve(result);
      }, error => { controller.completed(false); reject(error); }).finally(pump);
    }
  };
  const submit = method => job => closed ? Promise.reject(new Error('cohort set closed')) : new Promise((resolve, reject) => { queue.push({ method, job, resolve, reject }); pump(); });
  return {
    plan,
    controller,
    runners,
    get width() { return runners.reduce((total, runner) => total + runner.width, 0); },
    get widths() { return runners.map(runner => runner.width); },
    get pid() { return runners[0].pid; },
    get pids() { return runners.map(runner => runner.pid).filter(Boolean); },
    get stats() { return runners.reduce((total, { stats }) => { for (const key of Object.keys(stats)) total[key] = (total[key] || 0) + stats[key]; return total; }, {}); },
    ready: () => Promise.all(runners.map(runner => runner.ready())).then(() => undefined),
    run: submit('run'),
    runChecked: submit('runChecked'),
    async runTwice(job) {
      const first = await this.run(job), second = await this.run(job);
      if (first.status !== second.status || first.output !== second.output || first.reason !== second.reason) return { ...first, status: 'refused', reason: 'nondeterministic', second: { status: second.status, reason: second.reason, outputSha256: second.outputSha256 } };
      return { ...first, comparedRuns: 2 };
    },
    async close() { closed = true; for (const entry of queue.splice(0)) entry.reject(new Error('cohort set closed')); await Promise.all(runners.map(runner => runner.close())); },
  };
}
