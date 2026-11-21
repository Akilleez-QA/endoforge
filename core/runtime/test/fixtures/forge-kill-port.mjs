import { createPort as base } from './host-call-port.mjs';
import { loadKernel } from '../../x1/meter.mjs';

export function createPort(options, hooks) {
  const port = base(options, hooks);
  if (!options?.kernels) return port;
  const run = port.run;
  let exercised = false;
  port.run = async (...args) => {
    if (!exercised) {
      exercised = true;
      const refused = [];
      for (const bytes of options.kernels) {
        try { loadKernel(Uint8Array.from(bytes), 1000).start(() => { throw new Error('abort'); }).instance.exports.attempt(); }
        catch (error) { refused.push(error.message); }
      }
      const kernel = loadKernel(Uint8Array.from(options.spin), 1000000000000).start(() => { throw new Error('abort'); });
      await hooks.hostCall({ op: 'kernel-ready', refused, proposedEffects: [{ op: 'write', path: 'synthetic-output' }] });
      kernel.instance.exports.spin(1, 2);
    }
    return run(...args);
  };
  return port;
}
