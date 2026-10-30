import fs from 'node:fs';
import os from 'node:os';

export function limits(env = process.env) {
  const cpus = os.availableParallelism?.() ?? os.cpus().length, ramGb = os.totalmem() / 2 ** 30;
  return {
    maxLoad: Number(env.ENDOFORGE_MAX_LOAD) || +(cpus * 0.875).toFixed(1),
    reserveGb: Number(env.ENDOFORGE_RESERVE_GB) || Math.max(8, Math.floor(ramGb * 0.12)),
  };
}

export function availableGb(meminfo = '/proc/meminfo') {
  try { return Number(fs.readFileSync(meminfo, 'utf8').match(/^MemAvailable:\s+(\d+)/m)[1]) / 2 ** 20; }
  catch { return os.freemem() / 2 ** 30; }
}

export function headroom(env = process.env, sample = { load1: os.loadavg()[0], availGb: availableGb() }) {
  if (env.ENDOFORGE_THROTTLE === '0') return { ok: true, off: true };
  const { maxLoad, reserveGb } = limits(env);
  const ok = sample.load1 < maxLoad && sample.availGb >= reserveGb;
  return { ok, load1: +sample.load1.toFixed(2), availGb: +sample.availGb.toFixed(1), maxLoad, reserveGb };
}
