import fs from 'node:fs';
import { createPort as measured } from '../P-20-pool-speed-rerun/addendum-port.mjs';

export async function createPort(options) {
  if (options.workload !== 'noop') return measured(options);
  fs.writeFileSync(options.out, JSON.stringify({ workload: 'noop', cell: process.pid }));
  throw Error('measured');
}
