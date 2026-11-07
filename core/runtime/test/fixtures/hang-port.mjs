import { createPort as identityPort } from './identity-port.mjs';

export async function createPort(options = {}) {
  const port = await identityPort();
  return { ...port, describe(candidate) {
    if (options.hang) for (;;);
    return port.describe(candidate);
  } };
}
