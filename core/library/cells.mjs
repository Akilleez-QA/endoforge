import { Worker } from 'node:worker_threads';
const resourceLimits = { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 };
export class Cells {
  #idle = []; #waiting = []; #all = new Set(); #size; #deadlineMs; #closed = false; #jobs = 0;
  constructor({ size = 1, deadlineMs = 5000 } = {}) { this.#size = size; this.#deadlineMs = deadlineMs; }
  async ready() { await Promise.all(Array.from({ length: this.#size }, () => this.#start())); }
  #start() {
    const worker = new Worker(new URL('./cell.mjs', import.meta.url), { resourceLimits });
    this.#all.add(worker);
    return new Promise((resolve, reject) => {
      worker.once('message', () => { this.#release(worker); resolve(); });
      worker.once('error', reject);
    });
  }
  #release(worker) {
    const next = this.#waiting.shift();
    if (next) next(worker); else this.#idle.push(worker);
  }
  #take() { return this.#idle.pop() ?? new Promise(resolve => this.#waiting.push(resolve)); }
  async run(op, input) {
    if (this.#closed) throw Error('cells closed');
    const worker = await this.#take(), job = ++this.#jobs;
    return new Promise(resolve => {
      const finish = (value, replace) => {
        clearTimeout(timer);
        worker.off('message', message); worker.off('error', failed); worker.off('exit', exited);
        if (replace) { this.#all.delete(worker); worker.terminate(); if (!this.#closed) this.#start().catch(() => {}); } else this.#release(worker);
        resolve(value);
      };
      const message = reply => {
        if (reply.breach) finish({ error: 'cell_limit' }, true);
        else if (reply.job === job) finish(reply.error ? { error: reply.error } : { result: reply.result }, false);
      };
      const failed = error => finish({ error: `cell_failed:${error?.code ?? 'unknown'}` }, true);
      const exited = () => finish({ error: 'cell_exit' }, true);
      const timer = setTimeout(() => finish({ error: 'cell_timeout' }, true), this.#deadlineMs);
      worker.on('message', message); worker.once('error', failed); worker.once('exit', exited);
      worker.postMessage({ job, op, input });
    });
  }
  async close() {
    this.#closed = true;
    await Promise.all([...this.#all].map(worker => worker.terminate()));
    this.#all.clear();
  }
}
