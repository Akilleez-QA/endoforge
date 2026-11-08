import { setTimeout as sleep } from 'node:timers/promises';
import { createPort as basePort } from '../../core/runtime/x1/loop-port.mjs';
export { implementationFiles, verifyFromMemory, warm } from '../../core/runtime/x1/loop-port.mjs';

const delayMs = Number(process.env.P62_CELL_DELAY_MS) || 0;
export function createPort(options, context) {
  const port = basePort(options, context), evaluate = port.evaluate;
  port.evaluate = async (...args) => { if (delayMs) await sleep(delayMs); return evaluate(...args); };
  return port;
}
