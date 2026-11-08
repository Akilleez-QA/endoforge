import { readFileSync } from 'node:fs';
import { createController } from '../capacity/controller.mjs';

const TICKS = 100;
const cpuOf = pids => {
  let ticks = 0;
  for (const pid of pids) {
    try { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); ticks += Number(fields[11]) + Number(fields[12]); } catch { return null; }
  }
  return ticks / TICKS * 1000;
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
  const rssMb = () => {
    let pages = 0;
    for (const pid of runners.map(runner => runner.pid).filter(Boolean)) { try { pages += Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]); } catch { return null; } }
    return pages * 4096 / 1048576;
  };
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
