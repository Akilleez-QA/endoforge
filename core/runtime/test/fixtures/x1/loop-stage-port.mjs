import { appendFileSync } from 'node:fs';
import { createPort as base, warm } from '../../../x1/loop-port.mjs';
export { warm };
const { EF_KILL_STAGE: killStage, EF_MUTATE_FILE: mutateFile, EF_FLIP_ADMISSION: flipAdmission } = process.env;
export function createPort(options) {
  return base(options, { stage(name) {
    if (name === killStage) process.kill(process.pid, 'SIGKILL');
    if (name === 'gates:start' && mutateFile) appendFileSync(mutateFile, 'x');
    if (name === 'gates:start' && flipAdmission) options.admission.encoded += ' ';
  } });
}
