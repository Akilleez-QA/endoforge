import { performance } from 'node:perf_hooks';

export class ForgeKillScope {
  #controller = new AbortController();
  constructor({ level = 'isolate', parent, now = parent?.now ?? (() => performance.now()), latencyLimitMs = 1000 } = {}) {
    if (!['isolate', 'warp', 'block'].includes(level) || typeof now !== 'function' || !Number.isFinite(latencyLimitMs) || latencyLimitMs <= 0 ||
        (parent !== undefined && !(parent instanceof ForgeKillScope))) throw new TypeError('invalid kill scope');
    this.level = level;
    this.latencyLimitMs = latencyLimitMs;
    this.now = now;
    this.signal = parent ? AbortSignal.any([parent.signal, this.#controller.signal]) : this.#controller.signal;
  }
  kill(reason = 'killed') {
    if (!this.signal.aborted) this.#controller.abort({ reason: String(reason), requestedAt: this.now() });
  }
}
