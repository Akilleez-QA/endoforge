import { createPort as identityPort } from './identity-port.mjs';

export async function createPort({ recurse } = {}) {
  const port = await identityPort();
  const down = () => down();
  return { ...port, describe(candidate) {
    if (recurse) down();
    return port.describe(candidate);
  } };
}
