import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ledgerRequest } from './isolate-ledger.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;

export class IsolatePool {
  #size;
  #hostPort;
  #limits;
  #wasmMemoryMaxMb;
  #cells = new Set();
  #queue = [];
  #pending = new Set();
  #ledger = Promise.resolve();
  #closing = false;
  #stopping = false;
  #closed;

  constructor({ hostPort, size = availableParallelism(), resourceLimits = {}, wasmMemoryMaxMb = 64 } = {}) {
    if (!positive(size)) throw new TypeError('positive integer pool size required');
    if (typeof hostPort !== 'string' || !hostPort) throw new TypeError('hostPort module path required');
    if (!positive(wasmMemoryMaxMb) || wasmMemoryMaxMb > 4096) {
      throw new TypeError('wasmMemoryMaxMb must be an integer from 1 to 4096');
    }
    const limits = { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, ...resourceLimits };
    if (Object.keys(limits).length !== 2 || !Object.values(limits).every(positive)) {
      throw new TypeError('positive integer old and young generation limits required');
    }
    if (process.execArgv.some(arg => /^--max[-_](old[-_]space|semi[-_]space)[-_]size/.test(arg)) ||
        /--max[-_](old[-_]space|semi[-_]space)[-_]size/.test(process.env.NODE_OPTIONS || '')) {
      throw new Error('heap command-line overrides conflict with workcell limits');
    }
    this.#size = size;
    this.#hostPort = pathToFileURL(resolve(hostPort)).href;
    this.#limits = Object.freeze(limits);
    this.#wasmMemoryMaxMb = wasmMemoryMaxMb;
  }

  get stats() {
    return { size: this.#size, workers: this.#cells.size,
      busy: [...this.#cells].filter(cell => cell.job).length, queued: this.#queue.length };
  }

  #persist(action, job, result) {
    const pending = this.#ledger.then(() => ledgerRequest(action, job, result));
    this.#ledger = pending.catch(() => {});
    return pending;
  }

  run(input) {
    if (this.#closing) return Promise.reject(new Error('isolate pool is closing'));
    let data;
    try {
      data = structuredClone(input);
      if (!Array.isArray(data.candidates) || !data.candidates.length ||
          !data.candidates.every(c => typeof c === 'string' && c.length) ||
          new Set(data.candidates).size !== data.candidates.length) throw new Error('unique candidates required');
    } catch (error) { return Promise.reject(error); }
    const promise = new Promise((resolve, reject) => {
      const job = { data, resolve, reject, ready: false };
      this.#queue.push(job);
      this.#persist('prepare', data).then(() => { job.ready = true; this.#pump(); }, error => {
        this.#queue.splice(this.#queue.indexOf(job), 1);
        reject(error);
        this.#pump();
      });
    });
    this.#pending.add(promise);
    promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
    return promise;
  }

  #spawn() {
    const worker = new Worker(new URL('./isolate-workcell.mjs', import.meta.url), {
      resourceLimits: this.#limits, execArgv: [],
      workerData: { wasmMemoryMaxMb: this.#wasmMemoryMaxMb },
    });
    const cell = { worker, id: worker.threadId, job: null, error: null };
    this.#cells.add(cell);
    worker.on('message', result => {
      if (!cell.job) return;
      if (result.type === 'limit') {
        cell.error = { code: result.error };
        return;
      }
      const job = cell.job;
      cell.job = null;
      this.#finish(job, result);
      this.#pump();
    });
    worker.on('error', error => { cell.error = error; });
    worker.on('exit', code => {
      this.#cells.delete(cell);
      if (cell.job) this.#finish(cell.job, { status: 'outcome_unknown',
        reason: ['ERR_WORKER_OUT_OF_MEMORY', 'ERR_WORKCELL_WASM_MEMORY_LIMIT'].includes(cell.error?.code) ? 'limit' : 'worker_exit',
        error: cell.error?.code || null, exitCode: code, report: null,
        workcell: cell.id, resourceLimits: this.#limits, wasmMemoryMaxMb: this.#wasmMemoryMaxMb });
      if (!this.#stopping) {
        try { this.#spawn(); } catch { }
        this.#pump();
      }
    });
    return cell;
  }

  #pump() {
    while (this.#queue[0]?.ready) {
      let cell = [...this.#cells].find(cell => !cell.job);
      if (!cell && this.#cells.size >= this.#size) return;
      const job = this.#queue.shift();
      try {
        cell ||= this.#spawn();
        cell.job = job;
        const { reference, candidates, portOptions } = job.data;
        cell.worker.postMessage({ reference, candidates, portOptions, hostPort: this.#hostPort });
      } catch (error) {
        if (cell) cell.job = null;
        this.#finish(job, { status: 'outcome_unknown', reason: error.message,
          report: null, workcell: cell?.id ?? null, resourceLimits: this.#limits, wasmMemoryMaxMb: this.#wasmMemoryMaxMb });
      }
    }
  }

  async #finish(job, result) {
    try { job.resolve({ ...result, receipts: await this.#persist('append', job.data, result) }); }
    catch (error) { error.result = result; job.reject(error); }
  }

  close() {
    this.#closing = true;
    return this.#closed ||= (async () => {
      await Promise.allSettled([...this.#pending]);
      this.#stopping = true;
      await Promise.all([...this.#cells].map(cell => cell.worker.terminate()));
    })();
  }
}
